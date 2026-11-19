-- แจ้งซ่อมงานอาคารสถานที่ (เรียงตามความเร่งด่วน)
-- ขั้นตอน: new รับแจ้ง → proposed หัวหน้างานอาคารสถานที่ลงวันที่ทำได้ เสนอผู้บริหาร
--          → scheduled ผู้บริหารเห็นควรตามที่เสนอ (ลงปฏิทิน) → done ซ่อมเสร็จ
--   ผู้บริหาร (รอง ผอ./ผอ.) เลือกได้ 3 อย่าง: เห็นควรตามเสนอ · ให้ด่วน · ให้ทำงานอื่นก่อน
--   "ให้ด่วน" / "ให้ทำงานอื่นก่อน" ส่งกลับให้หัวหน้างานอาคารสถานที่เสนอวันใหม่ (status กลับเป็น new + exec_decision)
-- ผู้แจ้งเลือกความเร่งด่วนเอง หัวหน้างานอาคารสถานที่ปรับได้ (reported_priority เก็บค่าที่ผู้แจ้งเลือก)
-- ทุกการเขียนทำผ่าน RPC เท่านั้น (ตารางไม่เปิด insert/update ให้ authenticated)
-- รันหลัง 20261123000000_multi_roles.sql

create table public.repair_requests (
  id bigint generated always as identity primary key,
  reported_by uuid not null references public.profiles on delete restrict,
  title text not null check (length(trim(title)) between 3 and 120),
  detail text check (length(detail) <= 1000),
  location text not null check (length(trim(location)) between 1 and 120),
  category text not null check (category in ('electric','water','building','furniture','aircon','other')),
  priority text not null default 'normal' check (priority in ('urgent','high','normal','low')),
  reported_priority text not null default 'normal' check (reported_priority in ('urgent','high','normal','low')),
  status text not null default 'new' check (status in ('new','proposed','scheduled','done','cancelled')),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 4),
  plan_start date,
  plan_end date,
  proposal text check (length(proposal) <= 500),
  exec_decision text check (exec_decision in ('agree','urgent','defer')),
  exec_note text check (length(exec_note) <= 500),
  done_note text check (length(done_note) <= 500),
  done_photo_paths text[] not null default '{}' check (cardinality(done_photo_paths) <= 4),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (plan_end is null or plan_start is null or plan_end >= plan_start)
);
create index repair_requests_status_idx on public.repair_requests (status, created_at desc);
create index repair_requests_plan_idx on public.repair_requests (plan_start) where plan_start is not null;

create table public.repair_steps (
  id bigint generated always as identity primary key,
  repair_id bigint not null references public.repair_requests on delete cascade,
  action text not null check (action in ('submit','priority','propose','agree','urgent','defer','done','cancel')),
  actor_id uuid references public.profiles on delete set null,
  note text,
  channel text not null default 'app' check (channel in ('app','line')),
  created_at timestamptz not null default now()
);
create index repair_steps_repair_idx on public.repair_steps (repair_id, created_at);

alter table public.repair_requests enable row level security;
alter table public.repair_steps enable row level security;
revoke all on public.repair_requests, public.repair_steps from anon, authenticated;
grant select on public.repair_requests, public.repair_steps to authenticated;

-- บุคลากรที่มีบัญชีอ่านรายการได้ทุกคน (กันแจ้งซ้ำ ดูสถานะได้) — รูปถ่ายแยกสิทธิ์ที่ storage
create policy repair_requests_read on public.repair_requests for select to authenticated
  using (public.my_role() is not null);
create policy repair_steps_read on public.repair_steps for select to authenticated
  using (public.my_role() is not null);

-- ============================================================
-- Storage: รูปแจ้งซ่อม (private) — path = <uid ผู้อัปโหลด>/<uuid>.jpg
-- เจ้าของรูปเห็นรูปตัวเอง · ทีมอาคารสถานที่/ผู้บริหารเห็นทุกรูป
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('repair-photos', 'repair-photos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy repair_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'repair-photos' and public.my_role() is not null
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy repair_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'repair-photos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.my_roles() && array['facilities_head','ga_head','deputy','director','admin']::text[]));

-- ============================================================
-- ตรรกะ
-- ============================================================
-- รูปต้องอยู่ในโฟลเดอร์ของผู้ทำรายการเอง (กันอ้าง path ของคนอื่น)
create or replace function private.own_photo_paths(p_paths text[], p_uid uuid) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(bool_and(split_part(x, '/', 1) = p_uid::text and x !~ '\.\.'), true) from unnest(coalesce(p_paths, '{}')) x
$$;

create or replace function public.submit_repair(
  p_title text, p_detail text, p_location text, p_category text, p_priority text, p_photo_paths text[] default '{}'
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if auth.uid() is null or coalesce(public.my_role(), '') = '' then raise exception 'forbidden'; end if;
  if not private.own_photo_paths(p_photo_paths, auth.uid()) then raise exception 'forbidden'; end if;
  insert into public.repair_requests (reported_by, title, detail, location, category, priority, reported_priority, photo_paths)
  values (auth.uid(), trim(p_title), nullif(trim(coalesce(p_detail, '')), ''), trim(p_location), p_category,
          p_priority, p_priority, coalesce(p_photo_paths, '{}'))
  returning id into v_id;
  insert into public.repair_steps (repair_id, action, actor_id) values (v_id, 'submit', auth.uid());
  return v_id;
end $$;

-- หัวหน้างานอาคารสถานที่ปรับความเร่งด่วน (ก่อนเสร็จ/ยกเลิก)
create or replace function public.repair_set_priority(p_id bigint, p_priority text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.has_role('facilities_head') or public.has_role('admin')) then raise exception 'forbidden'; end if;
  update public.repair_requests set priority = p_priority, updated_at = now()
   where id = p_id and status in ('new','proposed','scheduled');
  if not found then raise exception 'not_found'; end if;
  insert into public.repair_steps (repair_id, action, actor_id, note) values (p_id, 'priority', auth.uid(), p_priority);
end $$;

-- หัวหน้างานอาคารสถานที่: ลงวันที่ทำได้ + เสนอผู้บริหาร (ใช้ซ้ำได้ถ้าผู้บริหารส่งกลับ หรืออยากเลื่อนวันหลังเห็นควรแล้ว)
create or replace function public.repair_propose(
  p_id bigint, p_plan_start date, p_plan_end date, p_priority text, p_proposal text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.has_role('facilities_head') or public.has_role('admin')) then raise exception 'forbidden'; end if;
  if p_plan_start is null then raise exception 'plan_required'; end if;
  update public.repair_requests
     set status = 'proposed', plan_start = p_plan_start, plan_end = coalesce(p_plan_end, p_plan_start),
         priority = p_priority, proposal = nullif(trim(coalesce(p_proposal, '')), ''),
         exec_decision = null, exec_note = null, updated_at = now()
   where id = p_id and status in ('new','proposed','scheduled');
  if not found then raise exception 'not_found'; end if;
  insert into public.repair_steps (repair_id, action, actor_id, note)
  values (p_id, 'propose', auth.uid(), to_char(p_plan_start, 'YYYY-MM-DD') || ' – ' || to_char(coalesce(p_plan_end, p_plan_start), 'YYYY-MM-DD'));
end $$;

-- ผู้บริหารตัดสิน: agree = เห็นควรตามเสนอ · urgent = ให้ด่วน · defer = ให้ทำงานอื่นก่อน
-- ตรรกะเดียวใช้ทั้งแอป (auth.uid()) และ LINE (line_repair_decide)
create or replace function public.repair_decide_as(
  p_actor uuid, p_channel text, p_id bigint, p_decision text, p_note text default null, p_expected text default null
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_roles text[] := public.roles_of(p_actor);
  v_status text;
  v_next text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not (v_roles && array['deputy','director']::text[]) then raise exception 'forbidden'; end if;
  if p_decision not in ('agree','urgent','defer') then raise exception 'bad_action'; end if;
  select status into v_status from public.repair_requests where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_status <> 'proposed' or (p_expected is not null and v_status <> p_expected) then raise exception 'not_pending'; end if;

  v_next := case p_decision when 'agree' then 'scheduled' else 'new' end;
  update public.repair_requests
     set status = v_next,
         priority = case when p_decision = 'urgent' then 'urgent' else priority end,
         exec_decision = p_decision, exec_note = v_note, updated_at = now()
   where id = p_id;
  insert into public.repair_steps (repair_id, action, actor_id, note, channel)
  values (p_id, p_decision, p_actor, v_note, p_channel);
  return v_next;
end $$;

create or replace function public.repair_decide(p_id bigint, p_decision text, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  return public.repair_decide_as(auth.uid(), 'app', p_id, p_decision, p_note, null);
end $$;

-- ซ่อมเสร็จ (หัวหน้างานอาคารสถานที่)
create or replace function public.repair_complete(p_id bigint, p_note text default null, p_photo_paths text[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.has_role('facilities_head') or public.has_role('admin')) then raise exception 'forbidden'; end if;
  if not private.own_photo_paths(p_photo_paths, auth.uid()) then raise exception 'forbidden'; end if;
  update public.repair_requests
     set status = 'done', done_at = now(), done_note = nullif(trim(coalesce(p_note, '')), ''),
         done_photo_paths = coalesce(p_photo_paths, '{}'), updated_at = now()
   where id = p_id and status = 'scheduled';
  if not found then raise exception 'not_scheduled'; end if;
  insert into public.repair_steps (repair_id, action, actor_id, note) values (p_id, 'done', auth.uid(), nullif(trim(coalesce(p_note, '')), ''));
end $$;

-- ยกเลิก: ผู้แจ้ง (ก่อนเสนอผู้บริหาร) หรือหัวหน้างานอาคารสถานที่/แอดมิน
create or replace function public.repair_cancel(p_id bigint, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_by uuid; v_status text;
begin
  select reported_by, status into v_by, v_status from public.repair_requests where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_status not in ('new','proposed','scheduled') then raise exception 'not_found'; end if;
  if not ((v_by = auth.uid() and v_status = 'new') or public.has_role('facilities_head') or public.has_role('admin')) then
    raise exception 'forbidden';
  end if;
  update public.repair_requests set status = 'cancelled', updated_at = now() where id = p_id;
  insert into public.repair_steps (repair_id, action, actor_id, note) values (p_id, 'cancel', auth.uid(), nullif(trim(coalesce(p_note, '')), ''));
end $$;

-- (edge function) ตัดสินจาก LINE + งานที่รอผู้บริหารคนนี้
create or replace function public.line_repair_decide(p_line_user text, p_id bigint, p_decision text, p_expected text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_next text;
begin
  select id into v_actor from public.profiles where line_user_id = p_line_user;
  if v_actor is null then raise exception 'not_linked'; end if;
  v_next := public.repair_decide_as(v_actor, 'line', p_id, p_decision, null, p_expected);
  return jsonb_build_object('status', v_next, 'title', (select title from public.repair_requests where id = p_id));
end $$;

create or replace function public.line_my_repair_queue(p_line_user text) returns setof public.repair_requests
language sql stable security definer set search_path = '' as $$
  select r.* from public.repair_requests r
    join public.profiles p on p.line_user_id = p_line_user
   where r.status = 'proposed' and (array[p.role] || p.extra_roles) && array['deputy','director']::text[]
   order by case r.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, r.plan_start
   limit 10
$$;

-- สิทธิ์ฟังก์ชัน: ฟังก์ชันของแอปให้ authenticated · ตรรกะภายใน/LINE ให้ service_role เท่านั้น
revoke execute on function public.submit_repair(text, text, text, text, text, text[]) from public, anon;
revoke execute on function public.repair_set_priority(bigint, text) from public, anon;
revoke execute on function public.repair_propose(bigint, date, date, text, text) from public, anon;
revoke execute on function public.repair_decide(bigint, text, text) from public, anon;
revoke execute on function public.repair_complete(bigint, text, text[]) from public, anon;
revoke execute on function public.repair_cancel(bigint, text) from public, anon;
grant execute on function public.submit_repair(text, text, text, text, text, text[]) to authenticated;
grant execute on function public.repair_set_priority(bigint, text) to authenticated;
grant execute on function public.repair_propose(bigint, date, date, text, text) to authenticated;
grant execute on function public.repair_decide(bigint, text, text) to authenticated;
grant execute on function public.repair_complete(bigint, text, text[]) to authenticated;
grant execute on function public.repair_cancel(bigint, text) to authenticated;
revoke execute on function public.repair_decide_as(uuid, text, bigint, text, text, text) from public, anon, authenticated;
revoke execute on function public.line_repair_decide(text, bigint, text, text) from public, anon, authenticated;
revoke execute on function public.line_my_repair_queue(text) from public, anon, authenticated;
revoke execute on function private.own_photo_paths(text[], uuid) from public, anon, authenticated;
grant execute on function public.repair_decide_as(uuid, text, bigint, text, text, text) to service_role;
grant execute on function public.line_repair_decide(text, bigint, text, text) to service_role;
grant execute on function public.line_my_repair_queue(text) to service_role;

-- ============================================================
-- แจ้งเตือน LINE: สร้างใหม่/เปลี่ยนสถานะ → edge function line-bot (ใช้ private.config เดิม)
-- ============================================================
create or replace function private.notify_line_repair() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  select value into v_url from private.config where key = 'line_notify_url';
  select value into v_secret from private.config where key = 'line_notify_secret';
  if v_url is null or v_secret is null then return new; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('type', 'repair_status', 'repair_id', new.id, 'status', new.status,
                               'from', case when tg_op = 'UPDATE' then old.status end),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret)
  );
  return new;
exception when others then
  return new; -- แจ้งเตือนพังต้องไม่ทำให้การแจ้งซ่อม/ตัดสินล้ม
end $$;
revoke execute on function private.notify_line_repair() from public, anon, authenticated;

create trigger repair_requests_notify_line
  after insert or update of status on public.repair_requests
  for each row execute function private.notify_line_repair();
