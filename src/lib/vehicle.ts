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
  note: string | null; acted_at: string; channel?: "app" | "line"; actor: { full_name: string; email: string } | null;
};

export const STEP_SELECT = "id,booking_id,stage,action,note,acted_at,channel,actor:profiles!vehicle_booking_steps_actor_id_fkey(full_name,email)";

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

/** เอกสารรถที่มีวันหมดอายุ — พ.ร.บ./ภาษี หมดแล้วจัดรถไม่ได้ (DB ตรวจ), ประกันภัยแค่เตือน */
export const VEHICLE_DOCS: { key: "act_expiry" | "tax_expiry" | "insurance_expiry"; label: string; required: boolean }[] = [
  { key: "act_expiry", label: "พ.ร.บ.", required: true },
  { key: "tax_expiry", label: "ภาษีรถ", required: true },
  { key: "insurance_expiry", label: "ประกันภัย", required: false },
];

/** สีตามวันคงเหลือ: หมดแล้ว = bad, ≤ 30 วัน = warn, ยังไม่กรอก = mute */
export function expiryTone(daysLeft: number | null): "ok" | "warn" | "bad" | "mute" {
  if (daysLeft === null) return "mute";
  if (daysLeft < 0) return "bad";
  return daysLeft <= 30 ? "warn" : "ok";
}

export const CONDITION_LABEL: Record<string, string> = { ready: "พร้อมใช้", maintenance: "ซ่อมบำรุง" };

/** สถานะในปฏิทิน/แดชบอร์ด รวมเป็นกลุ่มที่ผู้ใช้เข้าใจ */
export const STATUS_GROUP: Record<string, "waiting" | "approved" | "back" | "cancelled"> = {
  pending: "waiting", pending_deputy: "waiting", pending_director: "waiting",
  approved: "approved", on_trip: "approved", completed: "approved",
  returned: "back", rejected: "back", cancelled: "cancelled",
};

/** ชื่อสำหรับเอกสารราชการ: ตัดชื่อเล่นในวงเล็บออก เช่น "นายสมชาย ใจดี(น้าชาย)" → "นายสมชาย ใจดี" */
export function officialName(name: string): string {
  return name.replace(/\s*[(（][^)）]*[)）]/g, "").replace(/\s+/g, " ").trim();
}
