-- ลบรูปหลักฐาน นศท. ที่เก่ากว่า 30 วัน ทุกคืน 01:10 (เวลาไทย) ผ่าน edge function nst-auth (action purge)
-- secret สุ่มใน DB ตอนรัน ไม่อยู่ใน repo; edge function ตรวจผ่าน nst_purge_secret_ok
create extension if not exists pg_cron;
insert into private.config (key, value) values ('nst_purge_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;
insert into private.config (key, value) values ('nst_fn_url', 'https://rvoixpbaiwilpigcxeix.supabase.co/functions/v1/nst-auth')
on conflict (key) do nothing;
select cron.schedule('nst-purge-photos', '10 18 * * *', $cron$
  select net.http_post(
    url := (select value from private.config where key = 'nst_fn_url'),
    body := '{"action":"purge"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-purge-secret', (select value from private.config where key = 'nst_purge_secret')))
$cron$);
