# ระบบงานบริหารทั่วไป · โรงเรียนวังหลวงพิทยาสาร

MVP 3 โมดูล:
1. **จองห้องประชุม** — ปฏิทินรายวัน, จองทันที, กันจองซ้อนที่ระดับฐานข้อมูล
2. **จองรถ** — ส่งคำขอ → ผู้อนุมัติเลือกรถ/คนขับ → อนุมัติ/ไม่อนุมัติ, ตารางรถ, กันรถ/คนขับซ้อน
3. **สุขาดี มีความสุข** — QR ติดหน้าห้องน้ำ → สแกนแล้วตรวจตาม checklist HAS (สะอาด/เพียงพอ/ปลอดภัย) + รูป, dashboard สถานะวันนี้, รายงานข้อที่ไม่ผ่านบ่อย, ส่งออก CSV

Stack: React 19 + TypeScript + Vite, Supabase (Auth Google / Postgres + RLS / Storage), Vercel

## ติดตั้งครั้งแรก

### 1. ฐานข้อมูล (Supabase)
1. Supabase → project `school-admin` → **SQL Editor** → New query
2. วางเนื้อหาไฟล์ `supabase/migrations/20261109000000_init.sql` ทั้งไฟล์ → **Run**
   (สร้างตาราง, RLS, ฟังก์ชัน, bucket รูป `toilet-photos`, checklist ตั้งต้น 15 ข้อ)
3. `pongsarkon@wangluangpitt.ac.th` จะเป็น admin อัตโนมัติเมื่อล็อกอินครั้งแรก

### 2. ล็อกอิน Google
1. Google Cloud Console → APIs & Services → Credentials → OAuth client (ใช้ของ FormAuto เดิมได้)
   → **Authorized redirect URIs** เพิ่ม `https://rvoixpbaiwilpigcxeix.supabase.co/auth/v1/callback`
2. Supabase → Authentication → Sign In / Providers → **Google** → เปิด แล้ววาง Client ID + Client Secret
3. Supabase → Authentication → URL Configuration
   - Site URL: โดเมนจริง เช่น `https://admin.wangluangpitt.ac.th`
   - Redirect URLs: `https://admin.wangluangpitt.ac.th/**`, `https://<project>.vercel.app/**`, `http://localhost:5174/**`

### 3. Vercel
1. Add New → Project → Import `school-admin` (Framework: Vite)
2. Environment Variables:
   - `VITE_SUPABASE_URL` = `https://rvoixpbaiwilpigcxeix.supabase.co`
   - `VITE_SUPABASE_KEY` = Supabase → Project Settings → API Keys → **anon / publishable** key (ห้ามใช้ service_role)
3. Deploy (แก้ env แล้วต้อง Redeploy เพราะค่าฝังตอน build)
4. โดเมน: Settings → Domains → เพิ่ม `admin.wangluangpitt.ac.th` → ให้ผู้ดูแลโดเมนโรงเรียนเพิ่ม CNAME ตามที่ Vercel บอก

### 4. ตั้งค่าในแอป (เมนู "จัดการ")
1. เพิ่มห้องประชุม, รถ, คนขับ, จุดห้องน้ำ
2. ห้องน้ำ + QR → **พิมพ์ QR ทุกจุด** (A4 ได้หลายจุด) → ติดหน้าห้องน้ำ
3. ให้ครูล็อกอินครั้งแรก แล้วตั้งบทบาทในแท็บ "ผู้ใช้"
   - **ผู้อนุมัติ**: รองฯ ฝ่ายบริหารทั่วไป / ผอ. — อนุมัติรถ, ดูรายงานห้องน้ำ
   - **ผู้ตรวจห้องน้ำ**: ครูเวร / แม่บ้าน / สภานักเรียน (ต้องมีอีเมลโรงเรียน)
   - **ผู้ดูแลระบบ**: ทำได้ทุกอย่าง

## พัฒนาในเครื่อง
```bash
cp .env.example .env   # ใส่ anon key
npm install
npm run dev            # http://localhost:5174
```
`npm run build` · `npm run lint`

## ยังไม่ได้ทำ (รอบถัดไป)
- แจ้งเตือน LINE (คำขอรถใหม่ → ผู้อนุมัติ, ผลอนุมัติ → ผู้ขอ, ห้องน้ำความปลอดภัยไม่ผ่าน → ผู้รับผิดชอบ) ผ่าน Edge Function + LINE OA ของโรงเรียน
- พิมพ์ใบขออนุญาตใช้รถ (PDF)
- import ข้อมูลตั้งต้นจาก Google Sheet
