import type { Role } from "./supabase";

/** งานห้องน้ำเป็นของฝ่ายบริหารทั่วไป: ตรวจได้ / เห็นรูปห้องน้ำได้ — คนอื่นดูรายงานอย่างเดียว (ตรงกับ RLS) */
export const canInspectToilets = (r: Role) => r === "inspector" || r === "admin";
export const isToiletTeam = (r: Role) => r === "inspector" || r === "deputy" || r === "director" || r === "admin";

export type Item = { id: number; category: "H" | "A" | "S"; label: string; sort: number; active: boolean };

export const CAT_LABEL: Record<Item["category"], string> = { H: "H · สะอาด", A: "A · เพียงพอ", S: "S · ปลอดภัย" };
export const GENDER_LABEL: Record<string, string> = { male: "ชาย", female: "หญิง", unisex: "รวม", disabled: "ผู้พิการ" };

/** สีสถานะ: เขียว ≥80% · เหลือง 60–79% · แดง <60% หรือข้อความปลอดภัยไม่ผ่าน */
export function tone(score: number | null, safetyFail: boolean | null): "ok" | "warn" | "bad" | "mute" {
  if (score === null) return "mute";
  if (safetyFail || score < 60) return "bad";
  return score >= 80 ? "ok" : "warn";
}
