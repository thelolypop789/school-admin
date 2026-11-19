import { supabase, errText } from "./supabase";
import { addDays, dateOf, fmtTime } from "./time";
import { GA_CATEGORY_LABEL, hm, type GaEvent } from "./ga";
import { CATEGORY_LABEL, STATUS as REPAIR_STATUS, type RepairStatus } from "./repair";
import { expiryTone, licenseDaysLeft, VEHICLE_DOCS } from "./vehicle";

/** รายการในปฏิทินงานฝ่ายบริหารทั่วไป (ใช้ทั้งหน้าปฏิทินและแผงหน้าแรก) */
export type Kind = "repair" | "trip" | "room" | "doc" | "event";
export type Tone = "ok" | "wait" | "done" | "bad";
export type Item = {
  key: string; kind: Kind; title: string; sub?: string; start: string; end: string; time?: string;
  tone: Tone; path?: string; event?: GaEvent;
};

type RepairRow = { id: number; title: string; location: string; category: string; status: RepairStatus; plan_start: string; plan_end: string };
type TripRow = { id: number; destination: string; starts_at: string; ends_at: string; status: string; vehicle: { name: string } | null };
type RoomRow = { id: number; title: string; starts_at: string; ends_at: string; rooms: { name: string } | null };
type VehicleRow = { name: string; plate: string | null; act_expiry: string | null; tax_expiry: string | null; insurance_expiry: string | null };
type DriverRow = { full_name: string; license_expiry: string | null };

/**
 * ดึงงานของช่วงวัน first–last (YYYY-MM-DD)
 * - งานซ่อมที่เสนอ/กำหนดวันแล้ว · รถไปราชการ (อนุมัติแล้ว) · ห้องประชุม · กิจกรรมที่หัวหน้างานเพิ่มเอง: ทุกคนเห็น
 * - วันหมดอายุ พ.ร.บ./ภาษี/ประกันรถ และใบขับขี่: ข้อมูลภายใน เห็นเฉพาะทีมฝ่าย (docs = true)
 * - rooms = false สำหรับแผงหน้าแรก (หน้าแรกมีกล่อง "ห้องประชุมวันนี้" อยู่แล้ว)
 * - repairs: "scheduled" เห็นทุกคน; "proposed" (ยังรอผู้บริหาร) แสดงเฉพาะเมื่อ tentative = true
 */
export async function loadGaItems(first: string, last: string, opt: { docs: boolean; rooms: boolean; tentative: boolean }): Promise<{ items: Item[]; error: string }> {
  const from = `${first}T00:00:00+07:00`, to = `${addDays(last, 1)}T00:00:00+07:00`;
  const none = Promise.resolve({ data: [], error: null });
  const [rp, tr, rm, ve, dr, ev] = await Promise.all([
    supabase.from("repair_requests").select("id,title,location,category,status,plan_start,plan_end")
      .in("status", opt.tentative ? ["proposed", "scheduled", "done"] : ["scheduled"]).lte("plan_start", last).gte("plan_end", first),
    supabase.from("vehicle_bookings").select("id,destination,starts_at,ends_at,status,vehicle:vehicles(name)")
      .in("status", ["approved", "on_trip", "completed"]).lt("starts_at", to).gt("ends_at", from),
    opt.rooms ? supabase.from("room_bookings").select("id,title,starts_at,ends_at,rooms(name)").eq("status", "confirmed").lt("starts_at", to).gt("ends_at", from) : none,
    opt.docs ? supabase.from("vehicles").select("name,plate,act_expiry,tax_expiry,insurance_expiry").eq("active", true) : none,
    opt.docs ? supabase.from("drivers").select("full_name,license_expiry").eq("active", true) : none,
    supabase.from("ga_events").select("id,title,category,start_date,end_date,start_time,end_time,owner,note").lte("start_date", last).gte("end_date", first),
  ]);
  const e = rp.error || tr.error || rm.error || ve.error || dr.error || ev.error;

  const out: Item[] = [];
  for (const r of (rp.data ?? []) as unknown as RepairRow[]) {
    const st = REPAIR_STATUS[r.status];
    out.push({
      key: `repair${r.id}`, kind: "repair", title: `ซ่อม: ${r.title}`, sub: `${r.location} · ${CATEGORY_LABEL[r.category] ?? r.category} · ${st.label}`,
      start: r.plan_start, end: r.plan_end, tone: r.status === "scheduled" ? "ok" : r.status === "done" ? "done" : "wait", path: "/facilities",
    });
  }
  for (const t of (tr.data ?? []) as unknown as TripRow[]) {
    const s = dateOf(t.starts_at), en = dateOf(t.ends_at);
    out.push({
      key: `trip${t.id}`, kind: "trip", title: t.destination, sub: t.vehicle?.name ?? "ยังไม่ได้จัดรถ", start: s, end: en,
      time: s === en ? `${fmtTime(t.starts_at)}–${fmtTime(t.ends_at)}` : undefined,
      tone: t.status === "completed" ? "done" : "ok", path: "/vehicles",
    });
  }
  for (const r of (rm.data ?? []) as unknown as RoomRow[]) {
    const s = dateOf(r.starts_at), en = dateOf(r.ends_at);
    out.push({
      key: `room${r.id}`, kind: "room", title: r.title, sub: r.rooms?.name, start: s, end: en,
      time: s === en ? `${fmtTime(r.starts_at)}–${fmtTime(r.ends_at)}` : undefined, tone: "ok", path: "/rooms",
    });
  }
  const doc = (key: string, title: string, sub: string, date: string | null) => {
    if (!date || date < first || date > last) return;
    const tone = expiryTone(licenseDaysLeft(date));
    out.push({ key, kind: "doc", title, sub, start: date, end: date, tone: tone === "bad" ? "bad" : tone === "warn" ? "wait" : "done", path: "/vehicles" });
  };
  for (const v of (ve.data ?? []) as VehicleRow[]) {
    for (const d of VEHICLE_DOCS) doc(`doc-${v.name}-${d.key}`, `${d.label}${v.name}หมดอายุ`, v.plate ?? "", v[d.key]);
  }
  for (const d of (dr.data ?? []) as DriverRow[]) doc(`lic-${d.full_name}`, `ใบขับขี่ ${d.full_name} หมดอายุ`, "คนขับ", d.license_expiry);
  for (const g of (ev.data ?? []) as GaEvent[]) {
    out.push({
      key: `event${g.id}`, kind: "event", title: g.title, sub: [GA_CATEGORY_LABEL[g.category], g.owner && `ผู้รับผิดชอบ ${g.owner}`].filter(Boolean).join(" · "),
      start: g.start_date, end: g.end_date, time: g.start_time ? `${hm(g.start_time)}${g.end_time ? `–${hm(g.end_time)}` : ""}` : undefined,
      tone: "ok", event: g,
    });
  }
  return { items: out, error: e ? errText(e) : "" };
}

/** เรียงในวันเดียว: มีเวลาก่อน (ตามเวลา) แล้วงานทั้งวัน */
export const byTime = (a: Item, b: Item) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.kind.localeCompare(b.kind);
