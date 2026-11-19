import { useEffect, useState } from "react";
import { CircleCheck, MessageCircle } from "lucide-react";
import { errText, supabase } from "../lib/supabase";
import { LINE_OA_ID } from "../lib/brand";

/**
 * เชื่อมบัญชี LINE: สร้างรหัส 6 หลัก (15 นาที) → ส่งรหัสในแชท LINE ของโรงเรียน → บอทผูกให้
 * ระหว่างแสดงรหัส ถามสถานะทุก 4 วินาที เพื่อขึ้น "เชื่อมแล้ว" เองเมื่อส่งรหัสสำเร็จ
 */
export function LineLink({ userId, linked, onChange }: { userId: string; linked: boolean; onChange: (linked: boolean) => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!code || linked) return;
    const started = Date.now();
    const t = setInterval(async () => {
      if (Date.now() - started > 15 * 60_000) { clearInterval(t); setCode(null); return; }
      const { data } = await supabase.from("profiles").select("line_linked").eq("id", userId).maybeSingle();
      if (data?.line_linked) { clearInterval(t); setCode(null); onChange(true); }
    }, 4000);
    return () => clearInterval(t);
  }, [code, linked, userId, onChange]);

  const create = async () => {
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("create_line_link_code");
    setBusy(false);
    if (error) setErr(errText(error)); else setCode(data as string);
  };
  const unlink = async () => {
    if (!confirm("ยกเลิกการเชื่อม LINE? จะไม่ได้รับแจ้งเตือนและอนุมัติผ่าน LINE ไม่ได้")) return;
    const { error } = await supabase.rpc("unlink_line");
    if (error) setErr(errText(error)); else onChange(false);
  };

  return (
    <section className="line-link">
      <h3><MessageCircle size={18} /> LINE</h3>
      {linked ? (
        <>
          <p className="ok-line"><CircleCheck size={18} /> เชื่อม LINE แล้ว คำขอที่รอคุณและผลการพิจารณาจะส่งเข้า LINE</p>
          <button type="button" className="link danger" onClick={unlink}>ยกเลิกการเชื่อม</button>
        </>
      ) : code ? (
        <>
          <p className="muted small">ส่งรหัสนี้ในแชท LINE ของโรงเรียน (ใช้ได้ 15 นาที)</p>
          <div className="link-code num" aria-label={`รหัส ${code.split("").join(" ")}`}>{code}</div>
          {LINE_OA_ID ? (
            <div className="form">
              <a className="btn primary big" href={`https://line.me/R/oaMessage/${encodeURIComponent(LINE_OA_ID)}/?${code}`} target="_blank" rel="noreferrer">
                เปิด LINE แล้วส่งรหัส
              </a>
              <p className="muted small">ยังไม่ได้เป็นเพื่อนกับ LINE โรงเรียน? <a href={`https://line.me/R/ti/p/${encodeURIComponent(LINE_OA_ID)}`} target="_blank" rel="noreferrer">เพิ่มเพื่อน {LINE_OA_ID}</a> ก่อน</p>
            </div>
          ) : (
            <p className="muted small">เพิ่มเพื่อน LINE ของโรงเรียน แล้วพิมพ์รหัสนี้ส่งในแชท</p>
          )}
          <p className="muted small">ส่งแล้วหน้านี้จะขึ้น "เชื่อมแล้ว" เอง</p>
        </>
      ) : (
        <>
          <p className="muted small">รับแจ้งเตือนคำขอใช้รถ และกดอนุมัติหรือส่งกลับได้ในแชท LINE</p>
          <button type="button" className="btn" onClick={create} disabled={busy}>{busy ? "กำลังสร้างรหัส…" : "เชื่อม LINE"}</button>
        </>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  );
}
