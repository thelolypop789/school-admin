-- นศท.: ปฏิทินและสถิติของตัวเองในแอปนักเรียน (/s)
-- นักเรียนอ่านตารางตรงไม่ได้ (ไม่มี profile) → RPC เดียวคืนทั้งเดือนที่ขอ + สถิติสะสมของตัวเอง
-- รันหลัง 20261130000000_nst_name_login.sql

create or replace function public.nst_my_calendar(p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.nst_students := private.nst_me_row();
  v_from date := date_trunc('month', coalesce(p_month, private.nst_today()))::date;
  v_to date := (date_trunc('month', coalesce(p_month, private.nst_today())) + interval '1 month - 1 day')::date;
begin
  return jsonb_build_object(
    'from', v_from, 'to', v_to, 'now', now(),
    -- คาบเช็คชื่อของเดือน (เฉพาะชั้นปีของตัวเอง) สถานะ: ที่บันทึกไว้ / ปิดแล้วไม่มีบันทึก = ขาด / ยังไม่ถึงหรือยังเปิด = null
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'opens_at', x.opens_at, 'closes_at', x.closes_at,
               'status', coalesce(c.status, case when x.closes_at < now() then 'absent' end)) order by x.opens_at)
      from public.nst_sessions x left join public.nst_checkins c on c.session_id = x.id and c.student_id = s.id
      where (x.opens_at at time zone 'Asia/Bangkok')::date between v_from and v_to
        and (cardinality(x.nst_years) = 0 or s.nst_year = any(x.nst_years))), '[]'::jsonb),
    'duties', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'date', d.duty_date, 'post', p.name, 'starts', p.starts, 'ends', p.ends, 'status', d.status)
             order by d.duty_date, p.starts)
      from public.nst_duties d join public.nst_posts p on p.id = d.post_id
      where d.student_id = s.id and d.duty_date between v_from and v_to), '[]'::jsonb),
    -- สถิติสะสม (เฉพาะที่ผ่านมาแล้ว): เช็คชื่อ มา/สาย/ลา/ขาด · เวร รายงาน/สาย/ได้รับอนุญาต/ไม่มาเวร
    'stats', jsonb_build_object(
      'attend', (
        select jsonb_build_object(
          'present', count(*) filter (where st = 'present'), 'late', count(*) filter (where st = 'late'),
          'leave', count(*) filter (where st = 'leave'), 'absent', count(*) filter (where st = 'absent'))
        from (select coalesce(c.status, 'absent') st
                from public.nst_sessions x left join public.nst_checkins c on c.session_id = x.id and c.student_id = s.id
               where x.closes_at < now() and (cardinality(x.nst_years) = 0 or s.nst_year = any(x.nst_years))
              union all
              select c.status from public.nst_checkins c join public.nst_sessions x on x.id = c.session_id
               where c.student_id = s.id and x.closes_at >= now()) q),
      'duty', (
        select jsonb_build_object(
          'done', count(*) filter (where st = 'done'), 'late', count(*) filter (where st = 'late'),
          'excused', count(*) filter (where st = 'excused'), 'missed', count(*) filter (where st = 'missed'))
        from (select case when d.status = 'assigned' then 'missed' else d.status end st
                from public.nst_duties d join public.nst_posts p on p.id = d.post_id
               where d.student_id = s.id
                 and (d.status <> 'assigned' or private.nst_at(d.duty_date, p.ends) < now())) q)
    )
  );
end $$;

revoke execute on function public.nst_my_calendar(date) from public, anon;
grant execute on function public.nst_my_calendar(date) to authenticated;
