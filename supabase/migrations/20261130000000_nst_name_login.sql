-- นศท.: นักเรียนเข้าระบบด้วย "ชื่อ นามสกุล" (ไม่ต้องมีคำนำหน้า) + PIN 6 หลัก
-- - ครั้งแรก (ยังไม่มี PIN / ครูรีเซ็ต): พิมพ์ชื่อแล้วตั้ง PIN ได้เลย ไม่ต้องมีรหัสนักเรียน/เลขบัตร
--   (ผู้ใช้ยอมรับความเสี่ยงที่คนอื่นตั้ง PIN แทน เพราะรายงานตัวต้องมีเซลฟี่ และครูรีเซ็ต PIN ได้)
-- - ทางเดิม (รหัสนักเรียน + เลขบัตร/PIN ผ่าน nst_auth) ยังใช้ได้
-- รันหลัง 20261129000000_nst_callup.sql

-- ชื่อสำหรับเทียบ: ตัดช่องว่างทั้งหมด
create or replace function private.nst_name_core(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(coalesce(p, ''), '\s+', '', 'g')
$$;
-- ชื่อสำหรับเทียบ: ตัดช่องว่าง + คำนำหน้า (นศท.หญิง / นศท. / นางสาว / นาง / นาย / ด.ช. / ด.ญ.) ครั้งเดียว
create or replace function private.nst_name_key(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(private.nst_name_core(p), '^(นศท\.?หญิง|นศท\.?|นางสาว|นาง|นาย|ด\.ช\.|ด\.ญ\.)', '')
$$;

alter table public.nst_students add column name_key text generated always as (private.nst_name_key(full_name)) stored;
create unique index nst_students_name_key_active on public.nst_students (name_key) where active;

-- เข้าระบบด้วยชื่อ (edge function nst-auth, service_role เท่านั้น)
-- p_kind = 'pin' (ปกติ) | 'first' (ยังไม่มี PIN → ตั้ง PIN ใหม่จาก p_pin)
create or replace function public.nst_auth_name(p_name text, p_kind text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.nst_students; v_ok boolean;
begin
  -- ผู้ใช้พิมพ์ชื่อไม่มีคำนำหน้า: เทียบตรงก่อน แล้วค่อยลองตัดคำนำหน้า (เผื่อพิมพ์ "นาย…" มา)
  select * into s from public.nst_students
   where active and name_key in (private.nst_name_core(p_name), private.nst_name_key(p_name))
   order by (name_key = private.nst_name_core(p_name)) desc limit 1;
  if not found or length(private.nst_name_core(p_name)) < 4 then
    perform extensions.crypt('x', extensions.gen_salt('bf', 8)); -- เวลาเท่ากับกรณีมีชื่อ
    raise exception 'bad_credentials';
  end if;
  if s.locked_until is not null and s.locked_until > now() then raise exception 'locked'; end if;

  if p_kind = 'pin' then
    if s.pin_hash is null then raise exception 'pin_not_set'; end if;
    v_ok := s.pin_hash = extensions.crypt(coalesce(p_pin, ''), s.pin_hash);
    if not v_ok then
      update public.nst_students
         set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
             locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
       where id = s.id;
      return jsonb_build_object('ok', false);
    end if;
  elsif p_kind = 'first' then
    if s.pin_hash is not null then raise exception 'pin_already_set'; end if;
    if coalesce(p_pin, '') !~ '^\d{6}$' or p_pin ~ '^(\d)\1{5}$' or p_pin in ('123456','654321','012345','987654') then
      raise exception 'weak_pin';
    end if;
    update public.nst_students set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)) where id = s.id;
  else
    raise exception 'bad_request';
  end if;

  update public.nst_students set failed_attempts = 0, locked_until = null where id = s.id;
  return jsonb_build_object('ok', true, 'student_id', s.id, 'auth_user_id', s.auth_user_id);
end $$;

revoke execute on function public.nst_auth_name(text, text, text) from public, anon, authenticated;
grant execute on function public.nst_auth_name(text, text, text) to service_role;
revoke execute on function private.nst_name_core(text), private.nst_name_key(text) from public, anon, authenticated;
