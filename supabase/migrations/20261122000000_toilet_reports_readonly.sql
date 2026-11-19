-- ห้องน้ำเป็นงานของฝ่ายบริหารทั่วไป (งานอาคารสถานที่)
-- - ตรวจ/อัปโหลดรูป: inspector, vehicle_head (หัวหน้าฝ่ายบริหารทั่วไป ควบงานยานพาหนะ + อาคารสถานที่), admin
-- - เห็นรูป: + deputy, director
-- - บุคลากรอื่น: ดูรายงานได้อย่างเดียว (สรุปข้อที่ไม่ผ่าน + บันทึกการตรวจ) ไม่เห็นรูป
-- รันหลัง 20261121000000_vehicle_fleet.sql

create or replace function public.toilet_item_report(p_from date, p_to date)
returns table (item_id int, category text, label text, checks int, fails int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.my_role() is null then raise exception 'forbidden'; end if;
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

drop policy toilet_inspections_read on public.toilet_inspections;
create policy toilet_inspections_read on public.toilet_inspections for select to authenticated
  using (public.my_role() is not null);

-- หัวหน้าฝ่ายบริหารทั่วไป (บทบาท vehicle_head: ควบงานยานพาหนะ + งานอาคารสถานที่) ตรวจห้องน้ำได้และเห็นรูป
create or replace function public.submit_toilet_inspection(
  p_toilet_id int, p_answers jsonb, p_note text default null, p_photo_paths text[] default '{}'
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_total int; v_pass int; v_safety_fail boolean; v_id bigint;
begin
  if coalesce(public.my_role(), '') not in ('inspector','vehicle_head','admin') then
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

drop policy toilet_photos_upload on storage.objects;
create policy toilet_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'toilet-photos' and public.my_role() in ('inspector','vehicle_head','admin'));
drop policy toilet_photos_read on storage.objects;
create policy toilet_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'toilet-photos' and public.my_role() in ('inspector','vehicle_head','deputy','director','admin'));
