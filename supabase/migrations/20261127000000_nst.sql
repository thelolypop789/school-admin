-- ============================================================
-- นศท. (นักศึกษาวิชาทหาร): เช็คชื่อเช้าวันพุธ/คาบกิจกรรม + เวรจราจร
--   นักเรียนเข้าระบบด้วยรหัสนักเรียน + PIN (ครั้งแรก/หลังรีเซ็ต ยืนยันตัวด้วยเลขบัตรประชาชนแล้วตั้ง PIN)
--   — ผ่าน edge function nst-auth เท่านั้น; เลขบัตรและ PIN เก็บแบบเข้ารหัสทางเดียว (bcrypt) อ่านกลับไม่ได้
--   นักเรียนรายงานตัวด้วยเซลฟี่จากกล้อง + พิกัด; รูปเห็นเฉพาะเจ้าของ + ครูผู้กำกับ นศท. และลบอัตโนมัติหลัง 30 วัน
--   ครูผู้กำกับ นศท. (บทบาท nst_teacher): นำเข้ารายชื่อ ตั้งคาบ จัดเวรอัตโนมัติตามกลุ่ม อนุมัติแลกเวร
--   นักเรียนไม่มี profile (my_role() = null) จึงอ่านตารางตรงไม่ได้ ทุกอย่างผ่าน RPC nst_* ที่ตรวจ my_nst_student()
-- รันหลัง 20261126000100_clean_zones_seed.sql
-- ============================================================

-- บทบาทใหม่: ครูผู้กำกับ นศท.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('staff','inspector','vehicle_head','facilities_head','ga_head','nst_teacher','deputy','director','admin'));
alter table public.profiles drop constraint profiles_extra_roles_check;
alter table public.profiles add constraint profiles_extra_roles_check
  check (extra_roles <@ array['inspector','vehicle_head','facilities_head','ga_head','nst_teacher','deputy','director']::text[]);

create or replace function public.nst_is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_roles() && array['nst_teacher','admin']::text[], false)
$$;
create or replace function public.nst_is_viewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_roles() && array['nst_teacher','admin','ga_head','deputy','director']::text[], false)
$$;
revoke execute on function public.nst_is_staff(), public.nst_is_viewer() from public, anon;
grant execute on function public.nst_is_staff(), public.nst_is_viewer() to authenticated;

-- ============================================================ ตาราง
create table public.nst_students (
  id bigint generated always as identity primary key,
  student_code text not null unique check (student_code ~ '^[0-9A-Za-z]{1,20}$'),
  full_name text not null check (length(full_name) between 1 and 120),
  class_room text not null default '' check (length(class_room) <= 20),
  nst_year smallint check (nst_year between 1 and 5),
  group_name text not null default '' check (length(group_name) <= 40),
  nid_hash text,              -- bcrypt ของเลขบัตรประชาชน 13 หลัก
  pin_hash text,              -- bcrypt ของ PIN 6 หลัก (null = ยังไม่ตั้ง/ครูรีเซ็ต)
  pin_set boolean generated always as (pin_hash is not null) stored,
  auth_user_id uuid unique references auth.users on delete set null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.nst_sessions (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('wed','activity','other')),
  title text not null default '' check (length(title) <= 120),
  opens_at timestamptz not null,
  late_at timestamptz not null,
  closes_at timestamptz not null,
  nst_years smallint[] not null default '{}',   -- ว่าง = ทุกชั้นปี
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  check (opens_at < closes_at and late_at >= opens_at and late_at <= closes_at)
);
create index nst_sessions_open_idx on public.nst_sessions (opens_at);

create table public.nst_checkins (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.nst_sessions on delete cascade,
  student_id bigint not null references public.nst_students on delete cascade,
  status text not null check (status in ('present','late','leave','absent')),
  checked_at timestamptz,
  photo_path text,
  lat double precision, lng double precision, accuracy_m real, distance_m real,
  set_by uuid references public.profiles on delete set null,   -- null = นักเรียนรายงานเอง
  note text check (length(note) <= 300),
  unique (session_id, student_id)
);

-- จุดเวรจราจร (จุด + ช่วงเวลา + จำนวนคน)
create table public.nst_posts (
  id bigint generated always as identity primary key,
  name text not null check (length(name) between 1 and 80),
  starts time not null,
  ends time not null check (ends > starts),
  need smallint not null default 2 check (need between 1 and 30),
  sort int not null default 0,
  active boolean not null default true
);

create table public.nst_no_duty_days (
  day date primary key,
  note text not null default '' check (length(note) <= 120)
);

create table public.nst_duties (
  id bigint generated always as identity primary key,
  duty_date date not null,
  post_id bigint not null references public.nst_posts on delete cascade,
  student_id bigint not null references public.nst_students on delete cascade,
  group_name text not null default '',
  status text not null default 'assigned' check (status in ('assigned','done','late','missed','excused')),
  reported_at timestamptz,
  photo_path text,
  lat double precision, lng double precision, accuracy_m real, distance_m real,
  set_by uuid references public.profiles on delete set null,
  note text check (length(note) <= 300),
  unique (duty_date, post_id, student_id)
);
create index nst_duties_student_idx on public.nst_duties (student_id, duty_date);
create index nst_duties_date_idx on public.nst_duties (duty_date);

create table public.nst_swaps (
  id bigint generated always as identity primary key,
  from_duty bigint not null references public.nst_duties on delete cascade,
  to_duty bigint not null references public.nst_duties on delete cascade,
  requested_by bigint not null references public.nst_students on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','approved','rejected','declined','cancelled')),
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles on delete set null,
  decided_at timestamptz
);

-- ค่าตั้ง (แถวเดียว): ลำดับกลุ่มจัดเวร + จุดศูนย์กลางโรงเรียน/รัศมีตรวจพิกัด
create table public.nst_settings (
  id smallint primary key default 1 check (id = 1),
  group_order text[] not null default '{}',
  school_lat double precision not null default 18.0927,
  school_lng double precision not null default 103.2842,
  radius_m int not null default 400 check (radius_m between 50 and 5000)
);
insert into public.nst_settings (id) values (1) on conflict do nothing;

-- ============================================================ สิทธิ์อ่านตาราง (ครู/ผู้บริหาร) — นักเรียนใช้ RPC
alter table public.nst_students enable row level security;
alter table public.nst_sessions enable row level security;
alter table public.nst_checkins enable row level security;
alter table public.nst_posts enable row level security;
alter table public.nst_no_duty_days enable row level security;
alter table public.nst_duties enable row level security;
alter table public.nst_swaps enable row level security;
alter table public.nst_settings enable row level security;
revoke all on public.nst_students, public.nst_sessions, public.nst_checkins, public.nst_posts, public.nst_no_duty_days,
  public.nst_duties, public.nst_swaps, public.nst_settings from anon, authenticated;
-- ไม่ให้อ่าน nid_hash / pin_hash / auth_user_id
grant select (id, student_code, full_name, class_room, nst_year, group_name, pin_set, active, created_at, failed_attempts, locked_until)
  on public.nst_students to authenticated;
grant select on public.nst_sessions, public.nst_checkins, public.nst_posts, public.nst_no_duty_days,
  public.nst_duties, public.nst_swaps, public.nst_settings to authenticated;
create policy nst_students_read on public.nst_students for select to authenticated using (public.nst_is_viewer());
create policy nst_sessions_read on public.nst_sessions for select to authenticated using (public.nst_is_viewer());
create policy nst_checkins_read on public.nst_checkins for select to authenticated using (public.nst_is_viewer());
create policy nst_posts_read on public.nst_posts for select to authenticated using (public.nst_is_viewer());
create policy nst_no_duty_days_read on public.nst_no_duty_days for select to authenticated using (public.nst_is_viewer());
create policy nst_duties_read on public.nst_duties for select to authenticated using (public.nst_is_viewer());
create policy nst_swaps_read on public.nst_swaps for select to authenticated using (public.nst_is_viewer());
create policy nst_settings_read on public.nst_settings for select to authenticated using (public.nst_is_viewer());

-- ============================================================ รูป (private) path = <auth uid ของนักเรียน>/<uuid>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nst-photos', 'nst-photos', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create or replace function public.my_nst_student() returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.nst_students where auth_user_id = auth.uid() and active
$$;
revoke execute on function public.my_nst_student() from public, anon;
grant execute on function public.my_nst_student() to authenticated;

create policy nst_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'nst-photos' and public.my_nst_student() is not null
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy nst_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'nst-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.nst_is_staff()));

-- ============================================================ ตัวช่วย
create or replace function private.nst_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Bangkok')::date $$;
create or replace function private.nst_at(p_day date, p_time time) returns timestamptz
language sql immutable set search_path = '' as $$ select (p_day + p_time) at time zone 'Asia/Bangkok' $$;

-- ระยะ (เมตร) จากจุดศูนย์กลางโรงเรียน (haversine)
create or replace function private.nst_distance(p_lat double precision, p_lng double precision) returns real
language sql stable security definer set search_path = '' as $$
  select case when p_lat is null or p_lng is null then null else (
    2 * 6371000 * asin(sqrt(
      power(sin(radians(p_lat - s.school_lat) / 2), 2)
      + cos(radians(s.school_lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - s.school_lng) / 2), 2))))::real end
  from public.nst_settings s where s.id = 1
$$;

-- รูปต้องเป็นของผู้ส่งเอง 1 รูป
create or replace function private.nst_own_photo(p_path text) returns boolean
language sql immutable set search_path = '' as $$
  select p_path is not null and split_part(p_path, '/', 1) = auth.uid()::text and p_path !~ '\.\.' and p_path ~ '^[0-9a-f-]+/[0-9a-f-]+\.jpg$'
$$;

revoke execute on function private.nst_today(), private.nst_at(date, time), private.nst_distance(double precision, double precision),
  private.nst_own_photo(text) from public, anon, authenticated;

-- ============================================================ เข้าระบบ (edge function nst-auth, service_role เท่านั้น)
-- p_kind = 'pin' (ปกติ) | 'nid' (ครั้งแรก/หลังรีเซ็ต ต้องส่ง p_new_pin มาตั้งด้วย)
-- ผิด 5 ครั้งติด ล็อก 15 นาที; ใช้เลขบัตรได้เฉพาะตอนยังไม่มี PIN
create or replace function public.nst_auth(p_code text, p_kind text, p_secret text, p_new_pin text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.nst_students; v_ok boolean;
begin
  select * into s from public.nst_students where student_code = btrim(p_code) and active;
  if not found then
    perform extensions.crypt('x', extensions.gen_salt('bf', 8)); -- เวลาเท่ากับกรณีมีรหัส (กันเดารหัสนักเรียน)
    raise exception 'bad_credentials';
  end if;
  if s.locked_until is not null and s.locked_until > now() then raise exception 'locked'; end if;

  if p_kind = 'pin' then
    if s.pin_hash is null then raise exception 'pin_not_set'; end if;
    v_ok := s.pin_hash = extensions.crypt(coalesce(p_secret, ''), s.pin_hash);
  elsif p_kind = 'nid' then
    if s.pin_hash is not null then raise exception 'pin_already_set'; end if;
    if s.nid_hash is null then raise exception 'nid_not_set'; end if;
    v_ok := s.nid_hash = extensions.crypt(regexp_replace(coalesce(p_secret, ''), '\D', '', 'g'), s.nid_hash);
  else
    raise exception 'bad_request';
  end if;

  if not v_ok then
    update public.nst_students
       set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
     where id = s.id;
    return jsonb_build_object('ok', false);
  end if;

  if p_kind = 'nid' then
    if p_new_pin !~ '^\d{6}$' or p_new_pin ~ '^(\d)\1{5}$' or p_new_pin in ('123456','654321','012345','987654') then
      raise exception 'weak_pin';
    end if;
    update public.nst_students set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 8)) where id = s.id;
  end if;
  update public.nst_students set failed_attempts = 0, locked_until = null where id = s.id;
  return jsonb_build_object('ok', true, 'student_id', s.id, 'auth_user_id', s.auth_user_id);
end $$;

create or replace function public.nst_link_auth(p_student bigint, p_uid uuid) returns void
language sql security definer set search_path = '' as $$
  update public.nst_students set auth_user_id = p_uid where id = p_student and auth_user_id is null
$$;

-- ลบรูปเก่ากว่า 30 วัน: edge function ขอรายชื่อไฟล์ ลบผ่าน Storage API แล้วล้าง path ในตาราง
create or replace function public.nst_old_photos(p_limit int default 500) returns setof text
language sql stable security definer set search_path = '' as $$
  select name from storage.objects where bucket_id = 'nst-photos' and created_at < now() - interval '30 days'
  order by created_at limit p_limit
$$;
create or replace function public.nst_photos_purged(p_paths text[]) returns void
language sql security definer set search_path = '' as $$
  update public.nst_checkins set photo_path = null where photo_path = any(p_paths);
  update public.nst_duties set photo_path = null where photo_path = any(p_paths);
$$;
create or replace function public.nst_purge_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_secret) >= 32 and p_secret = (select value from private.config where key = 'nst_purge_secret'), false)
$$;
revoke execute on function public.nst_auth(text, text, text, text), public.nst_link_auth(bigint, uuid),
  public.nst_old_photos(int), public.nst_photos_purged(text[]), public.nst_purge_secret_ok(text) from public, anon, authenticated;
grant execute on function public.nst_auth(text, text, text, text), public.nst_link_auth(bigint, uuid),
  public.nst_old_photos(int), public.nst_photos_purged(text[]), public.nst_purge_secret_ok(text) to service_role;

-- ============================================================ ฝั่งนักเรียน
create or replace function private.nst_me_row() returns public.nst_students
language plpgsql stable security definer set search_path = '' as $$
declare s public.nst_students;
begin
  select * into s from public.nst_students where auth_user_id = auth.uid() and active;
  if not found then raise exception 'not_student'; end if;
  return s;
end $$;
revoke execute on function private.nst_me_row() from public, anon, authenticated;

-- ข้อมูลหน้าแรกของนักเรียน: ตัวเอง + คาบวันนี้ + เวร 14 วัน + คำขอแลกเวร + ประวัติเช็คชื่อล่าสุด
create or replace function public.nst_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.nst_students := private.nst_me_row(); v_today date := private.nst_today();
begin
  return jsonb_build_object(
    'me', jsonb_build_object('id', s.id, 'code', s.student_code, 'name', s.full_name, 'class_room', s.class_room,
                             'nst_year', s.nst_year, 'group_name', s.group_name),
    'now', now(),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'opens_at', x.opens_at,
               'late_at', x.late_at, 'closes_at', x.closes_at, 'status', c.status, 'checked_at', c.checked_at) order by x.opens_at)
      from public.nst_sessions x left join public.nst_checkins c on c.session_id = x.id and c.student_id = s.id
      where (x.opens_at at time zone 'Asia/Bangkok')::date = v_today
        and (cardinality(x.nst_years) = 0 or s.nst_year = any(x.nst_years))), '[]'::jsonb),
    'duties', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'date', d.duty_date, 'post', p.name, 'starts', p.starts, 'ends', p.ends,
               'status', d.status, 'reported_at', d.reported_at) order by d.duty_date, p.starts)
      from public.nst_duties d join public.nst_posts p on p.id = d.post_id
      where d.student_id = s.id and d.duty_date between v_today - 7 and v_today + 14), '[]'::jsonb),
    'swaps', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'status', w.status, 'mine', w.requested_by = s.id,
               'from', jsonb_build_object('date', fd.duty_date, 'post', fp.name, 'starts', fp.starts, 'student', fs.full_name),
               'to', jsonb_build_object('date', td.duty_date, 'post', tp.name, 'starts', tp.starts, 'student', ts.full_name))
             order by w.created_at desc)
      from public.nst_swaps w
      join public.nst_duties fd on fd.id = w.from_duty join public.nst_posts fp on fp.id = fd.post_id join public.nst_students fs on fs.id = fd.student_id
      join public.nst_duties td on td.id = w.to_duty join public.nst_posts tp on tp.id = td.post_id join public.nst_students ts on ts.id = td.student_id
      where (fd.student_id = s.id or td.student_id = s.id) and w.created_at > now() - interval '30 days'), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h order by h->>'opens_at' desc) from (
        select jsonb_build_object('opens_at', x.opens_at, 'kind', x.kind, 'title', x.title,
                 'status', coalesce(c.status, case when x.closes_at < now() then 'absent' end)) h
        from public.nst_sessions x left join public.nst_checkins c on c.session_id = x.id and c.student_id = s.id
        where x.opens_at < now() and x.opens_at > now() - interval '60 days'
          and (cardinality(x.nst_years) = 0 or s.nst_year = any(x.nst_years))
        order by x.opens_at desc limit 12) q), '[]'::jsonb)
  );
end $$;

create or replace function public.nst_check_in(p_session bigint, p_photo text, p_lat double precision, p_lng double precision, p_acc real)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.nst_students := private.nst_me_row(); x public.nst_sessions; v_status text;
begin
  select * into x from public.nst_sessions where id = p_session;
  if not found or not (cardinality(x.nst_years) = 0 or s.nst_year = any(x.nst_years)) then raise exception 'not_found'; end if;
  if now() < x.opens_at then raise exception 'not_open'; end if;
  if now() > x.closes_at then raise exception 'closed'; end if;
  if not private.nst_own_photo(p_photo) then raise exception 'photo_required'; end if;
  if exists (select 1 from public.nst_checkins where session_id = x.id and student_id = s.id) then raise exception 'already'; end if;
  v_status := case when now() > x.late_at then 'late' else 'present' end;
  insert into public.nst_checkins (session_id, student_id, status, checked_at, photo_path, lat, lng, accuracy_m, distance_m)
  values (x.id, s.id, v_status, now(), p_photo, p_lat, p_lng, p_acc, private.nst_distance(p_lat, p_lng));
  return v_status;
end $$;

-- รายงานตัวเวร: ตั้งแต่ 30 นาทีก่อนเริ่ม ถึงเวลาเลิก; หลังเริ่ม 10 นาที = สาย
create or replace function public.nst_duty_report(p_duty bigint, p_photo text, p_lat double precision, p_lng double precision, p_acc real)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.nst_students := private.nst_me_row(); d public.nst_duties; p public.nst_posts; v_start timestamptz; v_status text;
begin
  select * into d from public.nst_duties where id = p_duty and student_id = s.id;
  if not found then raise exception 'not_found'; end if;
  if d.status <> 'assigned' then raise exception 'already'; end if;
  select * into p from public.nst_posts where id = d.post_id;
  v_start := private.nst_at(d.duty_date, p.starts);
  if now() < v_start - interval '30 minutes' then raise exception 'not_open'; end if;
  if now() > private.nst_at(d.duty_date, p.ends) then raise exception 'closed'; end if;
  if not private.nst_own_photo(p_photo) then raise exception 'photo_required'; end if;
  v_status := case when now() > v_start + interval '10 minutes' then 'late' else 'done' end;
  update public.nst_duties set status = v_status, reported_at = now(), photo_path = p_photo,
    lat = p_lat, lng = p_lng, accuracy_m = p_acc, distance_m = private.nst_distance(p_lat, p_lng)
  where id = d.id;
  return v_status;
end $$;

-- เวรของคนอื่นที่แลกได้ (วันพรุ่งนี้เป็นต้นไป ยังไม่รายงาน ไม่ใช่วันเดียวกับเวรตัวเอง)
create or replace function public.nst_swap_options(p_my_duty bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.nst_students := private.nst_me_row(); d public.nst_duties;
begin
  select * into d from public.nst_duties where id = p_my_duty and student_id = s.id and status = 'assigned' and duty_date > private.nst_today();
  if not found then raise exception 'not_found'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id, 'date', o.duty_date, 'post', p.name, 'starts', p.starts,
             'student', st.full_name, 'class_room', st.class_room, 'group_name', st.group_name) order by o.duty_date, p.starts, st.full_name)
    from public.nst_duties o join public.nst_posts p on p.id = o.post_id join public.nst_students st on st.id = o.student_id
    where o.status = 'assigned' and o.duty_date > private.nst_today() and o.duty_date <= private.nst_today() + 30
      and o.student_id <> s.id and o.duty_date <> d.duty_date
      and not exists (select 1 from public.nst_duties mine where mine.student_id = s.id and mine.duty_date = o.duty_date)
      and not exists (select 1 from public.nst_duties theirs where theirs.student_id = o.student_id and theirs.duty_date = d.duty_date)
  ), '[]'::jsonb);
end $$;

create or replace function public.nst_swap_request(p_my_duty bigint, p_their_duty bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare s public.nst_students := private.nst_me_row(); v_id bigint;
begin
  if not exists (select 1 from jsonb_array_elements(public.nst_swap_options(p_my_duty)) o where (o->>'id')::bigint = p_their_duty) then
    raise exception 'not_allowed';
  end if;
  if exists (select 1 from public.nst_swaps where status in ('pending','accepted')
             and (from_duty in (p_my_duty, p_their_duty) or to_duty in (p_my_duty, p_their_duty))) then
    raise exception 'swap_pending';
  end if;
  insert into public.nst_swaps (from_duty, to_duty, requested_by) values (p_my_duty, p_their_duty, s.id) returning id into v_id;
  return v_id;
end $$;

-- คนถูกขอ: รับ/ไม่รับ · คนขอ: ยกเลิก
create or replace function public.nst_swap_respond(p_swap bigint, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.nst_students := private.nst_me_row(); w public.nst_swaps; v_target bigint;
begin
  select * into w from public.nst_swaps where id = p_swap;
  if not found then raise exception 'not_found'; end if;
  select student_id into v_target from public.nst_duties where id = w.to_duty;
  if p_action = 'cancel' and w.requested_by = s.id and w.status in ('pending','accepted') then
    update public.nst_swaps set status = 'cancelled', decided_at = now() where id = w.id;
  elsif p_action in ('accept','decline') and v_target = s.id and w.status = 'pending' then
    update public.nst_swaps set status = case when p_action = 'accept' then 'accepted' else 'declined' end, decided_at = now() where id = w.id;
  else
    raise exception 'not_allowed';
  end if;
end $$;

-- ============================================================ ฝั่งครูผู้กำกับ
-- นำเข้า/อัปเดตรายชื่อ: [{code,name,class_room,nst_year,group_name,nid}] — nid (13 หลัก) ถูกเข้ารหัสทางเดียวทันที
create or replace function public.nst_import(p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_n int := 0; v_nid text;
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 3000 then raise exception 'bad_request'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_nid := nullif(regexp_replace(coalesce(r->>'nid', ''), '\D', '', 'g'), '');
    if v_nid is not null and length(v_nid) <> 13 then raise exception 'bad_nid:%', r->>'code'; end if;
    insert into public.nst_students (student_code, full_name, class_room, nst_year, group_name, nid_hash)
    values (btrim(r->>'code'), btrim(r->>'name'), coalesce(btrim(r->>'class_room'), ''), nullif(r->>'nst_year', '')::smallint,
            coalesce(btrim(r->>'group_name'), ''),
            case when v_nid is null then null else extensions.crypt(v_nid, extensions.gen_salt('bf', 8)) end)
    on conflict (student_code) do update set
      full_name = excluded.full_name, class_room = excluded.class_room, nst_year = excluded.nst_year,
      group_name = excluded.group_name, active = true,
      nid_hash = coalesce(excluded.nid_hash, public.nst_students.nid_hash);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.nst_student_update(p_id bigint, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if p_action = 'reset_pin' then
    update public.nst_students set pin_hash = null, failed_attempts = 0, locked_until = null where id = p_id;
  elsif p_action in ('activate','deactivate') then
    update public.nst_students set active = (p_action = 'activate') where id = p_id;
  else
    raise exception 'bad_request';
  end if;
end $$;

create or replace function public.nst_session_save(
  p_id bigint, p_kind text, p_title text, p_opens timestamptz, p_late timestamptz, p_closes timestamptz, p_years smallint[]
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if p_id is null then
    insert into public.nst_sessions (kind, title, opens_at, late_at, closes_at, nst_years, created_by)
    values (p_kind, coalesce(btrim(p_title), ''), p_opens, p_late, p_closes, coalesce(p_years, '{}'), auth.uid()) returning id into v_id;
  else
    update public.nst_sessions set kind = p_kind, title = coalesce(btrim(p_title), ''), opens_at = p_opens, late_at = p_late,
      closes_at = p_closes, nst_years = coalesce(p_years, '{}') where id = p_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end $$;

-- สร้างคาบเช้าวันพุธทุกสัปดาห์ในช่วงวันที่ (ข้ามวันงดกิจกรรม และวันที่มีคาบแบบเดียวกันอยู่แล้ว)
create or replace function public.nst_sessions_weekly(p_from date, p_to date, p_dow int, p_kind text, p_title text,
  p_open time, p_late time, p_close time) returns int
language plpgsql security definer set search_path = '' as $$
declare d date; v_n int := 0;
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if p_to < p_from or p_to - p_from > 200 or p_dow not between 0 and 6 then raise exception 'bad_request'; end if;
  for d in select g::date from generate_series(p_from, p_to, interval '1 day') g where extract(dow from g) = p_dow loop
    continue when exists (select 1 from public.nst_no_duty_days where day = d);
    continue when exists (select 1 from public.nst_sessions where kind = p_kind and (opens_at at time zone 'Asia/Bangkok')::date = d);
    insert into public.nst_sessions (kind, title, opens_at, late_at, closes_at, created_by)
    values (p_kind, coalesce(btrim(p_title), ''), private.nst_at(d, p_open), private.nst_at(d, p_late), private.nst_at(d, p_close), auth.uid());
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.nst_session_remove(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if exists (select 1 from public.nst_checkins where session_id = p_id) then raise exception 'has_checkins'; end if;
  delete from public.nst_sessions where id = p_id;
end $$;

-- ครูตั้งสถานะแทน (ลา/ขาด/มา/สาย) หรือแก้สถานะที่นักเรียนรายงาน
create or replace function public.nst_set_attendance(p_session bigint, p_student bigint, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if p_status not in ('present','late','leave','absent') then raise exception 'bad_request'; end if;
  insert into public.nst_checkins (session_id, student_id, status, set_by, note)
  values (p_session, p_student, p_status, auth.uid(), nullif(btrim(p_note), ''))
  on conflict (session_id, student_id) do update set status = excluded.status, set_by = excluded.set_by, note = excluded.note;
end $$;

create or replace function public.nst_post_save(p_id bigint, p_name text, p_starts time, p_ends time, p_need smallint, p_sort int, p_active boolean)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if p_id is null then
    insert into public.nst_posts (name, starts, ends, need, sort, active) values (btrim(p_name), p_starts, p_ends, p_need, coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.nst_posts set name = btrim(p_name), starts = p_starts, ends = p_ends, need = p_need, sort = coalesce(p_sort, sort),
      active = coalesce(p_active, active) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.nst_no_duty_day(p_day date, p_note text, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if p_on then
    insert into public.nst_no_duty_days (day, note) values (p_day, coalesce(btrim(p_note), ''))
    on conflict (day) do update set note = excluded.note;
  else
    delete from public.nst_no_duty_days where day = p_day;
  end if;
end $$;

create or replace function public.nst_settings_save(p_group_order text[], p_lat double precision, p_lng double precision, p_radius int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  update public.nst_settings set group_order = coalesce(p_group_order, group_order), school_lat = coalesce(p_lat, school_lat),
    school_lng = coalesce(p_lng, school_lng), radius_m = coalesce(p_radius, radius_m) where id = 1;
end $$;

-- จัดเวรอัตโนมัติ: วันเรียน (จ.–ศ. ไม่ใช่วันงดเวร) วันละ 1 กลุ่ม หมุนตาม group_order เริ่มที่ p_start_group
-- คนในกลุ่มกระจายลงจุดตามจำนวนที่ต้องการ (เรียงชื่อ หมุนจุดเริ่มทุกรอบ ให้แต่ละคนได้จุดต่างกัน)
-- เวรในช่วงที่ยังไม่รายงานจะถูกแทนที่ เวรที่รายงานแล้ว/ครูตั้งสถานะแล้วคงไว้
create or replace function public.nst_generate_duties(p_from date, p_to date, p_start_group text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_groups text[]; v_gi int; d date; v_group text; v_students bigint[]; v_slots bigint[]; v_n int := 0; v_round int := 0; i int; k int;
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if p_from < private.nst_today() or p_to < p_from or p_to - p_from > 200 then raise exception 'bad_request'; end if;
  select group_order into v_groups from public.nst_settings where id = 1;
  if cardinality(v_groups) = 0 then raise exception 'no_groups'; end if;
  v_gi := coalesce(array_position(v_groups, p_start_group), 1) - 1;
  -- จุดเวร: ขยายตามจำนวนคนที่ต้องการ เช่น หน้าประตู x4
  select array_agg(p.id order by p.sort, p.starts, p.id) into v_slots
  from public.nst_posts p, generate_series(1, p.need) where p.active;
  if v_slots is null then raise exception 'no_posts'; end if;

  delete from public.nst_duties where duty_date between p_from and p_to and status = 'assigned' and set_by is null
    and not exists (select 1 from public.nst_swaps w where w.status in ('pending','accepted') and (w.from_duty = nst_duties.id or w.to_duty = nst_duties.id));

  for d in select g::date from generate_series(p_from, p_to, interval '1 day') g where extract(isodow from g) between 1 and 5 loop
    continue when exists (select 1 from public.nst_no_duty_days where day = d);
    v_group := v_groups[(v_gi % cardinality(v_groups)) + 1];
    v_gi := v_gi + 1;
    select array_agg(id order by full_name) into v_students from public.nst_students where active and group_name = v_group;
    continue when v_students is null;
    -- จุดละคน: คนที่ i ได้ช่อง (i + รอบ) ; ถ้าคนน้อยกว่าช่อง บางช่องว่าง ; คนมากกว่าช่อง = สำรองไม่ได้จัด
    for i in 1 .. least(cardinality(v_students), cardinality(v_slots)) loop
      k := ((i - 1 + v_round) % cardinality(v_slots)) + 1;
      insert into public.nst_duties (duty_date, post_id, student_id, group_name)
      values (d, v_slots[k], v_students[i], v_group) on conflict do nothing;
      v_n := v_n + 1;
    end loop;
    v_round := v_round + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.nst_set_duty(p_duty bigint, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if p_status not in ('assigned','done','late','missed','excused') then raise exception 'bad_request'; end if;
  update public.nst_duties set status = p_status, set_by = auth.uid(), note = nullif(btrim(p_note), '') where id = p_duty;
end $$;

-- ครูอนุมัติแลกเวร (หลังเพื่อนรับแล้ว): สลับนักเรียนของ 2 เวร
create or replace function public.nst_swap_decide(p_swap bigint, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.nst_swaps; a public.nst_duties; b public.nst_duties;
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  select * into w from public.nst_swaps where id = p_swap for update;
  if not found or w.status <> 'accepted' then raise exception 'not_pending'; end if;
  if p_approve then
    select * into a from public.nst_duties where id = w.from_duty for update;
    select * into b from public.nst_duties where id = w.to_duty for update;
    if a.status <> 'assigned' or b.status <> 'assigned' then raise exception 'already'; end if;
    -- ห้ามมีเวรซ้อนวันเดียวกันหลังสลับ
    if exists (select 1 from public.nst_duties where student_id = b.student_id and duty_date = a.duty_date and id <> b.id)
       or exists (select 1 from public.nst_duties where student_id = a.student_id and duty_date = b.duty_date and id <> a.id) then
      raise exception 'conflict';
    end if;
    update public.nst_duties set student_id = b.student_id, group_name = b.group_name where id = a.id;
    update public.nst_duties set student_id = a.student_id, group_name = a.group_name where id = b.id;
  end if;
  update public.nst_swaps set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now()
  where id = w.id;
end $$;

-- ============================================================ สิทธิ์เรียกฟังก์ชัน: เฉพาะผู้ที่ล็อกอินแล้ว (ตรวจบทบาท/ตัวนักเรียนในฟังก์ชัน)
revoke execute on function
  public.nst_home(), public.nst_check_in(bigint, text, double precision, double precision, real),
  public.nst_duty_report(bigint, text, double precision, double precision, real),
  public.nst_swap_options(bigint), public.nst_swap_request(bigint, bigint), public.nst_swap_respond(bigint, text),
  public.nst_import(jsonb), public.nst_student_update(bigint, text),
  public.nst_session_save(bigint, text, text, timestamptz, timestamptz, timestamptz, smallint[]),
  public.nst_sessions_weekly(date, date, int, text, text, time, time, time), public.nst_session_remove(bigint),
  public.nst_set_attendance(bigint, bigint, text, text),
  public.nst_post_save(bigint, text, time, time, smallint, int, boolean), public.nst_no_duty_day(date, text, boolean),
  public.nst_settings_save(text[], double precision, double precision, int), public.nst_generate_duties(date, date, text),
  public.nst_set_duty(bigint, text, text), public.nst_swap_decide(bigint, boolean)
from public, anon;
grant execute on function
  public.nst_home(), public.nst_check_in(bigint, text, double precision, double precision, real),
  public.nst_duty_report(bigint, text, double precision, double precision, real),
  public.nst_swap_options(bigint), public.nst_swap_request(bigint, bigint), public.nst_swap_respond(bigint, text),
  public.nst_import(jsonb), public.nst_student_update(bigint, text),
  public.nst_session_save(bigint, text, text, timestamptz, timestamptz, timestamptz, smallint[]),
  public.nst_sessions_weekly(date, date, int, text, text, time, time, time), public.nst_session_remove(bigint),
  public.nst_set_attendance(bigint, bigint, text, text),
  public.nst_post_save(bigint, text, time, time, smallint, int, boolean), public.nst_no_duty_day(date, text, boolean),
  public.nst_settings_save(text[], double precision, double precision, int), public.nst_generate_duties(date, date, text),
  public.nst_set_duty(bigint, text, text), public.nst_swap_decide(bigint, boolean)
to authenticated;
