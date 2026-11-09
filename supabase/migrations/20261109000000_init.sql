-- ระบบบริหารงานทั่วไป โรงเรียนวังหลวงพิทยาสาร — MVP
-- โมดูล: จองห้องประชุม · จองรถ (มีอนุมัติ) · แบบตรวจห้องน้ำ "สุขาดี มีความสุข" (HAS)
-- รันครั้งเดียวใน Supabase SQL Editor (migration ใหม่ให้เพิ่มไฟล์ อย่าแก้ไฟล์นี้)

create extension if not exists btree_gist with schema extensions;

-- ============================================================
-- ผู้ใช้ + บทบาท
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null unique,
  full_name text not null default '',
  role text not null default 'staff' check (role in ('staff','approver','inspector','admin')),
  line_user_id text,
  created_at timestamptz not null default now()
);

-- สร้าง profile อัตโนมัติเฉพาะอีเมลโรงเรียน (อีเมลอื่นล็อกอินได้แต่ไม่มี profile → RLS ไม่ให้เห็นอะไรเลย)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if lower(new.email) like '%@wangluangpitt.ac.th' then
    insert into public.profiles (id, email, full_name, role)
    values (
      new.id,
      lower(new.email),
      coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
      case when lower(new.email) = 'pongsarkon@wangluangpitt.ac.th' then 'admin' else 'staff' end
    )
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- บทบาทของผู้ใช้ปัจจุบัน (null = ไม่ใช่บุคลากรโรงเรียน)
create or replace function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ============================================================
-- ห้องประชุม
-- ============================================================
create table public.rooms (
  id serial primary key,
  name text not null,
  capacity int,
  equipment text[] not null default '{}',
  note text,
  active boolean not null default true
);

create table public.room_bookings (
  id bigserial primary key,
  room_id int not null references public.rooms,
  booked_by uuid not null references public.profiles default auth.uid(),
  title text not null check (length(trim(title)) > 0),
  attendees int,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- กันจองซ้อนที่ระดับฐานข้อมูล (ปลอดภัยแม้กดพร้อมกัน) → error 23P01
  constraint room_no_overlap exclude using gist (
    room_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (status = 'confirmed')
);
create index on public.room_bookings (starts_at);

-- ============================================================
-- รถ
-- ============================================================
create table public.vehicles (
  id serial primary key,
  name text not null,
  plate text,
  seats int,
  active boolean not null default true
);

create table public.drivers (
  id serial primary key,
  full_name text not null,
  phone text,
  active boolean not null default true
);

create table public.vehicle_bookings (
  id bigserial primary key,
  booked_by uuid not null references public.profiles default auth.uid(),
  destination text not null check (length(trim(destination)) > 0),
  purpose text not null check (length(trim(purpose)) > 0),
  passengers int not null check (passengers > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  vehicle_id int references public.vehicles,
  driver_id int references public.drivers,
  approver_id uuid references public.profiles,
  approver_note text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (status <> 'approved' or vehicle_id is not null),
  constraint vehicle_no_overlap exclude using gist (
    vehicle_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (status = 'approved'),
  constraint driver_no_overlap exclude using gist (
    driver_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (status = 'approved' and driver_id is not null)
);
create index on public.vehicle_bookings (starts_at);

-- อนุมัติ/ไม่อนุมัติ (เฉพาะ approver/admin)
create or replace function public.decide_vehicle_booking(
  p_id bigint, p_approve boolean, p_vehicle_id int default null, p_driver_id int default null, p_note text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(), '') not in ('approver','admin') then
    raise exception 'forbidden';
  end if;
  if p_approve and p_vehicle_id is null then
    raise exception 'vehicle_required';
  end if;
  update public.vehicle_bookings
     set status = case when p_approve then 'approved' else 'rejected' end,
         vehicle_id = case when p_approve then p_vehicle_id end,
         driver_id = case when p_approve then p_driver_id end,
         approver_id = auth.uid(),
         approver_note = nullif(trim(coalesce(p_note, '')), ''),
         decided_at = now()
   where id = p_id and status = 'pending';
  if not found then
    raise exception 'not_pending';
  end if;
end $$;

-- ============================================================
-- ห้องน้ำ "สุขาดี มีความสุข"
-- ============================================================
create table public.toilets (
  id serial primary key,
  name text not null,
  building text,
  gender text not null default 'unisex' check (gender in ('male','female','unisex','disabled')),
  qr_token uuid not null unique default gen_random_uuid(),
  active boolean not null default true
);

create table public.toilet_checklist_items (
  id serial primary key,
  category text not null check (category in ('H','A','S')),  -- H สะอาด · A เพียงพอ · S ปลอดภัย
  label text not null,
  sort int not null default 0,
  active boolean not null default true
);

create table public.toilet_inspections (
  id bigserial primary key,
  toilet_id int not null references public.toilets,
  inspector_id uuid not null references public.profiles,
  inspected_at timestamptz not null default now(),
  answers jsonb not null,          -- {"<item_id>": true|false}
  score numeric(5,2) not null,     -- % ผ่าน
  safety_fail boolean not null,    -- มีข้อหมวด S ไม่ผ่าน
  note text,
  photo_paths text[] not null default '{}'
);
create index on public.toilet_inspections (toilet_id, inspected_at desc);

-- บันทึกผลตรวจ: คะแนนคำนวณฝั่ง server จาก checklist ที่ active เท่านั้น
create or replace function public.submit_toilet_inspection(
  p_toilet_id int, p_answers jsonb, p_note text default null, p_photo_paths text[] default '{}'
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_total int; v_pass int; v_safety_fail boolean; v_id bigint;
begin
  if coalesce(public.my_role(), '') not in ('inspector','admin') then
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
  -- ต้องตอบครบทุกข้อ
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

-- สถานะล่าสุดของห้องน้ำทุกจุด (ให้บุคลากรทุกคนเห็นว่าจุดไหนยังไม่ได้ตรวจวันนี้)
create or replace function public.toilet_status()
returns table (id int, name text, building text, gender text, last_at timestamptz, last_score numeric, last_safety_fail boolean, checks_today int)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.building, t.gender, l.inspected_at, l.score, l.safety_fail,
         (select count(*)::int from public.toilet_inspections x
           where x.toilet_id = t.id
             and x.inspected_at >= date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok')
    from public.toilets t
    left join lateral (
      select inspected_at, score, safety_fail from public.toilet_inspections i
       where i.toilet_id = t.id order by inspected_at desc limit 1
    ) l on true
   where t.active and public.my_role() is not null
   order by t.building nulls last, t.name
$$;

-- ห้องน้ำจาก QR (ใช้ token แทน id เพื่อไม่ให้เดาได้)
create or replace function public.toilet_by_token(p_token uuid)
returns table (id int, name text, building text, gender text)
language sql stable security definer set search_path = '' as $$
  select id, name, building, gender from public.toilets
   where qr_token = p_token and active and public.my_role() is not null
$$;

-- รายงาน: แต่ละข้อไม่ผ่านกี่ครั้งในช่วงวันที่ (admin/approver)
create or replace function public.toilet_item_report(p_from date, p_to date)
returns table (item_id int, category text, label text, checks int, fails int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(), '') not in ('approver','admin') then raise exception 'forbidden'; end if;
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

-- ============================================================
-- แอดมิน: ตั้งบทบาทผู้ใช้
-- ============================================================
create or replace function public.admin_set_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(), '') <> 'admin' then raise exception 'forbidden'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'cannot_demote_self'; end if;
  update public.profiles set role = p_role where id = p_user;
end $$;

-- ============================================================
-- RLS + สิทธิ์
-- ============================================================
alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_bookings enable row level security;
alter table public.vehicles enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicle_bookings enable row level security;
alter table public.toilets enable row level security;
alter table public.toilet_checklist_items enable row level security;
alter table public.toilet_inspections enable row level security;

-- anon ไม่มีสิทธิ์อะไรเลย
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;

-- authenticated: เริ่มจากศูนย์แล้วให้เฉพาะที่ต้องใช้
revoke all on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;

-- profiles: บุคลากรเห็นชื่อกันได้ (แสดงผู้จอง); แก้ชื่อ/LINE ของตัวเองได้; role เปลี่ยนผ่าน admin_set_role เท่านั้น
create policy profiles_read on public.profiles for select to authenticated using (public.my_role() is not null);
grant update (full_name, line_user_id) on public.profiles to authenticated;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ข้อมูลหลัก (ห้อง รถ คนขับ ห้องน้ำ checklist): ทุกคนอ่าน, admin แก้
do $$
declare t text;
begin
  foreach t in array array['rooms','vehicles','drivers','toilets','toilet_checklist_items'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (public.my_role() is not null)', t);
    execute format('create policy %1$s_admin on public.%1$s for all to authenticated using (public.my_role() = ''admin'') with check (public.my_role() = ''admin'')', t);
    execute format('grant insert, update, delete on public.%1$s to authenticated', t);
  end loop;
end $$;

-- จองห้อง: ทุกคนเห็นปฏิทิน; จองในชื่อตัวเอง; ยกเลิกของตัวเอง (admin ยกเลิกได้ทุกอัน)
create policy room_bookings_read on public.room_bookings for select to authenticated using (public.my_role() is not null);
create policy room_bookings_insert on public.room_bookings for insert to authenticated
  with check (public.my_role() is not null and booked_by = auth.uid() and status = 'confirmed' and ends_at > now());
create policy room_bookings_cancel on public.room_bookings for update to authenticated
  using (booked_by = auth.uid() or public.my_role() = 'admin')
  with check (status = 'cancelled');
grant insert (room_id, title, attendees, starts_at, ends_at) on public.room_bookings to authenticated;
grant update (status) on public.room_bookings to authenticated;

-- จองรถ: ทุกคนเห็นปฏิทิน; ขอในชื่อตัวเอง (pending); ผู้ขอยกเลิกได้; อนุมัติผ่าน decide_vehicle_booking
create policy vehicle_bookings_read on public.vehicle_bookings for select to authenticated using (public.my_role() is not null);
create policy vehicle_bookings_insert on public.vehicle_bookings for insert to authenticated
  with check (public.my_role() is not null and booked_by = auth.uid() and status = 'pending' and ends_at > now());
create policy vehicle_bookings_cancel on public.vehicle_bookings for update to authenticated
  using (booked_by = auth.uid() and status in ('pending','approved'))
  with check (status = 'cancelled');
grant insert (destination, purpose, passengers, starts_at, ends_at) on public.vehicle_bookings to authenticated;
grant update (status) on public.vehicle_bookings to authenticated;

-- ผลตรวจห้องน้ำ: admin/approver เห็นทั้งหมด, ผู้ตรวจเห็นของตัวเอง; บันทึกผ่าน submit_toilet_inspection
create policy toilet_inspections_read on public.toilet_inspections for select to authenticated
  using (public.my_role() in ('admin','approver') or inspector_id = auth.uid());

grant execute on function public.my_role() to authenticated;
grant execute on function public.decide_vehicle_booking(bigint, boolean, int, int, text) to authenticated;
grant execute on function public.submit_toilet_inspection(int, jsonb, text, text[]) to authenticated;
grant execute on function public.toilet_status() to authenticated;
grant execute on function public.toilet_by_token(uuid) to authenticated;
grant execute on function public.toilet_item_report(date, date) to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- ============================================================
-- Storage: รูปห้องน้ำ (private)
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('toilet-photos', 'toilet-photos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy toilet_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'toilet-photos' and public.my_role() in ('inspector','admin'));
create policy toilet_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'toilet-photos' and public.my_role() in ('inspector','approver','admin'));

-- ============================================================
-- Seed: checklist ตั้งต้นตามหลัก HAS (ปรับได้ในหน้าแอดมิน)
-- ก่อนใช้จริงให้เทียบกับแบบประเมินส้วมสาธารณะ (HAS) ฉบับล่าสุดของกรมอนามัย
-- ============================================================
insert into public.toilet_checklist_items (category, label, sort) values
  ('H', 'พื้นแห้ง สะอาด ไม่มีคราบสกปรก', 10),
  ('H', 'โถส้วม/โถปัสสาวะสะอาด ไม่มีคราบ', 20),
  ('H', 'ไม่มีกลิ่นเหม็น', 30),
  ('H', 'ถังขยะมีฝาปิด ไม่ล้น', 40),
  ('H', 'อ่างล้างมือและกระจกสะอาด', 50),
  ('A', 'มีน้ำใช้ได้ทุกห้อง', 60),
  ('A', 'มีสบู่ล้างมือ', 70),
  ('A', 'มีกระดาษชำระหรือสายฉีดชำระใช้ได้', 80),
  ('A', 'ประตูปิด-ล็อกได้ทุกห้อง', 90),
  ('A', 'มีห้องส้วมสำหรับผู้พิการ/ราวจับ ใช้งานได้', 100),
  ('S', 'แสงสว่างเพียงพอ', 110),
  ('S', 'พื้นไม่ลื่น ไม่มีน้ำขัง', 120),
  ('S', 'ไม่มีสายไฟ/ปลั๊กชำรุดหรือเปลือย', 130),
  ('S', 'สุขภัณฑ์/อุปกรณ์ไม่แตกหัก ไม่มีส่วนแหลมคม', 140),
  ('S', 'มีการระบายอากาศที่ดี', 150);
