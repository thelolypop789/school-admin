-- เวรจราจรเฉพาะกิจ (เช่น วันกีฬาสหวิทยาเขต): จุดเวรของวันนั้นวันเดียว ครูเลือกคนลงทีละจุดเอง
-- - จุดเฉพาะกิจ = nst_posts ที่มี event_day (จัดเวรอัตโนมัติไม่ใช้จุดพวกนี้)
-- - เวรเฉพาะกิจ = nst_duties ปกติ (set_by = ครู) → นักเรียนเห็น/รายงานตัว/แลกเวร/สถิติ เหมือนเวรปกติ
--   และการจัดเวรอัตโนมัติไม่ลบ (ลบเฉพาะ set_by is null)
-- - ตำแหน่งจุด: ครูแตะบนแผนที่ 3 มิติ (map_x/map_y) ไม่บังคับ
-- - คนที่มีหน้าที่อื่นวันนั้น (ถือธง การแสดง ฯลฯ) = nst_event_excused → เลือกลงจุดไม่ได้

-- map_x/map_y = ตำแหน่งบนแผนที่ 3 มิติ (พิกเซลภาพดาวเทียม แบบเดียวกับ clean_zones.polygon)
alter table public.nst_posts add column event_day date,
  add column map_x real check (map_x between -2000 and 3000),
  add column map_y real check (map_y between -2000 and 3000);
create index nst_posts_event_day_idx on public.nst_posts (event_day) where event_day is not null;

create table public.nst_event_excused (
  day date not null,
  student_id bigint not null references public.nst_students on delete cascade,
  note text not null default '' check (length(note) <= 60),
  primary key (day, student_id)
);
alter table public.nst_event_excused enable row level security;
revoke all on public.nst_event_excused from anon, authenticated;
grant select on public.nst_event_excused to authenticated;
create policy nst_event_excused_read on public.nst_event_excused for select to authenticated using (public.nst_is_viewer());

-- จัดเวรอัตโนมัติ: เหมือนเดิม แต่ไม่ใช้จุดเฉพาะกิจ
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
  select array_agg(p.id order by p.sort, p.starts, p.id) into v_slots
  from public.nst_posts p, generate_series(1, p.need) where p.active and p.event_day is null;
  if v_slots is null then raise exception 'no_posts'; end if;

  delete from public.nst_duties where duty_date between p_from and p_to and status = 'assigned' and set_by is null
    and post_id in (select id from public.nst_posts where event_day is null)
    and not exists (select 1 from public.nst_swaps w where w.status in ('pending','accepted') and (w.from_duty = nst_duties.id or w.to_duty = nst_duties.id));

  for d in select g::date from generate_series(p_from, p_to, interval '1 day') g where extract(isodow from g) between 1 and 5 loop
    continue when exists (select 1 from public.nst_no_duty_days where day = d);
    v_group := v_groups[(v_gi % cardinality(v_groups)) + 1];
    v_gi := v_gi + 1;
    select array_agg(id order by full_name) into v_students from public.nst_students where active and group_name = v_group;
    continue when v_students is null;
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

-- เพิ่ม/แก้จุดเฉพาะกิจ
create or replace function public.nst_event_post_save(p_id bigint, p_day date, p_name text, p_starts time, p_ends time, p_sort int, p_x real, p_y real)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_old date;
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if p_day is null or p_day < private.nst_today() or p_ends <= p_starts or coalesce(btrim(p_name), '') = '' then raise exception 'bad_request'; end if;
  if p_id is null then
    insert into public.nst_posts (name, starts, ends, need, sort, active, event_day, map_x, map_y)
    values (btrim(p_name), p_starts, p_ends, 2, coalesce(p_sort, 0), true, p_day, p_x, p_y) returning id into v_id;
  else
    select event_day into v_old from public.nst_posts where id = p_id for update;
    if v_old is null then raise exception 'not_found'; end if;
    if v_old <> p_day then raise exception 'bad_request'; end if;
    update public.nst_posts set name = btrim(p_name), starts = p_starts, ends = p_ends, sort = coalesce(p_sort, sort),
      map_x = p_x, map_y = p_y
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

-- ลบจุดเฉพาะกิจ (ลบได้ถ้ายังไม่มีใครรายงานตัวที่จุดนี้)
create or replace function public.nst_event_post_remove(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.nst_posts where id = p_id and event_day is not null) then raise exception 'not_found'; end if;
  if exists (select 1 from public.nst_duties where post_id = p_id and status <> 'assigned') then raise exception 'has_checkins'; end if;
  delete from public.nst_swaps w where w.status in ('pending','accepted')
    and exists (select 1 from public.nst_duties d where d.post_id = p_id and d.id in (w.from_duty, w.to_duty));
  delete from public.nst_posts where id = p_id;
end $$;

-- ตั้งรายชื่อคนของจุด (แทนที่ทั้งชุด): คนที่รายงานตัวแล้วเอาออกไม่ได้
create or replace function public.nst_event_assign(p_post bigint, p_students bigint[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_day date; v_ids bigint[] := coalesce(p_students, '{}');
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  select event_day into v_day from public.nst_posts where id = p_post for update;
  if v_day is null then raise exception 'not_found'; end if;
  if v_day < private.nst_today() then raise exception 'closed'; end if;
  if cardinality(v_ids) > 30 then raise exception 'bad_request'; end if;
  if exists (select 1 from public.nst_duties where post_id = p_post and status <> 'assigned' and not (student_id = any (v_ids))) then
    raise exception 'has_checkins';
  end if;
  if exists (select 1 from unnest(v_ids) u(id) where not exists (select 1 from public.nst_students s where s.id = u.id and s.active)) then
    raise exception 'not_found';
  end if;
  if exists (select 1 from public.nst_event_excused e where e.day = v_day and e.student_id = any (v_ids)) then
    raise exception 'excused';
  end if;
  -- คนหนึ่งมีเวรได้วันละ 1 จุด (รวมเวรปกติ)
  if exists (select 1 from public.nst_duties d where d.duty_date = v_day and d.post_id <> p_post and d.student_id = any (v_ids)) then
    raise exception 'conflict';
  end if;
  delete from public.nst_swaps w where w.status in ('pending','accepted')
    and exists (select 1 from public.nst_duties d where d.post_id = p_post and d.status = 'assigned' and not (d.student_id = any (v_ids))
                and d.id in (w.from_duty, w.to_duty));
  delete from public.nst_duties where post_id = p_post and status = 'assigned' and not (student_id = any (v_ids));
  insert into public.nst_duties (duty_date, post_id, student_id, group_name, set_by)
  select v_day, p_post, s.id, s.group_name, auth.uid() from public.nst_students s where s.id = any (v_ids)
  on conflict (duty_date, post_id, student_id) do nothing;
end $$;

-- คนที่มีหน้าที่อื่นวันนั้น (เปิด = เอาออกจากจุดเฉพาะกิจของวันนั้นด้วย ถ้ายังไม่รายงานตัว)
create or replace function public.nst_event_excuse(p_day date, p_student bigint, p_note text, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if p_day is null or p_day < private.nst_today() then raise exception 'bad_request'; end if;
  if coalesce(p_on, false) then
    if exists (select 1 from public.nst_duties d join public.nst_posts p on p.id = d.post_id
               where p.event_day = p_day and d.student_id = p_student and d.status <> 'assigned') then
      raise exception 'has_checkins';
    end if;
    delete from public.nst_swaps w where w.status in ('pending','accepted')
      and exists (select 1 from public.nst_duties d join public.nst_posts p on p.id = d.post_id
                  where p.event_day = p_day and d.student_id = p_student and d.id in (w.from_duty, w.to_duty));
    delete from public.nst_duties d using public.nst_posts p
      where p.id = d.post_id and p.event_day = p_day and d.student_id = p_student and d.status = 'assigned';
    insert into public.nst_event_excused (day, student_id, note) values (p_day, p_student, left(coalesce(btrim(p_note), ''), 60))
    on conflict (day, student_id) do update set note = excluded.note;
  else
    delete from public.nst_event_excused where day = p_day and student_id = p_student;
  end if;
end $$;

revoke execute on function public.nst_event_post_save(bigint, date, text, time, time, int, real, real), public.nst_event_post_remove(bigint),
  public.nst_event_assign(bigint, bigint[]), public.nst_event_excuse(date, bigint, text, boolean) from public, anon;
grant execute on function public.nst_event_post_save(bigint, date, text, time, time, int, real, real), public.nst_event_post_remove(bigint),
  public.nst_event_assign(bigint, bigint[]), public.nst_event_excuse(date, bigint, text, boolean) to authenticated;
