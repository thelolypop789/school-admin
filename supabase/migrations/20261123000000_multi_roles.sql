-- หลายบทบาทต่อคน + แยกหน้าที่ฝ่ายบริหารทั่วไป (เผื่ออนาคตเปลี่ยนคน)
-- - profiles.role = บทบาทหลัก (เหมือนเดิม), profiles.extra_roles = บทบาทเสริม (ถือได้หลายอัน)
-- - vehicle_head    หัวหน้างานยานพาหนะ: จัดรถ/บันทึกเดินทาง (ไม่ตรวจห้องน้ำแล้ว)
-- - facilities_head หัวหน้างานอาคารสถานที่ (ใหม่): ตรวจห้องน้ำ/อัปโหลดรูป
-- - ga_head         หัวหน้าฝ่ายบริหารทั่วไป (ใหม่): ดูได้ทุกอย่าง ไม่มีสิทธิ์อนุมัติ/แก้ไขเพิ่ม
-- - admin เป็นได้เฉพาะบทบาทหลัก
-- สิทธิ์ใช้ public.has_role() / public.roles_of() แทนการเทียบ my_role() ตรงๆ ในฟังก์ชันที่เกี่ยวข้อง
-- รันหลัง 20261122000000_toilet_reports_readonly.sql

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('staff','inspector','vehicle_head','facilities_head','ga_head','deputy','director','admin'));
alter table public.profiles add column extra_roles text[] not null default '{}'
  check (extra_roles <@ array['inspector','vehicle_head','facilities_head','ga_head','deputy','director']::text[]);
grant select (extra_roles) on public.profiles to authenticated;

-- บทบาททั้งหมดของผู้ใช้ปัจจุบัน / ของคนที่ระบุ (ภายใน)
create or replace function public.my_roles() returns text[]
language sql stable security definer set search_path = '' as $$
  select array[role] || extra_roles from public.profiles where id = auth.uid()
$$;
create or replace function public.has_role(p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_role = any(public.my_roles()), false)
$$;
create or replace function public.roles_of(p_user uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((select array[role] || extra_roles from public.profiles where id = p_user), '{}'::text[])
$$;
revoke execute on function public.my_roles() from public, anon;
revoke execute on function public.has_role(text) from public, anon;
revoke execute on function public.roles_of(uuid) from public, anon, authenticated;
grant execute on function public.my_roles() to authenticated;
grant execute on function public.has_role(text) to authenticated;
grant execute on function public.roles_of(uuid) to service_role;

-- แอดมินตั้งบทบาทหลัก + บทบาทเสริม
create or replace function public.admin_set_roles(p_user uuid, p_role text, p_extra text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(), '') <> 'admin' then raise exception 'forbidden'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'cannot_demote_self'; end if;
  update public.profiles
     set role = p_role,
         extra_roles = coalesce((select array_agg(distinct r order by r) from unnest(coalesce(p_extra, '{}')) r where r <> p_role), '{}')
   where id = p_user;
end $$;
revoke execute on function public.admin_set_roles(uuid, text, text[]) from public, anon;
grant execute on function public.admin_set_roles(uuid, text, text[]) to authenticated;

-- ============================================================ จองรถ: ขั้นพิจารณาตามบทบาททั้งหมดของผู้กด
create or replace function public.review_vehicle_booking_as(
  p_actor uuid, p_channel text, p_id bigint, p_approve boolean, p_note text default null,
  p_vehicle_id int default null, p_driver_id int default null, p_expected text default null
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_roles text[] := public.roles_of(p_actor);
  v_status text;
  v_ends timestamptz;
  v_end_date date;
  v_stage text;
  v_next text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select status, ends_at into v_status, v_ends from public.vehicle_bookings where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if p_expected is not null and v_status <> p_expected then raise exception 'not_pending'; end if;
  v_end_date := (v_ends at time zone 'Asia/Bangkok')::date;

  if v_status = 'pending' and 'vehicle_head' = any(v_roles) then
    v_stage := 'head';
    v_next := case when p_approve then 'pending_deputy' else 'returned' end;
  elsif v_status = 'pending_deputy' and 'deputy' = any(v_roles) then
    v_stage := 'deputy';
    v_next := case when p_approve then 'pending_director' else 'pending' end;
  elsif v_status = 'pending_director' and 'director' = any(v_roles) then
    v_stage := 'director';
    v_next := case when p_approve then 'approved' else 'pending_deputy' end;
  elsif v_status not in ('pending','pending_deputy','pending_director') then
    raise exception 'not_pending';
  else
    raise exception 'forbidden';
  end if;

  if not p_approve and v_note is null then raise exception 'note_required'; end if;
  if v_stage = 'head' and p_approve then
    if p_vehicle_id is null then raise exception 'vehicle_required'; end if;
    if not exists (select 1 from public.vehicles where id = p_vehicle_id and active and condition = 'ready') then
      raise exception 'vehicle_unavailable';
    end if;
    if exists (select 1 from public.vehicles where id = p_vehicle_id and (act_expiry < v_end_date or tax_expiry < v_end_date)) then
      raise exception 'vehicle_docs_expired';
    end if;
    if p_driver_id is not null and exists (
         select 1 from public.drivers where id = p_driver_id and license_expiry < v_end_date) then
      raise exception 'license_expired';
    end if;
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
  if not ('director' = any(public.roles_of(p_actor))) then raise exception 'forbidden'; end if;
  if v_note is null then raise exception 'note_required'; end if;
  update public.vehicle_bookings
     set status = 'rejected', approver_note = v_note, approver_id = p_actor, decided_at = now()
   where id = p_id and status = 'pending_director' and (p_expected is null or status = p_expected);
  if not found then raise exception 'not_pending'; end if;
  insert into public.vehicle_booking_steps (booking_id, stage, action, actor_id, note, channel)
  values (p_id, 'director', 'reject', p_actor, v_note, p_channel);
end $$;

-- LINE: ขั้นจัดรถ (status pending) ต้องเลือกรถในแอป
create or replace function public.line_decide(
  p_line_user text, p_id bigint, p_action text, p_expected text, p_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_next text;
begin
  select id into v_actor from public.profiles where line_user_id = p_line_user;
  if v_actor is null then raise exception 'not_linked'; end if;
  if p_action = 'forward' then
    if p_expected = 'pending' then raise exception 'use_app'; end if;
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

create or replace function public.line_my_queue(p_line_user text) returns setof public.vehicle_bookings
language sql stable security definer set search_path = '' as $$
  select b.* from public.vehicle_bookings b
    join public.profiles p on p.line_user_id = p_line_user
   where (b.status = 'pending' and 'vehicle_head' = any(array[p.role] || p.extra_roles))
      or (b.status = 'pending_deputy' and 'deputy' = any(array[p.role] || p.extra_roles))
      or (b.status = 'pending_director' and 'director' = any(array[p.role] || p.extra_roles))
   order by b.starts_at limit 10
$$;

-- บันทึกเดินทาง: หัวหน้างานยานพาหนะ (บทบาทหลักหรือเสริม) หรือแอดมิน
create or replace function public.start_vehicle_trip(p_id bigint, p_start_odometer int, p_checklist jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_vehicle int;
  k text;
begin
  if not (public.has_role('vehicle_head') or public.has_role('admin')) then raise exception 'forbidden'; end if;
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

create or replace function public.close_vehicle_trip(
  p_id bigint, p_end_odometer int, p_fuel_liters numeric default null, p_fuel_cost numeric default null, p_note text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_start int;
begin
  if not (public.has_role('vehicle_head') or public.has_role('admin')) then raise exception 'forbidden'; end if;
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

-- ============================================================ ห้องน้ำ: ตรวจ = ผู้ตรวจ/หัวหน้างานอาคารสถานที่/แอดมิน
create or replace function public.submit_toilet_inspection(
  p_toilet_id int, p_answers jsonb, p_note text default null, p_photo_paths text[] default '{}'
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_total int; v_pass int; v_safety_fail boolean; v_id bigint;
begin
  if not (public.has_role('inspector') or public.has_role('facilities_head') or public.has_role('admin')) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.toilets where id = p_toilet_id and active) then
    raise exception 'toilet_not_found';
  end if;
  select count(*),
         count(*) filter (where (p_answers->>i.id::text)::boolean),
         coalesce(bool_or(i.category = 'S' and not coalesce((p_answers->>i.id::text)::boolean, false)), false)
    into v_total, v_pass, v_safety_fail
    from public.toilet_checklist_items i where i.active;
  if v_total = 0 then raise exception 'no_checklist'; end if;
  if exists (select 1 from public.toilet_checklist_items i
              where i.active and jsonb_typeof(p_answers->i.id::text) is distinct from 'boolean') then
    raise exception 'incomplete';
  end if;
  insert into public.toilet_inspections (toilet_id, inspector_id, answers, score, safety_fail, note, photo_paths)
  values (p_toilet_id, auth.uid(), p_answers, round(100.0 * v_pass / v_total, 2), v_safety_fail,
          nullif(trim(coalesce(p_note, '')), ''), coalesce(p_photo_paths, '{}'))
  returning id into v_id;
  return v_id;
end $$;

-- รูปห้องน้ำ: อัปโหลด = คนที่ตรวจได้; ดู = + หัวหน้าฝ่ายบริหารทั่วไป, รอง ผอ., ผอ.
drop policy toilet_photos_upload on storage.objects;
create policy toilet_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'toilet-photos' and (public.has_role('inspector') or public.has_role('facilities_head') or public.has_role('admin')));
drop policy toilet_photos_read on storage.objects;
create policy toilet_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'toilet-photos' and public.my_roles() && array['inspector','facilities_head','ga_head','deputy','director','admin']::text[]);
