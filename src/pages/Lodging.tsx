import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { BedDouble, Copy, Plus, QrCode, Sparkles, Trash2 } from "lucide-react";
import { errText, supabase } from "../lib/supabase";
import { useMe } from "../lib/me";
import { useNotice } from "../lib/notice";
import { fmtDate, fmtDateTime, toISO } from "../lib/time";
import {
  autoAllocate, byBuilding, free, isLodgingTeam, isLodgingViewer, KIND, REQ_STATUS, total,
  type Allocation, type Kind, type LodgingEvent, type LodgingRequest, type ReqStatus, type RoomRow, type RoomUse,
} from "../lib/lodging";
import { Empty, Field, Modal, ModuleHero } from "../components/ui";
import { BuildingDrawer, LodgingMap, type LodgingBuilding } from "../components/LodgingMap";

type Tab = "rooms" | "requests" | "settings";
const ERR: Record<string, string> = {
  not_allocated: "จัดห้องให้ครบทุกคนก่อนอนุมัติ",
  too_many: "จัดห้องเกินจำนวนคนที่ขอ",
  note_required: "ใส่เหตุผลที่ไม่อนุมัติ (โรงเรียนจะเห็น)",
  not_pending: "คำขอนี้ถูกพิจารณาไปแล้ว",
};
const lerr = (e: unknown) => {
  const m = errText(e);
  const full = m.match(/room_full:(.+)/);
  if (full) return `ห้อง ${full[1]} ที่นั่งไม่พอ`;
  return Object.entries(ERR).find(([k]) => m.includes(k))?.[1] ?? m;
};

/** ห้องพักงานแข่งขัน: ผังห้องว่าง/เต็ม (ทุกคน) · คำขอและจัดห้อง (ฝ่ายจัดห้อง) · ตั้งค่างาน/ห้อง */
export default function Lodging() {
  const me = useMe();
  const team = isLodgingTeam(me), viewer = isLodgingViewer(me);
  const [events, setEvents] = useState<LodgingEvent[] | null>(null);
  const [eventId, setEventId] = useState<number | null>(null);
  const [rooms, setRooms] = useState<RoomUse[]>([]);
  const [reqs, setReqs] = useState<LodgingRequest[]>([]);
  const [allocs, setAllocs] = useState<Allocation[]>([]);
  const [tab, setTab] = useState<Tab>(viewer ? "requests" : "rooms");
  const [open, setOpen] = useState<number | "new" | null>(null);
  const [share, setShare] = useState(false);
  const [buildings, setBuildings] = useState<LodgingBuilding[]>([]);
  const [bld, setBld] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [notice, say] = useNotice();

  const loadBuildings = useCallback(async () => {
    const { data } = await supabase.from("lodging_buildings").select("name, poly").order("name");
    setBuildings((data as LodgingBuilding[]) ?? []);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadBuildings(); }, [loadBuildings]);
  const loadEvents = useCallback(async () => {
    const { data, error } = await supabase.from("lodging_events").select("*").order("starts_on", { ascending: false });
    if (error) setErr(errText(error));
    const list = (data as LodgingEvent[]) ?? [];
    setEvents(list);
    setEventId((cur) => cur ?? list.find((e) => e.active)?.id ?? list[0]?.id ?? null);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadEvents(); }, [loadEvents]);

  const load = useCallback(async () => {
    if (!eventId) return;
    const occ = await supabase.rpc("lodging_occupancy", { p_event: eventId });
    if (occ.error) setErr(errText(occ.error));
    setRooms((occ.data as RoomUse[]) ?? []);
    if (!viewer) return;
    const { data, error } = await supabase.from("lodging_requests").select("*").eq("event_id", eventId).order("created_at");
    if (error) setErr(errText(error));
    const list = (data as LodgingRequest[]) ?? [];
    setReqs(list);
    const al = list.length ? await supabase.from("lodging_allocations").select("*").in("request_id", list.map((r) => r.id)) : { data: [] };
    setAllocs((al.data as Allocation[]) ?? []);
  }, [eventId, viewer]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const ev = events?.find((e) => e.id === eventId) ?? null;
  const cap = rooms.reduce((n, r) => n + r.capacity, 0);
  const approved = rooms.reduce((n, r) => n + r.approved, 0);
  const waiting = reqs.filter((r) => r.status === "pending");
  const live = useMemo(() => new Set(reqs.filter((r) => r.status === "pending" || r.status === "approved").map((r) => r.id)), [reqs]);
  const schoolsIn = (roomId: number) => allocs.filter((a) => a.room_id === roomId && live.has(a.request_id))
    .map((a) => ({ a, r: reqs.find((q) => q.id === a.request_id)! }));

  if (events === null) return <div className="spinner" />;
  return (
    <div className="c-stay">
      <ModuleHero mod="c-stay" icon={BedDouble} title={ev?.name ?? "ห้องพักงานแข่งขัน"}
        desc={ev ? `${fmtDate(ev.starts_on, { day: "numeric", month: "short" })} – ${fmtDate(ev.ends_on, { day: "numeric", month: "short", year: "numeric" })} · โรงเรียนขอที่พักได้ถึง ${fmtDateTime(ev.closes_at)} น.` : "ยังไม่มีงาน"}
        stats={ev ? [
          { n: `${approved}/${cap}`, label: "ที่นั่งจัดแล้ว" },
          { n: viewer ? waiting.length : rooms.reduce((n, r) => n + r.pending, 0), label: viewer ? "คำขอรอจัดห้อง" : "คนรอจัดห้อง" },
          { n: cap - approved - rooms.reduce((n, r) => n + r.pending, 0), label: "ที่ว่าง" },
        ] : undefined}>
        <div className="mh-tabs" role="tablist">
          {viewer && <button role="tab" aria-selected={tab === "requests"} className={tab === "requests" ? "on" : ""} onClick={() => setTab("requests")}>คำขอ</button>}
          <button role="tab" aria-selected={tab === "rooms"} className={tab === "rooms" ? "on" : ""} onClick={() => setTab("rooms")}>ห้องว่าง/เต็ม</button>
          {team && <button role="tab" aria-selected={tab === "settings"} className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>ตั้งค่า</button>}
        </div>
      </ModuleHero>
      {notice}
      {err && <p className="error">{err}</p>}
      {events.length > 1 && (
        <div className="row wrap" style={{ marginBottom: ".8rem" }}>
          <select value={eventId ?? ""} onChange={(e) => setEventId(Number(e.target.value))} aria-label="เลือกงาน">
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}{e.active ? "" : " (ปิด)"}</option>)}
          </select>
        </div>
      )}
      {team && ev && tab !== "settings" && (
        <div className="stay-share">
          <span>โรงเรียนขอที่พักเองได้ที่ <b>{window.location.origin}/stay</b></span>
          <button className="btn sm" onClick={() => setShare(true)}><QrCode size={16} />QR / คัดลอกลิงก์</button>
        </div>
      )}

      {tab === "rooms" && (rooms.length === 0 ? <Empty>ยังไม่มีห้องพัก</Empty> : (
        <section>
          <LodgingMap rooms={rooms} buildings={buildings} selected={bld} onPick={setBld} />
          {bld && <p className="row wrap stay-filter"><span>แสดงเฉพาะ <b>{bld}</b></span><button className="link" onClick={() => setBld(null)}>ดูทุกอาคาร</button></p>}
          {byBuilding(rooms).filter((b) => !bld || b.building === bld).map((b) => (
            <div key={b.building} className="card stay-board">
              <h2>{b.building} <small className="muted">ว่าง {b.floors.flatMap((f) => f.rooms).reduce((n, r) => n + free(r), 0)} จาก {b.floors.flatMap((f) => f.rooms).reduce((n, r) => n + r.capacity, 0)} ที่</small></h2>
              {b.floors.map((f) => (
                <div key={f.floor} className="stay-floor-row">
                  <span className="stay-floor-label">ชั้น {f.floor}</span>
                  <div className="stay-tiles">
                    {f.rooms.map((r) => {
                      const st = free(r) === 0 ? "full" : r.approved + r.pending === 0 ? "empty" : "part";
                      return (
                        <div key={r.id} className={`stay-tile ${st}`}>
                          <b>{r.name}</b>
                          <span className="stay-bar" aria-hidden><i className="a" style={{ width: `${(r.approved / r.capacity) * 100}%` }} /><i className="p" style={{ width: `${(r.pending / r.capacity) * 100}%` }} /></span>
                          <small>{st === "full" ? "เต็ม" : st === "empty" ? `ว่าง ${r.capacity}` : `เหลือ ${free(r)} / ${r.capacity}`}</small>
                          {viewer && schoolsIn(r.id).map(({ a, r: q }) => (
                            <small key={a.id} className={`stay-who${q.status === "pending" ? " p" : ""}`}>{q.school_name} · {KIND[a.kind]} {a.people}</small>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
          <p className="muted small stay-legend"><i className="a" /> จัดแล้ว (อนุมัติ) <i className="p" /> จัดไว้ รออนุมัติ</p>
        </section>
      ))}

      {tab === "requests" && viewer && (
        <Requests reqs={reqs} allocs={allocs} rooms={rooms} team={team} onOpen={setOpen} />
      )}

      {tab === "settings" && team && <Settings event={ev} buildings={buildings} onChanged={() => { loadEvents(); load(); loadBuildings(); }} say={say} />}

      {team && ev && tab === "requests" && (
        <><div className="fab-space" aria-hidden /><button className="fab" aria-label="บันทึกคำขอแทนโรงเรียน" onClick={() => setOpen("new")}><Plus size={20} /><span>บันทึกแทนโรงเรียน</span></button></>
      )}
      {open !== null && ev && (
        <RequestModal event={ev} req={open === "new" ? null : reqs.find((r) => r.id === open) ?? null} rooms={rooms} allocs={allocs}
          reqs={reqs} team={team} onClose={() => setOpen(null)} onChanged={(msg) => { load(); if (msg) say(msg); }} />
      )}
      {share && <ShareModal onClose={() => setShare(false)} />}
    </div>
  );
}

function Requests({ reqs, allocs, rooms, team, onOpen }: {
  reqs: LodgingRequest[]; allocs: Allocation[]; rooms: RoomUse[]; team: boolean; onOpen: (id: number) => void;
}) {
  const [filter, setFilter] = useState<ReqStatus | "all">("pending");
  const shown = reqs.filter((r) => filter === "all" || r.status === filter);
  const count = (s: ReqStatus) => reqs.filter((r) => r.status === s).length;
  const roomName = (id: number) => rooms.find((r) => r.id === id)?.name ?? "?";
  return (
    <>
      <div className="tabs scroll">
        <button className={filter === "pending" ? "on" : ""} onClick={() => setFilter("pending")}>รอจัดห้อง{count("pending") > 0 && <span className="badge">{count("pending")}</span>}</button>
        <button className={filter === "approved" ? "on" : ""} onClick={() => setFilter("approved")}>อนุมัติแล้ว {count("approved")}</button>
        <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>ทั้งหมด {reqs.length}</button>
      </div>
      {shown.length === 0 ? <Empty>{filter === "pending" ? "ไม่มีคำขอรอจัดห้อง" : "ยังไม่มีคำขอ"}</Empty> : (
        <div className="card nst-list">
          {shown.map((r) => {
            const mine = allocs.filter((a) => a.request_id === r.id);
            const got = mine.reduce((n, a) => n + a.people, 0);
            return (
              <button key={r.id} className="nst-person stay-req" onClick={() => onOpen(r.id)}>
                <span className="nst-person-text">
                  <b>{r.school_name}</b>
                  <small>{total(r)} คน (ชาย {r.male_students} · หญิง {r.female_students} · ครู {r.teachers}) · {r.contact_name}{r.source === "staff" ? " · บันทึกแทน" : ""}</small>
                  {mine.length > 0 && <small>ห้อง {[...new Set(mine.map((a) => roomName(a.room_id)))].join(", ")}{r.status === "pending" ? ` · จัดแล้ว ${got}/${total(r)}` : ""}</small>}
                </span>
                <span className={`chip ${REQ_STATUS[r.status].tone}`}>{REQ_STATUS[r.status].label}</span>
              </button>
            );
          })}
        </div>
      )}
      {!team && <p className="muted small">ฝ่ายจัดห้อง (หัวหน้างานอาคารสถานที่/ผู้ดูแลระบบ) เป็นผู้จัดห้องและอนุมัติ</p>}
    </>
  );
}

type Line = { room_id: number; kind: Kind; people: number };
function RequestModal({ event, req, rooms, allocs, reqs, team, onClose, onChanged }: {
  event: LodgingEvent; req: LodgingRequest | null; rooms: RoomUse[]; allocs: Allocation[]; reqs: LodgingRequest[]; team: boolean;
  onClose: () => void; onChanged: (msg?: string) => void;
}) {
  const [f, setF] = useState({
    school: req?.school_name ?? "", contact: req?.contact_name ?? "", phone: req?.phone ?? "",
    male: String(req?.male_students ?? ""), female: String(req?.female_students ?? ""), teachers: String(req?.teachers ?? ""), note: req?.note ?? "",
  });
  const [edit, setEdit] = useState(!req);
  const mine = useMemo(() => (req ? allocs.filter((a) => a.request_id === req.id) : []), [req, allocs]);
  const [lines, setLines] = useState<Line[]>(mine.map((a) => ({ room_id: a.room_id, kind: a.kind, people: a.people })));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const n = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const live = new Set(reqs.filter((r) => r.status === "pending" || r.status === "approved").map((r) => r.id));
  const others = allocs.filter((a) => req && a.request_id !== req.id && live.has(a.request_id));
  // ที่ว่างให้คำขอนี้ = ว่างจริง + ที่ของคำขอนี้เดิม
  const room = (id: number) => rooms.find((r) => r.id === id);
  const leftFor = (id: number) => { const r = room(id); return r ? free(r) + mine.filter((a) => a.room_id === id).reduce((s, a) => s + a.people, 0) : 0; };
  const planned = lines.reduce((s, l) => s + (l.people || 0), 0);
  const need = req ? total(req) : 0;
  const editable = team && req && (req.status === "pending" || req.status === "approved");

  const run = async (fn: () => PromiseLike<{ error: unknown }>, msg: string, close = true) => {
    setBusy(true); setErr("");
    const { error } = await fn();
    setBusy(false);
    if (error) { setErr(lerr(error)); return false; }
    onChanged(msg); if (close) onClose();
    return true;
  };
  const saveInfo = () => {
    const args = { p_school: f.school, p_contact: f.contact, p_phone: f.phone, p_male: n(f.male), p_female: n(f.female), p_teachers: n(f.teachers), p_note: f.note };
    if (n(f.male) + n(f.female) + n(f.teachers) < 1) { setErr("ใส่จำนวนคนอย่างน้อย 1 คน"); return; }
    return req
      ? run(() => supabase.rpc("lodging_request_update", { p_id: req.id, ...args }), "บันทึกข้อมูลแล้ว", false).then((ok) => ok && setEdit(false))
      : run(() => supabase.rpc("lodging_staff_create", { p_event: event.id, ...args }), "บันทึกคำขอแล้ว");
  };
  const saveAlloc = () => run(() => supabase.rpc("lodging_allocate", { p_request: req!.id, p_rows: lines.filter((l) => l.people > 0) }), "บันทึกการจัดห้องแล้ว", false);
  const approve = async () => {
    if (planned !== need) { setErr(`จัดห้องแล้ว ${planned} จาก ${need} คน ต้องครบก่อนอนุมัติ`); return; }
    if (await saveAlloc()) await run(() => supabase.rpc("lodging_decide", { p_request: req!.id, p_action: "approve", p_note: note || null }), "อนุมัติแล้ว");
  };

  return (
    <Modal title={req ? req.school_name : "บันทึกคำขอแทนโรงเรียน"} onClose={onClose}>
      {req && !edit ? (
        <div className="stay-info">
          <span className={`chip ${REQ_STATUS[req.status].tone}`}>{REQ_STATUS[req.status].label}</span>
          <p><b>{total(req)} คน</b> · นักเรียนชาย {req.male_students} · นักเรียนหญิง {req.female_students} · ครู {req.teachers}</p>
          <p>{req.contact_name} · <a href={`tel:${req.phone}`}>{req.phone}</a></p>
          {req.note && <p className="muted">หมายเหตุ: {req.note}</p>}
          <p className="muted small">ส่งเมื่อ {fmtDateTime(req.created_at)} · {req.source === "public" ? "โรงเรียนส่งเอง" : "บันทึกแทน"} · รหัสติดตาม {req.ref_code}</p>
          {req.decision_note && <p className="muted small">หมายเหตุการพิจารณา: {req.decision_note}</p>}
          {editable && <button className="link" onClick={() => setEdit(true)}>แก้ไขข้อมูล/จำนวนคน</button>}
        </div>
      ) : team && (
        <div className="form">
          <Field label="ชื่อโรงเรียน"><input value={f.school} onChange={set("school")} maxLength={120} /></Field>
          <div className="row2">
            <Field label="ผู้ประสานงาน"><input value={f.contact} onChange={set("contact")} maxLength={80} /></Field>
            <Field label="เบอร์โทร"><input value={f.phone} onChange={set("phone")} inputMode="tel" maxLength={20} /></Field>
          </div>
          <div className="row3">
            <Field label="นักเรียนชาย"><input value={f.male} onChange={set("male")} inputMode="numeric" /></Field>
            <Field label="นักเรียนหญิง"><input value={f.female} onChange={set("female")} inputMode="numeric" /></Field>
            <Field label="ครู"><input value={f.teachers} onChange={set("teachers")} inputMode="numeric" /></Field>
          </div>
          <Field label="หมายเหตุ"><input value={f.note} onChange={set("note")} maxLength={500} /></Field>
          <button className="btn primary big" disabled={busy} onClick={saveInfo}>{req ? "บันทึกข้อมูล" : "บันทึกคำขอ (แล้วจัดห้องต่อ)"}</button>
        </div>
      )}

      {req && (req.status === "pending" || req.status === "approved") && (
        <div className="zone-block">
          <h4>จัดห้อง · {planned}/{need} คน</h4>
          {lines.length === 0 && <p className="muted small">ยังไม่ได้จัดห้อง{editable ? " — กด “จัดให้อัตโนมัติ” หรือเพิ่มทีละห้อง" : ""}</p>}
          {lines.map((l, i) => (
            <div key={i} className="stay-line">
              {editable ? (
                <>
                  <select value={l.room_id} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, room_id: Number(e.target.value) } : x)))} aria-label="ห้อง">
                    {rooms.map((r) => <option key={r.id} value={r.id} disabled={leftFor(r.id) === 0 && r.id !== l.room_id}>{r.building.replace("อาคาร ", "อ.")} ห้อง {r.name} (ว่าง {leftFor(r.id)})</option>)}
                  </select>
                  <select value={l.kind} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, kind: e.target.value as Kind } : x)))} aria-label="ประเภท">
                    {(Object.keys(KIND) as Kind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
                  </select>
                  <input value={l.people || ""} inputMode="numeric" aria-label="จำนวนคน" onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, people: n(e.target.value) } : x)))} />
                  <button className="icon-btn" aria-label="เอาห้องนี้ออก" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
                </>
              ) : <p><b>{room(l.room_id)?.building} ห้อง {room(l.room_id)?.name}</b> · {KIND[l.kind]} {l.people} คน</p>}
            </div>
          ))}
          {editable && (
            <div className="row wrap">
              <button className="btn sm" onClick={() => setLines(autoAllocate(req, rooms, others, mine).map((a) => ({ room_id: a.room_id, kind: a.kind, people: a.people })))}><Sparkles size={16} />จัดให้อัตโนมัติ</button>
              <button className="btn sm" onClick={() => setLines([...lines, { room_id: rooms.find((r) => leftFor(r.id) > 0)?.id ?? rooms[0]?.id, kind: "male", people: 0 }])}><Plus size={16} />เพิ่มห้อง</button>
              {req.status === "approved" && <button className="btn sm primary" disabled={busy} onClick={saveAlloc}>บันทึกการจัดห้อง</button>}
            </div>
          )}
        </div>
      )}

      {editable && (
        <div className="zone-block act">
          <Field label={req!.status === "pending" ? "หมายเหตุถึงโรงเรียน (ไม่อนุมัติ = ต้องใส่)" : "หมายเหตุ (ถ้ายกเลิก)"}>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="เช่น ห้องเต็มแล้ว / เข้าพักได้ตั้งแต่ 16:00" />
          </Field>
          <div className="row wrap">
            {req!.status === "pending" && <button className="btn primary" disabled={busy} onClick={approve}>อนุมัติ ({planned}/{need} คน)</button>}
            {req!.status === "pending" && <button className="btn" disabled={busy} onClick={() => saveAlloc()}>บันทึกการจัดห้องไว้ก่อน</button>}
            {req!.status === "pending" && <button className="btn danger" disabled={busy} onClick={() => run(() => supabase.rpc("lodging_decide", { p_request: req!.id, p_action: "reject", p_note: note }), "ไม่อนุมัติแล้ว")}>ไม่อนุมัติ</button>}
            {req!.status === "approved" && <button className="btn danger" disabled={busy} onClick={() => { if (confirm(`ยกเลิกที่พักของ ${req!.school_name}? ห้องจะว่างให้โรงเรียนอื่น`)) run(() => supabase.rpc("lodging_decide", { p_request: req!.id, p_action: "cancel", p_note: note }), "ยกเลิกแล้ว"); }}>ยกเลิกที่พัก</button>}
          </div>
        </div>
      )}
      {err && <p className="error">{err}</p>}
    </Modal>
  );
}

function ShareModal({ onClose }: { onClose: () => void }) {
  const url = `${window.location.origin}/stay`;
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { QRCode.toDataURL(url, { width: 480, margin: 1, color: { dark: "#3b1250", light: "#ffffff" } }).then(setQr); }, [url]);
  return (
    <Modal title="ลิงก์ขอที่พักสำหรับโรงเรียน" onClose={onClose}>
      <div className="stay-qr">
        {qr && <img src={qr} alt={`QR ไปที่ ${url}`} />}
        <p><b>{url}</b></p>
        <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* blocked */ } }}><Copy size={16} />{copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}</button>
        <p className="muted small">ส่งลิงก์นี้ในกลุ่ม LINE ของโรงเรียนที่มาแข่ง หรือใส่ QR ในหนังสือเชิญ (กดค้างที่รูปเพื่อบันทึก)</p>
      </div>
    </Modal>
  );
}

function Settings({ event, buildings, onChanged, say }: { event: LodgingEvent | null; buildings: LodgingBuilding[]; onChanged: () => void; say: (m: string) => void }) {
  const [rooms, setRooms] = useState<RoomRow[] | null>(null);
  const [draw, setDraw] = useState<string | null>(null);
  const [editRoom, setEditRoom] = useState<RoomRow | "new" | null>(null);
  const [newEvent, setNewEvent] = useState(false);
  const loadRooms = useCallback(async () => {
    const { data } = await supabase.from("lodging_rooms").select("*").order("building").order("floor").order("sort");
    setRooms((data as RoomRow[]) ?? []);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadRooms(); }, [loadRooms]);
  return (
    <>
      <section>
        <div className="section-title"><h2>งาน</h2><button className="link" onClick={() => setNewEvent(true)}><Plus size={14} style={{ verticalAlign: "-2px" }} />เพิ่มงานใหม่</button></div>
        {event ? <EventForm event={event} onSaved={() => { onChanged(); say("บันทึกงานแล้ว"); }} /> : <Empty>ยังไม่มีงาน</Empty>}
      </section>
      <section>
        <div className="section-title"><h2>ห้องพัก</h2><button className="link" onClick={() => setEditRoom("new")}><Plus size={14} style={{ verticalAlign: "-2px" }} />เพิ่มห้อง</button></div>
        {rooms === null ? <div className="spinner" /> : (
          <div className="card nst-list">
            {rooms.map((r) => (
              <div key={r.id} className={`nst-person${r.active ? "" : " off"}`}>
                <span className="nst-person-text"><b>{r.building} ห้อง {r.name}</b><small>ชั้น {r.floor} · {r.capacity} คน{r.active ? "" : " · งดใช้"}</small></span>
                <button className="btn sm" onClick={() => setEditRoom(r)}>แก้ไข</button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section>
        <div className="section-title"><h2>ตำแหน่งอาคารบนแผนที่</h2></div>
        <div className="card nst-list">
          {[...new Set([...(rooms ?? []).map((r) => r.building), ...buildings.map((b) => b.name)])].map((name) => (
            <div key={name} className="nst-person">
              <span className="nst-person-text"><b>{name}</b><small>{buildings.some((b) => b.name === name) ? "วางบนแผนที่แล้ว" : "ยังไม่ได้วาง — ไม่แสดงบนแผนที่"}</small></span>
              <button className="btn sm" onClick={() => setDraw(name)}>วาดตำแหน่งใหม่</button>
            </div>
          ))}
        </div>
      </section>
      {draw && (
        <Modal title={`ตำแหน่ง${draw}`} onClose={() => setDraw(null)}>
          <BuildingDrawer name={draw} buildings={buildings} onCancel={() => setDraw(null)} onSave={async (poly) => {
            const { error } = await supabase.rpc("lodging_building_save", { p_name: draw, p_poly: poly });
            if (error) { say(errText(error)); return; }
            setDraw(null); onChanged(); say("บันทึกตำแหน่งอาคารแล้ว");
          }} />
        </Modal>
      )}
      {editRoom && <RoomForm room={editRoom === "new" ? null : editRoom} onClose={() => setEditRoom(null)} onSaved={() => { setEditRoom(null); loadRooms(); onChanged(); }} />}
      {newEvent && <Modal title="เพิ่มงานใหม่" onClose={() => setNewEvent(false)}><EventForm event={null} onSaved={() => { setNewEvent(false); onChanged(); say("เพิ่มงานแล้ว"); }} /></Modal>}
    </>
  );
}

function EventForm({ event, onSaved }: { event: LodgingEvent | null; onSaved: () => void }) {
  const [f, setF] = useState({
    name: event?.name ?? "", slug: event?.slug ?? "", starts: event?.starts_on ?? "", ends: event?.ends_on ?? "",
    closesDate: event ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(event.closes_at)) : "",
    closesTime: event ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(new Date(event.closes_at)) : "00:00",
    note: event?.note ?? "", active: event?.active ?? true,
  });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const closes = f.closesDate || f.starts;
    if (!f.name.trim() || !/^[a-z0-9-]{3,40}$/.test(f.slug) || !f.starts || !f.ends || f.ends < f.starts) {
      setErr("กรอกชื่องาน วันเริ่ม–วันจบ และรหัสงานภาษาอังกฤษตัวเล็ก/ตัวเลข/ขีด เช่น parichat-2569"); return;
    }
    const { error } = await supabase.rpc("lodging_event_save", { p_id: event?.id ?? null, p_slug: f.slug, p_name: f.name, p_starts: f.starts, p_ends: f.ends,
      p_closes: toISO(closes, f.closesTime || "00:00"), p_note: f.note, p_active: f.active });
    if (error) setErr(errText(error)); else { setErr(""); onSaved(); }
  };
  return (
    <div className={event ? "card form" : "form"}>
      <div className="row2">
        <Field label="ชื่องาน"><input value={f.name} onChange={set("name")} maxLength={120} /></Field>
        <Field label="รหัสงาน (ในลิงก์)"><input value={f.slug} onChange={set("slug")} maxLength={40} placeholder="parichat-2569" /></Field>
      </div>
      <div className="row2">
        <Field label="วันแรกของงาน"><input type="date" value={f.starts} onChange={set("starts")} /></Field>
        <Field label="วันสุดท้าย"><input type="date" value={f.ends} onChange={set("ends")} /></Field>
      </div>
      <div className="row2">
        <Field label="ปิดรับคำขอวันที่" hint="ว่าง = เที่ยงคืนวันแรกของงาน"><input type="date" value={f.closesDate} onChange={set("closesDate")} /></Field>
        <Field label="เวลา"><input type="time" value={f.closesTime} onChange={set("closesTime")} /></Field>
      </div>
      <Field label="ข้อความถึงโรงเรียน" hint="แสดงในหน้าขอที่พักและหน้าผล เช่น เวลาเข้าพัก ของที่ต้องเตรียม"><input value={f.note} onChange={set("note")} maxLength={500} /></Field>
      <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> เปิดใช้งานนี้</label>
      {err && <p className="error">{err}</p>}
      <button className="btn primary big" onClick={save}>บันทึกงาน</button>
    </div>
  );
}

function RoomForm({ room, onClose, onSaved }: { room: RoomRow | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ building: room?.building ?? "อาคาร 3", floor: String(room?.floor ?? 1), name: room?.name ?? "", capacity: String(room?.capacity ?? 20), sort: String(room?.sort ?? 0), active: room?.active ?? true });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const { error } = await supabase.rpc("lodging_room_save", { p_id: room?.id ?? null, p_building: f.building, p_floor: Number(f.floor) || 1,
      p_name: f.name, p_capacity: Number(f.capacity) || 1, p_sort: Number(f.sort) || 0, p_active: f.active });
    if (error) setErr(errText(error)); else onSaved();
  };
  return (
    <Modal title={room ? `แก้ไขห้อง ${room.name}` : "เพิ่มห้องพัก"} onClose={onClose}>
      <div className="row2">
        <Field label="อาคาร"><input value={f.building} onChange={set("building")} maxLength={40} /></Field>
        <Field label="ชั้น"><input value={f.floor} onChange={set("floor")} inputMode="numeric" /></Field>
        <Field label="ห้อง"><input value={f.name} onChange={set("name")} maxLength={40} /></Field>
        <Field label="นอนได้ (คน)"><input value={f.capacity} onChange={set("capacity")} inputMode="numeric" /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> ใช้ห้องนี้เป็นที่พัก (ปิด = งดใช้)</label>
      {err && <p className="error">{err}</p>}
      <button className="btn primary big" onClick={save}>บันทึกห้อง</button>
    </Modal>
  );
}
