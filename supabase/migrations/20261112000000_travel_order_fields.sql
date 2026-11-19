-- ข้อมูลสำหรับพิมพ์ "คำสั่งโรงเรียน เรื่อง การอนุมัติการเดินทางไปราชการ"
-- - profiles.position: ตำแหน่งของบุคลากร (ผู้ใช้แก้ของตัวเองได้)
-- - vehicle_bookings.travelers: รายชื่อผู้เดินทาง [{ "name": "...", "position": "..." }]
-- - vehicle_bookings.expenses: รายการที่ขอเบิก
-- รันหลัง 20261111000000_vehicle_approval_chain.sql

alter table public.profiles add column position text;
grant update (position) on public.profiles to authenticated;

alter table public.vehicle_bookings
  add column travelers jsonb not null default '[]'
    check (jsonb_typeof(travelers) = 'array' and jsonb_array_length(travelers) <= 100),
  add column expenses text[] not null default '{}'
    check (expenses <@ array['registration','allowance','transport','lodging','private_car','lump_sum']);

grant insert (travelers, expenses) on public.vehicle_bookings to authenticated;

-- ส่งใหม่หลังถูกส่งกลับ: เพิ่มรายชื่อผู้เดินทางและรายการเบิก
drop function public.resubmit_vehicle_booking(bigint, text, text, int, timestamptz, timestamptz);

create or replace function public.resubmit_vehicle_booking(
  p_id bigint, p_destination text, p_purpose text, p_passengers int, p_starts_at timestamptz, p_ends_at timestamptz,
  p_travelers jsonb, p_expenses text[]
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(), '') = '' then raise exception 'forbidden'; end if;
  if p_ends_at <= now() then raise exception 'in_past'; end if;
  update public.vehicle_bookings
     set destination = trim(p_destination), purpose = trim(p_purpose), passengers = p_passengers,
         starts_at = p_starts_at, ends_at = p_ends_at,
         travelers = coalesce(p_travelers, '[]'), expenses = coalesce(p_expenses, '{}'),
         status = 'pending', approver_note = null
   where id = p_id and booked_by = auth.uid() and status = 'returned';
  if not found then raise exception 'not_returned'; end if;
  insert into public.vehicle_booking_steps (booking_id, stage, action, actor_id)
  values (p_id, 'requester', 'submit', auth.uid());
end $$;

revoke execute on function public.resubmit_vehicle_booking(bigint, text, text, int, timestamptz, timestamptz, jsonb, text[]) from public, anon;
grant execute on function public.resubmit_vehicle_booking(bigint, text, text, int, timestamptz, timestamptz, jsonb, text[]) to authenticated;
