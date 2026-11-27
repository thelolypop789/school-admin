-- ============================================================
-- ที่พักเครือข่ายรอบโรงเรียน (โรงเรียน/วัด/หน่วยงานราชการ/โรงแรม) + ส่งต่อโรงเรียนไปพักที่อื่น
--   ข้อมูลจริง (ชื่อผู้ประสานงาน/เบอร์โทร) นำเข้าตรง DB เท่านั้น ไม่อยู่ใน repo (repo สาธารณะ)
--   lat/lng: geo_precision บอกความแม่นยำ (exact/name = ตำแหน่งสถานที่, village = กลางหมู่บ้าน, tambon = กลางตำบล,
--   manual = ฝ่ายจัดห้องปักหมุดเอง, none = ยังไม่มีพิกัด)
--   คำขอที่ส่งต่อ: lodging_requests.venue_id + status approved (ไม่มีการจัดห้องในโรงเรียน)
-- รันหลัง 20261206000000_lodging_exclusive.sql
-- ============================================================

create table public.lodging_venues (
  id bigint generated always as identity primary key,
  category text not null check (category in ('school','temple','government','hotel')),
  name text not null unique check (length(btrim(name)) between 2 and 120),
  contact text check (length(contact) <= 120),
  subdistrict text check (length(subdistrict) <= 60),
  district text check (length(district) <= 60),
  province text check (length(province) <= 60),
  distance_km numeric(5,1) check (distance_km >= 0),
  capacity int check (capacity >= 0),
  status text not null default 'unconfirmed' check (status in ('confirmed','unconfirmed','declined')),
  phone1 text check (length(phone1) <= 30),
  phone2 text check (length(phone2) <= 30),
  detail text check (length(detail) <= 500),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  geo_precision text not null default 'none' check (geo_precision in ('exact','name','village','tambon','manual','none')),
  is_home boolean not null default false,
  active boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);
create unique index lodging_venues_one_home on public.lodging_venues (is_home) where is_home;

alter table public.lodging_requests add column venue_id bigint references public.lodging_venues;
create index lodging_requests_venue_idx on public.lodging_requests (venue_id) where venue_id is not null;

alter table public.lodging_venues enable row level security;
revoke all on public.lodging_venues from anon, authenticated;
grant select on public.lodging_venues to authenticated;
create policy lodging_venues_read on public.lodging_venues for select to authenticated using (public.my_role() is not null);

-- คนที่ส่งต่อไปแต่ละที่ (คำขอที่รอ/อนุมัติ)
create or replace function private.lodging_venue_used(p_venue bigint) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(q.male_students + q.female_students + q.teachers), 0)::int
  from public.lodging_requests q where q.venue_id = p_venue and q.status in ('pending','approved')
$$;
revoke execute on function private.lodging_venue_used(bigint) from public, anon, authenticated;

-- รายการที่พักเครือข่าย (ใช้ทั้งหน้าสาธารณะและแอป) — ไม่มีชื่อโรงเรียนที่ส่งต่อไป
create or replace function private.lodging_venues_json() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id, 'category', v.category, 'name', v.name, 'contact', v.contact, 'subdistrict', v.subdistrict,
      'district', v.district, 'province', v.province, 'distance_km', v.distance_km, 'capacity', v.capacity,
      'status', v.status, 'phone1', v.phone1, 'phone2', v.phone2, 'detail', v.detail, 'lat', v.lat, 'lng', v.lng,
      'geo_precision', v.geo_precision, 'is_home', v.is_home, 'used', private.lodging_venue_used(v.id))
    order by v.is_home desc, (v.status = 'confirmed') desc, v.distance_km nulls last, v.sort, v.name), '[]'::jsonb)
  from public.lodging_venues v where v.active
$$;
revoke execute on function private.lodging_venues_json() from public, anon, authenticated;

create or replace function public.lodging_venues_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(), '') = '' then raise exception 'forbidden'; end if;
  return private.lodging_venues_json();
end $$;

-- เพิ่ม/แก้ที่พักเครือข่าย (ฝ่ายจัดห้อง)
create or replace function public.lodging_venue_save(p_id bigint, p jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not public.lodging_is_team() then raise exception 'forbidden'; end if;
  if p_id is null then
    insert into public.lodging_venues (category, name, contact, subdistrict, district, province, distance_km, capacity, status,
      phone1, phone2, detail, active)
    values (p->>'category', btrim(p->>'name'), nullif(btrim(p->>'contact'), ''), nullif(btrim(p->>'subdistrict'), ''),
      nullif(btrim(p->>'district'), ''), nullif(btrim(p->>'province'), ''), (p->>'distance_km')::numeric, (p->>'capacity')::int,
      coalesce(p->>'status', 'unconfirmed'), nullif(btrim(p->>'phone1'), ''), nullif(btrim(p->>'phone2'), ''),
      nullif(btrim(p->>'detail'), ''), coalesce((p->>'active')::boolean, true))
    returning id into v_id;
  else
    update public.lodging_venues set category = p->>'category', name = btrim(p->>'name'), contact = nullif(btrim(p->>'contact'), ''),
      subdistrict = nullif(btrim(p->>'subdistrict'), ''), district = nullif(btrim(p->>'district'), ''),
      province = nullif(btrim(p->>'province'), ''), distance_km = (p->>'distance_km')::numeric, capacity = (p->>'capacity')::int,
      status = coalesce(p->>'status', status), phone1 = nullif(btrim(p->>'phone1'), ''), phone2 = nullif(btrim(p->>'phone2'), ''),
      detail = nullif(btrim(p->>'detail'), ''), active = coalesce((p->>'active')::boolean, active), updated_at = now()
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end $$;

-- ปักหมุดตำแหน่งเอง (ลากหมุดบนแผนที่)
create or replace function public.lodging_venue_move(p_id bigint, p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.lodging_is_team() then raise exception 'forbidden'; end if;
  update public.lodging_venues set lat = p_lat, lng = p_lng, geo_precision = 'manual', updated_at = now() where id = p_id;
  if not found then raise exception 'not_found'; end if;
end $$;

-- ส่งต่อคำขอไปที่พักเครือข่าย (อนุมัติทันที ล้างการจัดห้องในโรงเรียน) — p_venue null = ยกเลิกการส่งต่อ กลับไปรอจัดห้อง
create or replace function public.lodging_refer(p_request bigint, p_venue bigint, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.lodging_requests; v public.lodging_venues;
begin
  if not public.lodging_is_team() then raise exception 'forbidden'; end if;
  select * into q from public.lodging_requests where id = p_request for update;
  if not found or q.status not in ('pending','approved') then raise exception 'not_pending'; end if;
  if p_venue is null then
    update public.lodging_requests set venue_id = null, status = 'pending', decided_by = null, decided_at = null, decision_note = null
    where id = q.id;
    return;
  end if;
  select * into v from public.lodging_venues where id = p_venue and active and not is_home for update;
  if not found then raise exception 'not_found'; end if;
  if v.capacity is not null and private.lodging_venue_used(v.id) - (case when q.venue_id = v.id then private.lodging_total(q) else 0 end)
       + private.lodging_total(q) > v.capacity then
    raise exception 'venue_full';
  end if;
  delete from public.lodging_allocations where request_id = q.id;
  update public.lodging_requests set venue_id = v.id, status = 'approved', decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(p_note), '')
  where id = q.id;
end $$;

-- จัดห้องในโรงเรียน = ไม่ได้ส่งต่อแล้ว
create or replace function private.lodging_clear_venue() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.lodging_requests set venue_id = null where id = new.request_id and venue_id is not null;
  return new;
end $$;
revoke execute on function private.lodging_clear_venue() from public, anon, authenticated;
create trigger lodging_allocations_clear_venue after insert on public.lodging_allocations
  for each row execute function private.lodging_clear_venue();

revoke execute on function public.lodging_venues_list(), public.lodging_venue_save(bigint, jsonb),
  public.lodging_venue_move(bigint, double precision, double precision), public.lodging_refer(bigint, bigint, text) from public, anon;
grant execute on function public.lodging_venues_list(), public.lodging_venue_save(bigint, jsonb),
  public.lodging_venue_move(bigint, double precision, double precision), public.lodging_refer(bigint, bigint, text) to authenticated;

-- หน้าสาธารณะ: งาน + ห้อง + ตำแหน่งอาคาร + ที่พักเครือข่าย
create or replace function public.lodging_public_event(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'slug', e.slug, 'name', e.name, 'starts_on', e.starts_on, 'ends_on', e.ends_on,
           'closes_at', e.closes_at, 'note', e.note, 'open', now() < e.closes_at, 'rooms', private.lodging_rooms_json(e.id),
           'buildings', coalesce((select jsonb_agg(jsonb_build_object('name', b.name, 'poly', b.poly) order by b.name)
                                  from public.lodging_buildings b), '[]'::jsonb),
           'venues', private.lodging_venues_json())
  from public.lodging_events e
  where e.active and e.ends_on >= (now() at time zone 'Asia/Bangkok')::date
    and (coalesce(p_slug, '') = '' or e.slug = lower(p_slug))
  order by e.starts_on limit 1
$$;
revoke execute on function public.lodging_public_event(text) from public, anon, authenticated;
grant execute on function public.lodging_public_event(text) to service_role;

-- สถานะสำหรับโรงเรียน: ถ้าถูกส่งต่อ แสดงที่พักที่ได้ + ผู้ประสานงาน
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
             else '[]'::jsonb end,
           'venue', case when q.status = 'approved' and v.id is not null then jsonb_build_object(
             'name', v.name, 'category', v.category, 'contact', v.contact, 'phone1', v.phone1, 'phone2', v.phone2,
             'subdistrict', v.subdistrict, 'district', v.district, 'distance_km', v.distance_km, 'lat', v.lat, 'lng', v.lng,
             'geo_precision', v.geo_precision) end)
  from public.lodging_requests q join public.lodging_events e on e.id = q.event_id
  left join public.lodging_venues v on v.id = q.venue_id
  where q.ref_code = upper(btrim(p_ref))
$$;
revoke execute on function public.lodging_public_status(text) from public, anon, authenticated;
grant execute on function public.lodging_public_status(text) to service_role;
