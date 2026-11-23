import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CalendarX, ImagePlus } from "lucide-react";
import { errText } from "../lib/supabase";
import { compressImage } from "../lib/image";
import { dateOf, fmtDate, hhmm } from "../lib/time";
import { KIND, type SessionKind } from "../lib/nst";
import { Field, Modal } from "../components/ui";

type Opt = { kind: "session" | "duty"; id: number; date: string; title: string; time: string; missed: boolean; at: string };
type MyLeave = { id: number; status: "pending" | "approved" | "rejected" | "cancelled"; type: "sick" | "personal"; reason: string; note: string | null;
  kind: "session" | "duty"; title: string; session_kind: SessionKind | null; date: string };

const TYPE = { sick: "ลาป่วย", personal: "ลากิจ" } as const;
const STATUS: Record<MyLeave["status"], { label: string; tone: string }> = {
  pending: { label: "รอ ผกท. อนุมัติ", tone: "info" }, approved: { label: "อนุมัติแล้ว", tone: "ok" },
  rejected: { label: "ไม่อนุมัติ", tone: "bad" }, cancelled: { label: "ยกเลิก", tone: "" },
};
const LEAVE_ERR: Record<string, string> = {
  leave_too_late: "ขอลาย้อนหลังได้ไม่เกิน 3 วัน",
  leave_exists: "ขอลารายการนี้ไปแล้ว",
};
const lerr = (e: unknown) => { const m = (e as { message?: string })?.message ?? ""; for (const [k, v] of Object.entries(LEAVE_ERR)) if (m.includes(k)) return v; return errText(e); };
const t5 = (t: string) => t.slice(0, 5);

/** การลาของนักเรียน: ปุ่มขอลา + คำขอลาล่าสุด */
export function StudentLeave({ sb, uid, onChanged }: { sb: SupabaseClient; uid: string; onChanged: () => void }) {
  const [list, setList] = useState<MyLeave[] | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    const { data, error } = await sb.rpc("nst_my_leaves");
    if (error) setErr(errText(error)); else { setErr(""); setList((data as MyLeave[]) ?? []); }
  }, [sb]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  const cancel = async (id: number) => {
    const { error } = await sb.rpc("nst_leave_cancel", { p_id: id });
    if (error) setErr(errText(error)); else load();
  };
  return (
    <section>
      <div className="section-title"><h2>การลา</h2><button className="btn sm" onClick={() => setOpen(true)}><CalendarX size={16} />ขอลา</button></div>
      <p className="note-line">ลาคาบเช็คชื่อหรือเวรจราจร แนบรูปหลักฐาน (รูปตัวเองก็ได้) ครูผู้กำกับเป็นผู้อนุมัติ · ขอย้อนหลังได้ไม่เกิน 3 วัน</p>
      {err && <p className="error">{err}</p>}
      {list?.slice(0, 5).map((l) => (
        <div key={l.id} className="nst-row muted-row">
          <div className="nst-row-text">
            <b>{TYPE[l.type]} · {fmtDate(l.date, { weekday: "short", day: "numeric", month: "short" })} {l.kind === "duty" ? `เวร ${l.title}` : l.title || (l.session_kind ? KIND[l.session_kind] : "")}</b>
            <small>{l.reason}{l.note ? ` · ครู: ${l.note}` : ""}</small>
          </div>
          {l.status === "pending"
            ? <div className="row"><span className="chip info">{STATUS.pending.label}</span><button className="btn sm" onClick={() => cancel(l.id)}>ยกเลิก</button></div>
            : <span className={`chip ${STATUS[l.status].tone}`}>{STATUS[l.status].label}</span>}
        </div>
      ))}
      {open && <LeaveModal sb={sb} uid={uid} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); onChanged(); }} />}
    </section>
  );
}

function LeaveModal({ sb, uid, onClose, onDone }: { sb: SupabaseClient; uid: string; onClose: () => void; onDone: () => void }) {
  const [opts, setOpts] = useState<Opt[] | null>(null);
  const [pick, setPick] = useState("");
  const [type, setType] = useState<"sick" | "personal">("sick");
  const [reason, setReason] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    sb.rpc("nst_leave_options").then(({ data, error }) => {
      if (error) { setErr(errText(error)); setOpts([]); return; }
      const d = data as { sessions: { id: number; kind: SessionKind; title: string; opens_at: string; closes_at: string; status: string | null }[];
        duties: { id: number; date: string; post: string; starts: string; ends: string; status: string }[] };
      const now = Date.now();
      setOpts([
        ...d.sessions.map((s) => ({ kind: "session" as const, id: s.id, date: dateOf(s.opens_at), title: s.title || KIND[s.kind],
          time: `${hhmm(s.opens_at)}–${hhmm(s.closes_at)}`, missed: s.status === "absent" || new Date(s.closes_at).getTime() < now, at: s.opens_at })),
        ...d.duties.map((x) => ({ kind: "duty" as const, id: x.id, date: x.date, title: `เวร ${x.post}`, time: `${t5(x.starts)}–${t5(x.ends)}`,
          missed: x.status === "missed", at: `${x.date}T${t5(x.starts)}:00+07:00` })),
      ].sort((a, b) => a.at.localeCompare(b.at)));
    });
  }, [sb]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const choose = async (f: File | undefined) => {
    if (!f) return;
    try { const b = await compressImage(f, 1280, 0.72); setPhoto(b); setPreview(URL.createObjectURL(b)); setErr(""); }
    catch { setErr("อ่านรูปไม่ได้ ลองเลือกรูปอื่น"); }
  };
  const send = async () => {
    const o = opts?.find((x) => `${x.kind}:${x.id}` === pick);
    if (!o) { setErr("เลือกคาบหรือเวรที่จะลา"); return; }
    if (!reason.trim()) { setErr("ใส่เหตุผล"); return; }
    if (!photo) { setErr("แนบรูปหลักฐาน"); return; }
    setBusy(true); setErr("");
    try {
      const path = `${uid}/${crypto.randomUUID()}.jpg`;
      const up = await sb.storage.from("nst-photos").upload(path, photo, { contentType: "image/jpeg" });
      if (up.error) throw new Error(`ส่งรูปไม่สำเร็จ: ${errText(up.error)}`);
      const { error } = await sb.rpc("nst_leave_request", { p_kind: o.kind, p_target: o.id, p_type: type, p_reason: reason.trim(), p_photo: path });
      if (error) throw error;
      onDone();
    } catch (e) { setErr(lerr(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title="ขอลา" onClose={onClose}>
      <Field label="ลาอะไร">
        {opts === null ? <div className="spinner" /> : opts.length === 0 ? <p className="muted small">ไม่มีคาบหรือเวรที่ขอลาได้ (ย้อนหลัง 3 วัน ถึงล่วงหน้า 30 วัน)</p> : (
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">— เลือก —</option>
            {opts.map((o) => <option key={`${o.kind}:${o.id}`} value={`${o.kind}:${o.id}`}>
              {fmtDate(o.date, { weekday: "short", day: "numeric", month: "short" })} · {o.title} {o.time}{o.missed ? " (ผ่านไปแล้ว)" : ""}
            </option>)}
          </select>
        )}
      </Field>
      <div className="tabs" role="tablist" aria-label="ประเภทการลา">
        {(["sick", "personal"] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={type === k} className={type === k ? "on" : ""} onClick={() => setType(k)}>{TYPE[k]}</button>)}
      </div>
      <Field label="เหตุผล"><textarea value={reason} maxLength={300} rows={2} onChange={(e) => setReason(e.target.value)} placeholder={type === "sick" ? "เช่น เป็นไข้ ปวดหัว" : "เช่น ไปงานบวชพี่ชาย"} /></Field>
      <Field label="รูปหลักฐาน" hint="รูปตัวเองตอนป่วย ใบรับรองแพทย์ หรือหนังสือผู้ปกครองก็ได้ · เห็นเฉพาะคุณและครูผู้กำกับ ลบเองใน 30 วัน">
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => choose(e.target.files?.[0])} />
        {preview
          ? <button type="button" className="leave-photo" onClick={() => file.current?.click()}><img src={preview} alt="รูปหลักฐานที่เลือก" /><span>เปลี่ยนรูป</span></button>
          : <button type="button" className="btn" onClick={() => file.current?.click()}><ImagePlus size={18} />ถ่ายรูปหรือเลือกรูป</button>}
      </Field>
      {err && <p className="error">{err}</p>}
      <button className="btn primary big" disabled={busy || !opts?.length} onClick={send}>{busy ? "กำลังส่ง…" : "ส่งคำขอลา"}</button>
    </Modal>
  );
}
