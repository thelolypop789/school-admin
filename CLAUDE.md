# school-admin — CLAUDE.md

ระบบงานบริหารทั่วไปของโรงเรียนวังหลวงพิทยาสาร (จองห้องประชุม · จองรถ · ตรวจห้องน้ำ HAS) — แยกจาก FormAuto/SOBPREP ทั้ง repo, Supabase project และ Vercel project
วิธีติดตั้ง/deploy อยู่ใน `README.md`

## Stack / โครงสร้าง
- React 19 + TS + Vite, ไม่มี router library: `src/lib/router.ts` (pushState) — `/`, `/rooms`, `/vehicles`, `/vehicles/print/<id>` (ใบขออนุญาตไปราชการ), `/toilets`, `/t/<qr_token>` (หน้าตรวจจาก QR), `/admin`
- `src/App.tsx` = auth gate (Google, จำกัด @wangluangpitt.ac.th) + nav; หน้าอยู่ใน `src/pages/*` (lazy)
- `src/lib/supabase.ts` = client (storageKey `school-admin-auth`), types, `errText()` แปล error เป็นไทย
- จองรถ 3 ขั้น: `pending`(หัวหน้างานยานพาหนะ) → `pending_deputy` → `pending_director` → `approved`; ส่งกลับ = ขั้นก่อนหน้า (`returned` = กลับผู้ขอ); ทำผ่าน RPC `review_vehicle_booking` / `resubmit_vehicle_booking` เท่านั้น ประวัติอยู่ `vehicle_booking_steps`; ค่าคงที่ฝั่ง UI อยู่ `src/lib/vehicle.ts`
- PWA: `public/manifest.webmanifest` + `public/sw.js` (เขียนเอง ไม่ใช้ plugin; ไม่ cache request ไป Supabase) ลงทะเบียนใน `src/main.tsx` เฉพาะ production — แก้ sw.js แล้วให้เพิ่ม `VERSION`
- `src/lib/time.ts` = เวลาไทยเสมอ (`toISO(date, "HH:MM")` ใส่ +07:00) ห้ามใช้เขตเวลาเครื่อง
- `supabase/migrations/` = SQL; รันผ่าน SQL Editor (connector Claude ยังเข้า project นี้ไม่ได้)

## กฎความปลอดภัย (ต้องคงไว้)
- ทุกตารางเปิด RLS; anon ไม่มีสิทธิ์ใดๆ; `public.my_role()` = null สำหรับคนนอกโรงเรียน (ไม่มี profile)
- ฟังก์ชัน security definer ต้องเช็กสิทธิ์ด้วย `coalesce(public.my_role(), '')` (null ทำให้ `if` ข้ามการ raise)
- การเปลี่ยน role / อนุมัติรถ / บันทึกผลตรวจ ทำผ่าน RPC เท่านั้น; insert/update ตารางจองใช้ column-level grant
- กันจองซ้อนด้วย exclusion constraint (error 23P01) — UI แค่เตือนล่วงหน้า ตัวตัดสินคือ DB
- รูปห้องน้ำ bucket private อ่านผ่าน signed URL; ห้ามมีบุคคลในภาพ (PDPA)
- migration รันแล้วห้ามแก้ — เพิ่มไฟล์ใหม่

## ทดสอบ
`npm run lint && npm run build`; ทดสอบ SQL บน Postgres local ได้โดยสร้าง stub schema `auth` (users, uid()) / `storage` / roles anon, authenticated ก่อนรัน migration
