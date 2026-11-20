import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { errText, supabase } from "../lib/supabase";
import { useMe } from "../lib/me";
import { useSignedUrls } from "../lib/photos";
import { fmtDate, fmtDateTime, todayISO } from "../lib/time";
import {
  CATEGORIES, CATEGORY_LABEL, DECISION_LABEL, isRepairExec, isRepairHead, OPEN_STATUSES, PRIORITIES, PRIORITY, REPAIR_SELECT,
  seesAllRepairPhotos, sortByPriority, STATUS, STEP_SELECT, stepLabel, type Decision, type Priority, type Repair, type RepairStep,
} from "../lib/repair";
import { PhotoPicker } from "../components/PhotoPicker";
import { uploadPics, type Pic } from "../lib/upload";
import { Empty, Field, Modal } from "../components/ui";
import { useNotice } from "../lib/notice";

type Filter = "open" | "mine" | "closed";

const planText = (r: Pick<Repair, "plan_start" | "plan_end">) =>
  !r.plan_start ? "" : r.plan_end && r.plan_end !== r.plan_start ? `${fmtDate(r.plan_start)} – ${fmtDate(r.plan_end)}` : fmtDate(r.plan_start);

/** เรื่องนี้รอ "ฉัน" ทำอะไรอยู่ไหม (หัวหน้างานอาคารฯ: รอลงวันที่ · ผู้บริหาร: รอพิจารณา) */
function waitingForMe(r: Repair, head: boolean, exec: boolean) {
  return (head && r.status === "new") || (exec && r.status === "proposed");
}

export function PriorityChip({ p }: { p: Priority }) {
  return <span className={`chip ${PRIORITY[p].tone}`}>{PRIORITY[p].label}</span>;
}

export type RepairStats = { urgent: number; plan: number; scheduled: number };

/** แจ้งซ่อมงานอาคารสถานที่: ผู้แจ้งเลือกความเร่งด่วน → หัวหน้างานอาคารฯ ลงวันที่ เสนอผู้บริหาร → ผู้บริหารตัดสิน → ซ่อมเสร็จ */
export default function Repairs({ onStats }: { onStats?: (s: RepairStats) => void }) {
  const [notice, say] = useNotice();
  const me = useMe();
  const head = isRepairHead(me), exec = isRepairExec(me);
  const [rows, setRows] = useState<Repair[] | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [form, setForm] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("repair_requests").select(REPAIR_SELECT).order("created_at", { ascending: false }).limit(300);
    if (error) setErr(errText(error)); else setErr("");
    setRows((data as unknown as Repair[]) ?? []);
  }, []);
  // load() ตั้ง state หลัง await (ไม่ใช่ sync) — rule มองไม่เห็นข้าม async function
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const all = rows ?? [];
  useEffect(() => {
    if (!rows || !onStats) return;
    onStats({
      urgent: rows.filter((r) => OPEN_STATUSES.includes(r.status) && r.priority === "urgent").length,
      plan: rows.filter((r) => r.status === "new").length,
      scheduled: rows.filter((r) => r.status === "scheduled").length,
    });
  }, [rows, onStats]);
  const shown = filter === "open" ? sortByPriority(all.filter((r) => OPEN_STATUSES.includes(r.status)))
    : filter === "mine" ? all.filter((r) => r.reported_by === me.id)
    : all.filter((r) => !OPEN_STATUSES.includes(r.status));
  const todo = all.filter((r) => waitingForMe(r, head, exec)).length;
  const opened = all.find((r) => r.id === openId) ?? null;

  return (
    <>
      <div className="tabs scroll">
        <button className={filter === "open" ? "on" : ""} onClick={() => setFilter("open")}>
          กำลังทำ{todo > 0 && <span className="badge">{todo} รอคุณ</span>}
        </button>
        <button className={filter === "mine" ? "on" : ""} onClick={() => setFilter("mine")}>ของฉัน</button>
        <button className={filter === "closed" ? "on" : ""} onClick={() => setFilter("closed")}>เสร็จแล้ว</button>
      </div>
      {err && <p className="error">{err}</p>}

      {rows === null ? <div className="spinner" /> : shown.length === 0 ? (
        <Empty>{filter === "open" ? "ตอนนี้ไม่มีเรื่องแจ้งซ่อมที่ค้างอยู่" : filter === "mine" ? "คุณยังไม่เคยแจ้งซ่อม" : "ยังไม่มีเรื่องที่เสร็จหรือยกเลิก"}</Empty>
      ) : (
        <div className="repair-list">
          {shown.map((r) => (
            <button key={r.id} className={`repair ${r.status === "done" || r.status === "cancelled" ? "closed" : ""}`} onClick={() => setOpenId(r.id)}>
              <span className={`prio-pill p-${OPEN_STATUSES.includes(r.status) ? r.priority : "low"}`}>
                {OPEN_STATUSES.includes(r.status) ? PRIORITY[r.priority].label : r.status === "done" ? "เสร็จ" : "ยกเลิก"}
              </span>
              <span className="rp-body">
                <b>{r.title}</b>
                <span className="small muted">{r.location} · {CATEGORY_LABEL[r.category] ?? r.category} · {fmtDate(r.created_at)}</span>
                <span className="tags">
                  <span className={`chip ${STATUS[r.status].tone}`}>{r.status === "scheduled" && r.plan_start ? `ซ่อม ${planText(r)}` : STATUS[r.status].label}</span>
                  {waitingForMe(r, head, exec) && <span className="chip bad">รอคุณ</span>}
                  {filter !== "mine" && r.reported_by === me.id && <span className="chip">ของฉัน</span>}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <><div className="fab-space" aria-hidden /><button className="fab" aria-label="แจ้งซ่อม" onClick={() => setForm(true)}><Plus size={20} /><span>แจ้งซ่อม</span></button></>
      {form && <RepairForm onClose={() => setForm(false)} onSaved={() => { setForm(false); setFilter("mine"); say("ส่งเรื่องแจ้งซ่อมแล้ว"); load(); }} />}
      {notice}
      {opened && <RepairDetail r={opened} onClose={() => setOpenId(null)} onChanged={load} />}
    </>
  );
}

// ------------------------------------------------------------ แบบฟอร์มแจ้งซ่อม
function RepairForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const me = useMe();
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("electric");
  const [priority, setPriority] = useState<Priority>("normal");
  const [detail, setDetail] = useState("");
  const [photos, setPhotos] = useState<Pic[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr("");
    try {
      const paths = await uploadPics("repair-photos", me.id, photos);
      const { error } = await supabase.rpc("submit_repair", {
        p_title: title, p_detail: detail, p_location: location, p_category: category, p_priority: priority, p_photo_paths: paths,
      });
      if (error) throw error;
      onSaved();
    } catch (x) { setErr(errText(x)); setSaving(false); }
  };

  return (
    <Modal title="แจ้งซ่อม" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="เรื่องที่ต้องซ่อม">
          <input required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น หลอดไฟห้องเรียนดับ ก๊อกน้ำรั่ว" />
        </Field>
        <Field label="สถานที่">
          <input required maxLength={120} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="เช่น อาคาร 2 ห้อง 201, ห้องน้ำชายหลังโรงอาหาร" />
        </Field>
        <Field label="ประเภทงาน">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
        <fieldset className="fs">
          <legend>ความเร่งด่วน</legend>
          <div className="prio-pick">
            {PRIORITIES.map((p) => (
              <label key={p.key} className={priority === p.key ? "on" : ""}>
                <input type="radio" name="prio" checked={priority === p.key} onChange={() => setPriority(p.key)} />
                <span><b>{p.label}</b><small className="muted">{p.hint}</small></span>
              </label>
            ))}
          </div>
          <small className="muted">หัวหน้างานอาคารสถานที่อาจปรับระดับตามความเหมาะสม</small>
        </fieldset>
        <Field label="รายละเอียด (ถ้ามี)">
          <textarea rows={3} maxLength={1000} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="อาการ เกิดขึ้นเมื่อไร มีผลกับใครบ้าง" />
        </Field>
        <div>
          <b>รูปถ่าย</b> <span className="muted small">(ไม่เกิน 4 รูป · ห้ามมีบุคคลในภาพ)</span>
          <PhotoPicker photos={photos} onChange={setPhotos} onError={setErr} />
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn primary big" disabled={saving}>{saving ? "กำลังส่ง…" : "ส่งเรื่องแจ้งซ่อม"}</button>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------ รายละเอียด + การดำเนินการตามบทบาท
function RepairDetail({ r, onClose, onChanged }: { r: Repair; onClose: () => void; onChanged: () => void }) {
  const me = useMe();
  const head = isRepairHead(me), exec = isRepairExec(me);
  const mine = r.reported_by === me.id;
  const canSee = mine || seesAllRepairPhotos(me);
  const urls = useSignedUrls("repair-photos", canSee ? [...r.photo_paths, ...r.done_photo_paths] : []);
  const [steps, setSteps] = useState<RepairStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  // ฟอร์มลงวันที่/เสนอผู้บริหาร
  const [start, setStart] = useState(r.plan_start ?? "");
  const [end, setEnd] = useState(r.plan_end ?? "");
  const [prio, setPrio] = useState<Priority>(r.priority);
  const [proposal, setProposal] = useState(r.proposal ?? "");
  // ฟอร์มปิดงาน
  const [doneNote, setDoneNote] = useState("");
  const [donePics, setDonePics] = useState<Pic[]>([]);

  // เปลี่ยนความเร่งด่วนด้วยตัวเลือกด้านบนแล้ว ให้ฟอร์มเสนอผู้บริหารตามค่าล่าสุด
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPrio(r.priority); }, [r.priority]);

  const loadSteps = useCallback(async () => {
    const { data } = await supabase.from("repair_steps").select(STEP_SELECT).eq("repair_id", r.id).order("created_at");
    setSteps((data as unknown as RepairStep[]) ?? []);
  }, [r.id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadSteps(); }, [loadSteps, r.status, r.priority, r.plan_start]);

  const run = async (fn: () => PromiseLike<{ error: unknown }>, closeAfter = false) => {
    setBusy(true); setErr("");
    try {
      const { error } = await fn();
      if (error) throw error;
      setNote("");
      onChanged();
      if (closeAfter) onClose();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  const propose = (e: React.FormEvent) => {
    e.preventDefault();
    if (!start) return setErr("กรุณาเลือกวันที่ทำได้");
    if (end && end < start) return setErr("วันสิ้นสุดต้องไม่ก่อนวันเริ่ม");
    run(() => supabase.rpc("repair_propose", { p_id: r.id, p_plan_start: start, p_plan_end: end || null, p_priority: prio, p_proposal: proposal }));
  };
  const decide = (d: Decision) => run(() => supabase.rpc("repair_decide", { p_id: r.id, p_decision: d, p_note: note }), true);
  const complete = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const paths = await uploadPics("repair-photos", me.id, donePics);
      const { error } = await supabase.rpc("repair_complete", { p_id: r.id, p_note: doneNote, p_photo_paths: paths });
      if (error) throw error;
      onChanged(); onClose();
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };
  const cancel = () => {
    if (!confirm(`ยกเลิกเรื่อง "${r.title}" ?`)) return;
    run(() => supabase.rpc("repair_cancel", { p_id: r.id, p_note: null }), true);
  };

  const open = OPEN_STATUSES.includes(r.status);
  const photoRow = (paths: string[]) => paths.length > 0 && (
    <div className="photos">{paths.map((p) => urls[p] && <a key={p} className="photo" href={urls[p]} target="_blank" rel="noreferrer"><img src={urls[p]} alt="รูปแจ้งซ่อม" /></a>)}</div>
  );

  return (
    <Modal title={r.title} onClose={onClose}>
      <div className="form">
        <p style={{ margin: 0 }}>
          {open && <PriorityChip p={r.priority} />}<span className={`chip ${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span>
          {open && r.priority !== r.reported_priority && <span className="small muted"> (ผู้แจ้งเลือก: {PRIORITY[r.reported_priority].label})</span>}
        </p>
        {head && open && (
          <Field label="ปรับความเร่งด่วน" hint="เปลี่ยนระดับได้ทันที ไม่ต้องรอผู้บริหารเห็นชอบอีกครั้ง">
            <select value={r.priority} disabled={busy} onChange={(e) => run(() => supabase.rpc("repair_set_priority", { p_id: r.id, p_priority: e.target.value }))}>
              {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </Field>
        )}

        {r.status === "new" && r.exec_decision && (
          <p className="warn-box">
            ผู้บริหาร{DECISION_LABEL[r.exec_decision]}{r.exec_note ? `: ${r.exec_note}` : ""} — ให้หัวหน้างานอาคารสถานที่เสนอวันใหม่
          </p>
        )}

        <dl className="kv">
          <dt>สถานที่</dt><dd>{r.location}</dd>
          <dt>ประเภท</dt><dd>{CATEGORY_LABEL[r.category] ?? r.category}</dd>
          <dt>ผู้แจ้ง</dt><dd>{r.reporter?.full_name || r.reporter?.email} · {fmtDateTime(r.created_at)}</dd>
          {r.detail && <><dt>รายละเอียด</dt><dd>{r.detail}</dd></>}
          {r.plan_start && <><dt>กำหนดซ่อม</dt><dd><b>{planText(r)}</b></dd></>}
          {r.proposal && <><dt>หมายเหตุ</dt><dd>{r.proposal}</dd></>}
          {r.status === "done" && <><dt>ซ่อมเสร็จ</dt><dd>{r.done_at ? fmtDateTime(r.done_at) : ""}{r.done_note ? ` · ${r.done_note}` : ""}</dd></>}
        </dl>
        {photoRow(r.photo_paths)}
        {r.status === "done" && photoRow(r.done_photo_paths)}

        {/* ผู้บริหาร: ตัดสินเมื่อหัวหน้างานเสนอแล้ว */}
        {exec && r.status === "proposed" && (
          <fieldset className="fs">
            <legend>พิจารณา</legend>
            <p className="muted small" style={{ margin: 0 }}>หัวหน้างานอาคารสถานที่เสนอทำวันที่ <b>{planText(r)}</b> — เห็นควรตามที่เสนอ หรือให้ด่วน หรือให้ทำงานอื่นก่อน</p>
            <textarea rows={2} maxLength={500} placeholder="หมายเหตุถึงหัวหน้างาน (ไม่บังคับ)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="row wrap">
              <button className="btn primary" disabled={busy} onClick={() => decide("agree")}>เห็นควรตามที่เสนอ</button>
              <button className="btn" disabled={busy} onClick={() => decide("urgent")}>ให้ด่วน</button>
              <button className="btn" disabled={busy} onClick={() => decide("defer")}>ให้ทำงานอื่นก่อน</button>
            </div>
          </fieldset>
        )}

        {/* หัวหน้างานอาคารสถานที่: ลงวันที่ เสนอผู้บริหาร / ปิดงาน */}
        {head && open && (
          <form className="fs" onSubmit={propose}>
            <legend>{r.status === "scheduled" ? "เลื่อนวันซ่อม (ให้ผู้บริหารเห็นชอบใหม่)" : r.status === "proposed" ? "แก้ไขข้อเสนอ" : "ลงวันที่ทำได้ เสนอผู้บริหาร"}</legend>
            <div className="row2">
              <Field label="วันที่เริ่ม"><input type="date" min={todayISO()} value={start} onChange={(e) => setStart(e.target.value)} required /></Field>
              <Field label="ถึงวันที่ (ถ้าหลายวัน)"><input type="date" min={start || todayISO()} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
            </div>
            <Field label="ความเร่งด่วน">
              <select value={prio} onChange={(e) => setPrio(e.target.value as Priority)}>
                {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="หมายเหตุถึงผู้บริหาร (ไม่บังคับ)">
              <textarea rows={2} maxLength={500} value={proposal} onChange={(e) => setProposal(e.target.value)} placeholder="เช่น รอวัสดุ 2 วัน, ช่างว่างวันพฤหัส" />
            </Field>
            <button className="btn primary" disabled={busy}>{r.status === "scheduled" ? "เสนอวันใหม่" : r.status === "proposed" ? "บันทึกข้อเสนอ" : "เสนอผู้บริหาร"}</button>
          </form>
        )}
        {head && r.status === "scheduled" && (
          <form className="fs" onSubmit={complete}>
            <legend>ซ่อมเสร็จแล้ว</legend>
            <textarea rows={2} maxLength={500} placeholder="ผลการซ่อม เช่น เปลี่ยนหลอดไฟ 2 หลอด (ไม่บังคับ)" value={doneNote} onChange={(e) => setDoneNote(e.target.value)} />
            <PhotoPicker photos={donePics} onChange={setDonePics} onError={setErr} />
            <button className="btn primary" disabled={busy}>บันทึกซ่อมเสร็จ</button>
          </form>
        )}

        {err && <p className="error">{err}</p>}
        {((mine && r.status === "new") || (head && open)) && (
          <button className="link danger" disabled={busy} onClick={cancel}>ยกเลิกเรื่องนี้</button>
        )}

        <section>
          <b>ประวัติ</b>
          <ul className="steps">
            {steps.map((s) => (
              <li key={s.id} className={s.action === "cancel" ? "ret" : ""}>
                <b>{stepLabel(s.action)}</b>{s.channel === "line" && <span className="chip">ทาง LINE</span>}
                <div className="small muted">{s.actor?.full_name || s.actor?.email || "-"} · {fmtDateTime(s.created_at)}{s.note ? ` · ${s.action === "priority" ? PRIORITY[s.note as Priority]?.label ?? s.note : s.note}` : ""}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  );
}

