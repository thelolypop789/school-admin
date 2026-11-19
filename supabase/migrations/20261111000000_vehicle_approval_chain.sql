-- จองรถ: อนุมัติ 3 ขั้น  หัวหน้างานยานพาหนะ → รอง ผอ. ฝ่ายบริหารทั่วไป → ผอ.
-- - หัวหน้างานยานพาหนะเลือกรถ/คนขับ แล้วส่งต่อ
-- - ขั้นไหนไม่เห็นชอบ = ส่งกลับให้ขั้นก่อนหน้า (ต้องระบุเหตุผล); หัวหน้างานส่งกลับ = กลับไปให้ผู้ขอแก้แล้วส่งใหม่
-- - ทุกคนเดินตาม flow เดียวกัน รวมถึงกรณีรอง ผอ./ผอ. เป็นผู้ขอเอง
-- - รถ/คนขับถูกกันไว้ตั้งแต่หัวหน้างานจัดรถ (pending_deputy) จนจบ เพื่อไม่ให้จัดรถคันเดียวซ้อน
-- รันหลัง 20261109000000_init.sql

-- ============================================================
-- บทบาทใหม่ (approver เดิม → deputy)
-- ============================================================
alter table public.profiles drop constraint profiles_role_check;
update public.profiles set role = 'deputy' where role = 'approver';
alter table public.profiles add constraint profiles_role_check
  check (role in ('staff','inspector','vehicle_head','deputy','director','admin'));

-- ============================================================
-- สถานะคำขอใช้รถ
--   pending          รอหัวหน้างานยานพาหนะ
--   returned         หัวหน้างานส่งกลับให้ผู้ขอแก้ไข
--   pending_deputy   รอรอง ผอ.
--   pending_director รอ ผอ.
--   approved         ผอ. อนุมัติแล้ว (พิมพ์ใบขออนุญาตได้)
--   rejected         (ข้อมูลเก่าจากระบบอนุมัติขั้นเดียว)
--   cancelled        ผู้ขอยกเลิก
-- ============================================================
alter table public.vehicle_bookings drop constraint vehicle_bookings_status_check;
alter table public.vehicle_bookings add constraint vehicle_bookings_status_check
  check (status in ('pending','returned','pending_deputy','pending_director','approved','rejected','cancelled'));

alter table public.vehicle_bookings drop constraint vehicle_bookings_check1; -- status <> 'approved' or vehicle_id is not null
alter table public.vehicle_bookings add constraint vehicle_bookings_vehicle_assigned
  check (status not in ('pending_deputy','pending_director','approved') or vehicle_id is not null);

alter table public.vehicle_bookings drop constraint vehicle_no_overlap;
alter table public.vehicle_bookings add constraint vehicle_no_overlap exclude using gist (
  vehicle_id with =, tstzrange(starts_at, ends_at) with &&
) where (status in ('pending_deputy','pending_director','approved'));

alter table public.vehicle_bookings drop constraint driver_no_overlap;
alter table public.vehicle_bookings add constraint driver_no_overlap exclude using gist (
  driver_id with =, tstzrange(starts_at, ends_at) with &&
) where (status in ('pending_deputy','pending_director','approved') and driver_id is not null);

-- ============================================================
-- ประวัติการพิจารณา (ใช้แสดงลำดับและพิมพ์ใบขออนุญาต)
-- ============================================================
create table public.vehicle_booking_steps (
  id bigserial primary key,
  booking_id bigint not null references public.vehicle_bookings on delete cascade,
  stage text not null check (stage in ('requester','head','deputy','director')),
  action text not null check (action in ('submit','forward','return')),
  actor_id uuid not null references public.profiles,
  note text,
  acted_at timestamptz not null default now()
);
create index on public.vehicle_booking_steps (booking_id, acted_at);

alter table public.vehicle_booking_steps enable row level security;
revoke all on public.vehicle_booking_steps from anon, authenticated;
grant select on public.vehicle_booking_steps to authenticated;
create policy vehicle_booking_steps_read on public.vehicle_booking_steps for select to authenticated
  using (public.my_role() is not null);

-- บันทึกขั้น "ส่งคำขอ" อัตโนมัติเมื่อสร้างคำขอ
create or replace function public.log_vehicle_booking_submit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.vehicle_booking_steps (booking_id, stage, action, actor_id)
  values (new.id, 'requester', 'submit', new.booked_by);
  return new;
end $$;
revoke execute on function public.log_vehicle_booking_submit() from public, anon, authenticated;

create trigger vehicle_booking_submitted
  after insert on public.vehicle_bookings
  for each row execute function public.log_vehicle_booking_submit();

-- ============================================================
-- พิจารณาตามขั้น: บทบาทของผู้ใช้กำหนดว่าพิจารณาขั้นไหนได้
--   p_approve = true  → ส่งต่อขั้นถัดไป (ขั้น ผอ. = อนุมัติ)
--   p_approve = false → ส่งกลับขั้นก่อนหน้า (ต้องมี p_note)
--   p_vehicle_id / p_driver_id ใช้เฉพาะขั้นหัวหน้างานยานพาหนะ
-- ============================================================
drop function public.decide_vehicle_booking(bigint, boolean, int, int, text);

create or replace function public.review_vehicle_booking(
  p_id bigint, p_approve boolean, p_note text default null, p_vehicle_id int default null, p_driver_id int default null
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_role text := coalesce(public.my_role(), '');
  v_status text;
  v_stage text;
  v_next text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select status into v_status from public.vehicle_bookings where id = p_id for update;
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

-- ผู้ขอแก้คำขอที่ถูกส่งกลับ แล้วส่งใหม่ (กลับไปรอหัวหน้างานยานพาหนะ)
create or replace function public.resubmit_vehicle_booking(
  p_id bigint, p_destination text, p_purpose text, p_passengers int, p_starts_at timestamptz, p_ends_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(), '') = '' then raise exception 'forbidden'; end if;
  if p_ends_at <= now() then raise exception 'in_past'; end if;
  update public.vehicle_bookings
     set destination = trim(p_destination), purpose = trim(p_purpose), passengers = p_passengers,
         starts_at = p_starts_at, ends_at = p_ends_at, status = 'pending', approver_note = null
   where id = p_id and booked_by = auth.uid() and status = 'returned';
  if not found then raise exception 'not_returned'; end if;
  insert into public.vehicle_booking_steps (booking_id, stage, action, actor_id)
  values (p_id, 'requester', 'submit', auth.uid());
end $$;

revoke execute on function public.review_vehicle_booking(bigint, boolean, text, int, int) from public, anon;
revoke execute on function public.resubmit_vehicle_booking(bigint, text, text, int, timestamptz, timestamptz) from public, anon;
grant execute on function public.review_vehicle_booking(bigint, boolean, text, int, int) to authenticated;
grant execute on function public.resubmit_vehicle_booking(bigint, text, text, int, timestamptz, timestamptz) to authenticated;

-- ผู้ขอยกเลิกได้ทุกสถานะที่ยังไม่จบ
drop policy vehicle_bookings_cancel on public.vehicle_bookings;
create policy vehicle_bookings_cancel on public.vehicle_bookings for update to authenticated
  using (booked_by = auth.uid() and status in ('pending','returned','pending_deputy','pending_director','approved'))
  with check (status = 'cancelled');

-- ============================================================
-- ห้องน้ำ: สิทธิ์ที่เคยให้ approver → รอง ผอ. / ผอ.
-- ============================================================
create or replace function public.toilet_item_report(p_from date, p_to date)
returns table (item_id int, category text, label text, checks int, fails int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(), '') not in ('deputy','director','admin') then raise exception 'forbidden'; end if;
  return query
    select i.id, i.category, i.label,
           count(x.id)::int,
           count(x.id) filter (where (x.answers->>i.id::text)::boolean is false)::int
      from public.toilet_checklist_items i
      left join public.toilet_inspections x
        on x.answers ? i.id::text
       and (x.inspected_at at time zone 'Asia/Bangkok')::date between p_from and p_to
     group by i.id, i.category, i.label, i.sort
     order by 5 desc, i.sort;
end $$;

drop policy toilet_inspections_read on public.toilet_inspections;
create policy toilet_inspections_read on public.toilet_inspections for select to authenticated
  using (public.my_role() in ('admin','deputy','director') or inspector_id = auth.uid());

drop policy toilet_photos_read on storage.objects;
create policy toilet_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'toilet-photos' and public.my_role() in ('inspector','deputy','director','admin'));
