import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, Copy, MapPin, Phone, RefreshCw, Siren, X } from "lucide-react";
import { Field } from "../components/ui";
import { MapPicker } from "../components/MapPicker";
import type { Pt } from "../campus/campus3d";
import { compressImage } from "../lib/image";
import { fmtDateTime } from "../lib/time";
import { EMERGENCY, INCIDENT, INCIDENT_ORDER, INCIDENT_STATUS, type IncidentCategory, type IncidentStatus } from "../lib/incident";
import { call, go, loadList, saveList } from "./api";

const SAVED = "stay-incidents";
const ME = "stay-reporter";
type Saved = { ref: string; category: IncidentCategory; location: string; at: string };
type Status = {
  ref: string; category: IncidentCategory; location: string; detail: string | null; status: IncidentStatus; staff_note: string | null;
  created_at: string; acknowledged_at: string | null; resolved_at: string | null; event_name: string;
};
const ERRS = { not_found: "ตอนนี้ยังไม่มีงานที่เปิดรับแจ้งเหตุ ติดต่อเจ้าหน้าที่ของโรงเรียนโดยตรง", bad_request: "กรอกให้ครบ: ประเภท จุดที่เกิดเหตุ ชื่อ และเบอร์โทร 9–10 หลัก" };

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]+,/, ""));
    r.onerror = () => reject(new Error("อ่านรูปไม่สำเร็จ"));
    r.readAsDataURL(b);
  });
}

function Emergency() {
  return (
    <div className="inc-sos" role="note">
      <b>มีคนบาดเจ็บสาหัส ไฟไหม้ หรือเหตุร้าย — โทรทันที ไม่ต้องรอแบบฟอร์ม</b>
      <div className="row wrap">
        {EMERGENCY.map((e) => <a key={e.n} className="btn sm" href={`tel:${e.n}`}><Phone size={14} />{e.n} {e.label}</a>)}
      </div>
    </div>
  );
}

/** /stay/report — แจ้งเหตุระหว่างงาน (คนที่มาพัก/มาแข่ง ไม่ต้องมีบัญชี) */
export function ReportView() {
  const from = new URLSearchParams(window.location.search).get("from") ?? "";
  const remembered = (() => { try { return JSON.parse(localStorage.getItem(ME) ?? "{}"); } catch { return {}; } })() as { name?: string; phone?: string };
  const [cat, setCat] = useState<IncidentCategory | null>(null);
  const [f, setF] = useState({ location: "", detail: "", name: remembered.name ?? "", phone: remembered.phone ?? "", website: "" });
  const [pin, setPin] = useState<Pt | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [photo, setPhoto] = useState<{ b64: string; url: string } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const mine = loadList<Saved>(SAVED);

  // มาจากลิงก์ติดตามคำขอที่พัก → เติมชื่อผู้ประสานงานให้ (ไม่มีเบอร์ในสถานะ ต้องกรอกเอง)
  useEffect(() => {
    if (!/^[0-9A-Fa-f]{12}$/.test(from) || remembered.name) return;
    call<{ contact_name: string }>({ action: "status", ref: from })
      .then((s) => setF((x) => (x.name ? x : { ...x, name: s.contact_name })))
      .catch(() => { /* ไม่พบก็ไม่เป็นไร */ });
  }, [from, remembered.name]);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const blob = await compressImage(file, 1280, 0.7);
      if (photo) URL.revokeObjectURL(photo.url);
      setPhoto({ b64: await blobToBase64(blob), url: URL.createObjectURL(blob) });
    } catch { setErr("อ่านรูปไม่สำเร็จ ลองรูปอื่น"); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!cat) { setErr("เลือกประเภทเหตุก่อน"); return; }
    if (f.location.trim().length < 2) { setErr("บอกจุดที่เกิดเหตุ เช่น อาคาร ห้อง หรือประตู"); return; }
    if (!/^0\d{8,9}$/.test(f.phone.replace(/\D/g, ""))) { setErr("เบอร์โทรไม่ถูกต้อง (เช่น 0812345678) เจ้าหน้าที่จะโทรกลับเบอร์นี้"); return; }
    setBusy(true);
    try {
      const r = await call<{ ref: string }>({
        action: "report", category: cat, location: f.location, detail: f.detail, name: f.name, phone: f.phone,
        x: pin?.[0] ?? null, y: pin?.[1] ?? null, request_ref: from || null, photo: photo?.b64 ?? null, website: f.website,
      }, ERRS);
      try { localStorage.setItem(ME, JSON.stringify({ name: f.name.trim(), phone: f.phone.trim() })); } catch { /* storage blocked */ }
      saveList(SAVED, [{ ref: r.ref, category: cat, location: f.location.trim(), at: new Date().toISOString() }, ...mine.filter((x) => x.ref !== r.ref)].slice(0, 10));
      go(`/stay/report/${r.ref}`);
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };

  const hint = cat ? INCIDENT[cat] : null;
  return (
    <main className="stay-main c-alert">
      <section className="mhero c-alert">
        <Siren size={64} strokeWidth={1.5} className="mh-ic" aria-hidden />
        <h1>แจ้งเหตุ / ขอความช่วยเหลือ</h1>
        <p>สำหรับคนที่มาพักหรือมาแข่งขันที่โรงเรียน · ส่งแล้วถึงเจ้าหน้าที่ทาง LINE ทันที และได้ลิงก์ติดตามว่ารับเรื่องหรือยัง</p>
      </section>
      <Emergency />
      <form className="card form inc-form" onSubmit={submit}>
        <fieldset className="inc-cats">
          <legend>เกิดอะไรขึ้น</legend>
          <div className="inc-grid" role="radiogroup" aria-label="ประเภทเหตุ">
            {INCIDENT_ORDER.map((k) => {
              const C = INCIDENT[k];
              return (
                <button key={k} type="button" role="radio" aria-checked={cat === k} className={`inc-cat${cat === k ? " on" : ""}`} onClick={() => setCat(k)}>
                  <C.icon size={26} aria-hidden /><span>{C.label}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <Field label="จุดที่เกิดเหตุ"><input id="inc-location" value={f.location} onChange={set("location")} required minLength={2} maxLength={200} placeholder={hint?.where ?? "อาคาร ห้อง ประตู หรือสนาม"} /></Field>
        {showMap ? (
          <div className="inc-map">
            <MapPicker value={pin} onChange={setPin} label="จุดเกิดเหตุ" hint="แตะบนแผนที่ตรงจุดที่เกิดเหตุ" />
            <button type="button" className="link" onClick={() => { setShowMap(false); setPin(null); }}>ไม่ปักหมุด</button>
          </div>
        ) : <button type="button" className="btn sm inc-pin" onClick={() => setShowMap(true)}><MapPin size={16} />ปักหมุดบนแผนที่โรงเรียน (ไม่บังคับ)</button>}
        <Field label="รายละเอียด (ถ้ามี)"><textarea id="inc-detail" rows={3} value={f.detail} onChange={set("detail")} maxLength={1000} placeholder={hint?.what ?? "เล่าสั้นๆ ว่าเกิดอะไรขึ้น"} /></Field>
        <div className="inc-photo">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
          {photo ? (
            <span className="inc-thumb">
              <img src={photo.url} alt="รูปประกอบ" />
              <button type="button" className="btn sm" onClick={() => { URL.revokeObjectURL(photo.url); setPhoto(null); }}><X size={14} />ลบรูป</button>
            </span>
          ) : <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}><Camera size={16} />แนบรูป (ไม่บังคับ)</button>}
          <small className="muted">เช่น จุดที่น้ำรั่ว หรือทะเบียนรถที่ขวาง · ไม่ต้องถ่ายหน้าคน</small>
        </div>
        <div className="row2">
          <Field label="ชื่อผู้แจ้ง"><input id="inc-name" value={f.name} onChange={set("name")} required minLength={2} maxLength={80} autoComplete="name" /></Field>
          <Field label="เบอร์โทรกลับ"><input id="inc-phone" value={f.phone} onChange={set("phone")} required inputMode="tel" autoComplete="tel" maxLength={20} /></Field>
        </div>
        <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden value={f.website} onChange={set("website")} name="website" />
        {err && <p className="error">{err}</p>}
        <button type="submit" className="btn primary big" disabled={busy}>{busy ? "กำลังส่ง…" : "ส่งแจ้งเหตุ"}</button>
        <p className="muted small">เบอร์โทรเห็นเฉพาะเจ้าหน้าที่ของโรงเรียน ใช้โทรกลับเรื่องนี้เท่านั้น</p>
      </form>
      {mine.length > 0 && (
        <section className="card stay-mine">
          <h2>เรื่องที่แจ้งจากเครื่องนี้</h2>
          {mine.map((x) => (
            <button key={x.ref} className="link stay-myref" onClick={() => go(`/stay/report/${x.ref}`)}>
              {INCIDENT[x.category]?.label ?? "แจ้งเหตุ"} · {x.location} · {fmtDateTime(x.at)}
            </button>
          ))}
        </section>
      )}
      <button className="link" onClick={() => go("/stay")}>← กลับหน้าขอที่พัก</button>
    </main>
  );
}

/** /stay/report/<รหัส> — ผู้แจ้งดูว่าเจ้าหน้าที่รับเรื่อง/แก้แล้วหรือยัง (รีเฟรชเองทุก 30 วินาทีจนกว่าจะแก้เสร็จ) */
export function ReportStatus({ refCode }: { refCode: string }) {
  const [s, setS] = useState<Status | null | undefined>(undefined);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setS(await call<Status>({ action: "report_status", ref: refCode })); setErr(""); }
    catch (e) { setErr((e as Error).message); setS((x) => x ?? null); }
    finally { setBusy(false); }
  }, [refCode]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!s || s.status === "resolved") return;
    const t = window.setInterval(load, 30_000);
    return () => window.clearInterval(t);
  }, [s, load]);
  if (s === undefined) return <div className="spinner" />;
  if (s === null) return <section className="card"><p className="error">{err || "ไม่พบเรื่องนี้"}</p><button className="btn" onClick={() => go("/stay/report")}>แจ้งเหตุใหม่</button></section>;
  const st = INCIDENT_STATUS[s.status];
  const C = INCIDENT[s.category] ?? INCIDENT.other;
  const steps = [
    { label: "ส่งแจ้งเหตุแล้ว", at: s.created_at, done: true },
    { label: "เจ้าหน้าที่รับเรื่อง", at: s.acknowledged_at, done: !!s.acknowledged_at },
    { label: "แก้ไขเรียบร้อย", at: s.resolved_at, done: !!s.resolved_at },
  ];
  return (
    <main className="stay-main c-alert">
      <section className="card stay-status inc-status">
        <p className="muted small">{s.event_name} · แจ้งเมื่อ {fmtDateTime(s.created_at)}</p>
        <h1><C.icon size={26} aria-hidden /> {C.label}</h1>
        <p><b>ที่:</b> {s.location}</p>
        {s.detail && <p className="muted">{s.detail}</p>}
        <p className={`chip ${st.tone}`}>{st.public}</p>
        <ol className="inc-steps">
          {steps.map((x) => (
            <li key={x.label} className={x.done ? "done" : ""}>
              <span className="dot">{x.done && <Check size={14} />}</span>
              <span><b>{x.label}</b>{x.at && <small>{fmtDateTime(x.at)}</small>}</span>
            </li>
          ))}
        </ol>
        {s.staff_note && <p className="inc-note"><b>จากเจ้าหน้าที่:</b> {s.staff_note}</p>}
        {s.status === "new" && <p className="muted small">ถ้าด่วนมากและยังไม่มีใครรับเรื่องใน 10 นาที แจ้งเจ้าหน้าที่ที่โต๊ะต้อนรับ</p>}
        <div className="row wrap">
          <button className="btn" onClick={load} disabled={busy}><RefreshCw size={16} />{busy ? "กำลังโหลด…" : "อัปเดตสถานะ"}</button>
          <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { /* blocked */ } }}><Copy size={16} />{copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}</button>
          <button className="btn" onClick={() => go("/stay/report")}><Siren size={16} />แจ้งเรื่องอื่น</button>
        </div>
        {err && <p className="error">{err}</p>}
      </section>
      <Emergency />
    </main>
  );
}
