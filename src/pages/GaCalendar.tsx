import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CarFront, ChevronLeft, ChevronRight, FileClock, Plus, Presentation, Wrench, type LucideIcon } from "lucide-react";
import { errText, supabase } from "../lib/supabase";
import { useMe } from "../lib/me";
import { navigate } from "../lib/router";
import { addDays, dateOf, fmtDate, fmtTime, todayISO } from "../lib/time";
import { canEditGaEvents, GA_CATEGORIES, GA_CATEGORY_LABEL, hm, type GaEvent } from "../lib/ga";
import { CATEGORY_LABEL, STATUS as REPAIR_STATUS, type RepairStatus } from "../lib/repair";
import { expiryTone, licenseDaysLeft, VEHICLE_DOCS } from "../lib/vehicle";
import { Empty, Field, Modal } from "../components/ui";

type Kind = "repair" | "trip" | "room" | "doc" | "event";
type Tone = "ok" | "wait" | "done" | "bad";
type Item = {
  key: string; kind: Kind; title: string; sub?: string; start: string; end: string; time?: string;
  tone: Tone; path?: string; event?: GaEvent;
};

const KINDS: { key: Kind; label: string; icon: LucideIcon }[] = [
  { key: "repair", label: "งานซ่อม", icon: Wrench },
  { key: "trip", label: "รถไปราชการ", icon: CarFront },
  { key: "room", label: "ห้องประชุม", icon: Presentation },
  { key: "doc", label: "เอกสารหมดอายุ", icon: FileClock },
  { key: "event", label: "กิจกรรมฝ่าย", icon: CalendarDays },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.key, k])) as Record<Kind, (typeof KINDS)[number]>;
const WEEK = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const dow = (d: string) => new Date(`${d}T12:00:00+07:00`).getUTCDay();

type RepairRow = { id: number; title: string; location: string; category: string; status: RepairStatus; plan_start: string; plan_end: string };
type TripRow = { id: number; destination: string; starts_at: string; ends_at: string; status: string; vehicle: { name: string } | null };
type RoomRow = { id: number; title: string; starts_at: string; ends_at: string; rooms: { name: string } | null };
type VehicleRow = { name: string; plate: string | null; act_expiry: string | null; tax_expiry: string | null; insurance_expiry: string | null };
type DriverRow = { full_name: string; license_expiry: string | null };

/** ปฏิทินงานฝ่ายบริหารทั่วไป: ดึงงานซ่อม/รถ/ห้องประชุม/วันหมดอายุเอกสาร อัตโนมัติ + กิจกรรมที่หัวหน้างานเพิ่มเอง */
export default function GaCalendar() {
  const me = useMe();
  const canEdit = canEditGaEvents(me);
  const today = todayISO();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [items, setItems] = useState<Item[]>([]);
  const [on, setOn] = useState<Record<Kind, boolean>>({ repair: true, trip: true, room: true, doc: true, event: true });
  const [form, setForm] = useState<{ event: GaEvent | null; date: string } | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const days = useMemo(() => {
    const first = `${month}-01`;
    const start = addDays(first, -dow(first));
    const last = addDays(addDays(`${month}-28`, 4).slice(0, 7) + "-01", -1);
    const end = addDays(last, 6 - dow(last));
    const out: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);
  const first = days[0], last = days[days.length - 1];

  const load = useCallback(async () => {
    const from = `${first}T00:00:00+07:00`, to = `${addDays(last, 1)}T00:00:00+07:00`;
    const [rp, tr, rm, ve, dr, ev] = await Promise.all([
      supabase.from("repair_requests").select("id,title,location,category,status,plan_start,plan_end")
        .in("status", ["proposed", "scheduled", "done"]).lte("plan_start", last).gte("plan_end", first),
      supabase.from("vehicle_bookings").select("id,destination,starts_at,ends_at,status,vehicle:vehicles(name)")
        .in("status", ["approved", "on_trip", "completed"]).lt("starts_at", to).gt("ends_at", from),
      supabase.from("room_bookings").select("id,title,starts_at,ends_at,rooms(name)")
        .eq("status", "confirmed").lt("starts_at", to).gt("ends_at", from),
      supabase.from("vehicles").select("name,plate,act_expiry,tax_expiry,insurance_expiry").eq("active", true),
      supabase.from("drivers").select("full_name,license_expiry").eq("active", true),
      supabase.from("ga_events").select("id,title,category,start_date,end_date,start_time,end_time,owner,note").lte("start_date", last).gte("end_date", first),
    ]);
    const e = rp.error || tr.error || rm.error || ve.error || dr.error || ev.error;
    setErr(e ? errText(e) : "");

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
    setItems(out);
    setLoading(false);
  }, [first, last]);
  // load() ตั้ง state หลัง await (ไม่ใช่ sync) — rule มองไม่เห็นข้าม async function
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const visible = items.filter((i) => on[i.kind]);
  const on_ = (d: string) => visible.filter((i) => i.start <= d && i.end >= d)
    .sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.kind.localeCompare(b.kind));
  const shift = (n: number) => setMonth(addDays(`${month}-15`, n * 30).slice(0, 7));
  const dayItems = on_(selected);
  const open = (i: Item) => {
    if (i.event && canEdit) setForm({ event: i.event, date: i.event.start_date });
    else if (i.path) navigate(i.path);
  };

  return (
    <>
      <div className="row between wrap" style={{ marginBottom: "1rem" }}>
        <div className="row wrap" role="group" aria-label="เลือกประเภทงานที่แสดง">
          {KINDS.map((k) => (
            <button key={k.key} className={`chip filter ${on[k.key] ? "ok" : ""}`} aria-pressed={on[k.key]}
              onClick={() => setOn((o) => ({ ...o, [k.key]: !o[k.key] }))}>
              <k.icon size={13} />{k.label}
            </button>
          ))}
        </div>
        {canEdit && <button className="btn primary" onClick={() => setForm({ event: null, date: selected })}><Plus size={18} />เพิ่มกิจกรรม</button>}
      </div>
      {err && <p className="error">{err}</p>}

      <section className="card cal">
        <div className="cal-head">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="เดือนก่อน"><ChevronLeft size={18} /></button>
          <h3>{fmtDate(`${month}-01`, { month: "long", year: "numeric" })}</h3>
          <button className="icon-btn" onClick={() => shift(1)} aria-label="เดือนถัดไป"><ChevronRight size={18} /></button>
          {month !== today.slice(0, 7) && <button className="link" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>วันนี้</button>}
          <ul className="cal-legend" aria-label="คำอธิบายสี">
            <li><span className="ev ok" />กำหนดแล้ว</li>
            <li><span className="ev wait" />รอ/ใกล้หมดอายุ</li>
            <li><span className="ev bad" />หมดอายุแล้ว</li>
            <li><span className="ev done" />เสร็จ/ปกติ</li>
          </ul>
        </div>
        <div className="cal-grid" role="grid">
          {WEEK.map((w) => <div key={w} className="cal-dow" role="columnheader">{w}</div>)}
          {days.map((d) => {
            const list = on_(d);
            const cls = ["cal-day", d.slice(0, 7) !== month && "out", d === today && "today", d === selected && "sel"].filter(Boolean).join(" ");
            return (
              <button key={d} className={cls} onClick={() => setSelected(d)} role="gridcell"
                aria-label={`${fmtDate(d, { day: "numeric", month: "long" })} ${list.length ? `${list.length} รายการ` : "ว่าง"}`}>
                <span className="cal-num">{Number(d.slice(8))}</span>
                <span className="cal-evs">
                  {list.slice(0, 2).map((i) => <span key={i.key} className={`ev ${i.tone}`}>{i.time ? `${i.time.slice(0, 5)} ` : ""}{i.title}</span>)}
                  {list.length > 2 && <span className="cal-more">+{list.length - 2}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="row between wrap">
          <h3 style={{ margin: 0 }}>{fmtDate(selected, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h3>
          {canEdit && <button className="link" onClick={() => setForm({ event: null, date: selected })}>+ เพิ่มกิจกรรมวันนี้</button>}
        </div>
        {loading ? <div className="spinner" /> : dayItems.length === 0 ? <Empty>วันนี้ไม่มีงานในปฏิทินฝ่าย</Empty> : (
          <ul className="list">
            {dayItems.map((i) => {
              const K = KIND[i.kind];
              const clickable = (i.event && canEdit) || i.path;
              return (
                <li key={i.key} className={clickable ? "clickable" : ""} onClick={clickable ? () => open(i) : undefined}>
                  <span className="ga-item">
                    <span className="ag-kind tone-brand"><K.icon size={12} />{K.label}</span>
                    <b>{i.time ? `${i.time} ` : ""}{i.title}</b>
                    {i.sub && <span className="small muted">{i.sub}{i.start !== i.end ? ` · ${fmtDate(i.start, { day: "numeric", month: "short" })} – ${fmtDate(i.end, { day: "numeric", month: "short" })}` : ""}</span>}
                    {i.event?.note && <span className="small muted">{i.event.note}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {form && <EventForm event={form.event} date={form.date} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </>
  );
}

function EventForm({ event, date, onClose, onSaved }: { event: GaEvent | null; date: string; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [category, setCategory] = useState(event?.category ?? "meeting");
  const [start, setStart] = useState(event?.start_date ?? date);
  const [end, setEnd] = useState(event?.end_date ?? "");
  const [st, setSt] = useState(hm(event?.start_time ?? null));
  const [et, setEt] = useState(hm(event?.end_time ?? null));
  const [owner, setOwner] = useState(event?.owner ?? "");
  const [note, setNote] = useState(event?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (end && end < start) return setErr("วันสิ้นสุดต้องไม่ก่อนวันเริ่ม");
    if (et && !st) return setErr("ใส่เวลาเริ่มด้วยถ้าระบุเวลาสิ้นสุด");
    if (st && et && (!end || end === start) && et <= st) return setErr("เวลาสิ้นสุดต้องหลังเวลาเริ่ม");
    setSaving(true); setErr("");
    const { error } = await supabase.rpc("ga_event_save", {
      p_id: event?.id ?? null, p_title: title, p_category: category, p_start_date: start, p_end_date: end || start,
      p_start_time: st || null, p_end_time: et || null, p_owner: owner, p_note: note,
    });
    setSaving(false);
    if (error) setErr(errText(error)); else onSaved();
  };
  const del = async () => {
    if (!event || !confirm(`ลบกิจกรรม "${event.title}" ?`)) return;
    setSaving(true);
    const { error } = await supabase.rpc("ga_event_delete", { p_id: event.id });
    setSaving(false);
    if (error) setErr(errText(error)); else onSaved();
  };

  return (
    <Modal title={event ? "แก้ไขกิจกรรม" : "เพิ่มกิจกรรมฝ่าย"} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <Field label="ชื่อกิจกรรม"><input required minLength={2} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ตรวจอาคารประจำเดือน, ซ้อมอพยพ" /></Field>
        <Field label="ประเภท">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {GA_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
        <div className="row2">
          <Field label="วันที่เริ่ม"><input type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="ถึงวันที่ (ถ้าหลายวัน)"><input type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <div className="row2">
          <Field label="เวลาเริ่ม (ไม่บังคับ)"><input type="time" value={st} onChange={(e) => setSt(e.target.value)} /></Field>
          <Field label="เวลาสิ้นสุด (ไม่บังคับ)"><input type="time" value={et} onChange={(e) => setEt(e.target.value)} /></Field>
        </div>
        <Field label="ผู้รับผิดชอบ (ไม่บังคับ)"><input maxLength={120} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="ชื่อคนหรืองานที่รับผิดชอบ" /></Field>
        <Field label="หมายเหตุ (ไม่บังคับ)"><textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {err && <p className="error">{err}</p>}
        <button className="btn primary big" disabled={saving}>{saving ? "กำลังบันทึก…" : "บันทึก"}</button>
        {event && <button type="button" className="link danger" disabled={saving} onClick={del}>ลบกิจกรรมนี้</button>}
      </form>
    </Modal>
  );
}
