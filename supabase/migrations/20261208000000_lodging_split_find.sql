-- ============================================================
-- ห้องพัก: (1) โรงเรียนค้นหาคำขอของตัวเองด้วยชื่อโรงเรียน + เบอร์โทร (ลิงก์ติดตามหาย)
--          (2) แบ่งคำขอ: บางส่วนพักในโรงเรียน ที่เหลือส่งต่อที่พักเครือข่าย
--   lodging_requests.venue_people = จำนวนคนที่ส่งต่อ (= คนทั้งหมด − ที่จัดห้องในโรงเรียนแล้ว ตอนส่งต่อ)
--   อนุมัติได้เมื่อ ห้องในโรงเรียน + ส่งต่อ = คนทั้งหมด; ไม่ลบการจัดห้องเมื่อส่งต่อแล้ว (เลิกใช้ trigger ล้าง venue)
--   lodging_submit_log.kind แยกนับ submit / find (ค้นหา 20 ครั้ง/ชม./IP)
-- รันหลัง 20261207000000_lodging_network.sql
-- ============================================================

alter table public.lodging_requests add column venue_people int check (venue_people > 0);
alter table public.lodging_submit_log add column kind text not null default 'submit' check (kind in ('submit','find'));

drop trigger lodging_allocations_clear_venue on public.lodging_allocations;
drop function private.lodging_clear_venue();

create or replace function private.lodging_allocated(p_request bigint) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(people), 0)::int from public.lodging_allocations where request_id = p_request
$$;
revoke execute on function private.lodging_allocated(bigint) from public, anon, authenticated;

create or replace function private.lodging_venue_used(p_venue bigint) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(coalesce(q.venue_people, q.male_students + q.female_students + q.teachers)), 0)::int
  from public.lodging_requests q where q.venue_id = p_venue and q.status in ('pending','approved')
$$;
revoke execute on function private.lodging_venue_used(bigint) from public, anon, authenticated;

-- จัดคนลงห้อง (แทนที่ทั้งชุด) + กฎเหมาห้อง + รวมกับส่วนที่ส่งต่อแล้วต้องไม่เกินคนทั้งหมด
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
    if exists (
      select 1 from public.lodging_allocations a join public.lodging_requests o on o.id = a.request_id
      where a.room_id = v_room.id and o.event_id = q.event_id and o.id <> q.id and o.status in ('pending','approved')
      group by o.id having coalesce(sum(a.people) filter (where a.kind <> 'teacher'), 0) > 10
    ) then
      raise exception 'room_full:%', v_room.name;
    end if;
    if v_students > 10 and exists (
      select 1 from public.lodging_allocations a join public.lodging_requests o on o.id = a.request_id
      where a.room_id = v_room.id and o.event_id = q.event_id and o.id <> q.id and o.status in ('pending','approved')
    ) then
      raise exception 'room_shared:%', v_room.name;
    end if;
  end loop;
  if private.lodging_allocated(q.id) + coalesce(q.venue_people, 0) > private.lodging_total(q) then
    raise exception 'too_many';
  end if;
end $$;
revoke execute on function public.lodging_allocate(bigint, jsonb) from public, anon;
grant execute on function public.lodging_allocate(bigint, jsonb) to authenticated;

-- อนุมัติ: ห้องในโรงเรียน + ส่งต่อ ต้องครบทุกคน
create or replace function public.lodging_decide(p_request bigint, p_action text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.lodging_requests;
begin
  if not public.lodging_is_team() then raise exception 'forbidden'; end if;
  select * into q from public.lodging_requests where id = p_request for update;
  if not found then raise exception 'not_found'; end if;
  if p_action = 'approve' then
    if q.status <> 'pending' then raise exception 'not_pending'; end if;
    if private.lodging_allocated(q.id) + coalesce(q.venue_people, 0) <> private.lodging_total(q) then
      raise exception 'not_allocated';
    end if;
  elsif p_action = 'reject' then
    if q.status <> 'pending' then raise exception 'not_pending'; end if;
    if coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  elsif p_action = 'cancel' then
    if q.status not in ('pending','approved') then raise exception 'not_pending'; end if;
  else
    raise exception 'bad_request';
  end if;
  update public.lodging_requests
     set status = case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'cancelled' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = q.id;
end $$;

-- ส่งต่อ "ส่วนที่เหลือ" (คนทั้งหมด − ที่จัดห้องในโรงเรียนแล้ว) ไปที่พักเครือข่าย แล้วอนุมัติ; p_venue null = ยกเลิกการส่งต่อ กลับไปรอ
create or replace function public.lodging_refer(p_request bigint, p_venue bigint, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.lodging_requests; v public.lodging_venues; v_rest int;
begin
  if not public.lodging_is_team() then raise exception 'forbidden'; end if;
  select * into q from public.lodging_requests where id = p_request for update;
  if not found or q.status not in ('pending','approved') then raise exception 'not_pending'; end if;
  if p_venue is null then
    update public.lodging_requests set venue_id = null, venue_people = null, status = 'pending', decided_by = null, decided_at = null,
      decision_note = null
    where id = q.id;
    return;
  end if;
  select * into v from public.lodging_venues where id = p_venue and active and not is_home for update;
  if not found then raise exception 'not_found'; end if;
  v_rest := private.lodging_total(q) - private.lodging_allocated(q.id);
  if v_rest <= 0 then raise exception 'nothing_to_refer'; end if;
  if v.capacity is not null and private.lodging_venue_used(v.id)
       - (case when q.venue_id = v.id then coalesce(q.venue_people, private.lodging_total(q)) else 0 end) + v_rest > v.capacity then
    raise exception 'venue_full';
  end if;
  update public.lodging_requests set venue_id = v.id, venue_people = v_rest, status = 'approved', decided_by = auth.uid(),
    decided_at = now(), decision_note = coalesce(nullif(btrim(p_note), ''), decision_note)
  where id = q.id;
end $$;

-- หน้าสาธารณะ: กันสแปมนับเฉพาะการส่งคำขอ
create or replace function public.lodging_public_submit(p_slug text, p_ip_hash text, p_school text, p_contact text, p_phone text,
  p_male int, p_female int, p_teachers int, p_note text) returns text
language plpgsql security definer set search_path = '' as $$
declare e public.lodging_events; v_ref text;
begin
  select * into e from public.lodging_events where slug = lower(p_slug) and active;
  if not found then raise exception 'not_found'; end if;
  if now() >= e.closes_at then raise exception 'closed'; end if;
  if (select count(*) from public.lodging_submit_log where ip_hash = p_ip_hash and kind = 'submit' and at > now() - interval '1 hour') >= 6 then
    raise exception 'rate_limited';
  end if;
  if (select count(*) from public.lodging_requests where event_id = e.id and source = 'public' and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'rate_limited';
  end if;
  insert into public.lodging_submit_log (ip_hash, kind) values (p_ip_hash, 'submit');
  v_ref := private.lodging_new_ref();
  insert into public.lodging_requests (event_id, ref_code, school_name, contact_name, phone, male_students, female_students, teachers, note, source)
  values (e.id, v_ref, btrim(p_school), btrim(p_contact), regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'),
          coalesce(p_male, 0), coalesce(p_female, 0), coalesce(p_teachers, 0), nullif(btrim(p_note), ''), 'public');
  return v_ref;
end $$;

-- ค้นหาคำขอของตัวเอง: ต้องตรงทั้งเบอร์โทร (ตัวเลขล้วน) และชื่อโรงเรียน (ตัดคำว่า โรงเรียน/รร./ช่องว่าง เทียบแบบมีอยู่ในชื่อ)
create or replace function public.lodging_public_find(p_ip_hash text, p_school text, p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
        v_school text := regexp_replace(regexp_replace(lower(coalesce(p_school, '')), '^(โรงเรียน|รร\.?)', ''), '\s', '', 'g');
begin
  if v_phone !~ '^0[0-9]{8,9}$' or length(v_school) < 2 then raise exception 'bad_request'; end if;
  if (select count(*) from public.lodging_submit_log where ip_hash = p_ip_hash and kind = 'find' and at > now() - interval '1 hour') >= 20 then
    raise exception 'rate_limited';
  end if;
  insert into public.lodging_submit_log (ip_hash, kind) values (p_ip_hash, 'find');
  return coalesce((
    select jsonb_agg(jsonb_build_object('ref', q.ref_code, 'school_name', q.school_name, 'status', q.status, 'created_at', q.created_at,
             'event_name', e.name) order by q.created_at desc)
    from (select * from public.lodging_requests q0
          where q0.phone = v_phone
            and regexp_replace(lower(q0.school_name), '\s', '', 'g') like '%' || v_school || '%'
          order by q0.created_at desc limit 10) q
    join public.lodging_events e on e.id = q.event_id), '[]'::jsonb);
end $$;

-- สถานะสำหรับโรงเรียน: แสดงทั้งห้องในโรงเรียนและส่วนที่ส่งต่อ (จำนวนคน)
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
             'geo_precision', v.geo_precision, 'people', coalesce(q.venue_people, q.male_students + q.female_students + q.teachers)) end)
  from public.lodging_requests q join public.lodging_events e on e.id = q.event_id
  left join public.lodging_venues v on v.id = q.venue_id
  where q.ref_code = upper(btrim(p_ref))
$$;

revoke execute on function public.lodging_public_submit(text, text, text, text, text, int, int, int, text),
  public.lodging_public_find(text, text, text), public.lodging_public_status(text) from public, anon, authenticated;
grant execute on function public.lodging_public_submit(text, text, text, text, text, int, int, int, text),
  public.lodging_public_find(text, text, text), public.lodging_public_status(text) to service_role;
