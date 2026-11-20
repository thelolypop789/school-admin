import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw } from "lucide-react";
import { canvasToJpeg, fileToJpeg } from "../lib/geo";

/**
 * ถ่ายเซลฟี่จากกล้องสดในแอป (เลือกรูปเก่าจากเครื่องไม่ได้) — ถ้าเบราว์เซอร์ไม่ให้ใช้กล้อง
 * ใช้ input แบบ capture ซึ่งบนมือถือเปิดกล้องหน้าโดยตรง
 */
export function SelfieCamera({ onShot }: { onShot: (blob: Blob, url: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<"live" | "fallback" | "starting">(() => ("getUserMedia" in (navigator.mediaDevices ?? {}) ? "starting" : "fallback"));
  const [shot, setShot] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;
    if (!("getUserMedia" in (navigator.mediaDevices ?? {}))) return;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 } }, audio: false })
      .then((s) => {
        if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); }
        setMode("live");
      })
      .catch(() => alive && setMode("fallback"));
    return () => { alive = false; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const take = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const s = Math.min(1, 900 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
    const g = c.getContext("2d")!;
    g.translate(c.width, 0); g.scale(-1, 1); // ให้ภาพเหมือนกระจก ตรงกับที่เห็นตอนถ่าย
    g.drawImage(v, 0, 0, c.width, c.height);
    const blob = await canvasToJpeg(c);
    const url = URL.createObjectURL(blob);
    setShot(url); onShot(blob, url);
  };

  if (shot) {
    return (
      <div className="selfie">
        <img src={shot} alt="รูปที่ถ่าย" />
        <button type="button" className="btn sm" onClick={() => setShot(null)}><RotateCcw size={16} />ถ่ายใหม่</button>
      </div>
    );
  }
  if (mode === "fallback") {
    return (
      <label className="selfie pick">
        <Camera size={30} /><span>แตะเพื่อเปิดกล้องหน้า</span>
        <input type="file" accept="image/*" capture="user" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (!f) return;
          const blob = await fileToJpeg(f);
          const url = URL.createObjectURL(blob);
          setShot(url); onShot(blob, url);
        }} />
      </label>
    );
  }
  return (
    <div className="selfie">
      <video ref={video} playsInline muted aria-label="ภาพจากกล้องหน้า" />
      <button type="button" className="btn primary" onClick={take} disabled={mode !== "live"}><Camera size={18} />ถ่ายรูป</button>
    </div>
  );
}
