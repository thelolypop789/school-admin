-- Hardening หลังรัน 20261119000000 (จาก Supabase security advisor) — รันแล้วบน production
-- 1. trip_checklist_keys: ตั้ง search_path ให้ว่าง
-- 2. handle_new_user: trigger function ไม่ต้องให้เรียกผ่าน /rest/v1/rpc ได้
--    (trigger ยังทำงานตามปกติ: สิทธิ์ execute ตรวจตอนสร้าง trigger ไม่ใช่ตอน fire)
-- ฟังก์ชัน RPC อื่นที่ advisor เตือน (authenticated_security_definer_function_executable) ตั้งใจให้เรียกได้
-- เพราะแต่ละตัวเช็ก public.my_role() ภายในเอง

create or replace function public.trip_checklist_keys() returns text[]
language sql immutable set search_path = '' as $$ select array['documents','vehicle','fuel','driver'] $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
