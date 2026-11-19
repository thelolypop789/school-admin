-- จองรถ: ช่วงหลังอนุมัติ + กติกาเพิ่มเติม
-- 1. บันทึกการเดินทาง (เจ้าหน้าที่/หัวหน้างานยานพาหนะกรอกเอง คนขับไม่ต้องเข้าระบบ)
--      approved → ออกเดินทาง (เลขไมล์ก่อนออก + checklist) → on_trip → ปิดงาน (เลขไมล์กลับ + น้ำมัน) → completed
-- 2. วันหมดอายุใบขับขี่ของคนขับ: จัดคนขับที่ใบขับขี่หมดก่อนวันกลับไม่ได้
-- 3. ผอ. ไม่อนุมัติแบบยุติเรื่อง (rejected) นอกจากส่งกลับรอง ผอ.
-- รันหลัง 20261112000000_travel_order_fields.sql

-- ============================================================
-- สถานะใหม่: on_trip (ออกเดินทางแล้ว), completed (ปิดงานแล้ว)
-- ============================================================
alter table public.vehicle_bookings drop constraint vehicle_bookings_status_check;
alter table public.vehicle_bookings add constraint vehicle_bookings_status_check
  check (status in ('pending','returned','pending_deputy','pending_director','approved','on_trip','completed','rejected','cancelled'));

alter table public.vehicle_bookings drop constraint vehicle_bookings_vehicle_assigned;
alter table public.vehicle_bookings add constraint vehicle_bookings_vehicle_assigned
  check (status not in ('pending_deputy','pending_director','approved','on_trip','completed') or vehicle_id is not null);

-- รถ/คนขับยังถูกกันไว้ระหว่างเดินทางและหลังปิดงาน (เป็นประวัติจริงว่าใช้ช่วงนั้น)
alter table public.vehicle_bookings drop constraint vehicle_no_overlap;
alter table public.vehicle_bookings add constraint vehicle_no_overlap exclude using gist (
  vehicle_id with =, tstzrange(starts_at, ends_at) with &&
) where (status in ('pending_deputy','pending_director','approved','on_trip','completed'));

alter table public.vehicle_bookings drop constraint driver_no_overlap;
alter table public.vehicle_bookings add constraint driver_no_overlap exclude using gist (
  driver_id with =, tstzrange(starts_at, ends_at) with &&
) where (status in ('pending_deputy','pending_director','approved','on_trip','completed') and driver_id is not null);

-- ขั้นตอนใหม่ในประวัติ: reject (ผอ. ยุติ), depart (ออกเดินทาง), close (ปิดงาน)
alter table public.vehicle_booking_steps drop constraint vehicle_booking_steps_action_check;
alter table public.vehicle_booking_steps add constraint vehicle_booking_steps_action_check
  check (action in ('submit','forward','return','reject','depart','close'));

-- ============================================================
-- ใบขับขี่
-- ============================================================
alter table public.drivers add column license_expiry date;

-- ============================================================
-- บันทึกการเดินทาง (1 คำขอ = 1 บันทึก)
-- ============================================================
create table public.vehicle_trips (
  booking_id bigint primary key references public.vehicle_bookings on delete cascade,
  vehicle_id int not null references public.vehicles,
  start_odometer int not null check (start_odometer >= 0),
  checklist jsonb not null,
  departed_at timestamptz not null default now(),
  departed_by uuid not null references public.profiles,
  end_odometer int,
  fuel_liters numeric(7,2) check (fuel_liters >= 0),
  fuel_cost numeric(10,2) check (fuel_cost >= 0),
  note text,
  closed_at timestamptz,
  closed_by uuid references public.profiles,
  check (end_odometer is null or end_odometer >= start_odometer),
  check ((closed_at is null) = (end_odometer is null))
);
create index on public.vehicle_trips (vehicle_id, departed_at desc);

alter table public.vehicle_trips enable row level security;
revoke all on public.vehicle_trips from anon, authenticated;
grant select on public.vehicle_trips to authenticated;
-- โปร่งใส: บุคลากรทุกคนดูได้; บันทึกผ่าน RPC เท่านั้น
create policy vehicle_trips_read on public.vehicle_trips for select to authenticated
  using (public.my_role() is not null);

-- รายการตรวจก่อนออกเดินทาง (ต้องผ่านครบทุกข้อ) — ตรงกับ TRIP_CHECKLIST ใน src/lib/vehicle.ts
create or replace function public.trip_checklist_keys() returns text[]
language sql immutable as $$ select array['documents','vehicle','fuel','driver'] $$;

-- ออกเดินทาง: เจ้าหน้าที่กรอกเลขไมล์ก่อนออก + ติ๊ก checklist
create or replace function public.start_vehicle_trip(p_id bigint, p_start_odometer int, p_checklist jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_vehicle int;
  k text;
begin
  if coalesce(public.my_role(), '') not in ('vehicle_head','admin') then raise exception 'forbidden'; end if;
  select vehicle_id into v_vehicle from public.vehicle_bookings where id = p_id and status = 'approved' for update;
  if not found then raise exception 'not_approved'; end if;
  if p_start_odometer is null or p_start_odometer < 0 then raise exception 'bad_odometer'; end if;
  foreach k in array public.trip_checklist_keys() loop
    if coalesce((p_checklist->>k)::boolean, false) is not true then raise exception 'checklist_incomplete'; end if;
  end loop;

  insert into public.vehicle_trips (booking_id, vehicle_id, start_odometer, checklist, departed_by)
  values (p_id, v_vehicle, p_start_odometer, p_checklist, auth.uid());
  update public.vehicle_bookings set status = 'on_trip' where id = p_id;
  insert into public.vehicle_booking_steps (booking_id, stage, action, actor_id, note)
  values (p_id, 'head', 'depart', auth.uid(), 'เลขไมล์ก่อนออก ' || p_start_odometer);
end $$;

-- ปิดงาน: เลขไมล์กลับ + น้ำมันที่เติมระหว่างทาง (ถ้ามี)
create or replace function public.close_vehicle_trip(
  p_id bigint, p_end_odometer int, p_fuel_liters numeric default null, p_fuel_cost numeric default null, p_note text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_start int;
begin
  if coalesce(public.my_role(), '') not in ('vehicle_head','admin') then raise exception 'forbidden'; end if;
  perform 1 from public.vehicle_bookings where id = p_id and status = 'on_trip' for update;
  if not found then raise exception 'not_on_trip'; end if;
  select start_odometer into v_start from public.vehicle_trips where booking_id = p_id;
  if p_end_odometer is null or p_end_odometer < v_start then raise exception 'odometer_less_than_start'; end if;
  if p_end_odometer - v_start > 5000 then raise exception 'odometer_too_far'; end if;

  update public.vehicle_trips
     set end_odometer = p_end_odometer, fuel_liters = p_fuel_liters, fuel_cost = p_fuel_cost,
         note = nullif(trim(coalesce(p_note, '')), ''), closed_at = now(), closed_by = auth.uid()
   where booking_id = p_id;
  update public.vehicle_bookings set status = 'completed' where id = p_id;
  insert into public.vehicle_booking_steps (booking_id, stage, action, actor_id, note)
  values (p_id, 'head', 'close', auth.uid(), 'ระยะทาง ' || (p_end_odometer - v_start) || ' กม.');
end $$;

-- ผอ. ไม่อนุมัติ ยุติเรื่อง (ต้องระบุเหตุผล) — ต่างจาก "ส่งกลับ" ที่ให้แก้แล้วเดินต่อ
create or replace function public.reject_vehicle_booking(p_id bigint, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if coalesce(public.my_role(), '') <> 'director' then raise exception 'forbidden'; end if;
  if v_note is null then raise exception 'note_required'; end if;
  update public.vehicle_bookings
     set status = 'rejected', approver_note = v_note, approver_id = auth.uid(), decided_at = now()
   where id = p_id and status = 'pending_director';
  if not found then raise exception 'not_pending'; end if;
  insert into public.vehicle_booking_steps (booking_id, stage, action, actor_id, note)
  values (p_id, 'director', 'reject', auth.uid(), v_note);
end $$;

-- ============================================================
-- review_vehicle_booking: เพิ่มเช็กใบขับขี่ตอนหัวหน้างานจัดคนขับ (ส่วนอื่นเหมือนเดิม)
-- ============================================================
create or replace function public.review_vehicle_booking(
  p_id bigint, p_approve boolean, p_note text default null, p_vehicle_id int default null, p_driver_id int default null
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_role text := coalesce(public.my_role(), '');
  v_status text;
  v_ends timestamptz;
  v_stage text;
  v_next text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select status, ends_at into v_status, v_ends from public.vehicle_bookings where id = p_id for update;
  if not found then raise exception 'not_found'; end if;

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
  -- ใบขับขี่ต้องไม่หมดอายุก่อนวันกลับ (ยังไม่กรอกวันหมดอายุ = ผ่าน แต่ UI เตือน)
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
         approver_id = case when v_next = 'approved' then auth.uid() else approver_id end,
         decided_at = case when v_next = 'approved' then now() else decided_at end
   where id = p_id;

  insert into public.vehicle_booking_steps (booking_id, stage, action, actor_id, note)
  values (p_id, v_stage, case when p_approve then 'forward' else 'return' end, auth.uid(), v_note);

  return v_next;
end $$;

revoke execute on function public.trip_checklist_keys() from public, anon;
revoke execute on function public.start_vehicle_trip(bigint, int, jsonb) from public, anon;
revoke execute on function public.close_vehicle_trip(bigint, int, numeric, numeric, text) from public, anon;
revoke execute on function public.reject_vehicle_booking(bigint, text) from public, anon;
grant execute on function public.trip_checklist_keys() to authenticated;
grant execute on function public.start_vehicle_trip(bigint, int, jsonb) to authenticated;
grant execute on function public.close_vehicle_trip(bigint, int, numeric, numeric, text) to authenticated;
grant execute on function public.reject_vehicle_booking(bigint, text) to authenticated;
