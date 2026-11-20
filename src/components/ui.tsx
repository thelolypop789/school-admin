import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);
  // portal ไปที่ body: หน้าอยู่ใน stacking context ของ .shell (z-index 1) ถ้าไม่ portal แถบเมนูล่างบนมือถือจะทับหน้าต่าง
  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="ปิด">✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function DateNav({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const shift = (n: number) => {
    const d = new Date(`${date}T12:00:00+07:00`);
    d.setUTCDate(d.getUTCDate() + n);
    onChange(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d));
  };
  return (
    <div className="datenav">
      <button className="btn" onClick={() => shift(-1)} aria-label="วันก่อนหน้า">‹</button>
      <input type="date" value={date} onChange={(e) => e.target.value && onChange(e.target.value)} />
      <button className="btn" onClick={() => shift(1)} aria-label="วันถัดไป">›</button>
    </div>
  );
}

/** แถบเวลา 07:00–19:00 แสดงช่วงที่ถูกจอง */
export function Timeline({ items, day, from = 7, to = 19 }: {
  items: { id: number | string; starts_at: string; ends_at: string; label: string; tone?: "busy" | "pending" }[];
  day: [string, string];
  from?: number; to?: number;
}) {
  const span = (to - from) * 60;
  const dayStart = new Date(day[0]).getTime();
  // นาทีนับจากเที่ยงคืน (เวลาไทย) ของวันที่แสดง → % ของแถบ
  const pos = (iso: string) => {
    const mins = Math.max(0, Math.min(24 * 60, (new Date(iso).getTime() - dayStart) / 60000)) - from * 60;
    return Math.max(0, Math.min(100, (mins / span) * 100));
  };
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return (
    <div className="timeline">
      <div className="tl-track">
        {items.map((it) => {
          const l = pos(it.starts_at), r = pos(it.ends_at);
          if (r <= l) return null;
          return (
            <div key={it.id} className={`tl-block ${it.tone ?? "busy"}`} style={{ left: `${l}%`, width: `${r - l}%` }} title={it.label} />
          );
        })}
      </div>
      <div className="tl-hours">
        {hours.filter((h) => h % 2 === 1).map((h) => (
          <span key={h} style={{ left: `${((h - from) / (to - from)) * 100}%` }}>{String(h).padStart(2, "0")}</span>
        ))}
      </div>
    </div>
  );
}

export function StatusChip({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    confirmed: ["ยืนยันแล้ว", "ok"],
    pending: ["รอหัวหน้างานยานพาหนะ", "warn"],
    returned: ["ส่งกลับให้แก้ไข", "bad"],
    pending_deputy: ["รอรอง ผอ.", "warn"],
    pending_director: ["รอ ผอ.", "warn"],
    approved: ["อนุมัติแล้ว", "ok"],
    on_trip: ["กำลังเดินทาง", "warn"],
    completed: ["ปิดงานแล้ว", "mute"],
    rejected: ["ไม่อนุมัติ", "bad"],
    cancelled: ["ยกเลิก", "mute"],
  };
  const [label, tone] = map[status] ?? [status, "mute"];
  return <span className={`chip ${tone}`}>{label}</span>;
}

export type Tone = "rooms" | "vehicles" | "toilets" | "admin" | "brand";

/** หัวหน้า: ชื่อหน้า + บอกว่าหน้านี้ทำอะไร + ปุ่มหลักของหน้า (icon/tone เก็บไว้ให้ผู้เรียกเดิม ยังไม่ได้แสดง) */
export function PageHeader(props: {
  icon?: LucideIcon; tone?: Tone; title: string; desc?: ReactNode; children?: ReactNode;
}) {
  const { title, desc, children } = props;
  return (
    <header className="page-head">
      <div className="ph-text">
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {children && <div className="ph-actions">{children}</div>}
    </header>
  );
}

/** หัวหน้าแบบแผ่นสีประจำงาน (mod = c-room/c-car/c-fix/c-wc/c-ga) + ตัวเลขสรุป + ปุ่ม/แท็บใน children */
export function ModuleHero({ mod, icon: Icon, title, desc, stats, children }: {
  mod: string; icon: LucideIcon; title: string; desc?: ReactNode;
  stats?: { n: ReactNode; label: string }[]; children?: ReactNode;
}) {
  return (
    <header className={`mhero ${mod}`}>
      <Icon size={64} strokeWidth={1.5} className="mh-ic" aria-hidden />
      <h1>{title}</h1>
      {desc && <p>{desc}</p>}
      {stats && stats.length > 0 && (
        <div className="mh-stats" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }} aria-live="polite">
          {stats.map((x) => <div key={x.label}><b>{x.n}</b>{x.label}</div>)}
        </div>
      )}
      {children && <div className="mh-actions">{children}</div>}
    </header>
  );
}
