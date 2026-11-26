-- ============================================================
-- ห้องพัก: กฎ "นักเรียนเกิน 10 คน = เหมาห้อง"
--   ถ้าโรงเรียนใดมีนักเรียน (ไม่นับครู) ในห้องหนึ่งเกิน 10 คน ห้องนั้นถือว่าเต็ม โรงเรียนอื่นเข้าไม่ได้
--   และถ้าห้องมีโรงเรียนอื่นอยู่แล้ว จะจัดนักเรียนของอีกโรงเรียนลงห้องนั้นได้ไม่เกิน 10 คน
--   people = จำนวนคนจริงแยกประเภท {male,female,teacher,mixed} (วาดรูปคนในแต่ละห้อง)
--   ผังห้องว่าง/เต็ม: ห้องที่ถูกเหมา ที่นั่งที่เหลือนับเป็นของโรงเรียนนั้น (locked = true, lock_extra = ที่ว่างที่เหลือ)
-- รันหลัง 20261205000000_lodging.sql
-- ============================================================

create or replace function private.lodging_rooms_json(p_event bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  with per as (
    select a.room_id, q.id as req, q.status, sum(a.people) as people,
           coalesce(sum(a.people) filter (where a.kind <> 'teacher'), 0) as students
    from public.lodging_allocations a join public.lodging_requests q on q.id = a.request_id
    where q.event_id = p_event and q.status in ('pending','approved')
    group by a.room_id, q.id, q.status
  ), u as (
    select room_id,
           coalesce(sum(people) filter (where status = 'approved'), 0) as approved,
           coalesce(sum(people) filter (where status = 'pending'), 0) as pending,
           (array_agg(status order by status) filter (where students > 10))[1] as lock_status
    from per group by room_id
  ), k as (
    -- จำนวนคนจริงในห้องแยกประเภท (ไว้วาดรูปคนในผังห้อง — ไม่มีชื่อโรงเรียน)
    select a.room_id, jsonb_object_agg(a.kind, a.n) as people
    from (select a.room_id, a.kind, sum(a.people) as n
          from public.lodging_allocations a join public.lodging_requests q on q.id = a.request_id
          where q.event_id = p_event and q.status in ('pending','approved') group by a.room_id, a.kind) a
    group by a.room_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'building', r.building, 'floor', r.floor, 'name', r.name, 'capacity', r.capacity,
      'approved', coalesce(u.approved, 0)
        + case when u.lock_status = 'approved' then greatest(r.capacity - u.approved - u.pending, 0) else 0 end,
      'pending', coalesce(u.pending, 0)
        + case when u.lock_status = 'pending' then greatest(r.capacity - u.approved - u.pending, 0) else 0 end,
      'locked', u.lock_status is not null,
      'lock_extra', case when u.lock_status is not null then greatest(r.capacity - u.approved - u.pending, 0) else 0 end,
      'people', coalesce(k.people, '{}'::jsonb))
    order by r.building, r.floor, r.sort, r.name), '[]'::jsonb)
  from public.lodging_rooms r
  left join u on u.room_id = r.id
  left join k on k.room_id = r.id
  where r.active
$$;
revoke execute on function private.lodging_rooms_json(bigint) from public, anon, authenticated;

-- จัดคนลงห้อง (แทนที่ทั้งชุด) + กฎเหมาห้อง
create or replace function public.lodging_allocate(p_request bigint, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.lodging_requests; r jsonb; v_room public.lodging_rooms; v_want int; v_students int;
begin
  if not public.lodging_is_team() then raise exception 'forbidden'; end if;
  select * into q from public.lodging_requests where id = p_request for update;
  if not found or q.status not in ('pending','approved') then raise exception 'not_found'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'bad_request'; end if;
  delete from public.lodging_allocations where request_id = q.id;
  for r in select * from jsonb_array_elements(p_rows) loop
    continue when coalesce((r->>'people')::int, 0) <= 0;
    select * into v_room from public.lodging_rooms where id = (r->>'room_id')::bigint and active for update;
    if not found then raise exception 'room_not_found'; end if;
    insert into public.lodging_allocations (request_id, room_id, people, kind)
    values (q.id, v_room.id, (r->>'people')::int, coalesce(r->>'kind', 'mixed'))
    on conflict (request_id, room_id, kind) do update set people = public.lodging_allocations.people + excluded.people;
  end loop;
  for v_room in select ro.* from public.lodging_rooms ro where ro.id in (select room_id from public.lodging_allocations where request_id = q.id) loop
    select coalesce(sum(people), 0), coalesce(sum(people) filter (where kind <> 'teacher'), 0) into v_want, v_students
      from public.lodging_allocations where request_id = q.id and room_id = v_room.id;
    if private.lodging_used(q.event_id, v_room.id, q.id) + v_want > v_room.capacity then
      raise exception 'room_full:%', v_room.name;
    end if;
    -- โรงเรียนอื่นเหมาห้องนี้ไว้แล้ว (นักเรียนเกิน 10 คน)
    if exists (
      select 1 from public.lodging_allocations a join public.lodging_requests o on o.id = a.request_id
      where a.room_id = v_room.id and o.event_id = q.event_id and o.id <> q.id and o.status in ('pending','approved')
      group by o.id having coalesce(sum(a.people) filter (where a.kind <> 'teacher'), 0) > 10
    ) then
      raise exception 'room_full:%', v_room.name;
    end if;
    -- จะเหมาห้อง (นักเรียนเกิน 10) แต่มีโรงเรียนอื่นอยู่แล้ว
    if v_students > 10 and exists (
      select 1 from public.lodging_allocations a join public.lodging_requests o on o.id = a.request_id
      where a.room_id = v_room.id and o.event_id = q.event_id and o.id <> q.id and o.status in ('pending','approved')
    ) then
      raise exception 'room_shared:%', v_room.name;
    end if;
  end loop;
  if (select coalesce(sum(people), 0) from public.lodging_allocations where request_id = q.id) > private.lodging_total(q) then
    raise exception 'too_many';
  end if;
end $$;
revoke execute on function public.lodging_allocate(bigint, jsonb) from public, anon;
grant execute on function public.lodging_allocate(bigint, jsonb) to authenticated;
