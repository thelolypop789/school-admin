-- ============================================================
-- เขตทำความสะอาดของครูที่ปรึกษา (แบบผสม)
--   ครูที่ปรึกษาถ่ายรูปรายงานเขตของตัวเองทุกวันที่มีเรียน → เจ้าหน้าที่อาคารสถานที่ (inspector)
--   / หัวหน้างานอาคารสถานที่ / admin ยืนยันผล (สะอาด/พอใช้/ต้องปรับปรุง) หรือสุ่มตรวจเองโดยไม่ต้องรอรายงาน
--   ผล "ต้องปรับปรุง" แจ้งครูที่ปรึกษาทาง LINE
-- polygon = พิกัดพิกเซลบนภาพดาวเทียมของแบบจำลอง 3 มิติ (0.3485 ม./พิกเซล, ทิศเหนือขึ้น) [[x,y],...]
-- ============================================================
create table public.clean_zones (
  id bigint generated always as identity primary key,
  class_name text not null check (length(class_name) between 1 and 40),
  area text not null default '' check (length(area) <= 120),
  advisor_names text not null default '' check (length(advisor_names) <= 200),
  advisor_ids uuid[] not null default '{}',
  polygon jsonb not null check (jsonb_typeof(polygon) = 'array' and jsonb_array_length(polygon) between 3 and 64),
  sort int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create index clean_zones_advisors_idx on public.clean_zones using gin (advisor_ids);

create table public.clean_reports (
  id bigint generated always as identity primary key,
  zone_id bigint not null references public.clean_zones on delete cascade,
  report_date date not null,
  -- รายงานของครูที่ปรึกษา (null = เจ้าหน้าที่ตรวจเองโดยไม่มีรายงาน)
  reported_by uuid references public.profiles on delete set null,
  reported_at timestamptz,
  photo_paths text[] not null default '{}',
  note text check (length(note) <= 500),
  -- ผลยืนยันของเจ้าหน้าที่ (null = รอยืนยัน)
  result text check (result in ('pass','fair','fail')),
  verified_by uuid references public.profiles on delete set null,
  verified_at timestamptz,
  verify_note text check (length(verify_note) <= 500),
  verify_photo_paths text[] not null default '{}',
  unique (zone_id, report_date)
);
create index clean_reports_date_idx on public.clean_reports (report_date);

alter table public.clean_zones enable row level security;
alter table public.clean_reports enable row level security;
revoke all on public.clean_zones, public.clean_reports from anon, authenticated;
grant select on public.clean_zones, public.clean_reports to authenticated;

-- บุคลากรทุกคนเห็นแผนที่และสถานะ (รูปแยกสิทธิ์ที่ storage)
create policy clean_zones_read on public.clean_zones for select to authenticated
  using (public.my_role() is not null);
create policy clean_reports_read on public.clean_reports for select to authenticated
  using (public.my_role() is not null);

-- ============================================================
-- Storage: รูปเขตทำความสะอาด (private) — path = <uid ผู้อัปโหลด>/<uuid>.jpg
-- เจ้าของรูป · ทีมอาคารสถานที่/ผู้บริหาร · ครูที่ปรึกษาของเขตนั้น เห็นรูป
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clean-photos', 'clean-photos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy clean_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'clean-photos' and public.my_role() is not null
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy clean_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'clean-photos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.my_roles() && array['inspector','facilities_head','ga_head','deputy','director','admin']::text[]
    or exists (select 1 from public.clean_reports r join public.clean_zones z on z.id = r.zone_id
               where auth.uid() = any(z.advisor_ids)
                 and (name = any(r.photo_paths) or name = any(r.verify_photo_paths)))));

-- ============================================================
-- ตรรกะ
-- ============================================================
create or replace function private.clean_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Bangkok')::date $$;

-- ครูที่ปรึกษารายงานเขตของตัวเอง (วันนี้หรือเมื่อวาน) ต้องมีรูปอย่างน้อย 1 รูป
-- เขตที่ยังไม่ผูกบัญชีครูที่ปรึกษา บุคลากรคนใดก็รายงานแทนได้ (บันทึกชื่อผู้รายงานไว้)
create or replace function public.clean_submit(
  p_zone bigint, p_date date, p_note text, p_photo_paths text[]
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_id bigint; v_result text;
begin
  if coalesce(public.my_role(), '') = '' then raise exception 'forbidden'; end if;
  select advisor_ids into v_ids from public.clean_zones where id = p_zone and active;
  if not found then raise exception 'not_found'; end if;
  if cardinality(v_ids) > 0 and not (auth.uid() = any(v_ids)
     or coalesce(public.my_roles() && array['inspector','facilities_head','admin']::text[], false)) then
    raise exception 'forbidden';
  end if;
  if p_date is null or p_date > private.clean_today() or p_date < private.clean_today() - 1 then
    raise exception 'bad_date';
  end if;
  if cardinality(coalesce(p_photo_paths, '{}')) = 0 or cardinality(p_photo_paths) > 4 then raise exception 'photo_required'; end if;
  if not private.own_photo_paths(p_photo_paths, auth.uid()) then raise exception 'forbidden'; end if;

  select result into v_result from public.clean_reports where zone_id = p_zone and report_date = p_date;
  if v_result is not null and v_result <> 'fail' then raise exception 'already_verified'; end if;

  -- รายงานใหม่หลัง "ต้องปรับปรุง" = แก้แล้ว ส่งให้ตรวจใหม่ (ล้างผลเดิม)
  insert into public.clean_reports (zone_id, report_date, reported_by, reported_at, photo_paths, note)
  values (p_zone, p_date, auth.uid(), now(), p_photo_paths, nullif(btrim(p_note), ''))
  on conflict (zone_id, report_date) do update
    set reported_by = excluded.reported_by, reported_at = excluded.reported_at,
        photo_paths = excluded.photo_paths, note = excluded.note,
        result = null, verified_by = null, verified_at = null, verify_note = null, verify_photo_paths = '{}'
  returning id into v_id;
  return v_id;
end $$;

-- เจ้าหน้าที่ยืนยันผล หรือสุ่มตรวจเอง (ไม่มีรายงานก็ได้) — "ต้องปรับปรุง" ต้องมีหมายเหตุ
create or replace function public.clean_verify(
  p_zone bigint, p_date date, p_result text, p_note text, p_photo_paths text[]
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not (coalesce(public.my_roles() && array['inspector','facilities_head','admin']::text[], false)) then raise exception 'forbidden'; end if;
  if p_result not in ('pass','fair','fail') then raise exception 'bad_result'; end if;
  if p_result = 'fail' and coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  if p_date is null or p_date > private.clean_today() or p_date < private.clean_today() - 7 then raise exception 'bad_date'; end if;
  if cardinality(coalesce(p_photo_paths, '{}')) > 4 then raise exception 'too_many_photos'; end if;
  if not private.own_photo_paths(p_photo_paths, auth.uid()) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.clean_zones where id = p_zone and active) then raise exception 'not_found'; end if;

  insert into public.clean_reports (zone_id, report_date, result, verified_by, verified_at, verify_note, verify_photo_paths)
  values (p_zone, p_date, p_result, auth.uid(), now(), nullif(btrim(p_note), ''), coalesce(p_photo_paths, '{}'))
  on conflict (zone_id, report_date) do update
    set result = excluded.result, verified_by = excluded.verified_by, verified_at = excluded.verified_at,
        verify_note = excluded.verify_note, verify_photo_paths = excluded.verify_photo_paths
  returning id into v_id;
  return v_id;
end $$;

-- ตั้งค่าเขต (หัวหน้างานอาคารสถานที่/admin): p_id null = เพิ่มใหม่; ไม่มีลบ ใช้ปิดใช้งานแทน (เก็บประวัติ)
create or replace function public.clean_zone_save(
  p_id bigint, p_class_name text, p_area text, p_advisor_names text, p_advisor_ids uuid[],
  p_polygon jsonb, p_sort int, p_active boolean
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not (coalesce(public.my_roles() && array['facilities_head','admin']::text[], false)) then raise exception 'forbidden'; end if;
  if coalesce(btrim(p_class_name), '') = '' then raise exception 'name_required'; end if;
  if exists (select 1 from unnest(coalesce(p_advisor_ids, '{}')) a
             where not exists (select 1 from public.profiles pr where pr.id = a)) then
    raise exception 'bad_advisor';
  end if;
  if p_polygon is null or jsonb_typeof(p_polygon) <> 'array' or jsonb_array_length(p_polygon) < 3
     or exists (select 1 from jsonb_array_elements(p_polygon) pt
                where jsonb_typeof(pt) <> 'array' or jsonb_array_length(pt) <> 2
                   or jsonb_typeof(pt->0) <> 'number' or jsonb_typeof(pt->1) <> 'number') then
    raise exception 'bad_polygon';
  end if;
  if p_id is null then
    insert into public.clean_zones (class_name, area, advisor_names, advisor_ids, polygon, sort, active)
    values (btrim(p_class_name), coalesce(btrim(p_area), ''), coalesce(btrim(p_advisor_names), ''),
            coalesce(p_advisor_ids, '{}'), p_polygon, coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.clean_zones set class_name = btrim(p_class_name), area = coalesce(btrim(p_area), ''),
      advisor_names = coalesce(btrim(p_advisor_names), ''), advisor_ids = coalesce(p_advisor_ids, '{}'),
      polygon = p_polygon, sort = coalesce(p_sort, sort), active = coalesce(p_active, active), updated_at = now()
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end $$;

-- บอท LINE: ข้อมูลสำหรับแจ้งครูที่ปรึกษาเมื่อผล "ต้องปรับปรุง"
create or replace function public.line_clean_report_info(p_report bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'date', r.report_date, 'result', r.result, 'note', r.verify_note,
    'class_name', z.class_name, 'area', z.area,
    'line_ids', coalesce((select jsonb_agg(p.line_user_id) from public.profiles p
                          where p.id = any(z.advisor_ids) and p.line_user_id is not null), '[]'::jsonb))
  from public.clean_reports r join public.clean_zones z on z.id = r.zone_id where r.id = p_report
$$;

revoke execute on function private.clean_today() from public, anon, authenticated;
revoke execute on function public.clean_submit(bigint, date, text, text[]) from public, anon;
revoke execute on function public.clean_verify(bigint, date, text, text, text[]) from public, anon;
revoke execute on function public.clean_zone_save(bigint, text, text, text, uuid[], jsonb, int, boolean) from public, anon;
grant execute on function public.clean_submit(bigint, date, text, text[]) to authenticated;
grant execute on function public.clean_verify(bigint, date, text, text, text[]) to authenticated;
grant execute on function public.clean_zone_save(bigint, text, text, text, uuid[], jsonb, int, boolean) to authenticated;
revoke execute on function public.line_clean_report_info(bigint) from public, anon, authenticated;
grant execute on function public.line_clean_report_info(bigint) to service_role;

-- ============================================================
-- แจ้งเตือน LINE เมื่อผลเป็น "ต้องปรับปรุง" (ใช้ private.config เดิม)
-- ============================================================
create or replace function private.notify_line_clean() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if new.result is distinct from 'fail' or (tg_op = 'UPDATE' and old.result is not distinct from new.result
     and old.verified_at is not distinct from new.verified_at) then
    return new;
  end if;
  select value into v_url from private.config where key = 'line_notify_url';
  select value into v_secret from private.config where key = 'line_notify_secret';
  if v_url is null or v_secret is null then return new; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('type', 'clean_fail', 'report_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret)
  );
  return new;
exception when others then
  return new; -- แจ้งเตือนพังต้องไม่ทำให้การบันทึกผลล้ม
end $$;
revoke execute on function private.notify_line_clean() from public, anon, authenticated;

create trigger clean_reports_notify_line
  after insert or update of result, verified_at on public.clean_reports
  for each row execute function private.notify_line_clean();

-- ชื่อบทบาท inspector ในหน้าแอปเปลี่ยนเป็น "เจ้าหน้าที่อาคารสถานที่" (ตรวจห้องน้ำ + เขตทำความสะอาด) — ไม่ต้องแก้ DB
