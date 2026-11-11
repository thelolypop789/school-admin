import type { Role } from "./supabase";

/** สถานะที่บทบาทนี้ต้องพิจารณา (ตามลำดับ หัวหน้างานยานพาหนะ → รอง ผอ. → ผอ.) */
export const REVIEW_STATUS: Partial<Record<Role, string>> = {
  vehicle_head: "pending",
  deputy: "pending_deputy",
  director: "pending_director",
};

/** สถานะที่รถ/คนขับถูกกันไว้แล้ว (ตรงกับ exclusion constraint ใน DB) */
export const RESERVED = ["pending_deputy", "pending_director", "approved"];

/** สถานะที่ยังไม่จบ (ผู้ขอยกเลิกได้) */
export const OPEN = ["pending", "returned", "pending_deputy", "pending_director", "approved"];

export const STAGE_LABEL: Record<string, string> = {
  requester: "ผู้ขอ",
  head: "หัวหน้างานยานพาหนะ",
  deputy: "รอง ผอ. ฝ่ายบริหารทั่วไป",
  director: "ผู้อำนวยการ",
};

export type Step = {
  id: number; booking_id: number; stage: string; action: "submit" | "forward" | "return";
  note: string | null; acted_at: string; actor: { full_name: string; email: string } | null;
};

export const STEP_SELECT = "id,booking_id,stage,action,note,acted_at,actor:profiles!vehicle_booking_steps_actor_id_fkey(full_name,email)";

export function stepText(s: Step): string {
  if (s.action === "submit") return "ส่งคำขอ";
  if (s.action === "return") return "ส่งกลับ";
  return s.stage === "head" ? "จัดรถ ส่งต่อ" : s.stage === "deputy" ? "เห็นชอบ ส่งต่อ" : "อนุมัติ";
}
