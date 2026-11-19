import { Camera } from "lucide-react";
import { compressImage } from "../lib/image";
import { errText } from "../lib/supabase";
import type { Pic } from "../lib/upload";

/** เลือก/ถ่ายรูป (ย่อก่อนอัปโหลด) แสดงตัวอย่างและลบได้ */
export function PhotoPicker({ photos, onChange, max = 4, onError }: {
  photos: Pic[]; onChange: (p: Pic[]) => void; max?: number; onError?: (msg: string) => void;
}) {
  const add = async (files: FileList | null) => {
    if (!files) return;
    try {
      const next = [...photos];
      for (const f of Array.from(files).slice(0, max - photos.length)) {
        const blob = await compressImage(f);
        next.push({ blob, url: URL.createObjectURL(blob) });
      }
      onChange(next);
    } catch (e) { onError?.(errText(e)); }
  };
  return (
    <div className="photos">
      {photos.map((p, idx) => (
        <div key={p.url} className="photo">
          <img src={p.url} alt="" />
          <button type="button" className="icon-btn" aria-label="ลบรูป"
            onClick={() => { URL.revokeObjectURL(p.url); onChange(photos.filter((_, j) => j !== idx)); }}>✕</button>
        </div>
      ))}
      {photos.length < max && (
        <label className="photo add">
          <Camera size={26} /><span>เพิ่มรูป</span>
          <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        </label>
      )}
    </div>
  );
}
