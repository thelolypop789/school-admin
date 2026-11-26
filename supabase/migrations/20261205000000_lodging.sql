-- ============================================================
-- ห้องพักสำหรับงานแข่งขัน (เริ่มที่งานปาริชาติ 25–27 ธ.ค. 2569 ใช้ซ้ำกับงานอื่นได้)
--   โรงเรียนที่มาแข่งขอที่พักเองทางหน้า /stay (ไม่ต้องมีบัญชี — ผ่าน edge function lodging-public เท่านั้น)
--   หรือฝ่ายจัดห้องบันทึกแทน; ขอเป็น "จำนวนคน" (นักเรียนชาย/หญิง/ครู) ไม่เลือกห้องเอง
--   ฝ่ายจัดห้อง (facilities_head/admin) จัดคนลงห้องตามที่นั่งเหลือ แล้วอนุมัติ; ฟรี ไม่มีลงทะเบียนกุญแจ
--   ทุกคน (รวมหน้าจองสาธารณะ) เห็นห้องว่าง/เต็ม ไม่เห็นชื่อโรงเรียน; ชื่อ/เบอร์เห็นเฉพาะทีมอาคารสถานที่/ผู้บริหารฝ่าย
-- รันหลัง 20261204000000_nst_post_map.sql
-- ============================================================

create table public.lodging_events (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null check (length(name) between 1 and 120),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  closes_at timestamptz not null,               -- หมดเขตขอที่พัก (ค่าเริ่มต้น = เที่ยงคืนวันแรกของงาน)
  note text not null default '' check (length(note) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.lodging_rooms (
  id bigint generated always as identity primary key,
  building text not null check (length(building) between 1 and 40),
  floor smallint not null check (floor between 1 and 20),
  name text not null check (length(name) between 1 and 40),
  capacity smallint not null check (capacity between 1 and 200),
  sort int not null default 0,
  active boolean not null default true,
  unique (building, name)
);

create table public.lodging_requests (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.lodging_events on delete cascade,
  ref_code text not null unique,                -- รหัสติดตามสถานะของโรงเรียน (สุ่ม เดาไม่ได้)
  school_name text not null check (length(school_name) between 2 and 120),
  contact_name text not null check (length(contact_name) between 2 and 80),
  phone text not null check (phone ~ '^0[0-9]{8,9}$'),
  male_students int not null default 0 check (male_students between 0 and 500),
  female_students int not null default 0 check (female_students between 0 and 500),
  teachers int not null default 0 check (teachers between 0 and 200),
  note text check (length(note) <= 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  source text not null default 'public' check (source in ('public','staff')),
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles on delete set null,
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 500),
  check (male_students + female_students + teachers between 1 and 600)
);
create index lodging_requests_event_idx on public.lodging_requests (event_id, status);

-- การจัดคนลงห้อง (คำขอหนึ่งแยกได้หลายห้อง ห้องหนึ่งรับได้หลายโรงเรียนจนเต็ม)
create table public.lodging_allocations (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.lodging_requests on delete cascade,
  room_id bigint not null references public.lodging_rooms,
  people smallint not null check (people between 1 and 200),
  kind text not null check (kind in ('male','female','teacher','mixed')),
  unique (request_id, room_id, kind)
);
create index lodging_allocations_room_idx on public.lodging_allocations (room_id);

-- กันสแปมหน้าสาธารณะ (เก็บ hash ของ IP ไม่ใช่ IP จริง)
create table public.lodging_submit_log (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  at timestamptz not null default now()
);
create index lodging_submit_log_idx on public.lodging_submit_log (ip_hash, at);

-- ============================================================ สิทธิ์
-- ฝ่ายจัดห้อง: จัดห้อง/อนุมัติ/ตั้งค่า · ผู้ดูรายละเอียด: + เจ้าหน้าที่อาคารสถานที่ หัวหน้าฝ่าย ผู้บริหาร
create or replace function public.lodging_is_team() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_roles() && array['facilities_head','admin']::text[], false)
$$;
create or replace function public.lodging_is_viewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_roles() && array['facilities_head','admin','inspector','ga_head','deputy','director']::text[], false)
$$;
revoke execute on function public.lodging_is_team(), public.lodging_is_viewer() from public, anon;
grant execute on function public.lodging_is_team(), public.lodging_is_viewer() to authenticated;

alter table public.lodging_events enable row level security;
alter table public.lodging_rooms enable row level security;
alter table public.lodging_requests enable row level security;
alter table public.lodging_allocations enable row level security;
alter table public.lodging_submit_log enable row level security;
revoke all on public.lodging_events, public.lodging_rooms, public.lodging_requests, public.lodging_allocations,
  public.lodging_submit_log from anon, authenticated;
grant select on public.lodging_events, public.lodging_rooms, public.lodging_requests, public.lodging_allocations to authenticated;
-- งาน/ห้อง: บุคลากรทุกคน · คำขอ/การจัดห้อง (มีชื่อ เบอร์โทร): เฉพาะผู้ดูรายละเอียด
create policy lodging_events_read on public.lodging_events for select to authenticated using (public.my_role() is not null);
create policy lodging_rooms_read on public.lodging_rooms for select to authenticated using (public.my_role() is not null);
create policy lodging_requests_read on public.lodging_requests for select to authenticated using (public.lodging_is_viewer());
create policy lodging_allocations_read on public.lodging_allocations for select to authenticated using (public.lodging_is_viewer());

-- ============================================================ ตัวช่วย
create or replace function private.lodging_total(r public.lodging_requests) returns int
language sql immutable set search_path = '' as $$ select r.male_students + r.female_students + r.teachers $$;

-- ที่นั่งที่ใช้ไปของห้องในงานนี้ (คำขอที่รอ/อนุมัติแล้ว) ไม่นับคำขอที่ระบุ
create or replace function private.lodging_used(p_event bigint, p_room bigint, p_except bigint default null) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(a.people), 0)::int from public.lodging_allocations a join public.lodging_requests q on q.id = a.request_id
  where q.event_id = p_event and a.room_id = p_room and q.status in ('pending','approved') and q.id is distinct from p_except
$$;
revoke execute on function private.lodging_total(public.lodging_requests), private.lodging_used(bigint, bigint, bigint)
  from public, anon, authenticated;

-- ห้องว่าง/เต็มของงาน (ไม่มีชื่อโรงเรียน) — ใช้ทั้งในแอปและหน้าสาธารณะ
create or replace function private.lodging_rooms_json(p_event bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'building', r.building, 'floor', r.floor, 'name', r.name, 'capacity', r.capacity,
      'approved', coalesce(u.approved, 0), 'pending', coalesce(u.pending, 0))
    order by r.building, r.floor, r.sort, r.name), '[]'::jsonb)
  from public.lodging_rooms r
  left join (
    select a.room_id,
           sum(a.people) filter (where q.status = 'approved') as approved,
           sum(a.people) filter (where q.status = 'pending') as pending
    from public.lodging_allocations a join public.lodging_requests q on q.id = a.request_id
    where q.event_id = p_event group by a.room_id) u on u.room_id = r.id
  where r.active
$$;
revoke execute on function private.lodging_rooms_json(bigint) from public, anon, authenticated;

create or replace function public.lodging_occupancy(p_event bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(), '') = '' then raise exception 'forbidden'; end if;
  return private.lodging_rooms_json(p_event);
end $$;

create or replace function private.lodging_new_ref() returns text
language sql volatile set search_path = '' as $$ select upper(encode(extensions.gen_random_bytes(6), 'hex')) $$;
revoke execute on function private.lodging_new_ref() from public, anon, authenticated;

-- ============================================================ ฝ่ายจัดห้อง
create or replace function public.lodging_staff_create(
  p_event bigint, p_school text, p_contact text, p_phone text, p_male int, p_female int, p_teachers int, p_note text
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not public.lodging_is_team() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.lodging_events where id = p_event and active) then raise exception 'not_found'; end if;
  insert into public.lodging_requests (event_id, ref_code, school_name, contact_name, phone, male_students, female_students, teachers,
                                       note, source, created_by)
  values (p_event, private.lodging_new_ref(), btrim(p_school), btrim(p_contact), regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'),
          coalesce(p_male, 0), coalesce(p_female, 0), coalesce(p_teachers, 0), nullif(btrim(p_note), ''), 'staff', auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- แก้จำนวนคน/ข้อมูลติดต่อ (เช่น โรงเรียนโทรมาเปลี่ยน)
create or replace function public.lodging_request_update(
  p_id bigint, p_school text, p_contact text, p_phone text, p_male int, p_female int, p_teachers int, p_note text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.lodging_is_team() then raise exception 'forbidden'; end if;
  update public.lodging_requests set school_name = btrim(p_school), contact_name = btrim(p_contact),
    phone = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), male_students = coalesce(p_male, 0),
    female_students = coalesce(p_female, 0), teachers = coalesce(p_teachers, 0), note = nullif(btrim(p_note), '')
  where id = p_id and status in ('pending','approved');
  if not found then raise exception 'not_found'; end if;
end $$;

-- จัดคนลงห้อง (แทนที่ทั้งชุดของคำขอนี้): [{room_id, people, kind}] — ห้ามเกินที่นั่งเหลือ
create or replace function public.lodging_allocate(p_request bigint, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.lodging_requests; r jsonb; v_room public.lodging_rooms; v_want int;
begin
  if not public.lodging_is_team() then raise exception 'forbidden'; end if;
  select * into q from public.lodging_requests where id = p_request for update;
  if not found or q.status not in ('pending','approved') then raise exception 'not_found'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'bad_request'; end if;
  delete from public.lodging_allocations where request_id = q.id;
  for r in select * from jsonb_array_elements(p_rows) loop
    continue when coalesce((r->>'people')::int, 0) <= 0;
    select * into v_room from public.lodging_rooms where id = (r->>'room_id')::bigint and active for update;
    if not found then raise exception 'room_not_found'; end if;
    insert into public.lodging_allocations (request_id, room_id, people, kind)
    values (q.id, v_room.id, (r->>'people')::int, coalesce(r->>'kind', 'mixed'))
    on conflict (request_id, room_id, kind) do update set people = public.lodging_allocations.people + excluded.people;
  end loop;
  -- ตรวจที่นั่งหลังรวมแล้ว (ล็อกแถวห้องไว้แล้ว กันจัดชนกันพร้อมกัน)
  for v_room in select ro.* from public.lodging_rooms ro where ro.id in (select room_id from public.lodging_allocations where request_id = q.id) loop
    select coalesce(sum(people), 0) into v_want from public.lodging_allocations where request_id = q.id and room_id = v_room.id;
    if private.lodging_used(q.event_id, v_room.id, q.id) + v_want > v_room.capacity then
      raise exception 'room_full:%', v_room.name;
    end if;
  end loop;
  if (select coalesce(sum(people), 0) from public.lodging_allocations where request_id = q.id) > private.lodging_total(q) then
    raise exception 'too_many';
  end if;
end $$;

-- อนุมัติ (ต้องจัดห้องครบทุกคน) / ไม่อนุมัติ (ต้องมีเหตุผล) / ยกเลิกที่อนุมัติแล้ว
create or replace function public.lodging_decide(p_request bigint, p_action text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.lodging_requests;
begin
  if not public.lodging_is_team() then raise exception 'forbidden'; end if;
  select * into q from public.lodging_requests where id = p_request for update;
  if not found then raise exception 'not_found'; end if;
  if p_action = 'approve' then
    if q.status <> 'pending' then raise exception 'not_pending'; end if;
    if (select coalesce(sum(people), 0) from public.lodging_allocations where request_id = q.id) <> private.lodging_total(q) then
      raise exception 'not_allocated';
    end if;
  elsif p_action = 'reject' then
    if q.status <> 'pending' then raise exception 'not_pending'; end if;
    if coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  elsif p_action = 'cancel' then
    if q.status not in ('pending','approved') then raise exception 'not_pending'; end if;
  else
    raise exception 'bad_request';
  end if;
  update public.lodging_requests
     set status = case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'cancelled' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = q.id;
end $$;

create or replace function public.lodging_event_save(p_id bigint, p_slug text, p_name text, p_starts date, p_ends date,
  p_closes timestamptz, p_note text, p_active boolean) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not public.lodging_is_team() then raise exception 'forbidden'; end if;
  if p_id is null then
    insert into public.lodging_events (slug, name, starts_on, ends_on, closes_at, note, active)
    values (lower(btrim(p_slug)), btrim(p_name), p_starts, p_ends, p_closes, coalesce(btrim(p_note), ''), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.lodging_events set slug = lower(btrim(p_slug)), name = btrim(p_name), starts_on = p_starts, ends_on = p_ends,
      closes_at = p_closes, note = coalesce(btrim(p_note), ''), active = coalesce(p_active, active)
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.lodging_room_save(p_id bigint, p_building text, p_floor smallint, p_name text,
  p_capacity smallint, p_sort int, p_active boolean) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not public.lodging_is_team() then raise exception 'forbidden'; end if;
  if p_id is null then
    insert into public.lodging_rooms (building, floor, name, capacity, sort, active)
    values (btrim(p_building), p_floor, btrim(p_name), p_capacity, coalesce(p_sort, 0), coalesce(p_active, true)) returning id into v_id;
  else
    update public.lodging_rooms set building = btrim(p_building), floor = p_floor, name = btrim(p_name), capacity = p_capacity,
      sort = coalesce(p_sort, sort), active = coalesce(p_active, active) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end $$;

-- ============================================================ หน้าสาธารณะ (edge function lodging-public, service_role เท่านั้น)
-- งานที่เปิดอยู่ (slug ว่าง = งานที่ใกล้ที่สุดที่ยังไม่จบ) + ห้องว่าง/เต็ม
create or replace function public.lodging_public_event(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'slug', e.slug, 'name', e.name, 'starts_on', e.starts_on, 'ends_on', e.ends_on,
           'closes_at', e.closes_at, 'note', e.note, 'open', now() < e.closes_at, 'rooms', private.lodging_rooms_json(e.id))
  from public.lodging_events e
  where e.active and e.ends_on >= (now() at time zone 'Asia/Bangkok')::date
    and (coalesce(p_slug, '') = '' or e.slug = lower(p_slug))
  order by e.starts_on limit 1
$$;

create or replace function public.lodging_public_submit(p_slug text, p_ip_hash text, p_school text, p_contact text, p_phone text,
  p_male int, p_female int, p_teachers int, p_note text) returns text
language plpgsql security definer set search_path = '' as $$
declare e public.lodging_events; v_ref text;
begin
  select * into e from public.lodging_events where slug = lower(p_slug) and active;
  if not found then raise exception 'not_found'; end if;
  if now() >= e.closes_at then raise exception 'closed'; end if;
  if (select count(*) from public.lodging_submit_log where ip_hash = p_ip_hash and at > now() - interval '1 hour') >= 6 then
    raise exception 'rate_limited';
  end if;
  if (select count(*) from public.lodging_requests where event_id = e.id and source = 'public' and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'rate_limited';
  end if;
  insert into public.lodging_submit_log (ip_hash) values (p_ip_hash);
  v_ref := private.lodging_new_ref();
  insert into public.lodging_requests (event_id, ref_code, school_name, contact_name, phone, male_students, female_students, teachers, note, source)
  values (e.id, v_ref, btrim(p_school), btrim(p_contact), regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'),
          coalesce(p_male, 0), coalesce(p_female, 0), coalesce(p_teachers, 0), nullif(btrim(p_note), ''), 'public');
  return v_ref;
end $$;

-- สถานะสำหรับโรงเรียน (ด้วยรหัสติดตาม) — ห้องที่ได้ แสดงเมื่ออนุมัติแล้ว
create or replace function public.lodging_public_status(p_ref text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ref', q.ref_code, 'status', q.status, 'school_name', q.school_name, 'contact_name', q.contact_name,
           'male_students', q.male_students, 'female_students', q.female_students, 'teachers', q.teachers, 'note', q.note,
           'decision_note', q.decision_note, 'created_at', q.created_at,
           'event', jsonb_build_object('name', e.name, 'slug', e.slug, 'starts_on', e.starts_on, 'ends_on', e.ends_on, 'note', e.note),
           'rooms', case when q.status = 'approved' then coalesce((
             select jsonb_agg(jsonb_build_object('building', r.building, 'floor', r.floor, 'name', r.name, 'people', a.people, 'kind', a.kind)
                    order by r.building, r.floor, r.sort, r.name)
             from public.lodging_allocations a join public.lodging_rooms r on r.id = a.room_id where a.request_id = q.id), '[]'::jsonb)
             else '[]'::jsonb end)
  from public.lodging_requests q join public.lodging_events e on e.id = q.event_id
  where q.ref_code = upper(btrim(p_ref))
$$;

create or replace function public.lodging_public_cancel(p_ref text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.lodging_requests set status = 'cancelled', decided_at = now(), decision_note = 'โรงเรียนยกเลิกเอง'
  where ref_code = upper(btrim(p_ref)) and status = 'pending';
  if not found then raise exception 'not_pending'; end if;
end $$;

-- ข้อมูลแจ้งเตือน LINE เมื่อมีคำขอใหม่จากหน้าสาธารณะ
create or replace function public.line_lodging_info(p_request bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', q.id, 'status', q.status, 'school_name', q.school_name, 'contact_name', q.contact_name,
           'male_students', q.male_students, 'female_students', q.female_students, 'teachers', q.teachers, 'event_name', e.name)
  from public.lodging_requests q join public.lodging_events e on e.id = q.event_id where q.id = p_request
$$;

revoke execute on function public.lodging_public_event(text),
  public.lodging_public_submit(text, text, text, text, text, int, int, int, text),
  public.lodging_public_status(text), public.lodging_public_cancel(text), public.line_lodging_info(bigint)
from public, anon, authenticated;
grant execute on function public.lodging_public_event(text),
  public.lodging_public_submit(text, text, text, text, text, int, int, int, text),
  public.lodging_public_status(text), public.lodging_public_cancel(text), public.line_lodging_info(bigint)
to service_role;

revoke execute on function public.lodging_occupancy(bigint),
  public.lodging_staff_create(bigint, text, text, text, int, int, int, text),
  public.lodging_request_update(bigint, text, text, text, int, int, int, text),
  public.lodging_allocate(bigint, jsonb), public.lodging_decide(bigint, text, text),
  public.lodging_event_save(bigint, text, text, date, date, timestamptz, text, boolean),
  public.lodging_room_save(bigint, text, smallint, text, smallint, int, boolean)
from public, anon;
grant execute on function public.lodging_occupancy(bigint),
  public.lodging_staff_create(bigint, text, text, text, int, int, int, text),
  public.lodging_request_update(bigint, text, text, text, int, int, int, text),
  public.lodging_allocate(bigint, jsonb), public.lodging_decide(bigint, text, text),
  public.lodging_event_save(bigint, text, text, date, date, timestamptz, text, boolean),
  public.lodging_room_save(bigint, text, smallint, text, smallint, int, boolean)
to authenticated;

-- ============================================================ แจ้งเตือน LINE ฝ่ายจัดห้องเมื่อมีคำขอใหม่ (ใช้ private.config เดิม)
create or replace function private.notify_line_lodging() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select value into v_url from private.config where key = 'line_notify_url';
  select value into v_secret from private.config where key = 'line_notify_secret';
  if v_url is null or v_secret is null then return new; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('type', 'lodging_new', 'request_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret)
  );
  return new;
exception when others then
  return new;
end $$;
revoke execute on function private.notify_line_lodging() from public, anon, authenticated;
create trigger lodging_requests_notify_line
  after insert on public.lodging_requests
  for each row when (new.source = 'public') execute function private.notify_line_lodging();

-- ============================================================ งานแรก + ห้อง (อาคาร 3, 4)
insert into public.lodging_events (slug, name, starts_on, ends_on, closes_at, note)
values ('parichat-2569', 'การแข่งขันปาริชาติ', '2026-12-25', '2026-12-27', '2026-12-25 00:00+07',
        'ที่พักฟรี ในอาคาร 3 และอาคาร 4 · ฝ่ายอาคารสถานที่จัดห้องให้ตามจำนวนคน')
on conflict (slug) do nothing;

insert into public.lodging_rooms (building, floor, name, capacity, sort)
select v.b, v.f, v.n, v.c, v.s from (values
  ('อาคาร 3', 1, 'ห้องชีวะ', 30, 10),
  ('อาคาร 3', 2, '322', 20, 22), ('อาคาร 3', 2, '323', 20, 23), ('อาคาร 3', 2, '324', 20, 24), ('อาคาร 3', 2, '325', 20, 25), ('อาคาร 3', 2, '326', 20, 26),
  ('อาคาร 3', 3, '331', 30, 31), ('อาคาร 3', 3, '332', 20, 32), ('อาคาร 3', 3, '333', 20, 33), ('อาคาร 3', 3, '334', 20, 34),
  ('อาคาร 3', 3, '335', 20, 35), ('อาคาร 3', 3, '336', 20, 36), ('อาคาร 3', 3, '337', 30, 37),
  ('อาคาร 4', 2, '422', 20, 22), ('อาคาร 4', 2, '423', 20, 23), ('อาคาร 4', 2, '424', 20, 24), ('อาคาร 4', 2, '425', 20, 25),
  ('อาคาร 4', 2, '426', 20, 26), ('อาคาร 4', 2, '427', 20, 27),
  ('อาคาร 4', 3, '431', 30, 31), ('อาคาร 4', 3, '432', 20, 32), ('อาคาร 4', 3, '433', 20, 33), ('อาคาร 4', 3, '434', 20, 34),
  ('อาคาร 4', 3, '435', 20, 35), ('อาคาร 4', 3, '436', 20, 36), ('อาคาร 4', 3, '437', 20, 37), ('อาคาร 4', 3, '438', 30, 38)
) as v(b, f, n, c, s)
on conflict (building, name) do nothing;

-- ============================================================ ตำแหน่งอาคารบนแผนที่ 3 มิติ (พิกัดพิกเซลภาพดาวเทียม แบบเดียวกับ clean_zones)
-- ค่าเริ่มต้นประเมินจากแบบจำลอง: อาคาร 3 = อาคาร 216ค, อาคาร 4 = อาคารเรียนหลัก (ชั้นล่างโล่ง ห้องพักเริ่มชั้น 2)
-- ฝ่ายจัดห้องวาดใหม่ได้ในแท็บ ตั้งค่า (lodging_building_save)
create table public.lodging_buildings (
  name text primary key check (length(btrim(name)) between 1 and 40),
  poly jsonb not null check (jsonb_typeof(poly) = 'array' and jsonb_array_length(poly) between 3 and 40),
  updated_at timestamptz not null default now()
);
alter table public.lodging_buildings enable row level security;
revoke all on public.lodging_buildings from anon, authenticated;
grant select on public.lodging_buildings to authenticated;
create policy lodging_buildings_read on public.lodging_buildings for select to authenticated using (public.my_role() is not null);

create or replace function public.lodging_building_save(p_name text, p_poly jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.lodging_is_team() then raise exception 'forbidden'; end if;
  if p_poly is null or jsonb_typeof(p_poly) <> 'array' or jsonb_array_length(p_poly) < 3 then raise exception 'bad_poly'; end if;
  insert into public.lodging_buildings (name, poly) values (btrim(p_name), p_poly)
  on conflict (name) do update set poly = excluded.poly, updated_at = now();
end $$;
revoke execute on function public.lodging_building_save(text, jsonb) from public, anon;
grant execute on function public.lodging_building_save(text, jsonb) to authenticated;

-- หน้าสาธารณะได้ตำแหน่งอาคารด้วย (ไว้แสดงบนแผนที่)
create or replace function public.lodging_public_event(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'slug', e.slug, 'name', e.name, 'starts_on', e.starts_on, 'ends_on', e.ends_on,
           'closes_at', e.closes_at, 'note', e.note, 'open', now() < e.closes_at, 'rooms', private.lodging_rooms_json(e.id),
           'buildings', coalesce((select jsonb_agg(jsonb_build_object('name', b.name, 'poly', b.poly) order by b.name)
                                  from public.lodging_buildings b), '[]'::jsonb))
  from public.lodging_events e
  where e.active and e.ends_on >= (now() at time zone 'Asia/Bangkok')::date
    and (coalesce(p_slug, '') = '' or e.slug = lower(p_slug))
  order by e.starts_on limit 1
$$;
revoke execute on function public.lodging_public_event(text) from public, anon, authenticated;
grant execute on function public.lodging_public_event(text) to service_role;

insert into public.lodging_buildings (name, poly) values
  ('อาคาร 3', '[[445,810],[645,810],[645,870],[445,870]]'),
  ('อาคาร 4', '[[432,207],[680,207],[680,286],[432,286]]')
on conflict (name) do nothing;
