-- อนุมัติ/ส่งกลับ/ไม่อนุมัติ คำขอใช้รถผ่าน LINE + แจ้งเตือนทุกขั้น
-- - ผูก LINE กับบัญชีด้วยรหัส 6 หลักที่สร้างในแอป (ต้องล็อกอิน) — ผู้ใช้แก้ line_user_id เองไม่ได้
-- - ตรรกะพิจารณาอยู่ที่ *_as(p_actor) ฟังก์ชันเดียว ใช้ทั้งจากแอป (auth.uid()) และจาก LINE (edge function line-bot)
-- - ปุ่มใน LINE ส่งสถานะที่คาดไว้มาด้วย ถ้าคำขอเปลี่ยนขั้นไปแล้ว (ปุ่มเก่า) จะทำไม่ได้
-- - trigger ส่งงานให้ edge function ผ่าน pg_net (URL/secret อยู่ private.config ไม่อยู่ใน repo)
-- รันหลัง 20261119000001_harden_function_privileges.sql

-- ============================================================
-- ประวัติ: ทำผ่านช่องทางไหน
-- ============================================================
alter table public.vehicle_booking_steps add column channel text not null default 'app' check (channel in ('app','line'));

-- ============================================================
-- LINE ID: ไม่ให้ผู้ใช้ตั้งเอง ไม่เปิดให้คนอื่นเห็น (เห็นแค่ว่าเชื่อมแล้วหรือยัง)
-- ============================================================
revoke update (line_user_id) on public.profiles from authenticated;
create unique index profiles_line_user_id_key on public.profiles (line_user_id) where line_user_id is not null;
alter table public.profiles add column line_linked boolean generated always as (line_user_id is not null) stored;
revoke select on public.profiles from authenticated;
grant select (id, email, full_name, role, position, created_at, line_linked) on public.profiles to authenticated;

create table public.line_link_codes (
  code text primary key,
  user_id uuid not null references public.profiles on delete cascade,
  expires_at timestamptz not null
);
alter table public.line_link_codes enable row level security;
revoke all on public.line_link_codes from anon, authenticated;

-- เหตุผลที่รอพิมพ์ (กดส่งกลับ/ไม่อนุมัติใน LINE แล้วบอทถามเหตุผล) — 1 รายการต่อคน
create table public.line_pending_reasons (
  line_user_id text primary key,
  booking_id bigint not null references public.vehicle_bookings on delete cascade,
  action text not null check (action in ('return','reject')),
  expected text not null,
  created_at timestamptz not null default now()
);
alter table public.line_pending_reasons enable row level security;
revoke all on public.line_pending_reasons from anon, authenticated;

-- สร้างรหัสเชื่อม LINE (อายุ 15 นาที)
create or replace function public.create_line_link_code() returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if coalesce(public.my_role(), '') = '' then raise exception 'forbidden'; end if;
  delete from public.line_link_codes where user_id = auth.uid() or expires_at < now();
  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.line_link_codes where code = v_code);
  end loop;
  insert into public.line_link_codes (code, user_id, expires_at) values (v_code, auth.uid(), now() + interval '15 minutes');
  return v_code;
end $$;

create or replace function public.unlink_line() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(), '') = '' then raise exception 'forbidden'; end if;
  update public.profiles set line_user_id = null where id = auth.uid();
end $$;

-- (edge function) ผูก LINE ด้วยรหัส: LINE หนึ่งบัญชีผูกได้คนเดียว ถ้าเคยผูกคนอื่นจะย้ายมา
create or replace function public.line_link_account(p_line_user text, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_out jsonb;
begin
  delete from public.line_link_codes where code = trim(p_code) and expires_at > now() returning user_id into v_user;
  if v_user is null then raise exception 'bad_code'; end if;
  update public.profiles set line_user_id = null where line_user_id = p_line_user and id <> v_user;
  update public.profiles set line_user_id = p_line_user where id = v_user
    returning jsonb_build_object('full_name', full_name, 'role', role) into v_out;
  return v_out;
end $$;

-- ============================================================
-- พิจารณาคำขอ: ตรรกะเดียว ใช้ทั้งแอปและ LINE
-- ============================================================
create or replace function public.review_vehicle_booking_as(
  p_actor uuid, p_channel text, p_id bigint, p_approve boolean, p_note text default null,
  p_vehicle_id int default null, p_driver_id int default null, p_expected text default null
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_role text := coalesce((select role from public.profiles where id = p_actor), '');
  v_status text;
  v_ends timestamptz;
  v_stage text;
  v_next text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select status, ends_at into v_status, v_ends from public.vehicle_bookings where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if p_expected is not null and v_status <> p_expected then raise exception 'not_pending'; end if;

  if v_status = 'pending' and v_role = 'vehicle_head' then
    v_stage := 'head';
    v_next := case when p_approve then 'pending_deputy' else 'returned' end;
  elsif v_status = 'pending_deputy' and v_role = 'deputy' then
    v_stage := 'deputy';
    v_next := case when p_approve then 'pending_director' else 'pending' end;
  elsif v_status = 'pending_director' and v_role = 'director' then
    v_stage := 'director';
    v_next := case when p_approve then 'approved' else 'pending_deputy' end;
  elsif v_status not in ('pending','pending_deputy','pending_director') then
    raise exception 'not_pending';
  else
    raise exception 'forbidden';
  end if;

  if not p_approve and v_note is null then raise exception 'note_required'; end if;
  if v_stage = 'head' and p_approve and p_vehicle_id is null then raise exception 'vehicle_required'; end if;
  if v_stage = 'head' and p_approve and p_driver_id is not null and exists (
       select 1 from public.drivers
        where id = p_driver_id and license_expiry < (v_ends at time zone 'Asia/Bangkok')::date) then
    raise exception 'license_expired';
  end if;

  update public.vehicle_bookings
     set status = v_next,
         vehicle_id = case when v_stage = 'head' and p_approve then p_vehicle_id else vehicle_id end,
         driver_id = case when v_stage = 'head' and p_approve then p_driver_id else driver_id end,
         approver_note = v_note,
         approver_id = case when v_next = 'approved' then p_actor else approver_id end,
         decided_at = case when v_next = 'approved' then now() else decided_at end
   where id = p_id;

  insert into public.vehicle_booking_steps (booking_id, stage, action, actor_id, note, channel)
  values (p_id, v_stage, case when p_approve then 'forward' else 'return' end, p_actor, v_note, p_channel);

  return v_next;
end $$;

create or replace function public.reject_vehicle_booking_as(
  p_actor uuid, p_channel text, p_id bigint, p_note text, p_expected text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if coalesce((select role from public.profiles where id = p_actor), '') <> 'director' then raise exception 'forbidden'; end if;
  if v_note is null then raise exception 'note_required'; end if;
  update public.vehicle_bookings
     set status = 'rejected', approver_note = v_note, approver_id = p_actor, decided_at = now()
   where id = p_id and status = 'pending_director' and (p_expected is null or status = p_expected);
  if not found then raise exception 'not_pending'; end if;
  insert into public.vehicle_booking_steps (booking_id, stage, action, actor_id, note, channel)
  values (p_id, 'director', 'reject', p_actor, v_note, p_channel);
end $$;

-- RPC เดิมของแอป: ลายเซ็นเดิม เรียกตรรกะร่วมด้วย auth.uid()
create or replace function public.review_vehicle_booking(
  p_id bigint, p_approve boolean, p_note text default null, p_vehicle_id int default null, p_driver_id int default null
) returns text language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  return public.review_vehicle_booking_as(auth.uid(), 'app', p_id, p_approve, p_note, p_vehicle_id, p_driver_id, null);
end $$;

create or replace function public.reject_vehicle_booking(p_id bigint, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  perform public.reject_vehicle_booking_as(auth.uid(), 'app', p_id, p_note, null);
end $$;

-- (edge function) ตัดสินจาก LINE: forward = เห็นชอบ/อนุมัติ, return = ส่งกลับ, reject = ไม่อนุมัติ (ผอ.)
-- หัวหน้างานยานพาหนะต้องเลือกรถ/คนขับ จึงส่งต่อจาก LINE ไม่ได้ (use_app)
create or replace function public.line_decide(
  p_line_user text, p_id bigint, p_action text, p_expected text, p_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_role text; v_next text;
begin
  select id, role into v_actor, v_role from public.profiles where line_user_id = p_line_user;
  if v_actor is null then raise exception 'not_linked'; end if;
  if p_action = 'forward' then
    if v_role = 'vehicle_head' then raise exception 'use_app'; end if;
    v_next := public.review_vehicle_booking_as(v_actor, 'line', p_id, true, p_note, null, null, p_expected);
  elsif p_action = 'return' then
    v_next := public.review_vehicle_booking_as(v_actor, 'line', p_id, false, p_note, null, null, p_expected);
  elsif p_action = 'reject' then
    perform public.reject_vehicle_booking_as(v_actor, 'line', p_id, p_note, p_expected);
    v_next := 'rejected';
  else
    raise exception 'bad_action';
  end if;
  return jsonb_build_object('status', v_next,
    'destination', (select destination from public.vehicle_bookings where id = p_id));
end $$;

-- (edge function) งานที่รอคนนี้พิจารณา (คำสั่ง "งาน" ใน LINE)
create or replace function public.line_my_queue(p_line_user text) returns setof public.vehicle_bookings
language sql stable security definer set search_path = '' as $$
  select b.* from public.vehicle_bookings b
    join public.profiles p on p.line_user_id = p_line_user
   where b.status = case p.role when 'vehicle_head' then 'pending' when 'deputy' then 'pending_deputy'
                                when 'director' then 'pending_director' end
   order by b.starts_at limit 10
$$;

revoke execute on function public.review_vehicle_booking_as(uuid, text, bigint, boolean, text, int, int, text) from public, anon, authenticated;
revoke execute on function public.reject_vehicle_booking_as(uuid, text, bigint, text, text) from public, anon, authenticated;
revoke execute on function public.line_link_account(text, text) from public, anon, authenticated;
revoke execute on function public.line_decide(text, bigint, text, text, text) from public, anon, authenticated;
revoke execute on function public.line_my_queue(text) from public, anon, authenticated;
grant execute on function public.review_vehicle_booking_as(uuid, text, bigint, boolean, text, int, int, text) to service_role;
grant execute on function public.reject_vehicle_booking_as(uuid, text, bigint, text, text) to service_role;
grant execute on function public.line_link_account(text, text) to service_role;
grant execute on function public.line_decide(text, bigint, text, text, text) to service_role;
grant execute on function public.line_my_queue(text) to service_role;
revoke execute on function public.create_line_link_code() from public, anon;
revoke execute on function public.unlink_line() from public, anon;
grant execute on function public.create_line_link_code() to authenticated;
grant execute on function public.unlink_line() to authenticated;

-- ============================================================
-- แจ้งเตือน: เมื่อคำขอถูกสร้างหรือเปลี่ยนสถานะ → edge function line-bot ส่ง LINE ให้คนที่เกี่ยวข้อง
-- ============================================================
create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.config (key text primary key, value text not null);
revoke all on private.config from public, anon, authenticated;
-- ตั้งค่าหลังรัน (ไม่ใส่ใน repo):
--   insert into private.config values ('line_notify_url', 'https://<ref>.supabase.co/functions/v1/line-bot'), ('line_notify_secret', '<สุ่ม>');

create or replace function private.notify_line() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  select value into v_url from private.config where key = 'line_notify_url';
  select value into v_secret from private.config where key = 'line_notify_secret';
  if v_url is null or v_secret is null then return new; end if;
  -- ส่งหลัง commit (pg_net เข้าคิวในธุรกรรมเดียวกัน); ส่งไม่สำเร็จไม่กระทบการอนุมัติ
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('type', 'vehicle_status', 'booking_id', new.id, 'status', new.status,
                               'from', case when tg_op = 'UPDATE' then old.status end),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret)
  );
  return new;
exception when others then
  return new; -- แจ้งเตือนพังต้องไม่ทำให้การจอง/อนุมัติล้ม
end $$;
revoke execute on function private.notify_line() from public, anon, authenticated;

create trigger vehicle_bookings_notify_line
  after insert or update of status on public.vehicle_bookings
  for each row execute function private.notify_line();
