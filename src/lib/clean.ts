import type { Profile } from "./supabase";
import { hasRole } from "./roles";
import type { Pt } from "../campus/campus3d";

/** เขตทำความสะอาดของครูที่ปรึกษา — พิกัด polygon = พิกเซลบนภาพดาวเทียมของแบบจำลอง 3 มิติ */
export type Zone = {
  id: number; class_name: string; area: string; advisor_names: string; advisor_ids: string[];
  polygon: Pt[]; sort: number; active: boolean;
};
export type Result = "pass" | "fair" | "fail";
export type Report = {
  id: number; zone_id: number; report_date: string;
  reported_by: string | null; reported_at: string | null; photo_paths: string[]; note: string | null;
  result: Result | null; verified_by: string | null; verified_at: string | null; verify_note: string | null; verify_photo_paths: string[];
  reporter?: { full_name: string } | null; verifier?: { full_name: string } | null;
};
export const REPORT_SELECT = "*, reporter:profiles!clean_reports_reported_by_fkey(full_name), verifier:profiles!clean_reports_verified_by_fkey(full_name)";

/** สถานะของเขตในวันหนึ่ง: ยังไม่รายงาน → รายงานแล้วรอตรวจ → ผลตรวจ */
export type State = "none" | "waiting" | Result;
export const stateOf = (r?: Report | null): State => (!r ? "none" : r.result ?? "waiting");

/** สีสถานะบนแผนที่ (ผ่านการตรวจสีกับพื้นหญ้า/หลังคา และคู่สีตาบอดสี: แดง-เขียวต่างค่าความสว่างชัด + มีป้ายคำกำกับเสมอ) */
export const STATE: Record<State, { label: string; short: string; color: string; tone: string }> = {
  none: { label: "ยังไม่รายงาน", short: "ยังไม่รายงาน", color: "#8a8f98", tone: "" },
  waiting: { label: "รายงานแล้ว รอตรวจ", short: "รอตรวจ", color: "#2f6fe0", tone: "info" },
  pass: { label: "สะอาด", short: "สะอาด", color: "#14a05a", tone: "ok" },
  fair: { label: "พอใช้", short: "พอใช้", color: "#e8a20c", tone: "warn" },
  fail: { label: "ต้องปรับปรุง", short: "ปรับปรุง", color: "#d8344a", tone: "bad" },
};
export const RESULTS: Result[] = ["pass", "fair", "fail"];
export const SCORE: Record<Result, number> = { pass: 2, fair: 1, fail: 0 };

type P = Pick<Profile, "role" | "extra_roles">;
/** ยืนยันผล/สุ่มตรวจ: เจ้าหน้าที่อาคารสถานที่ (inspector) · หัวหน้างานอาคารสถานที่ · admin */
export const canVerifyClean = (p: P) => hasRole(p, "inspector", "facilities_head", "admin");
/** ตั้งค่าเขต (รูปเขต ชั้นเรียน ครูที่ปรึกษา) */
export const canEditZones = (p: P) => hasRole(p, "facilities_head", "admin");
/** เห็นรูปทุกเขต (ตรงกับ policy ของ bucket clean-photos) */
export const seesAllCleanPhotos = (p: P) => hasRole(p, "inspector", "facilities_head", "ga_head", "deputy", "director", "admin");
export const isAdvisorOf = (z: Zone, uid: string) => z.advisor_ids.includes(uid);
/** รายงานได้: ครูที่ปรึกษาของเขต · เขตที่ยังไม่ผูกบัญชี (ใครก็รายงานแทนได้) · ทีมตรวจ */
export const canReport = (z: Zone, p: P & { id: string }) => z.advisor_ids.length === 0 || isAdvisorOf(z, p.id) || canVerifyClean(p);

/** วันที่มีเรียน = จันทร์–ศุกร์ (วันหยุดนักขัตฤกษ์ยังไม่ได้ตัดออก) */
export const isSchoolDay = (d: string) => { const w = new Date(`${d}T12:00:00+07:00`).getUTCDay(); return w >= 1 && w <= 5; };

/** สรุปผลรายเขตช่วงหลายวัน: จำนวนวันมีเรียน รายงาน ผลแต่ละแบบ และคะแนน (สะอาด 2 พอใช้ 1 ปรับปรุง 0 ยังไม่รายงาน 0) */
export type ZoneSummary = { zone: Zone; days: number; reported: number; pass: number; fair: number; fail: number; score: number };
export function summarize(zones: Zone[], reports: Report[], dates: string[]): ZoneSummary[] {
  const school = dates.filter(isSchoolDay);
  const set = new Set(school);
  return zones.map((zone) => {
    const rs = reports.filter((r) => r.zone_id === zone.id && set.has(r.report_date));
    const n = (x: Result) => rs.filter((r) => r.result === x).length;
    const pts = rs.reduce((a, r) => a + (r.result ? SCORE[r.result] : 0), 0);
    return {
      zone, days: school.length, reported: rs.filter((r) => r.reported_by).length,
      pass: n("pass"), fair: n("fair"), fail: n("fail"),
      score: school.length ? Math.round((pts / (school.length * 2)) * 100) : 0,
    };
  }).sort((a, b) => b.score - a.score || b.reported - a.reported || a.zone.sort - b.zone.sort);
}

/** พื้นที่เขต (ตร.ม.) จากพิกัดพิกเซล */
export function areaM2(poly: Pt[], pxPerM: number): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.round(Math.abs(a) / 2 / (pxPerM * pxPerM));
}
