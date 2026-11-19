-- ห้องน้ำเป็นงานของฝ่ายบริหารทั่วไป: ตรวจได้เฉพาะ inspector/admin (เหมือนเดิม)
-- บุคลากรอื่นดูรายงานได้อย่างเดียว (สรุปข้อที่ไม่ผ่าน + บันทึกการตรวจ) — รูปห้องน้ำยังเห็นเฉพาะ inspector/deputy/director/admin
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
