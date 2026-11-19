import type { Role } from "./supabase";

/** สถานะที่บทบาทนี้ต้องพิจารณา (ตามลำดับ หัวหน้างานยานพาหนะ → รอง ผอ. → ผอ.) */
export const REVIEW_STATUS: Partial<Record<Role, string>> = {
  vehicle_head: "pending",
  deputy: "pending_deputy",
  director: "pending_director",
};

/** สถานะที่รถ/คนขับถูกกันไว้แล้ว (ตรงกับ exclusion constraint ใน DB) */
export const RESERVED = ["pending_deputy", "pending_director", "approved", "on_trip", "completed"];

/** สถานะที่พิมพ์คำสั่งไปราชการได้ (ผอ. อนุมัติแล้ว) */
export const PRINTABLE = ["approved", "on_trip", "completed"];

/** ควรยื่นล่วงหน้าอย่างน้อยกี่วัน (แค่เตือน ไม่ห้าม — งานด่วนมีจริง) */
export const LEAD_DAYS = 3;

/** วันที่เหลือก่อนใบขับขี่หมดอายุ ณ วันที่กำหนด (null = ยังไม่กรอก) */
export function licenseDaysLeft(expiry: string | null, atISO: string = new Date().toISOString()): number | null {
  if (!expiry) return null;
  const at = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(atISO)) + "T00:00:00Z");
  return Math.round((new Date(expiry + "T00:00:00Z").getTime() - at.getTime()) / 86400000);
}

/** ตรวจก่อนออกเดินทาง — key ต้องตรงกับ public.trip_checklist_keys() ใน DB */
export const TRIP_CHECKLIST: { key: string; label: string }[] = [
  { key: "documents", label: "คำสั่งไปราชการ/ใบอนุญาตใช้รถ อยู่ในรถ" },
  { key: "vehicle", label: "สภาพรถปกติ (ยาง ไฟ เบรก น้ำมันเครื่อง)" },
  { key: "fuel", label: "น้ำมันเพียงพอ หรือมีบัตร/เงินเติมน้ำมัน" },
  { key: "driver", label: "คนขับพร้อม มีใบขับขี่ติดตัว" },
];

export type Trip = {
  booking_id: number; vehicle_id: number; start_odometer: number; departed_at: string;
  end_odometer: number | null; fuel_liters: number | null; fuel_cost: number | null; note: string | null; closed_at: string | null;
};

/** สถานะที่ยังไม่จบ (ผู้ขอยกเลิกได้) */
export const OPEN = ["pending", "returned", "pending_deputy", "pending_director", "approved"];

export const STAGE_LABEL: Record<string, string> = {
  requester: "ผู้ขอ",
  head: "หัวหน้างานยานพาหนะ",
  deputy: "รอง ผอ. ฝ่ายบริหารทั่วไป",
  director: "ผู้อำนวยการ",
};

export type Step = {
  id: number; booking_id: number; stage: string; action: "submit" | "forward" | "return" | "reject" | "depart" | "close";
  note: string | null; acted_at: string; actor: { full_name: string; email: string } | null;
};

export const STEP_SELECT = "id,booking_id,stage,action,note,acted_at,actor:profiles!vehicle_booking_steps_actor_id_fkey(full_name,email)";

export function stepText(s: Step): string {
  if (s.action === "submit") return "ส่งคำขอ";
  if (s.action === "return") return "ส่งกลับ";
  if (s.action === "reject") return "ไม่อนุมัติ (ยุติเรื่อง)";
  if (s.action === "depart") return "ออกเดินทาง";
  if (s.action === "close") return "ปิดงาน";
  return s.stage === "head" ? "จัดรถ ส่งต่อ" : s.stage === "deputy" ? "เห็นชอบ ส่งต่อ" : "อนุมัติ";
}

/** รายการเบิก (ตรงกับ check constraint ใน DB และลำดับในคำสั่งไปราชการ) */
export const EXPENSES: { key: string; label: string }[] = [
  { key: "registration", label: "ลงทะเบียน" },
  { key: "allowance", label: "เบี้ยเลี้ยง (เฉพาะข้าราชการและพนักงานราชการ)" },
  { key: "transport", label: "พาหนะ" },
  { key: "lodging", label: "เช่าที่พัก" },
  { key: "private_car", label: "ชดเชยในการใช้พาหนะส่วนตัวในการเดินทางไปราชการได้ตามสิทธิ์โดยประหยัด" },
  { key: "lump_sum", label: "ค่าตอบแทนเหมาจ่าย/ค่าอาหารเหมาจ่าย (เฉพาะนักเรียนและลูกจ้างชั่วคราว)" },
];

export type Traveler = { name: string; position: string };
