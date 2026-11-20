import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

/** ข้อความแจ้งผลสั้นๆ หลังทำรายการสำเร็จ (หายเอง 4 วินาที) — ใช้: const [notice, say] = useNotice(); say("ส่งคำขอแล้ว"); แล้วใส่ {notice} ในหน้า */
export function useNotice(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(""), 4000);
    return () => window.clearTimeout(t);
  }, [msg]);
  return [msg ? createPortal(<div className="toast" role="status" onClick={() => setMsg("")}><Check size={18} />{msg}</div>, document.body) : null, setMsg];
}
