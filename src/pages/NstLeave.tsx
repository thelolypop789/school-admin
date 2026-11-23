import { useCallback, useEffect, useState } from "react";
import { errText, supabase } from "../lib/supabase";
import { useSignedUrls } from "../lib/photos";
import { fmtDate, fmtDateTime, hhmm } from "../lib/time";
import { groupLabel, KIND, type Session, type Student } from "../lib/nst";
import { Modal } from "../components/ui";

type Leave = { id: number; student_id: number; session_id: number | null; duty_id: number | null; leave_type: "sick" | "personal";
  reason: string; photo_path: string; status: string; created_at: string };
type DutyRow = { id: number; duty_date: string; post_id: number; status: string };
const TYPE = { sick: "ลาป่วย", personal: "ลากิจ" } as const;

/** คำขอลาที่รอ ผกท. อนุมัติ (แสดงบนแท็บ วันนี้) — ผู้บริหารดูได้อย่างเดียว */
export function LeavePending({ staff, onChanged }: { staff: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<Leave[]>([]);
  const [ctx, setCtx] = useState<{ st: Map<number, Student>; ss: Map<number, Session>; du: Map<number, DutyRow>; po: Map<number, string> }>(
    { st: new Map(), ss: new Map(), du: new Map(), po: new Map() });
  const [photo, setPhoto] = useState<string | null>(null);
  const [reject, setReject] = useState<Leave | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("nst_leaves").select("*").eq("status", "pending").order("created_at");
    if (error) { setErr(errText(error)); return; }
    const ls = (data as Leave[]) ?? [];
    const sIds = [...new Set(ls.map((l) => l.student_id))], ssIds = ls.flatMap((l) => (l.session_id ? [l.session_id] : [])), dIds = ls.flatMap((l) => (l.duty_id ? [l.duty_id] : []));
    const [st, ss, du] = await Promise.all([
      sIds.length ? supabase.from("nst_students").select("id,full_name,class_room,nst_year,group_name").in("id", sIds) : { data: [] },
      ssIds.length ? supabase.from("nst_sessions").select("*").in("id", ssIds) : { data: [] },
      dIds.length ? supabase.from("nst_duties").select("id,duty_date,post_id,status").in("id", dIds) : { data: [] },
    ]);
    const duties = (du.data as DutyRow[]) ?? [];
    const pIds = [...new Set(duties.map((d) => d.post_id))];
    const po = pIds.length ? await supabase.from("nst_posts").select("id,name").in("id", pIds) : { data: [] };
    setCtx({
      st: new Map(((st.data as Student[]) ?? []).map((x) => [x.id, x])),
      ss: new Map(((ss.data as Session[]) ?? []).map((x) => [x.id, x])),
      du: new Map(duties.map((x) => [x.id, x])),
      po: new Map(((po.data as { id: number; name: string }[]) ?? []).map((x) => [x.id, x.name])),
    });
    setRows(ls); setErr("");
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  const urls = useSignedUrls("nst-photos", rows.map((r) => r.photo_path));

  const decide = async (l: Leave, ok: boolean, n = "") => {
    const { error } = await supabase.rpc("nst_leave_decide", { p_id: l.id, p_approve: ok, p_note: n || null });
    if (error) setErr(/not_pending/.test(error.message) ? "คำขอนี้ถูกพิจารณาไปแล้ว" : /already/.test(error.message) ? "นักเรียนรายงานตัวไปแล้ว อนุมัติลาไม่ได้" : errText(error));
    setReject(null); setNote(""); load(); onChanged();
  };

  if (!rows.length && !err) return null;
  return (
    <section>
      <div className="section-title"><h2>คำขอลารออนุมัติ ({rows.length})</h2></div>
      {err && <p className="error">{err}</p>}
      <div className="card nst-list">
        {rows.map((l) => {
          const s = ctx.st.get(l.student_id);
          const x = l.session_id ? ctx.ss.get(l.session_id) : undefined;
          const d = l.duty_id ? ctx.du.get(l.duty_id) : undefined;
          const what = x ? `${fmtDate(x.opens_at, { weekday: "short", day: "numeric", month: "short" })} · ${x.title || KIND[x.kind]} ${hhmm(x.opens_at)}`
            : d ? `${fmtDate(d.duty_date, { weekday: "short", day: "numeric", month: "short" })} · เวร ${ctx.po.get(d.post_id) ?? ""}` : "";
          return (
            <div key={l.id} className="nst-person">
              {urls[l.photo_path]
                ? <button className="nst-thumb" onClick={() => setPhoto(urls[l.photo_path])} aria-label={`ดูรูปหลักฐานของ ${s?.full_name ?? ""}`}><img src={urls[l.photo_path]} alt="" /></button>
                : <span className="nst-thumb empty" aria-hidden />}
              <span className="nst-person-text">
                <b>{s?.full_name ?? "?"} · {TYPE[l.leave_type]}</b>
                <small>{what}</small>
                <small>“{l.reason}” · {s?.class_room}{s?.group_name ? ` · ${groupLabel(s.group_name)}` : ""} · ขอเมื่อ {fmtDateTime(l.created_at)}</small>
              </span>
              {staff && <div className="row"><button className="btn sm" onClick={() => setReject(l)}>ไม่อนุมัติ</button><button className="btn primary sm" onClick={() => decide(l, true)}>อนุมัติ</button></div>}
            </div>
          );
        })}
      </div>
      {photo && <Modal title="รูปหลักฐานการลา" onClose={() => setPhoto(null)}><img src={photo} alt="รูปหลักฐานการลา" style={{ width: "100%", borderRadius: 12 }} /></Modal>}
      {reject && (
        <Modal title="ไม่อนุมัติการลา" onClose={() => setReject(null)}>
          <p className="muted small">นักเรียนจะเห็นเหตุผลนี้ในแอป สถานะคาบหรือเวรยังเหมือนเดิม</p>
          <textarea value={note} maxLength={300} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="เช่น รูปไม่ชัด ส่งใหม่" aria-label="เหตุผลที่ไม่อนุมัติ" />
          <button className="btn primary big" onClick={() => decide(reject, false, note)}>ยืนยันไม่อนุมัติ</button>
        </Modal>
      )}
    </section>
  );
}
