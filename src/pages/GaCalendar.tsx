import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CarFront, ChevronLeft, ChevronRight, FileClock, Plus, Presentation, Wrench, type LucideIcon } from "lucide-react";
import { errText, supabase } from "../lib/supabase";
import { useMe } from "../lib/me";
import { navigate } from "../lib/router";
import { addDays, fmtDate, todayISO } from "../lib/time";
import { canEditGaEvents, GA_CATEGORIES, hm, isGaTeam, type GaEvent } from "../lib/ga";
import { byTime, loadGaItems, type Item, type Kind } from "../lib/gaItems";
import { Empty, Field, Modal } from "../components/ui";

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

const MAX_LANES = 3;
/**
 * จัดแถบงานของหนึ่งสัปดาห์: งานหลายวันเป็นแถบยาวข้ามช่องวัน, งานที่เวลาทับกัน (แม้คนละประเภท) ซ้อนเป็นหลายชั้น
 * เกิน MAX_LANES ชั้นไม่วาด แต่นับไว้ให้ขึ้น "+n รายการ" ในวันนั้น
 */
function layoutWeek(week: string[], list: Item[]) {
  const ws = week[0], we = week[week.length - 1];
  const inWeek = list.filter((i) => i.start <= we && i.end >= ws)
    .sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || byTime(a, b));
  const laneEnd: number[] = [];
  const bars: { item: Item; lane: number; c0: number; c1: number; l: boolean; r: boolean }[] = [];
  const hidden: number[] = week.map(() => 0);
  for (const item of inWeek) {
    const c0 = item.start < ws ? 0 : week.indexOf(item.start);
    const c1 = item.end > we ? week.length - 1 : week.indexOf(item.end);
    let lane = laneEnd.findIndex((e) => e < c0);
    if (lane === -1) lane = laneEnd.length;
    laneEnd[lane] = c1;
    if (lane >= MAX_LANES) { for (let c = c0; c <= c1; c++) hidden[c]++; continue; }
    bars.push({ item, lane, c0, c1, l: item.start < ws, r: item.end > we });
  }
  return { bars, hidden, lanes: Math.max(2, Math.min(MAX_LANES, laneEnd.length)) };
}

/** ปฏิทินงานฝ่ายบริหารทั่วไป: ดึงงานซ่อม/รถ/ห้องประชุม/วันหมดอายุเอกสาร อัตโนมัติ + กิจกรรมที่หัวหน้างานเพิ่มเอง */
export default function GaCalendar() {
  const me = useMe();
  const canEdit = canEditGaEvents(me);
  const team = isGaTeam(me);
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
  const weeks = useMemo(() => {
    const out: string[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [days]);
  const first = days[0], last = days[days.length - 1];

  const load = useCallback(async () => {
    const r = await loadGaItems(first, last, { docs: team, rooms: true, tentative: true });
    setErr(r.error);
    setItems(r.items);
    setLoading(false);
  }, [first, last, team]);
  // load() ตั้ง state หลัง await (ไม่ใช่ sync) — rule มองไม่เห็นข้าม async function
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const visible = items.filter((i) => on[i.kind]);
  const on_ = (d: string) => visible.filter((i) => i.start <= d && i.end >= d).sort(byTime);
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
          {KINDS.filter((k) => team || k.key !== "doc").map((k) => (
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
        <div className="cal-ga" role="grid">
          <div className="cal-inner">
            <div className="cal-dows">{WEEK.map((w) => <div key={w} className="cal-dow" role="columnheader">{w}</div>)}</div>
            {weeks.map((week) => {
              const { bars, hidden, lanes } = layoutWeek(week, visible);
              return (
                <div key={week[0]} className="cal-week" style={{ "--lanes": lanes } as React.CSSProperties}>
                  {week.map((d, c) => {
                    const list = on_(d);
                    const cls = ["cal-day", d.slice(0, 7) !== month && "out", d === today && "today", d === selected && "sel"].filter(Boolean).join(" ");
                    return (
                      <button key={d} className={cls} style={{ gridColumn: c + 1 }} onClick={() => setSelected(d)} role="gridcell"
                        aria-label={`${fmtDate(d, { day: "numeric", month: "long" })} ${list.length ? `${list.length} รายการ` : "ว่าง"}`}>
                        <span className="cal-num">{Number(d.slice(8))}</span>
                        <span className="cal-dots" aria-hidden>
                          {list.slice(0, 3).map((i) => <span key={i.key} className={`ev ${i.tone}`} />)}
                          {list.length > 3 && <span className="cal-more">+{list.length - 3}</span>}
                        </span>
                        {hidden[c] > 0 && <span className="cal-more cal-more-d" aria-hidden>+{hidden[c]} รายการ</span>}
                      </button>
                    );
                  })}
                  {bars.map((b) => (
                    <span key={b.item.key} aria-hidden className={`cal-bar ev ${b.item.tone}${b.l ? " cont-l" : ""}${b.r ? " cont-r" : ""}`}
                      style={{ gridColumn: `${b.c0 + 1} / span ${b.c1 - b.c0 + 1}`, gridRow: b.lane + 2 }}>
                      {b.item.time ? `${b.item.time.slice(0, 5)} ` : ""}{b.item.title}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
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
