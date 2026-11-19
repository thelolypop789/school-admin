-- ข้อมูลรถ: รูป · สภาพ (พร้อมใช้/ซ่อมบำรุง) · วันหมดอายุ ประกันภัย / พ.ร.บ. / ภาษี
-- - จัดรถที่ซ่อมบำรุงหรือปิดใช้งานไม่ได้ (vehicle_unavailable)
-- - จัดรถที่ พ.ร.บ. หรือภาษีหมดก่อนวันกลับไม่ได้ (vehicle_docs_expired) — ผิดกฎหมายถ้าขับ; ประกันภัยแค่เตือนใน UI
-- รันหลัง 20261120000000_line_approval.sql

alter table public.vehicles
  add column photo_path text,
  add column condition text not null default 'ready' check (condition in ('ready','maintenance')),
  add column condition_note text,
  add column insurance_expiry date,
  add column act_expiry date,
  add column tax_expiry date;

-- รูปรถ: bucket private (อ่านผ่าน signed URL) — บุคลากรดูได้, แอดมินอัปโหลด/เปลี่ยน/ลบ
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-photos', 'vehicle-photos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy vehicle_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'vehicle-photos' and public.my_role() is not null);
create policy vehicle_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-photos' and public.my_role() = 'admin');
create policy vehicle_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'vehicle-photos' and public.my_role() = 'admin')
  with check (bucket_id = 'vehicle-photos' and public.my_role() = 'admin');
create policy vehicle_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vehicle-photos' and public.my_role() = 'admin');

-- พิจารณาคำขอ: เพิ่มเช็กรถตอนหัวหน้างานจัดรถ (ส่วนอื่นเหมือน 20261120000000)
create or replace function public.review_vehicle_booking_as(
  p_actor uuid, p_channel text, p_id bigint, p_approve boolean, p_note text default null,
  p_vehicle_id int default null, p_driver_id int default null, p_expected text default null
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_role text := coalesce((select role from public.profiles where id = p_actor), '');
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

revoke execute on function public.review_vehicle_booking_as(uuid, text, bigint, boolean, text, int, int, text) from public, anon, authenticated;
grant execute on function public.review_vehicle_booking_as(uuid, text, bigint, boolean, text, int, int, text) to service_role;
