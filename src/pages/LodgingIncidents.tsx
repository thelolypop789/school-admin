import { lazy, Suspense, useMemo, useState } from "react";
import { Check, Map as MapIcon, Phone, Siren } from "lucide-react";
import { errText, supabase } from "../lib/supabase";
import { useSignedUrls } from "../lib/photos";
import { fmtDateTime } from "../lib/time";
import { INCIDENT, INCIDENT_STATUS, type Incident, type IncidentStatus } from "../lib/incident";
import { Empty } from "../components/ui";
import type { Pt, ZoneShape } from "../campus/campus3d";

const CampusMap = lazy(() => import("../components/CampusMap"));
const R = 8;
const square = (x: number, y: number): Pt[] => [[x - R, y - R], [x + R, y - R], [x + R, y + R], [x - R, y + R]];
const ERR: Record<string, string> = { not_pending: "เรื่องนี้มีคนรับหรือปิดไปแล้ว รีเฟรชดูสถานะล่าสุด", forbidden: "คุณดูได้อย่างเดียว เปลี่ยนสถานะไม่ได้" };
const ierr = (e: unknown) => { const m = errText(e); return Object.entries(ERR).find(([k]) => m.includes(k))?.[1] ?? m; };
const ago = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return min < 1 ? "เมื่อสักครู่" : min < 60 ? `${min} นาทีที่แล้ว` : fmtDateTime(iso);
};

/** แท็บ "แจ้งเหตุ" ใน /lodging — เรื่องจากหน้าสาธารณะ /stay/report · ทีมรับเรื่องกด รับเรื่อง → แก้ไขแล้ว (ผู้แจ้งเห็นในลิงก์ติดตามผล) */
export function LodgingIncidents({ items, handler, onChanged, say }: {
  items: Incident[]; handler: boolean; onChanged: () => void; say: (m: string) => void;
}) {
  const [filter, setFilter] = useState<"open" | IncidentStatus | "all">("open");
  const [map, setMap] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const open = items.filter((i) => i.status !== "resolved");
  const shown = filter === "open" ? open : items.filter((i) => filter === "all" || i.status === filter);
  const photos = useSignedUrls("incident-photos", shown.map((i) => i.photo_path));
  const pins: ZoneShape[] = useMemo(() => open.filter((i) => i.map_x != null && i.map_y != null).map((i) => ({
    id: i.id, poly: square(i.map_x!, i.map_y!), color: i.status === "new" ? "#d1293a" : "#d98a00", label: INCIDENT[i.category]?.label ?? "แจ้งเหตุ",
  })), [open]);
  const pickPin = (id: number | null) => {
    setSel(id);
    if (id) document.getElementById(`inc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  return (
    <>
      <div className="tabs scroll">
        <button className={filter === "open" ? "on" : ""} onClick={() => setFilter("open")}>ยังไม่เสร็จ{open.length > 0 && <span className="badge">{open.length}</span>}</button>
        <button className={filter === "new" ? "on" : ""} onClick={() => setFilter("new")}>รอรับเรื่อง {items.filter((i) => i.status === "new").length}</button>
        <button className={filter === "resolved" ? "on" : ""} onClick={() => setFilter("resolved")}>แก้ไขแล้ว {items.filter((i) => i.status === "resolved").length}</button>
        <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>ทั้งหมด {items.length}</button>
      </div>
      <p className="muted small inc-help">
        คนที่มาพัก/มาแข่งแจ้งได้ที่ <b>{window.location.origin}/stay/report</b> (มีปุ่มในหน้าขอที่พัก) · เรื่องใหม่เด้งเข้า LINE กด "รับเรื่องแล้ว" ในการ์ดได้เลย
      </p>
      {pins.length > 0 && (map ? (
        <div className="inc-overview">
          <Suspense fallback={<div className="campus3d loading"><div className="spinner" /></div>}>
            <CampusMap zones={pins} selected={sel} onPick={pickPin} />
          </Suspense>
          <button className="link" onClick={() => setMap(false)}>ซ่อนแผนที่</button>
        </div>
      ) : <button className="btn sm" onClick={() => setMap(true)}><MapIcon size={16} />ดูจุดเกิดเหตุบนแผนที่ ({pins.length})</button>)}
      {shown.length === 0 ? <Empty>{filter === "open" ? "ไม่มีเรื่องค้าง" : "ยังไม่มีการแจ้งเหตุ"}</Empty> : (
        <div className="inc-list">
          {shown.map((i) => <Item key={i.id} i={i} photo={i.photo_path ? photos[i.photo_path] : undefined} handler={handler} selected={sel === i.id} onChanged={onChanged} say={say} />)}
        </div>
      )}
    </>
  );
}

function Item({ i, photo, handler, selected, onChanged, say }: {
  i: Incident; photo?: string; handler: boolean; selected: boolean; onChanged: () => void; say: (m: string) => void;
}) {
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const C = INCIDENT[i.category] ?? INCIDENT.other;
  const st = INCIDENT_STATUS[i.status];
  const update = async (status: "acknowledged" | "resolved", n: string | null) => {
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("lodging_incident_update", { p_id: i.id, p_status: status, p_note: n });
    setBusy(false);
    if (error) { setErr(ierr(error)); return; }
    setClosing(false); setNote("");
    say(status === "acknowledged" ? "รับเรื่องแล้ว ผู้แจ้งเห็นสถานะแล้ว" : "ปิดเรื่องแล้ว");
    onChanged();
  };
  return (
    <article id={`inc-${i.id}`} className={`card inc-item s-${i.status}${selected ? " sel" : ""}`}>
      <header>
        <span className="inc-ic"><C.icon size={22} aria-hidden /></span>
        <span className="inc-head"><b>{C.label}</b><small>{ago(i.created_at)}</small></span>
        <span className={`chip ${st.tone}`}>{st.label}</span>
      </header>
      <p className="inc-where">{i.location}{i.map_x != null && <small> · ปักหมุดไว้</small>}</p>
      {i.detail && <p>{i.detail}</p>}
      {photo && <a href={photo} target="_blank" rel="noreferrer" className="inc-photo-staff"><img src={photo} alt={`รูปประกอบ ${C.label}`} /></a>}
      <p className="muted small">
        ผู้แจ้ง {i.reporter_name}{i.school_name ? ` · ${i.school_name}` : ""} · <a href={`tel:${i.phone}`}><Phone size={12} /> {i.phone}</a>
        {i.acknowledged_at && <> · รับเรื่อง {fmtDateTime(i.acknowledged_at)}</>}{i.resolved_at && <> · แก้เสร็จ {fmtDateTime(i.resolved_at)}</>}
      </p>
      {i.staff_note && <p className="inc-note"><b>หมายเหตุถึงผู้แจ้ง:</b> {i.staff_note}</p>}
      {handler && i.status !== "resolved" && (closing ? (
        <div className="decide">
          <label className="field"><span>บอกผู้แจ้ง (ไม่บังคับ)</span>
            <textarea rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="เช่น เปลี่ยนวาล์วแล้ว น้ำไหลปกติ / แจ้งเจ้าของรถย้ายแล้ว" />
          </label>
          <div className="row wrap">
            <button className="btn primary" disabled={busy} onClick={() => update("resolved", note.trim() || null)}><Check size={16} />ยืนยัน แก้ไขแล้ว</button>
            <button className="btn" onClick={() => setClosing(false)}>ยกเลิก</button>
          </div>
        </div>
      ) : (
        <div className="row wrap">
          {i.status === "new" && <button className="btn primary" disabled={busy} onClick={() => update("acknowledged", null)}><Siren size={16} />รับเรื่อง</button>}
          <button className="btn" disabled={busy} onClick={() => setClosing(true)}><Check size={16} />แก้ไขแล้ว</button>
          <a className="btn" href={`tel:${i.phone}`}><Phone size={16} />โทรหาผู้แจ้ง</a>
        </div>
      ))}
      {err && <p className="error">{err}</p>}
    </article>
  );
}
