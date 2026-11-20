import type { Profile } from "./supabase";
import { hasRole } from "./roles";

/** นศท. (นักศึกษาวิชาทหาร): เช็คชื่อเช้าวันพุธ/คาบกิจกรรม + เวรจราจร */
export type Attend = "present" | "late" | "leave" | "absent";
export type DutyStatus = "assigned" | "done" | "late" | "missed" | "excused";
export type SessionKind = "wed" | "activity" | "other";

export const ATTEND: Record<Attend, { label: string; tone: string }> = {
  present: { label: "มา", tone: "ok" },
  late: { label: "สาย", tone: "warn" },
  leave: { label: "ลา", tone: "info" },
  absent: { label: "ขาด", tone: "bad" },
};
export const DUTY: Record<DutyStatus, { label: string; tone: string }> = {
  assigned: { label: "ยังไม่รายงาน", tone: "" },
  done: { label: "รายงานแล้ว", tone: "ok" },
  late: { label: "รายงานสาย", tone: "warn" },
  missed: { label: "ไม่มาเวร", tone: "bad" },
  excused: { label: "ได้รับอนุญาต", tone: "info" },
};
export const KIND: Record<SessionKind, string> = { wed: "ฝึกเช้าวันพุธ", activity: "คาบกิจกรรม", other: "อื่นๆ" };

export type Student = {
  id: number; student_code: string; full_name: string; class_room: string; nst_year: number | null; group_name: string;
  pin_set: boolean; active: boolean; failed_attempts: number; locked_until: string | null;
};
export type Session = { id: number; kind: SessionKind; title: string; opens_at: string; late_at: string; closes_at: string; nst_years: number[] };
export type Checkin = {
  id: number; session_id: number; student_id: number; status: Attend; checked_at: string | null; photo_path: string | null;
  distance_m: number | null; accuracy_m: number | null; set_by: string | null; note: string | null;
};
export type Post = { id: number; name: string; starts: string; ends: string; need: number; sort: number; active: boolean };
export type Duty = {
  id: number; duty_date: string; post_id: number; student_id: number; group_name: string; status: DutyStatus;
  reported_at: string | null; photo_path: string | null; distance_m: number | null; set_by: string | null; note: string | null;
};
export type Swap = { id: number; from_duty: number; to_duty: number; requested_by: number; status: string; created_at: string };
export type Settings = { group_order: string[]; school_lat: number; school_lng: number; radius_m: number };

type P = Pick<Profile, "role" | "extra_roles">;
/** ครูผู้กำกับ นศท. / admin: จัดการทั้งหมด */
export const isNstStaff = (p: P) => hasRole(p, "nst_teacher", "admin");
/** ผู้บริหาร/หัวหน้าฝ่าย: ดูได้ */
export const isNstViewer = (p: P) => isNstStaff(p) || hasRole(p, "ga_head", "deputy", "director");

/** เวรที่เลยเวลาเลิกแล้วแต่ยังไม่รายงาน แสดงเป็น "ไม่มาเวร" */
export function dutyShown(status: DutyStatus, date: string, ends: string, now = new Date()): DutyStatus {
  if (status !== "assigned") return status;
  return new Date(`${date}T${ends.slice(0, 5)}:00+07:00`) < now ? "missed" : "assigned";
}

/** แยกข้อความที่วางจาก Google Sheets/Excel (แท็บ) หรือ CSV เป็นแถว — แถวแรกเป็นหัวตาราง */
export function parseTable(text: string): string[][] {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  const tab = lines[0].includes("\t");
  return lines.map((l) => (tab ? l.split("\t") : splitCsv(l)).map((c) => c.trim()));
}
function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** จับคอลัมน์จากหัวตาราง (ชื่อภาษาไทย/อังกฤษที่พบบ่อย) */
export const IMPORT_COLS = {
  code: ["รหัส", "รหัสนักเรียน", "เลขประจำตัว", "code", "student_id"],
  name: ["ชื่อ", "ชื่อ-สกุล", "ชื่อ-นามสกุล", "ชื่อสกุล", "name"],
  class_room: ["ชั้น", "ห้อง", "ชั้น/ห้อง", "class"],
  nst_year: ["ชั้นปี", "ชั้นปี นศท.", "ปี", "year"],
  group_name: ["กลุ่ม", "หมู่", "กลุ่มเวร", "group"],
  nid: ["เลขบัตรประชาชน", "เลขประจำตัวประชาชน", "บัตรประชาชน", "nid"],
} as const;
export type ImportRow = { code: string; name: string; class_room: string; nst_year: string; group_name: string; nid: string };
export function mapImport(rows: string[][]): { rows: ImportRow[]; missing: string[] } {
  if (rows.length < 2) return { rows: [], missing: ["code", "name"] };
  const head = rows[0].map((h) => h.replace(/\s+/g, " ").trim().toLowerCase());
  const idx = Object.fromEntries(Object.entries(IMPORT_COLS).map(([k, names]) =>
    [k, head.findIndex((h) => (names as readonly string[]).some((n) => h === n.toLowerCase()))])) as Record<keyof typeof IMPORT_COLS, number>;
  const missing = (["code", "name"] as const).filter((k) => idx[k] < 0);
  const get = (r: string[], k: keyof typeof IMPORT_COLS) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");
  return {
    missing,
    rows: rows.slice(1).map((r) => ({
      code: get(r, "code"), name: get(r, "name"), class_room: get(r, "class_room"),
      nst_year: get(r, "nst_year").replace(/\D/g, ""), group_name: get(r, "group_name"), nid: get(r, "nid").replace(/\D/g, ""),
    })).filter((r) => r.code && r.name),
  };
}

/** ข้อความผิดพลาดของการเข้าระบบนักเรียน */
export const LOGIN_ERR: Record<string, string> = {
  bad_credentials: "รหัสนักเรียนหรือ PIN ไม่ถูกต้อง",
  locked: "ใส่ผิดหลายครั้ง ระบบล็อกไว้ 15 นาที ลองใหม่ภายหลัง",
  pin_not_set: "ยังไม่ได้ตั้ง PIN — เลือก “เข้าครั้งแรก / ลืม PIN” แล้วยืนยันตัวด้วยเลขบัตรประชาชน",
  pin_already_set: "ตั้ง PIN ไปแล้ว เข้าด้วย PIN ได้เลย (ลืม PIN ให้ครูผู้กำกับรีเซ็ต)",
  nid_not_set: "ยังไม่มีเลขบัตรประชาชนของคุณในระบบ แจ้งครูผู้กำกับ นศท.",
  weak_pin: "PIN ง่ายเกินไป (เลขซ้ำกัน หรือเรียงกัน) ตั้งใหม่",
  bad_request: "ข้อมูลไม่ครบ",
  server_error: "ระบบขัดข้อง ลองใหม่อีกครั้ง",
};
