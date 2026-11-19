import type { Profile } from "./supabase";
import { hasRole } from "./roles";

/** ปฏิทินงานฝ่ายบริหารทั่วไป — ตรงกับ RLS/RPC ใน DB (ga_events) */
type P = Pick<Profile, "role" | "extra_roles">;
/** ดูได้: ทีมฝ่ายบริหารทั่วไป (หัวหน้างาน หัวหน้าฝ่าย รอง ผอ. ผอ. แอดมิน) */
export const canViewGaCalendar = (p: P) => hasRole(p, "vehicle_head", "facilities_head", "ga_head", "deputy", "director", "admin");
/** เพิ่ม/แก้กิจกรรมเอง: หัวหน้างานยานพาหนะ/อาคารสถานที่/แอดมิน (หัวหน้าฝ่ายดูอย่างเดียว) */
export const canEditGaEvents = (p: P) => hasRole(p, "vehicle_head", "facilities_head", "admin");

export type GaEvent = {
  id: number; title: string; category: string; start_date: string; end_date: string;
  start_time: string | null; end_time: string | null; owner: string | null; note: string | null;
};
export const GA_CATEGORIES: { key: string; label: string }[] = [
  { key: "meeting", label: "ประชุม/อบรม" },
  { key: "inspection", label: "ตรวจ/ติดตามงาน" },
  { key: "ceremony", label: "พิธี/กิจกรรมโรงเรียน" },
  { key: "holiday", label: "วันหยุด/ปิดอาคาร" },
  { key: "other", label: "อื่นๆ" },
];
export const GA_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(GA_CATEGORIES.map((c) => [c.key, c.label]));

/** "09:00:00" → "09:00" */
export const hm = (t: string | null) => (t ? t.slice(0, 5) : "");
