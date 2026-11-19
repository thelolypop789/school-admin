-- ปฏิทินงานฝ่ายบริหารทั่วไป: กิจกรรมที่หัวหน้างานเพิ่มเอง (ส่วนที่ดึงอัตโนมัติ — งานซ่อม รถ ห้องประชุม วันหมดอายุเอกสารรถ —
-- อ่านจากตารางเดิมในแอป ไม่ซ้ำข้อมูล)
-- เขียน: หัวหน้างานยานพาหนะ / หัวหน้างานอาคารสถานที่ / แอดมิน (หัวหน้าฝ่ายบริหารทั่วไปดูอย่างเดียว) ผ่าน RPC เท่านั้น
-- อ่าน: ทีมฝ่ายบริหารทั่วไป (หัวหน้างาน, หัวหน้าฝ่าย, รอง ผอ., ผอ., แอดมิน)
-- รันหลัง 20261124000000_repairs.sql

create table public.ga_events (
  id bigint generated always as identity primary key,
  title text not null check (length(trim(title)) between 2 and 120),
  category text not null default 'other' check (category in ('meeting','inspection','ceremony','holiday','other')),
  start_date date not null,
  end_date date not null,
  start_time time,
  end_time time,
  owner text check (length(owner) <= 120),
  note text check (length(note) <= 500),
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (end_time is null or start_time is null or end_date > start_date or end_time > start_time)
);
create index ga_events_dates_idx on public.ga_events (start_date, end_date);

alter table public.ga_events enable row level security;
revoke all on public.ga_events from anon, authenticated;
grant select on public.ga_events to authenticated;
create policy ga_events_read on public.ga_events for select to authenticated
  using (public.my_roles() && array['vehicle_head','facilities_head','ga_head','deputy','director','admin']::text[]);

create or replace function public.ga_event_save(
  p_id bigint, p_title text, p_category text, p_start_date date, p_end_date date,
  p_start_time time default null, p_end_time time default null, p_owner text default null, p_note text default null
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not (public.has_role('vehicle_head') or public.has_role('facilities_head') or public.has_role('admin')) then
    raise exception 'forbidden';
  end if;
  if p_id is null then
    insert into public.ga_events (title, category, start_date, end_date, start_time, end_time, owner, note, created_by)
    values (trim(p_title), p_category, p_start_date, coalesce(p_end_date, p_start_date), p_start_time, p_end_time,
            nullif(trim(coalesce(p_owner, '')), ''), nullif(trim(coalesce(p_note, '')), ''), auth.uid())
    returning id into v_id;
  else
    update public.ga_events
       set title = trim(p_title), category = p_category, start_date = p_start_date, end_date = coalesce(p_end_date, p_start_date),
           start_time = p_start_time, end_time = p_end_time,
           owner = nullif(trim(coalesce(p_owner, '')), ''), note = nullif(trim(coalesce(p_note, '')), '')
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.ga_event_delete(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.has_role('vehicle_head') or public.has_role('facilities_head') or public.has_role('admin')) then
    raise exception 'forbidden';
  end if;
  delete from public.ga_events where id = p_id;
  if not found then raise exception 'not_found'; end if;
end $$;

revoke execute on function public.ga_event_save(bigint, text, text, date, date, time, time, text, text) from public, anon;
revoke execute on function public.ga_event_delete(bigint) from public, anon;
grant execute on function public.ga_event_save(bigint, text, text, date, date, time, time, text, text) to authenticated;
grant execute on function public.ga_event_delete(bigint) to authenticated;
