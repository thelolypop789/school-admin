import { useCallback, useEffect, useState } from "react";
import { BedDouble, Check, Copy } from "lucide-react";
import { LOGO, SCHOOL_NAME } from "../lib/brand";
import { byBuilding, free, KIND, REQ_STATUS, type Kind, type ReqStatus, type RoomUse } from "../lib/lodging";
import { fmtDate, fmtDateTime } from "../lib/time";
import { Field } from "../components/ui";
import { LodgingMap, type LodgingBuilding } from "../components/LodgingMap";

const URL_ = import.meta.env.VITE_SUPABASE_URL || "https://placeholder.supabase.co";
const KEY = import.meta.env.VITE_SUPABASE_KEY || "placeholder";
const SAVED = "stay-refs";

type EventInfo = { id: number; slug: string; name: string; starts_on: string; ends_on: string; closes_at: string; note: string; open: boolean; rooms: RoomUse[]; buildings?: LodgingBuilding[] };
type Status = {
  ref: string; status: ReqStatus; school_name: string; contact_name: string; male_students: number; female_students: number; teachers: number;
  note: string | null; decision_note: string | null; created_at: string;
  event: { name: string; slug: string; starts_on: string; ends_on: string; note: string };
  rooms: { building: string; floor: number; name: string; people: number; kind: Kind }[];
};
const ERR: Record<string, string> = {
  not_found: "ไม่พบงานหรือคำขอนี้",
  closed: "ปิดรับคำขอที่พักแล้ว",
  rate_limited: "ส่งคำขอถี่เกินไป รอสักครู่แล้วลองใหม่",
  not_pending: "คำขอนี้ได้รับการพิจารณาแล้ว ยกเลิกเองไม่ได้ ติดต่อฝ่ายอาคารสถานที่",
  bad_request: "กรอกข้อมูลให้ครบ (เบอร์โทร 9–10 หลัก และจำนวนคนอย่างน้อย 1)",
  server_error: "ระบบขัดข้อง ลองใหม่อีกครั้ง",
};

async function call<T>(body: object): Promise<T> {
  const res = await fetch(`${URL_}/functions/v1/lodging-public`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(ERR[j.error] ?? ERR.server_error);
  return j as T;
}
function savedRefs(): { ref: string; school: string }[] {
  try { return JSON.parse(localStorage.getItem(SAVED) ?? "[]"); } catch { return []; }
}
function saveRef(ref: string, school: string) {
  try { localStorage.setItem(SAVED, JSON.stringify([{ ref, school }, ...savedRefs().filter((x) => x.ref !== ref)].slice(0, 10))); } catch { /* storage blocked */ }
}
const go = (path: string) => { window.history.pushState(null, "", path); window.dispatchEvent(new PopStateEvent("popstate")); };
const days = (e: { starts_on: string; ends_on: string }) =>
  `${fmtDate(e.starts_on, { day: "numeric", month: "short" })} – ${fmtDate(e.ends_on, { day: "numeric", month: "short", year: "numeric" })}`;

/** หน้าขอที่พักสาธารณะ /stay (โรงเรียนที่มาแข่ง ไม่ต้องมีบัญชี) และ /stay/<รหัสติดตาม> */
export default function StayApp() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  useEffect(() => { document.title = "ขอที่พัก · " + SCHOOL_NAME; }, []);
  const ref = path.match(/^\/stay\/([0-9A-Fa-f]{12})$/)?.[1];
  return (
    <div className="stay-app c-stay">
      <header className="stay-brand">
        <span className="seal"><img src={LOGO} alt={`ตรา${SCHOOL_NAME}`} /></span>
        <div><b>ขอที่พักสำหรับโรงเรียนที่มาแข่งขัน</b><small>{SCHOOL_NAME}</small></div>
      </header>
      {ref ? <StatusView refCode={ref.toUpperCase()} /> : <RequestView />}
    </div>
  );
}

function Availability({ rooms, buildings }: { rooms: RoomUse[]; buildings: LodgingBuilding[] }) {
  const [bld, setBld] = useState<string | null>(null);
  return (
    <section className="card stay-avail">
      <h2>ห้องว่างตอนนี้</h2>
      <LodgingMap rooms={rooms} buildings={buildings} selected={bld} onPick={setBld} />
      {byBuilding(rooms).filter((b) => !bld || b.building === bld).map((b) => {
        const left = b.floors.flatMap((f) => f.rooms).reduce((n, r) => n + free(r), 0);
        const cap = b.floors.flatMap((f) => f.rooms).reduce((n, r) => n + r.capacity, 0);
        return (
          <div key={b.building} className="stay-building">
            <p><b>{b.building}</b> <span className="muted">ว่าง {left} จาก {cap} ที่</span></p>
            {b.floors.map((f) => (
              <div key={f.floor} className="stay-floor">
                <small>ชั้น {f.floor}</small>
                <div className="stay-rooms">
                  {f.rooms.map((r) => (
                    <span key={r.id} className={`stay-room${free(r) === 0 ? " full" : ""}`} title={`ห้อง ${r.name} ว่าง ${free(r)} จาก ${r.capacity}`}>
                      {r.name}<i>{free(r) === 0 ? "เต็ม" : `ว่าง ${free(r)}`}</i>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}
      {bld && <button className="link" onClick={() => setBld(null)}>ดูทุกอาคาร</button>}
      <p className="muted small">ฝ่ายอาคารสถานที่เป็นผู้จัดห้องให้ตามจำนวนคน (แยกนักเรียนชาย หญิง และครู) ตัวเลขนี้รวมคำขอที่รอจัดห้องแล้ว</p>
    </section>
  );
}

function RequestView() {
  const [ev, setEv] = useState<EventInfo | null | undefined>(undefined);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ school: "", contact: "", phone: "", male: "", female: "", teachers: "", note: "", website: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const slug = new URLSearchParams(window.location.search).get("event") ?? "";
  useEffect(() => {
    call<EventInfo>({ action: "event", slug }).then(setEv).catch(() => setEv(null));
  }, [slug]);
  const n = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  const sum = n(f.male) + n(f.female) + n(f.teachers);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ev) return;
    setErr("");
    if (sum < 1) { setErr("ใส่จำนวนคนอย่างน้อย 1 คน"); return; }
    if (!/^0\d{8,9}$/.test(f.phone.replace(/\D/g, ""))) { setErr("เบอร์โทรไม่ถูกต้อง (เช่น 0812345678)"); return; }
    setBusy(true);
    try {
      const r = await call<{ ref: string }>({ action: "submit", slug: ev.slug, school: f.school, contact: f.contact, phone: f.phone,
        male: n(f.male), female: n(f.female), teachers: n(f.teachers), note: f.note, website: f.website });
      saveRef(r.ref, f.school);
      go(`/stay/${r.ref}`);
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };

  if (ev === undefined) return <div className="spinner" />;
  if (ev === null) return <section className="card"><p>ตอนนี้ยังไม่มีงานที่เปิดรับคำขอที่พัก</p><MyRequests /></section>;
  return (
    <main className="stay-main">
      <section className="mhero c-stay">
        <BedDouble size={64} strokeWidth={1.5} className="mh-ic" aria-hidden />
        <h1>{ev.name}</h1>
        <p>{days(ev)} · {ev.open ? `รับคำขอถึง ${fmtDateTime(ev.closes_at)} น.` : "ปิดรับคำขอแล้ว"}</p>
        {ev.note && <p>{ev.note}</p>}
      </section>
      {ev.open ? (
        <form className="card form stay-form" onSubmit={submit}>
          <h2>กรอกคำขอที่พัก</h2>
          <Field label="ชื่อโรงเรียน"><input id="stay-school" value={f.school} onChange={set("school")} required minLength={2} maxLength={120} /></Field>
          <div className="row2">
            <Field label="ครูผู้ประสานงาน"><input id="stay-contact" value={f.contact} onChange={set("contact")} required minLength={2} maxLength={80} autoComplete="name" /></Field>
            <Field label="เบอร์โทร"><input id="stay-phone" value={f.phone} onChange={set("phone")} required inputMode="tel" autoComplete="tel" maxLength={20} /></Field>
          </div>
          <div className="row3">
            <Field label="นักเรียนชาย"><input id="stay-male" value={f.male} onChange={set("male")} inputMode="numeric" placeholder="0" /></Field>
            <Field label="นักเรียนหญิง"><input id="stay-female" value={f.female} onChange={set("female")} inputMode="numeric" placeholder="0" /></Field>
            <Field label="ครู"><input id="stay-teachers" value={f.teachers} onChange={set("teachers")} inputMode="numeric" placeholder="0" /></Field>
          </div>
          <Field label="หมายเหตุ (ถ้ามี)"><textarea id="stay-note" rows={2} value={f.note} onChange={set("note")} maxLength={500} placeholder="เช่น มาถึงเย็นวันที่ 24" /></Field>
          <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden value={f.website} onChange={set("website")} name="website" />
          {err && <p className="error">{err}</p>}
          <button type="submit" className="btn primary big" disabled={busy}>{busy ? "กำลังส่ง…" : `ส่งคำขอที่พัก ${sum ? `${sum} คน` : ""}`}</button>
          <p className="muted small">ที่พักฟรี ไม่ต้องโอนเงิน · หลังส่งจะได้ลิงก์ติดตามผล เก็บไว้ดูว่าได้ห้องไหน</p>
        </form>
      ) : <section className="card"><p>ปิดรับคำขอที่พักของงานนี้แล้ว ติดต่อฝ่ายอาคารสถานที่ของโรงเรียน</p></section>}
      <Availability rooms={ev.rooms} buildings={ev.buildings ?? []} />
      <MyRequests />
    </main>
  );
}

function MyRequests() {
  const refs = savedRefs();
  if (!refs.length) return null;
  return (
    <section className="card">
      <h2>คำขอที่ส่งจากเครื่องนี้</h2>
      {refs.map((r) => <button key={r.ref} className="link stay-myref" onClick={() => go(`/stay/${r.ref}`)}>{r.school} · {r.ref}</button>)}
    </section>
  );
}

function StatusView({ refCode }: { refCode: string }) {
  const [s, setS] = useState<Status | null | undefined>(undefined);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const load = useCallback(() => {
    call<Status>({ action: "status", ref: refCode }).then((x) => { setS(x); saveRef(x.ref, x.school_name); }).catch((e) => { setErr((e as Error).message); setS(null); });
  }, [refCode]);
  useEffect(() => { load(); }, [load]);
  const cancel = async () => {
    if (!confirm("ยกเลิกคำขอที่พักนี้?")) return;
    try { setS(await call<Status>({ action: "cancel", ref: refCode })); } catch (e) { setErr((e as Error).message); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { /* clipboard blocked */ }
  };
  if (s === undefined) return <div className="spinner" />;
  if (s === null) return <section className="card"><p className="error">{err || "ไม่พบคำขอนี้"}</p><button className="btn" onClick={() => go("/stay")}>กลับหน้าขอที่พัก</button></section>;
  const st = REQ_STATUS[s.status];
  return (
    <main className="stay-main">
      <section className="card stay-status">
        <p className="muted small">{s.event.name} · {days(s.event)}</p>
        <h1>{s.school_name}</h1>
        <p className={`chip ${st.tone}`}>{s.status === "pending" ? "ส่งคำขอแล้ว · รอฝ่ายจัดห้อง" : st.label}</p>
        <dl className="stay-dl">
          <dt>นักเรียนชาย</dt><dd>{s.male_students}</dd><dt>นักเรียนหญิง</dt><dd>{s.female_students}</dd><dt>ครู</dt><dd>{s.teachers}</dd>
          <dt>ผู้ประสานงาน</dt><dd>{s.contact_name}</dd><dt>ส่งเมื่อ</dt><dd>{fmtDateTime(s.created_at)}</dd>
        </dl>
        {s.decision_note && <p><b>หมายเหตุจากฝ่ายจัดห้อง:</b> {s.decision_note}</p>}
        {s.status === "approved" && (
          <div className="stay-got">
            <h2><Check size={20} /> ห้องที่ได้</h2>
            {s.rooms.map((r, i) => <p key={i}><b>{r.building} ห้อง {r.name}</b> (ชั้น {r.floor}) · {KIND[r.kind]} {r.people} คน</p>)}
            {s.event.note && <p className="muted small">{s.event.note}</p>}
          </div>
        )}
        <div className="row wrap">
          <button className="btn" onClick={copy}><Copy size={16} />{copied ? "คัดลอกลิงก์แล้ว" : "คัดลอกลิงก์ติดตามผล"}</button>
          {s.status === "pending" && <button className="btn" onClick={cancel}>ยกเลิกคำขอ</button>}
          <button className="btn" onClick={() => go("/stay")}>ส่งคำขออีกครั้ง</button>
        </div>
        <p className="muted small">รหัสติดตาม {s.ref} · เก็บลิงก์นี้ไว้เปิดดูผลภายหลัง</p>
        {err && <p className="error">{err}</p>}
      </section>
    </main>
  );
}
