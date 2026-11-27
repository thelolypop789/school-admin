import type { Profile } from "./supabase";
import { hasRole } from "./roles";

/** ห้องพักงานแข่งขัน (เช่น ปาริชาติ): โรงเรียนขอเป็นจำนวนคน → ฝ่ายจัดห้องจัดลงห้อง → อนุมัติ */
export type LodgingEvent = { id: number; slug: string; name: string; starts_on: string; ends_on: string; closes_at: string; note: string; active: boolean };
/** ห้อง + ที่นั่งที่ใช้แล้วในงานนี้ (จาก lodging_occupancy / lodging_public_event) */
/** locked = มีโรงเรียนเหมาห้อง (นักเรียนเกิน EXCLUSIVE_OVER คน) ที่เหลือ lock_extra ที่นับเป็นของโรงเรียนนั้น */
export type RoomUse = { id: number; building: string; floor: number; name: string; capacity: number; approved: number; pending: number; locked?: boolean; lock_extra?: number; people?: Partial<Record<Kind, number>> };
/** นักเรียนของโรงเรียนเดียวในห้องเกินเท่านี้ = เหมาห้อง โรงเรียนอื่นเข้าไม่ได้ (ตรงกับ lodging_allocate ใน DB) */
export const EXCLUSIVE_OVER = 10;
const isStudent = (k: Kind) => k !== "teacher";
/** นักเรียน (ไม่นับครู) ในห้องจากรายการจัดห้อง */
export const studentsIn = (list: Pick<Allocation, "room_id" | "people" | "kind">[], roomId: number) =>
  list.filter((a) => a.room_id === roomId && isStudent(a.kind)).reduce((n, a) => n + a.people, 0);
/** ที่ว่างให้คำขอหนึ่ง: ว่างจริง + ที่ของคำขอนี้เดิม (+ ที่ที่เหลือถ้าคำขอนี้เหมาห้องไว้เอง) */
export function leftForRequest(r: RoomUse, mine: Allocation[]): number {
  const own = mine.filter((a) => a.room_id === r.id).reduce((n, a) => n + a.people, 0);
  return free(r) + own + (r.locked && studentsIn(mine, r.id) > EXCLUSIVE_OVER ? r.lock_extra ?? 0 : 0);
}
export type RoomRow = { id: number; building: string; floor: number; name: string; capacity: number; sort: number; active: boolean };
export type ReqStatus = "pending" | "approved" | "rejected" | "cancelled";
export type LodgingRequest = {
  id: number; event_id: number; ref_code: string; school_name: string; contact_name: string; phone: string;
  male_students: number; female_students: number; teachers: number; note: string | null; status: ReqStatus;
  source: "public" | "staff"; venue_id?: number | null; created_at: string; decided_at: string | null; decision_note: string | null;
};
export type Kind = "male" | "female" | "teacher" | "mixed";
export type Allocation = { id?: number; request_id: number; room_id: number; people: number; kind: Kind };

export const REQ_STATUS: Record<ReqStatus, { label: string; tone: string }> = {
  pending: { label: "รอจัดห้อง", tone: "warn" },
  approved: { label: "อนุมัติแล้ว", tone: "ok" },
  rejected: { label: "ไม่อนุมัติ", tone: "bad" },
  cancelled: { label: "ยกเลิก", tone: "" },
};
export const KIND: Record<Kind, string> = { male: "นักเรียนชาย", female: "นักเรียนหญิง", teacher: "ครู", mixed: "รวม" };

type P = Pick<Profile, "role" | "extra_roles">;
/** ฝ่ายจัดห้อง: จัดห้อง อนุมัติ บันทึกแทนโรงเรียน ตั้งค่างาน/ห้อง (ตรงกับ lodging_is_team ใน DB) */
export const isLodgingTeam = (p: P) => hasRole(p, "facilities_head", "admin");
/** เห็นชื่อโรงเรียน/เบอร์โทร (ตรงกับ lodging_is_viewer) — คนอื่นเห็นแค่ห้องว่าง/เต็ม */
export const isLodgingViewer = (p: P) => isLodgingTeam(p) || hasRole(p, "inspector", "ga_head", "deputy", "director");

export const total = (r: Pick<LodgingRequest, "male_students" | "female_students" | "teachers">) =>
  r.male_students + r.female_students + r.teachers;
export const used = (r: RoomUse) => r.approved + r.pending;
export const free = (r: RoomUse) => Math.max(0, r.capacity - used(r));

/** จัดกลุ่มห้องตามอาคาร → ชั้น (เรียงตามที่ DB ส่งมา) */
export function byBuilding(rooms: RoomUse[]): { building: string; floors: { floor: number; rooms: RoomUse[] }[] }[] {
  const out: { building: string; floors: { floor: number; rooms: RoomUse[] }[] }[] = [];
  for (const r of rooms) {
    let b = out.find((x) => x.building === r.building);
    if (!b) out.push(b = { building: r.building, floors: [] });
    let f = b.floors.find((x) => x.floor === r.floor);
    if (!f) b.floors.push(f = { floor: r.floor, rooms: [] });
    f.rooms.push(r);
  }
  return out;
}

/**
 * จัดห้องอัตโนมัติให้คำขอหนึ่ง: แยกนักเรียนหญิง ชาย ครู คนละห้อง
 * เลือกห้องที่มีแต่คนประเภทเดียวกันอยู่ก่อน แล้วค่อยห้องว่าง · อาคารเดียวกันก่อน · ห้องที่จุพอดีก่อน
 * rooms = ที่นั่งรวมของทุกคำขอ (รวมของคำขอนี้) · others = การจัดห้องของคำขออื่นที่ยังมีผล (ไว้ดูว่าห้องมีคนประเภทไหน)
 * mine = การจัดห้องเดิมของคำขอนี้ (คืนที่นั่งก่อนจัดใหม่)
 */
export function autoAllocate(
  req: Pick<LodgingRequest, "id" | "male_students" | "female_students" | "teachers">,
  rooms: RoomUse[], others: Allocation[], mine: Allocation[],
): Allocation[] {
  const left = new Map(rooms.map((r) => [r.id, leftForRequest(r, mine)]));
  const shared = new Set(others.map((a) => a.room_id)); // ห้องที่มีโรงเรียนอื่นอยู่ — ใส่นักเรียนได้ไม่เกิน EXCLUSIVE_OVER
  const kindsIn = new Map<number, Set<Kind>>();
  for (const a of others) { if (!kindsIn.has(a.room_id)) kindsIn.set(a.room_id, new Set()); kindsIn.get(a.room_id)!.add(a.kind); }
  const out: Allocation[] = [];
  const buildings = new Set<string>();
  const want: [Kind, number][] = [["female", req.female_students], ["male", req.male_students], ["teacher", req.teachers]];
  for (const [kind, n0] of want) {
    let n = n0;
    while (n > 0) {
      // ห้องที่ใส่ได้จริงสำหรับคำขอนี้ (ห้องที่มีโรงเรียนอื่น: นักเรียนรวมของเราไม่เกิน EXCLUSIVE_OVER)
      const cap = (r: RoomUse) => {
        const l = left.get(r.id) ?? 0;
        return isStudent(kind) && shared.has(r.id) ? Math.min(l, EXCLUSIVE_OVER - studentsIn(out, r.id)) : l;
      };
      const cands = rooms.filter((r) => cap(r) > 0 && !out.some((a) => a.room_id === r.id && a.kind !== kind)).map((r) => {
        const ks = kindsIn.get(r.id);
        let compat = !ks || ks.size === 0 ? 1 : ks.size === 1 && ks.has(kind) ? 0 : 2; // 0 = คนประเภทเดียวกัน, 1 = ว่าง, 2 = มีคนอื่นปน
        // นักเรียนกลุ่มใหญ่ (เกิน 10) เหมาห้องว่างก่อน ไม่ไปแทรกห้องที่มีโรงเรียนอื่น
        if (isStudent(kind) && n > EXCLUSIVE_OVER && compat < 2) compat = 1 - compat;
        const c = cap(r);
        const fits = c >= n ? 0 : 1;
        return { r, compat, sameB: buildings.size === 0 || buildings.has(r.building) ? 0 : 1, fits, left: c };
      }).filter((c) => c.compat < 2)
        .sort((a, b) => a.sameB - b.sameB || a.compat - b.compat || a.fits - b.fits || (a.fits ? b.left - a.left : a.left - b.left));
      const c = cands[0];
      if (!c) break; // ห้องไม่พอ — เหลือให้จัดเอง
      const take = Math.min(n, c.left);
      out.push({ request_id: req.id, room_id: c.r.id, people: take, kind });
      left.set(c.r.id, (left.get(c.r.id) ?? 0) - take);
      buildings.add(c.r.building);
      n -= take;
    }
  }
  return out;
}

// ================================================================ ที่พักเครือข่ายรอบโรงเรียน
export type VenueCategory = "school" | "temple" | "government" | "hotel";
export type VenueStatus = "confirmed" | "unconfirmed" | "declined";
export type GeoPrecision = "exact" | "name" | "village" | "tambon" | "manual" | "none";
export type Venue = {
  id: number; category: VenueCategory; name: string; contact: string | null; subdistrict: string | null; district: string | null;
  province: string | null; distance_km: number | null; capacity: number | null; status: VenueStatus; phone1: string | null;
  phone2: string | null; detail: string | null; lat: number | null; lng: number | null; geo_precision: GeoPrecision;
  is_home: boolean; used: number;
};
export const VENUE_CAT: Record<VenueCategory, string> = { school: "โรงเรียน", temple: "วัด", government: "หน่วยงานราชการ", hotel: "โรงแรม/รีสอร์ท" };
export const VENUE_STATUS: Record<VenueStatus, { label: string; tone: string }> = {
  confirmed: { label: "รับแล้ว", tone: "ok" }, unconfirmed: { label: "ยังไม่ยืนยัน", tone: "" }, declined: { label: "ไม่รับ", tone: "bad" },
};
/** ตำแหน่งบนแผนที่แม่นแค่ไหน — ที่ไม่แม่นบอกผู้ใช้ตรงๆ */
export const GEO_NOTE: Record<GeoPrecision, string> = {
  exact: "", name: "", manual: "", village: "ตำแหน่งโดยประมาณ (กลางหมู่บ้าน)", tambon: "ตำแหน่งโดยประมาณ (กลางตำบล)", none: "ยังไม่มีพิกัด",
};
export const venueLeft = (v: Venue) => (v.capacity == null ? null : Math.max(0, v.capacity - v.used));
/** ลิงก์นำทาง Google Maps (พิกัดถ้ามี ไม่งั้นค้นด้วยชื่อ + อำเภอ) */
export function mapsUrl(v: Pick<Venue, "name" | "lat" | "lng" | "district" | "province" | "geo_precision">): string {
  const exact = v.lat != null && v.lng != null && !["tambon", "village", "none"].includes(v.geo_precision);
  const q = exact ? `${v.lat},${v.lng}` : [v.name, v.district && `อ.${v.district}`, v.province].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
const tel = (p: string) => p.replace(/[^\d+]/g, "");
export const telHref = (p: string) => `tel:${tel(p)}`;
