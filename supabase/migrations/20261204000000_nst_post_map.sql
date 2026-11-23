-- จุดเวรปกติ: เก็บตำแหน่งบนแผนที่ 3 มิติได้ (map_x/map_y เพิ่มไว้แล้วใน 20261202000000_nst_event_duty.sql)
-- เพิ่ม nst_post_save แบบมีพิกัด (คงแบบเดิม 7 พารามิเตอร์ไว้ ให้แอปเวอร์ชันก่อน deploy ยังบันทึกได้)
create or replace function public.nst_post_save(p_id bigint, p_name text, p_starts time, p_ends time, p_need smallint, p_sort int,
  p_active boolean, p_x real, p_y real)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if (p_x is null) <> (p_y is null) then raise exception 'bad_request'; end if;
  if p_id is null then
    insert into public.nst_posts (name, starts, ends, need, sort, active, map_x, map_y)
    values (btrim(p_name), p_starts, p_ends, p_need, coalesce(p_sort, 0), coalesce(p_active, true), p_x, p_y)
    returning id into v_id;
  else
    update public.nst_posts set name = btrim(p_name), starts = p_starts, ends = p_ends, need = p_need, sort = coalesce(p_sort, sort),
      active = coalesce(p_active, active), map_x = p_x, map_y = p_y
    where id = p_id and event_day is null returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end $$;
revoke execute on function public.nst_post_save(bigint, text, time, time, smallint, int, boolean, real, real) from public, anon;
grant execute on function public.nst_post_save(bigint, text, time, time, smallint, int, boolean, real, real) to authenticated;
