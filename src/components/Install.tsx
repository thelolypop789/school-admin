import { useState } from "react";
import { Download, EllipsisVertical, ExternalLink, Share, SquarePlus, X } from "lucide-react";
import { externalBrowserUrl, useInstall } from "../lib/install";
import { Mark } from "./Mark";
import { Modal } from "./ui";

/** ปุ่มติดตั้งแอป: ถ้าเบราว์เซอร์มีหน้าติดตั้งให้เรียกได้ก็เรียกเลย ไม่อย่างนั้นเปิดวิธีทำตามอุปกรณ์ */
export function InstallButton({ className = "btn", label = "ติดตั้งแอปลงมือถือ" }: { className?: string; label?: string }) {
  const ins = useInstall();
  const [help, setHelp] = useState(false);
  if (ins.installed) return null;
  const click = async () => {
    if (ins.canPrompt) { const r = await ins.prompt(); if (r !== "unavailable") return; }
    setHelp(true);
  };
  return (
    <>
      <button type="button" className={className} onClick={click}><Download size={18} />{label}</button>
      {help && <InstallHelp onClose={() => setHelp(false)} />}
    </>
  );
}

/** แถบชวนติดตั้งในหน้าแรก (มือถือที่ยังไม่ได้ติดตั้ง) — ปิดได้ แล้วไม่ถามอีก 30 วัน */
const DISMISS_KEY = "install-nudge-dismissed-at";
export function InstallNudge() {
  const ins = useInstall();
  const [hidden, setHidden] = useState(() => {
    try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < 30 * 86400000; } catch { return false; }
  });
  const mobile = ins.platform !== "desktop";
  if (ins.installed || hidden || (!mobile && !ins.canPrompt)) return null;
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* storage blocked */ } setHidden(true); };
  return (
    <div className="install-nudge">
      <span className="install-icon" aria-hidden><Mark size={30} /></span>
      <span className="install-text"><b>ติดตั้งเป็นแอป</b><small>เปิดจากหน้าจอโฮมได้ทันที</small></span>
      <InstallButton className="btn gold" label="ติดตั้ง" />
      <button className="icon-btn" onClick={dismiss} aria-label="ไม่ใช่ตอนนี้"><X size={16} /></button>
    </div>
  );
}

function InstallHelp({ onClose }: { onClose: () => void }) {
  const { platform } = useInstall();
  return (
    <Modal title="ติดตั้งแอปลงมือถือ" onClose={onClose}>
      <div className="install-help">
        {platform === "line" && (
          <>
            <p>ตอนนี้เปิดอยู่ในแอป LINE ซึ่งติดตั้งแอปไม่ได้ และเข้าสู่ระบบด้วย Google ไม่ได้</p>
            <a className="btn primary big" href={externalBrowserUrl()}><ExternalLink size={18} />เปิดใน Safari / Chrome</a>
            <p className="muted small">เปิดแล้วกดปุ่ม "ติดตั้งแอปลงมือถือ" อีกครั้ง</p>
          </>
        )}
        {platform === "inapp" && (
          <ol className="install-steps">
            <li>กดปุ่ม <b>⋯</b> มุมขวาบน</li>
            <li>เลือก <b>เปิดในเบราว์เซอร์</b> (Safari หรือ Chrome)</li>
            <li>กดปุ่ม <b>ติดตั้งแอปลงมือถือ</b> อีกครั้ง</li>
          </ol>
        )}
        {platform === "ios" && (
          <>
            <ol className="install-steps">
              <li>กดปุ่ม <b>แชร์</b> <Share size={18} className="inline-ic" /> ที่แถบล่างของ Safari (บน iPad อยู่มุมขวาบน)</li>
              <li>เลื่อนลง แล้วกด <b>เพิ่มไปยังหน้าจอโฮม</b> <SquarePlus size={18} className="inline-ic" /></li>
              <li>กด <b>เพิ่ม</b> มุมขวาบน</li>
            </ol>
            <p className="muted small">ต้องเปิดด้วย Safari ถ้าใช้ Chrome บน iPhone ให้กดปุ่มแชร์ที่แถบที่อยู่เว็บแทน</p>
          </>
        )}
        {platform === "android" && (
          <ol className="install-steps">
            <li>กดปุ่ม <b>เมนู</b> <EllipsisVertical size={18} className="inline-ic" /> มุมขวาบนของ Chrome</li>
            <li>กด <b>ติดตั้งแอป</b> หรือ <b>เพิ่มลงในหน้าจอหลัก</b></li>
            <li>กด <b>ติดตั้ง</b></li>
          </ol>
        )}
        {platform === "desktop" && (
          <ol className="install-steps">
            <li>ใช้ Chrome หรือ Edge</li>
            <li>กดไอคอน <b>ติดตั้ง</b> ที่ท้ายช่องที่อยู่เว็บ หรือเมนู ⋮ → <b>ติดตั้ง ระบบจัดการงานบริหารทั่วไป</b></li>
          </ol>
        )}
        <p className="muted small">ติดตั้งแล้วจะเห็นไอคอนสีเบอร์กันดี-ทองบนหน้าจอ เปิดแล้วเต็มจอเหมือนแอปทั่วไป</p>
      </div>
    </Modal>
  );
}
