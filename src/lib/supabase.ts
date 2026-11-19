import { createClient } from "@supabase/supabase-js";

export const SCHOOL_DOMAIN = "wangluangpitt.ac.th";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || "https://placeholder.supabase.co",
  import.meta.env.VITE_SUPABASE_KEY || "placeholder",
  { auth: { storageKey: "school-admin-auth", persistSession: true, detectSessionInUrl: true } },
);

export const isConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_KEY);

export type Role = "staff" | "inspector" | "vehicle_head" | "deputy" | "director" | "admin";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  line_linked: boolean;  // LINE ID จริงอ่านไม่ได้จากแอป (เห็นแค่ว่าเชื่อมแล้วหรือยัง)
  position: string | null;
};

export const ROLE_LABEL: Record<Role, string> = {
  staff: "บุคลากร",
  inspector: "ผู้ตรวจห้องน้ำ",
  vehicle_head: "หัวหน้างานยานพาหนะ",
  deputy: "รอง ผอ. ฝ่ายบริหารทั่วไป",
  director: "ผู้อำนวยการ",
  admin: "ผู้ดูแลระบบ",
};

const ERRORS: Record<string, string> = {
  forbidden: "คุณไม่มีสิทธิ์ทำรายการนี้",
  vehicle_required: "กรุณาเลือกรถก่อนส่งต่อ",
  not_pending: "คำขอนี้ถูกพิจารณาไปแล้ว",
  note_required: "กรุณาระบุเหตุผลที่ส่งกลับ",
  not_returned: "คำขอนี้ไม่ได้อยู่ในสถานะส่งกลับแก้ไข",
  not_found: "ไม่พบคำขอนี้",
  in_past: "เวลาที่เลือกผ่านไปแล้ว",
  vehicle_unavailable: "รถคันนี้ซ่อมบำรุงหรือปิดใช้งานอยู่ เลือกคันอื่น",
  vehicle_docs_expired: "พ.ร.บ. หรือภาษีของรถคันนี้หมดก่อนวันเดินทางกลับ ต่ออายุก่อน หรือเลือกคันอื่น",
  license_expired: "ใบขับขี่ของคนขับคนนี้หมดอายุก่อนวันเดินทางกลับ เลือกคนอื่น",
  not_approved: "คำขอนี้ยังไม่ได้รับอนุมัติ หรือบันทึกออกเดินทางไปแล้ว",
  not_on_trip: "คำขอนี้ไม่ได้อยู่ระหว่างเดินทาง",
  checklist_incomplete: "กรุณาตรวจให้ครบทุกข้อก่อนออกเดินทาง",
  bad_odometer: "เลขไมล์ไม่ถูกต้อง",
  odometer_less_than_start: "เลขไมล์กลับต้องไม่น้อยกว่าเลขไมล์ก่อนออก",
  odometer_too_far: "ระยะทางเกิน 5,000 กม. — ตรวจเลขไมล์อีกครั้ง",
  toilet_not_found: "ไม่พบห้องน้ำนี้ (QR อาจเก่าหรือถูกปิดใช้งาน)",
  incomplete: "กรุณาตอบให้ครบทุกข้อ",
  no_checklist: "ยังไม่มีรายการตรวจ ให้ผู้ดูแลระบบเพิ่มก่อน",
  cannot_demote_self: "ลดสิทธิ์ตัวเองไม่ได้ ให้ผู้ดูแลระบบคนอื่นทำแทน",
};

/** แปลง error จาก Supabase เป็นข้อความภาษาไทย */
export function errText(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return "เกิดข้อผิดพลาด";
  if (err.code === "23P01") {
    if (err.message?.includes("driver")) return "คนขับคนนี้มีงานในช่วงเวลานี้แล้ว";
    if (err.message?.includes("vehicle")) return "รถคันนี้ถูกจองในช่วงเวลานี้แล้ว";
    return "ช่วงเวลานี้มีคนจองแล้ว เลือกเวลาอื่น";
  }
  if (err.code === "42501") return "คุณไม่มีสิทธิ์ทำรายการนี้";
  if (err.code === "23514") return "ข้อมูลไม่ถูกต้อง (ตรวจเวลาเริ่ม-สิ้นสุด และช่องที่จำเป็น)";
  const msg = err.message ?? "";
  for (const [k, v] of Object.entries(ERRORS)) if (msg.includes(k)) return v;
  if (msg.includes("row-level security")) return "บันทึกไม่ได้: ไม่มีสิทธิ์ หรือเวลาที่เลือกผ่านไปแล้ว";
  return msg || "เกิดข้อผิดพลาด";
}
