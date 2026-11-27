import { useCallback, useEffect, useState } from "react";
import { BedDouble, Check, Copy, MapPinned, Navigation, Phone, Siren } from "lucide-react";
import { LOGO, SCHOOL_NAME } from "../lib/brand";
import { byBuilding, closesLabel, free, GEO_NOTE, KIND, mapsUrl, REQ_STATUS, telHref, VENUE_CAT, type Kind, type ReqStatus, type RoomUse, type Venue } from "../lib/lodging";
import { NearbyVenues } from "../components/NearbyVenues";
import { fmtDate, fmtDateTime } from "../lib/time";
import { Field } from "../components/ui";
import { LodgingMap, type LodgingBuilding } from "../components/LodgingMap";
import { PeopleLegend, RoomPeople } from "../components/RoomPeople";
import { call, ERR, go, loadList, saveList } from "./api";
import { ReportStatus, ReportView } from "./Report";

const SAVED = "stay-refs";

type EventInfo = { id: number; slug: string; name: string; starts_on: string; ends_on: string; closes_at: string; note: string; open: boolean; rooms: RoomUse[]; buildings?: LodgingBuilding[]; venues?: Venue[] };
type Status = {
  ref: string; status: ReqStatus; school_name: string; contact_name: string; male_students: number; female_students: number; teachers: number;
  note: string | null; decision_note: string | null; created_at: string;
  event: { name: string; slug: string; starts_on: string; ends_on: string; note: string };
  rooms: { building: string; floor: number; name: string; people: number; kind: Kind }[];
  venue?: (Pick<Venue, "name" | "category" | "contact" | "phone1" | "phone2" | "subdistrict" | "district" | "distance_km" | "lat" | "lng" | "geo_precision"> & { people?: number }) | null;
};
const savedRefs = () => loadList<{ ref: string; school: string }>(SAVED);
const saveRef = (ref: string, school: string) => saveList(SAVED, [{ ref, school }, ...savedRefs().filter((x) => x.ref !== ref)].slice(0, 10));
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
  const report = path.startsWith("/stay/report");
  useEffect(() => { document.title = (report ? "แจ้งเหตุ · " : "ขอที่พัก · ") + SCHOOL_NAME; }, [report]);
  const ref = path.match(/^\/stay\/([0-9A-Fa-f]{12})$/)?.[1];
  const incident = path.match(/^\/stay\/report\/([0-9A-Fa-f]{12})$/)?.[1];
  return (
    <div className="stay-app c-stay">
      <header className="stay-brand">
        <span className="seal"><img src={LOGO} alt={`ตรา${SCHOOL_NAME}`} /></span>
        <div><b>{report ? "แจ้งเหตุ · ขอความช่วยเหลือระหว่างงานแข่งขัน" : "ขอที่พักสำหรับโรงเรียนที่มาแข่งขัน"}</b><small>{SCHOOL_NAME}</small></div>
      </header>
      {incident ? <ReportStatus refCode={incident.toUpperCase()} />
        : report ? <ReportView />
        : ref ? <StatusView refCode={ref.toUpperCase()} />
        : path.startsWith("/stay/near") ? <NearView /> : <RequestView />}
    </div>
  );
}

/** ห้องว่าง/เต็ม: สรุปทีละอาคาร (บรรทัดเดียว) แตะเพื่อดูห้องและรูปคน — หน้าสั้นลงบนมือถือ */
function Availability({ rooms, buildings }: { rooms: RoomUse[]; buildings: LodgingBuilding[] }) {
  const [bld, setBld] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (name: string) => setOpen((o) => { const n = new Set(o); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const pick = (name: string | null) => { setBld(name); if (name) setOpen((o) => new Set(o).add(name)); };
  return (
    <section className="card stay-avail">
      <h2>ห้องว่างตอนนี้</h2>
      <LodgingMap rooms={rooms} buildings={buildings} selected={bld} onPick={pick} />
      {byBuilding(rooms).filter((b) => !bld || b.building === bld).map((b) => {
        const all = b.floors.flatMap((f) => f.rooms);
        const left = all.reduce((n, r) => n + free(r), 0), cap = all.reduce((n, r) => n + r.capacity, 0);
        const freeRooms = all.filter((r) => free(r) > 0).map((r) => r.name);
        const isOpen = open.has(b.building);
        return (
          <div key={b.building} className={`stay-building${isOpen ? " open" : ""}`}>
            <button className="stay-bsum" aria-expanded={isOpen} onClick={() => toggle(b.building)}>
              <span className="stay-bsum-t"><b>{b.building}</b><small>{left > 0 ? `ว่าง ${left} จาก ${cap} ที่ · ห้อง ${freeRooms.join(", ")}` : `เต็มทั้งอาคาร (${cap} ที่)`}</small></span>
              <span className="stay-bsum-bar" aria-hidden><i style={{ width: `${cap ? ((cap - left) / cap) * 100 : 0}%` }} /></span>
              <span className="stay-bsum-go">{isOpen ? "ซ่อนห้อง" : "ดูห้อง"}</span>
            </button>
            {isOpen && b.floors.map((f) => (
              <div key={f.floor} className="stay-floor">
                <small>ชั้น {f.floor}</small>
                <div className="stay-tiles">
                  {f.rooms.map((r) => (
                    <div key={r.id} className={`stay-tile stay-room${free(r) === 0 ? " full" : ""}`}>
                      <span className="stay-tile-head"><b>{r.name}</b><small>{free(r) === 0 ? "เต็ม" : `ว่าง ${free(r)}`}</small></span>
                      <RoomPeople room={r} plain />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}
      {bld && <button className="link" onClick={() => setBld(null)}>ดูทุกอาคาร</button>}
      {open.size > 0 && <PeopleLegend plain />}
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
  const left = ev ? ev.rooms.reduce((x, r) => x + free(r), 0) : 0;
  const network = ev?.venues?.filter((v) => v.status === "confirmed" && !v.is_home).length ?? 0;

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
        <p>{days(ev)} · {ev.open ? `รับคำขอถึง ${closesLabel(ev.closes_at)}` : "ปิดรับคำขอแล้ว"}</p>
        {ev.note && <p>{ev.note}</p>}
      </section>
      <ReportLink />
      {ev.open ? (
        <form className="card form stay-form" onSubmit={submit}>
          <h2>กรอกคำขอที่พัก</h2>
          <p className={`stay-left${left === 0 ? " none" : ""}`}>{left > 0 ? <>ห้องในโรงเรียนว่างอีก <b>{left} ที่</b></> : <>ห้องในโรงเรียน<b>เต็มแล้ว</b></>}{network > 0 && <> · มีที่พักรอบโรงเรียนรับแล้วอีก {network} แห่ง</>}</p>
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
          {sum > left && (
            <p className="stay-over" role="status">ขอ {sum} คน {left > 0 ? `แต่ในโรงเรียนว่าง ${left} ที่` : "แต่ห้องในโรงเรียนเต็มแล้ว"} — ส่งคำขอได้ตามปกติ ฝ่ายอาคารสถานที่จะจัดในโรงเรียนเท่าที่ได้ ส่วนที่เหลือจัดให้ที่<button type="button" className="link" onClick={() => go("/stay/near")}>ที่พักรอบโรงเรียน</button>และแจ้งในลิงก์ติดตามผล</p>
          )}
          <button type="submit" className="btn primary big" disabled={busy}>{busy ? "กำลังส่ง…" : `ส่งคำขอที่พัก ${sum ? `${sum} คน` : ""}`}</button>
          <p className="muted small">ที่พักฟรี ไม่ต้องโอนเงิน · หลังส่งจะได้ลิงก์ติดตามผล เก็บไว้ดูว่าได้ห้องไหน</p>
        </form>
      ) : <section className="card"><p>ปิดรับคำขอที่พักของงานนี้แล้ว ติดต่อฝ่ายอาคารสถานที่ของโรงเรียน</p></section>}
      {(ev.venues?.length ?? 0) > 1 && (
        <button className="card stay-near-link" onClick={() => go("/stay/near")}>
          <MapPinned size={28} />
          <span><b>ที่พักอื่นรอบโรงเรียน</b><small>{ev.venues!.filter((v) => v.status === "confirmed" && !v.is_home).length} แห่งรับแล้ว · โรงแรม/รีสอร์ทและสถานที่อื่นอีก {ev.venues!.filter((v) => v.status !== "confirmed").length} แห่ง พร้อมแผนที่และเบอร์โทร</small></span>
        </button>
      )}
      <Availability rooms={ev.rooms} buildings={ev.buildings ?? []} />
      <MyRequests />
    </main>
  );
}

type Found = { ref: string; school_name: string; status: ReqStatus; created_at: string; event_name: string };
/** คำขอของฉัน: ที่จำไว้ในเครื่องนี้ + ค้นด้วยชื่อโรงเรียนและเบอร์โทร (กรณีลิงก์หาย/เปลี่ยนเครื่อง) */
function MyRequests() {
  const refs = savedRefs();
  const [f, setF] = useState({ school: "", phone: "" });
  const [found, setFound] = useState<Found[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const find = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    if (f.school.trim().length < 2 || !/^0\d{8,9}$/.test(f.phone.replace(/\D/g, ""))) { setErr(ERR.find_bad); return; }
    setBusy(true);
    try { setFound((await call<{ items: Found[] }>({ action: "find", school: f.school, phone: f.phone })).items); }
    catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="card stay-mine">
      <h2>ติดตามคำขอของฉัน</h2>
      {refs.length > 0 && (
        <div className="stay-mine-list">
          <small className="muted">คำขอที่ส่งจากเครื่องนี้</small>
          {refs.map((r) => <button key={r.ref} className="link stay-myref" onClick={() => go(`/stay/${r.ref}`)}>{r.school} · {r.ref}</button>)}
        </div>
      )}
      <form className="stay-find" onSubmit={find}>
        <small className="muted">ลิงก์หายหรือส่งจากเครื่องอื่น? ค้นด้วยชื่อโรงเรียนและเบอร์โทรที่ใช้ตอนขอ</small>
        <div className="row2">
          <Field label="ชื่อโรงเรียน"><input id="find-school" value={f.school} onChange={(e) => setF({ ...f, school: e.target.value })} maxLength={120} /></Field>
          <Field label="เบอร์โทร"><input id="find-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" maxLength={20} /></Field>
        </div>
        <button type="submit" className="btn" disabled={busy}>{busy ? "กำลังค้นหา…" : "ค้นหาคำขอ"}</button>
        {err && <p className="error">{err}</p>}
        {found && (found.length === 0 ? <p className="muted">ไม่พบคำขอที่ตรงกับชื่อโรงเรียนและเบอร์นี้</p> : found.map((x) => (
          <button key={x.ref} type="button" className="link stay-myref" onClick={() => { saveRef(x.ref, x.school_name); go(`/stay/${x.ref}`); }}>
            {x.school_name} · {REQ_STATUS[x.status].label} · ส่งเมื่อ {fmtDateTime(x.created_at)}
          </button>
        )))}
      </form>
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
        {s.status === "approved" && s.rooms.length > 0 && (
          <div className="stay-got">
            <h2><Check size={20} /> {s.venue ? "ห้องในโรงเรียนวังหลวงพิทยาสรรพ์" : "ห้องที่ได้"}</h2>
            {s.rooms.map((r, i) => <p key={i}><b>{r.building} ห้อง {r.name}</b> (ชั้น {r.floor}) · {KIND[r.kind]} {r.people} คน</p>)}
            {s.event.note && <p className="muted small">{s.event.note}</p>}
          </div>
        )}
        {s.status === "approved" && s.venue && (
          <div className="stay-got">
            <h2><Check size={20} /> {s.rooms.length ? `ส่วนที่เหลือ ${s.venue.people ?? ""} คน พักที่` : "ที่พักที่ได้:"} {s.venue.name}</h2>
            <p>{[VENUE_CAT[s.venue.category], s.venue.distance_km != null ? `ห่างจากโรงเรียนวังหลวงพิทยาสรรพ์ ${s.venue.distance_km} กม.` : "", s.venue.subdistrict && `ต.${s.venue.subdistrict}`, s.venue.district && `อ.${s.venue.district}`].filter(Boolean).join(" · ")}</p>
            {s.venue.contact && <p>ผู้ประสานงาน: {s.venue.contact}</p>}
            <div className="row wrap">
              {[s.venue.phone1, s.venue.phone2].filter(Boolean).map((p) => <a key={p} className="btn sm" href={telHref(p!)}><Phone size={14} />{p}</a>)}
              <a className="btn sm" href={mapsUrl({ ...s.venue, province: null })} target="_blank" rel="noreferrer"><Navigation size={14} />นำทาง</a>
            </div>
            {GEO_NOTE[s.venue.geo_precision] && <p className="muted small">{GEO_NOTE[s.venue.geo_precision]} · ปุ่มนำทางค้นหาจากชื่อสถานที่ โทรถามทางก่อนเดินทาง</p>}
          </div>
        )}
        <div className="row wrap">
          <button className="btn" onClick={copy}><Copy size={16} />{copied ? "คัดลอกลิงก์แล้ว" : "คัดลอกลิงก์ติดตามผล"}</button>
          {s.status === "pending" && <button className="btn" onClick={cancel}>ยกเลิกคำขอ</button>}
          <button className="btn" onClick={() => go("/stay")}>ส่งคำขออีกครั้ง</button>
          {s.status === "approved" && <button className="btn" onClick={() => go(`/stay/report?from=${s.ref}`)}><Siren size={16} />แจ้งเหตุ</button>}
        </div>
        <div className="stay-code">
          <small>รหัสติดตาม</small>
          <b>{s.ref.replace(/(.{4})(?=.)/g, "$1 ")}</b>
          <small>ถ่ายรูปหน้านี้เก็บไว้ · ถ้าลิงก์หาย ค้นได้ที่หน้าขอที่พักด้วยชื่อโรงเรียนและเบอร์โทร</small>
        </div>
        {err && <p className="error">{err}</p>}
      </section>
    </main>
  );
}

/** ทางเข้าหน้าแจ้งเหตุ (น้ำไม่ไหล ไฟดับ รถขวางทาง ฯลฯ) — อยู่บนสุดของหน้าขอที่พัก */
function ReportLink() {
  return (
    <button className="card stay-near-link stay-report-link c-alert" onClick={() => go("/stay/report")}>
      <Siren size={28} />
      <span><b>แจ้งเหตุ / ขอความช่วยเหลือ</b><small>น้ำไม่ไหล ไฟดับ ห้องชำรุด เฉี่ยวชน รถขวางทางเข้าออก — ถึงเจ้าหน้าที่ทาง LINE ทันที</small></span>
    </button>
  );
}

/** /stay/near — ที่พักอื่นรอบโรงเรียน (แผนที่ + รายชื่อ) */
function NearView() {
  const [ev, setEv] = useState<EventInfo | null | undefined>(undefined);
  useEffect(() => { call<EventInfo>({ action: "event" }).then(setEv).catch(() => setEv(null)); }, []);
  if (ev === undefined) return <div className="spinner" />;
  return (
    <main className="stay-main">
      <section className="card">
        <button className="link" onClick={() => go("/stay")}>← กลับหน้าขอที่พัก</button>
        <h1 className="near-title">ที่พักรอบโรงเรียนวังหลวงพิทยาสรรพ์</h1>
        <p className="muted">ที่ที่ "รับแล้ว" ฝ่ายอาคารสถานที่ประสานไว้แล้ว ขอผ่านหน้านี้ได้เลย ฝ่ายจะจัดให้ถ้าห้องในโรงเรียนเต็ม · โรงแรม/รีสอร์ทและสถานที่ที่ยังไม่ยืนยัน โรงเรียนติดต่อเอง</p>
        {ev?.venues?.length ? <NearbyVenues venues={ev.venues} initialFilter="confirmed" /> : <p>ยังไม่มีข้อมูลที่พักรอบโรงเรียน</p>}
      </section>
    </main>
  );
}
