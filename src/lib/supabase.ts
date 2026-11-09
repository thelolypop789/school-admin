import { createClient } from "@supabase/supabase-js";

export const SCHOOL_DOMAIN = "wangluangpitt.ac.th";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || "https://placeholder.supabase.co",
  import.meta.env.VITE_SUPABASE_KEY || "placeholder",
  { auth: { storageKey: "school-admin-auth", persistSession: true, detectSessionInUrl: true } },
);

export const isConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_KEY);

export type Role = "staff" | "approver" | "inspector" | "admin";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  line_user_id: string | null;
};

export const ROLE_LABEL: Record<Role, string> = {
  staff: "บุคลากร",
  approver: "ผู้อนุมัติ",
  inspector: "ผู้ตรวจห้องน้ำ",
  admin: "ผู้ดูแลระบบ",
};

const ERRORS: Record<string, string> = {
  forbidden: "คุณไม่มีสิทธิ์ทำรายการนี้",
  vehicle_required: "กรุณาเลือกรถก่อนอนุมัติ",
  not_pending: "คำขอนี้ถูกพิจารณาไปแล้ว",
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
