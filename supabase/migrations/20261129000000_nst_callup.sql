-- นศท.: เช็คชื่อเฉพาะกิจ "เรียกรวม" (ไม่มีกำหนดการล่วงหน้า)
-- - ครูผู้กำกับกด "เรียกรวมตอนนี้" เลือกชั้นปีได้ → เกิดคาบ kind = 'callup' เริ่ม ณ ตอนนั้น
-- - ครูเช็คเองเท่านั้น (self_report = false และเปิดให้รายงานเองไม่ได้) ไม่มีเวลาสาย ครูเลือกสถานะเอง
-- - ครูกด "ปิดการเรียกรวม" → คนที่ยังไม่ได้เช็คนับเป็นขาด; ถ้าไม่กดปิด ปิดเองตอน 23:59 ของวันนั้น
-- รันหลัง 20261128000100_nst_purge_cron.sql

alter table public.nst_sessions drop constraint nst_sessions_kind_check;
alter table public.nst_sessions add constraint nst_sessions_kind_check
  check (kind in ('wed','wed_pm','activity','other','callup'));

create or replace function public.nst_callup_start(p_title text, p_years smallint[]) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_end timestamptz := private.nst_at(private.nst_today(), time '23:59');
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if v_end <= now() then v_end := now() + interval '1 minute'; end if;
  insert into public.nst_sessions (kind, title, opens_at, late_at, closes_at, nst_years, self_report, created_by)
  values ('callup',
          coalesce(nullif(btrim(p_title), ''), 'เรียกรวม ' || to_char(now() at time zone 'Asia/Bangkok', 'HH24:MI')),
          now(), v_end, v_end, coalesce(p_years, '{}'), false, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.nst_callup_close(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  update public.nst_sessions set late_at = greatest(opens_at, now()), closes_at = greatest(opens_at + interval '1 second', now())
   where id = p_id and kind = 'callup' and closes_at > now();
  if not found then raise exception 'not_found'; end if;
end $$;

-- "ที่เหลือทั้งหมด = มา/ขาด": ใส่สถานะให้นักเรียนในชั้นปีของคาบที่ยังไม่มีบันทึก คืนจำนวนที่เติม
create or replace function public.nst_callup_fill(p_id bigint, p_status text) returns int
language plpgsql security definer set search_path = '' as $$
declare x public.nst_sessions; v_n int;
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if p_status not in ('present','late','leave','absent') then raise exception 'bad_request'; end if;
  select * into x from public.nst_sessions where id = p_id and kind = 'callup';
  if not found then raise exception 'not_found'; end if;
  insert into public.nst_checkins (session_id, student_id, status, set_by)
  select x.id, s.id, p_status, auth.uid() from public.nst_students s
   where s.active and (cardinality(x.nst_years) = 0 or s.nst_year = any(x.nst_years))
     and not exists (select 1 from public.nst_checkins c where c.session_id = x.id and c.student_id = s.id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- คาบเรียกรวมครูเช็คเองเท่านั้น: เปิดให้รายงานเองไม่ได้
create or replace function public.nst_session_self_report(p_id bigint, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.nst_is_staff() then raise exception 'forbidden'; end if;
  if coalesce(p_on, false) and exists (select 1 from public.nst_sessions where id = p_id and kind = 'callup') then
    raise exception 'callup_teacher_only';
  end if;
  update public.nst_sessions set self_report = coalesce(p_on, false) where id = p_id;
  if not found then raise exception 'not_found'; end if;
end $$;

revoke execute on function public.nst_callup_start(text, smallint[]), public.nst_callup_close(bigint), public.nst_callup_fill(bigint, text)
  from public, anon;
grant execute on function public.nst_callup_start(text, smallint[]), public.nst_callup_close(bigint), public.nst_callup_fill(bigint, text)
  to authenticated;
