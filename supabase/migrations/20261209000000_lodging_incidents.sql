-- แจ้งเหตุระหว่างงานแข่งขัน (คนที่มาพัก/มาแข่ง ไม่ต้องมีบัญชี): น้ำไม่ไหล ไฟดับ ห้องพัก/ห้องน้ำชำรุด เฉี่ยวชน รถขวางทาง เจ็บป่วย อื่นๆ
--   หน้าสาธารณะ /stay/report → edge function lodging-public (action report / report_status) → RPC ที่ grant ให้ service_role เท่านั้น
--   ทีมรับเรื่อง (lodging_incident_handler): ฝ่ายจัดห้อง + เจ้าหน้าที่อาคารสถานที่ + หัวหน้างานยานพาหนะ
--     เห็นในแท็บ "แจ้งเหตุ" ของ /lodging · รับเรื่อง → แก้ไขแล้ว (lodging_incident_update) หรือกดจากการ์ด LINE (line_incident_update)
--   ผู้ดู (อ่านอย่างเดียว): ผู้ดูรายละเอียดห้องพัก (lodging_is_viewer) เช่น หัวหน้าฝ่าย ผู้บริหาร
--   แจ้งเตือน LINE: trigger → line-bot event 'lodging_incident' (ผู้รับเลือกตามประเภทใน logic.ts)
--   รูป: bucket private incident-photos อัปโหลดโดย edge function (service_role) อ่านผ่าน signed URL

create table public.lodging_incidents (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.lodging_events(id) on delete cascade,
  ref_code text not null unique,
  category text not null check (category in ('water','power','room','crash','blocked','medical','other')),
  location text not null check (length(location) between 2 and 200),
  map_x real, map_y real,
  detail text check (length(detail) <= 1000),
  reporter_name text not null check (length(reporter_name) between 2 and 80),
  phone text not null check (phone ~ '^0[0-9]{8,9}$'),
  school_name text check (length(school_name) <= 120),
  request_id bigint references public.lodging_requests(id) on delete set null,
  photo_path text,
  status text not null default 'new' check (status in ('new','acknowledged','resolved')),
  staff_note text check (length(staff_note) <= 500),
  handled_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index lodging_incidents_event_idx on public.lodging_incidents (event_id, status, created_at desc);

alter table public.lodging_submit_log drop constraint lodging_submit_log_kind_check;
alter table public.lodging_submit_log add constraint lodging_submit_log_kind_check check (kind in ('submit','find','incident'));

-- ============================================================ สิทธิ์
create or replace function public.lodging_incident_handler() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_roles() && array['facilities_head','admin','inspector','vehicle_head']::text[], false)
$$;
revoke execute on function public.lodging_incident_handler() from public, anon;
grant execute on function public.lodging_incident_handler() to authenticated;

alter table public.lodging_incidents enable row level security;
revoke all on public.lodging_incidents from anon, authenticated;
grant select on public.lodging_incidents to authenticated;
create policy lodging_incidents_read on public.lodging_incidents for select to authenticated
  using (public.lodging_incident_handler() or public.lodging_is_viewer());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incident-photos', 'incident-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;
create policy incident_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'incident-photos' and (public.lodging_incident_handler() or public.lodging_is_viewer()));

-- ============================================================ หน้าสาธารณะ (service_role เท่านั้น)
-- งานที่รับแจ้งเหตุ = งานที่เปิดอยู่ล่าสุด (ไม่ผูกกับเวลาปิดรับคำขอที่พัก)
create or replace function public.lodging_public_report(p_ip_hash text, p_category text, p_location text, p_x real, p_y real,
  p_detail text, p_name text, p_phone text, p_request_ref text, p_photo text) returns text
language plpgsql security definer set search_path = '' as $$
declare e public.lodging_events; v_ref text; v_req public.lodging_requests; v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  select * into e from public.lodging_events where active order by starts_on desc limit 1;
  if not found then raise exception 'not_found'; end if;
  if coalesce(p_category, '') not in ('water','power','room','crash','blocked','medical','other')
     or length(btrim(coalesce(p_location, ''))) < 2 or length(btrim(coalesce(p_name, ''))) < 2 or v_phone !~ '^0[0-9]{8,9}$'
     or (p_photo is not null and p_photo !~ '^[0-9a-f-]{36}\.jpg$') then
    raise exception 'bad_request';
  end if;
  if (select count(*) from public.lodging_submit_log where ip_hash = p_ip_hash and kind = 'incident' and at > now() - interval '1 hour') >= 30
     or (select count(*) from public.lodging_incidents where event_id = e.id and created_at > now() - interval '1 hour') >= 200 then
    raise exception 'rate_limited';
  end if;
  insert into public.lodging_submit_log (ip_hash, kind) values (p_ip_hash, 'incident');
  if p_request_ref is not null then
    select * into v_req from public.lodging_requests where ref_code = upper(btrim(p_request_ref)) and event_id = e.id;
  end if;
  loop
    v_ref := private.lodging_new_ref();
    exit when not exists (select 1 from public.lodging_incidents where ref_code = v_ref);
  end loop;
  insert into public.lodging_incidents (event_id, ref_code, category, location, map_x, map_y, detail, reporter_name, phone,
    school_name, request_id, photo_path)
  values (e.id, v_ref, p_category, left(btrim(p_location), 200),
          case when p_x between 0 and 2000 and p_y between 0 and 2000 then p_x end,
          case when p_x between 0 and 2000 and p_y between 0 and 2000 then p_y end,
          nullif(left(btrim(coalesce(p_detail, '')), 1000), ''), left(btrim(p_name), 80), v_phone,
          v_req.school_name, v_req.id, p_photo);
  return v_ref;
end $$;

-- สถานะสำหรับผู้แจ้ง (ด้วยรหัสติดตาม) — ไม่ส่งชื่อเจ้าหน้าที่
create or replace function public.lodging_public_report_status(p_ref text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ref', i.ref_code, 'category', i.category, 'location', i.location, 'detail', i.detail,
           'status', i.status, 'staff_note', i.staff_note, 'created_at', i.created_at,
           'acknowledged_at', i.acknowledged_at, 'resolved_at', i.resolved_at, 'event_name', e.name)
  from public.lodging_incidents i join public.lodging_events e on e.id = i.event_id
  where i.ref_code = upper(btrim(p_ref))
$$;

-- ============================================================ ทีมรับเรื่อง
create or replace function private.lodging_incident_set(p_actor uuid, p_id bigint, p_status text, p_note text) returns public.lodging_incidents
language plpgsql security definer set search_path = '' as $$
declare i public.lodging_incidents;
begin
  if p_status not in ('acknowledged','resolved') then raise exception 'bad_request'; end if;
  select * into i from public.lodging_incidents where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if i.status = 'resolved' or (i.status = p_status and p_note is null) then raise exception 'not_pending'; end if;
  update public.lodging_incidents set
    status = p_status,
    staff_note = coalesce(nullif(left(btrim(coalesce(p_note, '')), 500), ''), staff_note),
    handled_by = p_actor,
    acknowledged_at = coalesce(acknowledged_at, now()),
    resolved_at = case when p_status = 'resolved' then now() end
  where id = p_id returning * into i;
  return i;
end $$;
revoke execute on function private.lodging_incident_set(uuid, bigint, text, text) from public, anon, authenticated;

create or replace function public.lodging_incident_update(p_id bigint, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(), '') = '' or not public.lodging_incident_handler() then raise exception 'forbidden'; end if;
  perform private.lodging_incident_set(auth.uid(), p_id, p_status, p_note);
end $$;
revoke execute on function public.lodging_incident_update(bigint, text, text) from public, anon;
grant execute on function public.lodging_incident_update(bigint, text, text) to authenticated;

-- ปุ่มในการ์ด LINE: ผู้กดต้องผูก LINE แล้วและเป็นทีมรับเรื่อง
create or replace function public.line_incident_update(p_line_user text, p_id bigint, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.profiles; i public.lodging_incidents;
begin
  select * into p from public.profiles where line_user_id = p_line_user;
  if not found then raise exception 'not_linked'; end if;
  if not ((array[p.role] || p.extra_roles) && array['facilities_head','admin','inspector','vehicle_head']::text[]) then
    raise exception 'forbidden';
  end if;
  i := private.lodging_incident_set(p.id, p_id, p_status, null);
  return jsonb_build_object('status', i.status, 'location', i.location, 'category', i.category, 'by', p.full_name);
end $$;

-- ข้อมูลการ์ดแจ้งเตือน LINE
create or replace function public.line_incident_info(p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'category', i.category, 'location', i.location, 'detail', i.detail,
           'reporter_name', i.reporter_name, 'phone', i.phone, 'school_name', i.school_name, 'status', i.status,
           'has_photo', i.photo_path is not null, 'created_at', i.created_at, 'event_name', e.name)
  from public.lodging_incidents i join public.lodging_events e on e.id = i.event_id where i.id = p_id
$$;

revoke execute on function public.lodging_public_report(text, text, text, real, real, text, text, text, text, text),
  public.lodging_public_report_status(text), public.line_incident_update(text, bigint, text), public.line_incident_info(bigint)
from public, anon, authenticated;
grant execute on function public.lodging_public_report(text, text, text, real, real, text, text, text, text, text),
  public.lodging_public_report_status(text), public.line_incident_update(text, bigint, text), public.line_incident_info(bigint)
to service_role;

-- ============================================================ แจ้งเตือน LINE เมื่อมีเหตุใหม่ (ใช้ private.config เดิม)
create or replace function private.notify_line_incident() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select value into v_url from private.config where key = 'line_notify_url';
  select value into v_secret from private.config where key = 'line_notify_secret';
  if v_url is null or v_secret is null then return new; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('type', 'lodging_incident', 'incident_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret)
  );
  return new;
exception when others then
  return new;
end $$;
revoke execute on function private.notify_line_incident() from public, anon, authenticated;
create trigger lodging_incidents_notify_line after insert on public.lodging_incidents
  for each row execute function private.notify_line_incident();
