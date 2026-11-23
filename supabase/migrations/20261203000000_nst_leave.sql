-- นศท. ขอลา: นักเรียนขอลาคาบเช็คชื่อ/เวรจราจรในแอป แนบรูปหลักฐาน (รูปตัวเองก็ได้ ไม่บังคับใบรับรองแพทย์)
-- ครูผู้กำกับ (ผกท.) อนุมัติ → คาบ = 'leave', เวร = 'excused' ; ไม่อนุมัติ = สถานะเดิม
-- ขอล่วงหน้าได้ 30 วัน ขอย้อนหลังได้ไม่เกิน 3 วัน ; รูปอยู่ bucket nst-photos (<auth uid>/<uuid>.jpg ลบเองใน 30 วัน)

create table public.nst_leaves (
  id bigint generated always as identity primary key,
  student_id bigint not null references public.nst_students on delete cascade,
  session_id bigint references public.nst_sessions on delete cascade,
  duty_id bigint references public.nst_duties on delete cascade,
  leave_type text not null check (leave_type in ('sick','personal')),
  reason text not null check (length(btrim(reason)) between 1 and 300),
  photo_path text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles on delete set null,
  decided_at timestamptz,
  decide_note text check (length(decide_note) <= 300),
  check ((session_id is null) <> (duty_id is null))
);
create index nst_leaves_student_idx on public.nst_leaves (student_id, created_at desc);
create index nst_leaves_pending_idx on public.nst_leaves (created_at) where status = 'pending';
-- ขอซ้ำเรื่องเดียวกันไม่ได้ ระหว่างรอหรืออนุมัติแล้ว
create unique index nst_leaves_one_session on public.nst_leaves (session_id, student_id) where session_id is not null and status in ('pending','approved');
create unique index nst_leaves_one_duty on public.nst_leaves (duty_id) where duty_id is not null and status in ('pending','approved');

alter table public.nst_leaves enable row level security;
revoke all on public.nst_leaves from anon, authenticated;
grant select on public.nst_leaves to authenticated;
create policy nst_leaves_read on public.nst_leaves for select to authenticated using (public.nst_is_viewer());

-- รายการที่ขอลาได้ (ย้อนหลัง 3 วัน ถึงล่วงหน้า 30 วัน)
create or replace function public.nst_leave_options() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.nst_students := private.nst_me_row(); d0 date := private.nst_today() - 3; d1 date := private.nst_today() + 30;
begin
  return jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'opens_at', x.opens_at, 'closes_at', x.closes_at,
               'status', c.status) order by x.opens_at)
      from public.nst_sessions x
      left join public.nst_checkins c on c.session_id = x.id and c.student_id = s.id
      where (x.opens_at at time zone 'Asia/Bangkok')::date between d0 and d1
        and (cardinality(x.nst_years) = 0 or s.nst_year = any(x.nst_years))
        and (c.status is null or c.status = 'absent')
        and not exists (select 1 from public.nst_leaves l where l.session_id = x.id and l.student_id = s.id and l.status in ('pending','approved'))), '[]'::jsonb),
    'duties', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'date', d.duty_date, 'post', p.name, 'starts', p.starts, 'ends', p.ends, 'status', d.status)
               order by d.duty_date, p.starts)
      from public.nst_duties d join public.nst_posts p on p.id = d.post_id
      where d.student_id = s.id and d.duty_date between d0 and d1 and d.status in ('assigned','missed')
        and not exists (select 1 from public.nst_leaves l where l.duty_id = d.id and l.status in ('pending','approved'))), '[]'::jsonb));
end $$;

create or replace function public.nst_leave_request(p_kind text, p_target bigint, p_type text, p_reason text, p_photo text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare s public.nst_students := private.nst_me_row(); v_id bigint; v_day date;
begin
  if p_type not in ('sick','personal') or coalesce(btrim(p_reason), '') = '' or length(p_reason) > 300 then raise exception 'bad_request'; end if;
  if not private.nst_own_photo(p_photo) then raise exception 'photo_required'; end if;
  if p_kind = 'session' then
    select (x.opens_at at time zone 'Asia/Bangkok')::date into v_day from public.nst_sessions x
    where x.id = p_target and (cardinality(x.nst_years) = 0 or s.nst_year = any(x.nst_years));
    if v_day is null then raise exception 'not_found'; end if;
    if exists (select 1 from public.nst_checkins where session_id = p_target and student_id = s.id and status <> 'absent') then raise exception 'already'; end if;
  elsif p_kind = 'duty' then
    select duty_date into v_day from public.nst_duties where id = p_target and student_id = s.id and status in ('assigned','missed');
    if v_day is null then raise exception 'not_found'; end if;
  else
    raise exception 'bad_request';
  end if;
  if v_day < private.nst_today() - 3 then raise exception 'leave_too_late'; end if;
  if v_day > private.nst_today() + 30 then raise exception 'bad_request'; end if;
  insert into public.nst_leaves (student_id, session_id, duty_id, leave_type, reason, photo_path)
  values (s.id, case when p_kind = 'session' then p_target end, case when p_kind = 'duty' then p_target end, p_type, btrim(p_reason), p_photo)
  returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'leave_exists';
end $$;

create or replace function public.nst_leave_cancel(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.nst_students := private.nst_me_row();
begin
  update public.nst_leaves set status = 'cancelled' where id = p_id and student_id = s.id and status = 'pending';
  if not found then raise exception 'not_pending'; end if;
end $$;

-- คำขอลาของฉัน (ล่าสุด 20 รายการ)
create or replace function public.nst_my_leaves() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.nst_students := private.nst_me_row();
begin
  return coalesce((
    select jsonb_agg(q.j order by q.created_at desc) from (
      select l.created_at, jsonb_build_object('id', l.id, 'status', l.status, 'type', l.leave_type, 'reason', l.reason, 'note', l.decide_note,
        'created_at', l.created_at,
        'kind', case when l.session_id is not null then 'session' else 'duty' end,
        'title', coalesce(nullif(x.title, ''), p.name, ''), 'session_kind', x.kind,
        'date', coalesce((x.opens_at at time zone 'Asia/Bangkok')::date, d.duty_date)) j
      from public.nst_leaves l
      left join public.nst_sessions x on x.id = l.session_id
      left join public.nst_duties d on d.id = l.duty_id
      left join public.nst_posts p on p.id = d.post_id
      where l.student_id = s.id
      order by l.created_at desc limit 20) q), '[]'::jsonb);
end $$;

-- ผกท. อนุมัติ/ไม่อนุมัติ
create or replace function public.nst_leave_decide(p_id bigint, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.nst_leaves; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  select * into l from public.nst_leaves where id = p_id for update;
  if not found or l.status <> 'pending' then raise exception 'not_pending'; end if;
  if p_approve then
    if l.session_id is not null then
      if exists (select 1 from public.nst_checkins where session_id = l.session_id and student_id = l.student_id and status in ('present','late')) then
        raise exception 'already';
      end if;
      insert into public.nst_checkins (session_id, student_id, status, set_by, note)
      values (l.session_id, l.student_id, 'leave', auth.uid(), left((case l.leave_type when 'sick' then 'ลาป่วย: ' else 'ลากิจ: ' end) || l.reason, 300))
      on conflict (session_id, student_id) do update set status = 'leave', set_by = excluded.set_by, note = excluded.note,
        checked_at = null, photo_path = null;
    else
      update public.nst_duties set status = 'excused', set_by = auth.uid(),
        note = left((case l.leave_type when 'sick' then 'ลาป่วย: ' else 'ลากิจ: ' end) || l.reason, 300)
      where id = l.duty_id and status in ('assigned','missed');
      if not found then raise exception 'already'; end if;
      update public.nst_swaps set status = 'cancelled' where status in ('pending','accepted') and l.duty_id in (from_duty, to_duty);
    end if;
  end if;
  update public.nst_leaves set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now(), decide_note = v_note where id = p_id;
end $$;

revoke execute on function public.nst_leave_options(), public.nst_leave_request(text, bigint, text, text, text), public.nst_leave_cancel(bigint),
  public.nst_my_leaves(), public.nst_leave_decide(bigint, boolean, text) from public, anon;
grant execute on function public.nst_leave_options(), public.nst_leave_request(text, bigint, text, text, text), public.nst_leave_cancel(bigint),
  public.nst_my_leaves(), public.nst_leave_decide(bigint, boolean, text) to authenticated;
