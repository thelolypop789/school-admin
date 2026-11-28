// แจ้งเหตุระหว่างงานแข่งขัน — ใช้ทั้งหน้าสาธารณะ /stay/report และแท็บ "แจ้งเหตุ" ใน /lodging
import { Ambulance, CarFront, CircleHelp, Droplets, Ban, DoorOpen, Zap, type LucideIcon } from "lucide-react";
import { hasRole } from "./roles";
import type { Profile } from "./supabase";
import { isLodgingViewer } from "./lodging";

type WithRoles = Pick<Profile, "role" | "extra_roles">;

export type IncidentCategory = "water" | "power" | "room" | "crash" | "blocked" | "medical" | "other";
export type IncidentStatus = "new" | "acknowledged" | "resolved";

/** ประเภทเหตุ: label = ปุ่มเลือก, where/what = คำแนะนำในช่องกรอกตามประเภท */
export const INCIDENT: Record<IncidentCategory, { label: string; icon: LucideIcon; where: string; what: string }> = {
  water: { label: "น้ำไม่ไหล", icon: Droplets, where: "เช่น อาคาร 3 ห้องน้ำชาย ชั้น 2", what: "เช่น ไม่ไหลทั้งชั้น / ไหลซึม ท่อแตก" },
  power: { label: "ไฟดับ / ไฟฟ้า", icon: Zap, where: "เช่น อาคาร 4 ห้อง 437", what: "เช่น ไฟดับทั้งห้อง / ปลั๊กไม่มีไฟ / พัดลมไม่ทำงาน" },
  room: { label: "ห้องพัก / ห้องน้ำชำรุด", icon: DoorOpen, where: "เช่น อาคาร 3 ห้อง 333", what: "เช่น ประตูล็อกไม่ได้ / ส้วมตัน / หน้าต่างแตก" },
  crash: { label: "เฉี่ยวชน / อุบัติเหตุรถ", icon: CarFront, where: "เช่น ลานจอดรถหน้าโรงอาหาร", what: "เช่น รถเฉี่ยวกัน มีคนเจ็บไหม ทะเบียนรถ" },
  blocked: { label: "รถขวางทางเข้าออก", icon: Ban, where: "เช่น ประตูหน้าโรงเรียน", what: "ยี่ห้อ สี ทะเบียนรถที่ขวาง" },
  medical: { label: "เจ็บป่วย / ปฐมพยาบาล", icon: Ambulance, where: "เช่น สนามฟุตซอล", what: "อาการ / อายุ / รู้สึกตัวไหม" },
  other: { label: "เรื่องอื่นๆ", icon: CircleHelp, where: "จุดที่เกิดเหตุ", what: "เล่าสั้นๆ ว่าเกิดอะไรขึ้น" },
};
export const INCIDENT_ORDER: IncidentCategory[] = ["water", "power", "room", "crash", "blocked", "medical", "other"];

export const INCIDENT_STATUS: Record<IncidentStatus, { label: string; tone: string; public: string }> = {
  new: { label: "รอรับเรื่อง", tone: "bad", public: "ส่งแล้ว · รอเจ้าหน้าที่รับเรื่อง" },
  acknowledged: { label: "รับเรื่องแล้ว", tone: "warn", public: "เจ้าหน้าที่รับเรื่องแล้ว กำลังดำเนินการ" },
  resolved: { label: "แก้ไขแล้ว", tone: "ok", public: "แก้ไขเรียบร้อยแล้ว" },
};

export type Incident = {
  id: number; event_id: number; ref_code: string; category: IncidentCategory; location: string; map_x: number | null; map_y: number | null;
  detail: string | null; reporter_name: string; phone: string; school_name: string | null; request_id: number | null; photo_path: string | null;
  status: IncidentStatus; staff_note: string | null; handled_by: string | null; acknowledged_at: string | null; resolved_at: string | null; created_at: string;
};

/** ทีมรับเรื่อง (ตรงกับ lodging_incident_handler ใน DB) — ผู้ดูรายละเอียดห้องพักเห็นได้แต่แก้สถานะไม่ได้ */
export const isIncidentHandler = (p: WithRoles | null | undefined) => !!p && hasRole(p, "facilities_head", "admin", "inspector", "vehicle_head");
export const canSeeIncidents = (p: WithRoles | null | undefined) => !!p && (isIncidentHandler(p) || isLodgingViewer(p));

/** เบอร์ฉุกเฉินที่แสดงบนหน้าแจ้งเหตุ */
export const EMERGENCY = [
  { n: "1669", label: "เจ็บป่วยฉุกเฉิน" },
  { n: "191", label: "เหตุด่วนเหตุร้าย" },
  { n: "199", label: "ไฟไหม้" },
];
