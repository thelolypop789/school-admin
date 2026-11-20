-- รูปห้องประชุม · รูปคนขับ · รูปโปรไฟล์ผู้ใช้ (bucket private อ่านผ่าน signed URL)
-- - ห้อง/คนขับ: บุคลากรดูได้ แอดมินอัปโหลด/เปลี่ยน/ลบ (แบบเดียวกับ vehicle-photos)
-- - โปรไฟล์: บุคลากรดูได้ เจ้าของอัปโหลด/เปลี่ยน/ลบเฉพาะโฟลเดอร์ของตัวเอง (<uid>/<uuid>.jpg)
-- รันหลัง 20261126000100_clean_zones_seed.sql

alter table public.rooms add column photo_path text;
alter table public.drivers add column photo_path text;
alter table public.profiles add column avatar_path text;

-- profiles ใช้ column-level grant: อ่านได้ทุกคนที่มีบทบาท, แก้ได้เฉพาะแถวตัวเอง (policy profiles_self_update)
grant select (avatar_path) on public.profiles to authenticated;
grant update (avatar_path) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('room-photos', 'room-photos', false, 2097152, array['image/jpeg','image/png','image/webp']),
  ('driver-photos', 'driver-photos', false, 2097152, array['image/jpeg','image/png','image/webp']),
  ('avatars', 'avatars', false, 524288, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- ห้องประชุม + คนขับ
create policy room_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'room-photos' and public.my_role() is not null);
create policy room_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'room-photos' and public.my_role() = 'admin');
create policy room_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'room-photos' and public.my_role() = 'admin')
  with check (bucket_id = 'room-photos' and public.my_role() = 'admin');
create policy room_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'room-photos' and public.my_role() = 'admin');

create policy driver_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'driver-photos' and public.my_role() is not null);
create policy driver_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'driver-photos' and public.my_role() = 'admin');
create policy driver_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'driver-photos' and public.my_role() = 'admin')
  with check (bucket_id = 'driver-photos' and public.my_role() = 'admin');
create policy driver_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'driver-photos' and public.my_role() = 'admin');

-- รูปโปรไฟล์: เจ้าของโฟลเดอร์เท่านั้นที่เขียน/ลบ
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.my_role() is not null);
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.my_role() is not null and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
