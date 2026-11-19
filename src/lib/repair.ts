import type { Profile } from "./supabase";
import { hasRole } from "./roles";

/** งานแจ้งซ่อมอาคารสถานที่ — ตรงกับ RPC repair_* ใน DB */
export type Priority = "urgent" | "high" | "normal" | "low";
export type RepairStatus = "new" | "proposed" | "scheduled" | "done" | "cancelled";
export type Decision = "agree" | "urgent" | "defer";

export type Repair = {
  id: number; reported_by: string; title: string; detail: string | null; location: string;
  category: string; priority: Priority; reported_priority: Priority; status: RepairStatus;
  photo_paths: string[]; plan_start: string | null; plan_end: string | null; proposal: string | null;
  exec_decision: Decision | null; exec_note: string | null; done_note: string | null;
  done_photo_paths: string[]; done_at: string | null; created_at: string;
  reporter: { full_name: string; email: string } | null;
};
export const REPAIR_SELECT =
  "id,reported_by,title,detail,location,category,priority,reported_priority,status,photo_paths,plan_start,plan_end,proposal," +
  "exec_decision,exec_note,done_note,done_photo_paths,done_at,created_at,reporter:profiles!repair_requests_reported_by_fkey(full_name,email)";

export type RepairStep = {
  id: number; action: string; note: string | null; channel: "app" | "line"; created_at: string;
  actor: { full_name: string; email: string } | null;
};
export const STEP_SELECT = "id,action,note,channel,created_at,actor:profiles!repair_steps_actor_id_fkey(full_name,email)";

export const PRIORITIES: { key: Priority; label: string; hint: string; tone: "bad" | "warn" | "mute" }[] = [
  { key: "urgent", label: "ด่วนมาก", hint: "อันตราย หรือกระทบการเรียนการสอนทันที เช่น ไฟรั่ว น้ำท่วม ประตูหลุด", tone: "bad" },
  { key: "high", label: "ด่วน", hint: "ใช้งานไม่ได้ ต้องซ่อมภายใน 1–3 วัน", tone: "warn" },
  { key: "normal", label: "ปกติ", hint: "ซ่อมได้ตามคิวงาน", tone: "mute" },
  { key: "low", label: "ไม่เร่งด่วน", hint: "ความสวยงาม หรือรอซ่อมพร้อมงานอื่นได้", tone: "mute" },
];
export const PRIORITY = Object.fromEntries(PRIORITIES.map((p, i) => [p.key, { ...p, rank: i }])) as Record<Priority, (typeof PRIORITIES)[number] & { rank: number }>;

export const CATEGORIES: { key: string; label: string }[] = [
  { key: "electric", label: "ไฟฟ้า" },
  { key: "water", label: "ประปา/สุขา" },
  { key: "building", label: "อาคาร/โครงสร้าง" },
  { key: "furniture", label: "เครื่องเรือน" },
  { key: "aircon", label: "เครื่องปรับอากาศ" },
  { key: "other", label: "อื่นๆ" },
];
export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

export const STATUS: Record<RepairStatus, { label: string; tone: "ok" | "warn" | "bad" | "mute" }> = {
  new: { label: "รอลงวันที่", tone: "warn" },
  proposed: { label: "รอผู้บริหารพิจารณา", tone: "warn" },
  scheduled: { label: "กำหนดวันซ่อมแล้ว", tone: "ok" },
  done: { label: "ซ่อมเสร็จแล้ว", tone: "mute" },
  cancelled: { label: "ยกเลิก", tone: "mute" },
};
export const OPEN_STATUSES: RepairStatus[] = ["new", "proposed", "scheduled"];

export const DECISION_LABEL: Record<Decision, string> = { agree: "เห็นควรตามที่เสนอ", urgent: "ให้ด่วน", defer: "ให้ทำงานอื่นก่อน" };

const STEP_LABEL: Record<string, string> = {
  submit: "แจ้งซ่อม", priority: "ปรับความเร่งด่วน", propose: "ลงวันที่ เสนอผู้บริหาร",
  agree: "ผู้บริหารเห็นควรตามที่เสนอ", urgent: "ผู้บริหารให้ด่วน", defer: "ผู้บริหารให้ทำงานอื่นก่อน",
  done: "ซ่อมเสร็จ", cancel: "ยกเลิก",
};
export const stepLabel = (a: string) => STEP_LABEL[a] ?? a;

/** ผู้บริหารที่ตัดสินเรื่องแจ้งซ่อม (รอง ผอ./ผอ.) และหัวหน้างานอาคารสถานที่ที่ลงวันที่/ปิดงาน */
type P = Pick<Profile, "role" | "extra_roles">;
export const isRepairExec = (p: P) => hasRole(p, "deputy", "director");
export const isRepairHead = (p: P) => hasRole(p, "facilities_head", "admin");
/** ฝ่ายบริหาร/อาคารฯ ที่เห็นรูปทุกเรื่อง (ตรงกับ policy storage) */
export const seesAllRepairPhotos = (p: P) => hasRole(p, "facilities_head", "ga_head", "deputy", "director", "admin");

/** เรียง: ด่วนมาก → ปกติ ในกลุ่มเดียวกันเรื่องเก่าก่อน */
export function sortByPriority<T extends Pick<Repair, "priority" | "created_at">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => PRIORITY[a.priority].rank - PRIORITY[b.priority].rank || a.created_at.localeCompare(b.created_at));
}
