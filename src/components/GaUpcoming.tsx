import { useEffect, useState } from "react";
import { CalendarDays, CarFront, ChevronRight, Wrench, type LucideIcon } from "lucide-react";
import { navigate } from "../lib/router";
import { addDays, fmtDate, todayISO } from "../lib/time";
import { byTime, loadGaItems, type Item, type Kind } from "../lib/gaItems";

const ICON: Partial<Record<Kind, { icon: LucideIcon; label: string }>> = {
  repair: { icon: Wrench, label: "งานซ่อม" },
  trip: { icon: CarFront, label: "รถไปราชการ" },
  event: { icon: CalendarDays, label: "กิจกรรมฝ่าย" },
};
const DAYS = 7;
const MAX = 8;

/** แผงหน้าแรก: งานของฝ่ายบริหารทั่วไป 7 วันข้างหน้า ให้บุคลากรทุกคนเห็นว่าฝ่ายกำลังทำอะไร (ไม่รวมข้อมูลภายใน เช่น วันหมดอายุเอกสารรถ) */
export function GaUpcoming() {
  const today = todayISO();
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    let alive = true;
    loadGaItems(today, addDays(today, DAYS - 1), { docs: false, rooms: false, tentative: false }).then((r) => { if (alive) setItems(r.items); });
    return () => { alive = false; };
  }, [today]);

  const last = addDays(today, DAYS - 1);
  // แสดงที่วันเริ่มของงาน (ถ้าเริ่มก่อนวันนี้ แสดงที่วันนี้) เรียงตามวัน แล้วตามเวลา
  const shown = (items ?? []).filter((i) => i.start <= last && i.end >= today)
    .map((i) => ({ i, day: i.start < today ? today : i.start }))
    .sort((a, b) => a.day.localeCompare(b.day) || byTime(a.i, b.i));
  const rows = shown.slice(0, MAX);
  const dayLabel = (d: string) => (d === today ? "วันนี้" : d === addDays(today, 1) ? "พรุ่งนี้" : fmtDate(d, { weekday: "short", day: "numeric", month: "short" }));

  return (
    <section className="card">
      <div className="row between wrap">
        <h3 style={{ margin: 0 }}>งานฝ่ายบริหารทั่วไป · 7 วันข้างหน้า</h3>
        <button className="link" onClick={() => navigate("/facilities/calendar")}>ดูปฏิทินทั้งหมด<ChevronRight size={14} style={{ verticalAlign: "-2px" }} /></button>
      </div>
      {items === null ? <div className="spinner" /> : rows.length === 0 ? (
        <p className="muted small">ยังไม่มีงานที่กำหนดไว้ใน 7 วันนี้</p>
      ) : (
        <ul className="agenda">
          {rows.map(({ i, day }) => {
            const K = ICON[i.kind];
            const multi = i.start !== i.end;
            return (
              <li key={i.key} className={i.path ? "clickable" : ""} onClick={i.path ? () => navigate(i.path!) : undefined}>
                <time>{dayLabel(day)}<small>{i.time ?? (multi ? "หลายวัน" : "ทั้งวัน")}</small></time>
                <span className="ag-what">
                  {K && <span className="ag-kind tone-brand"><K.icon size={12} />{K.label}</span>}
                  {i.title}
                  <span className="ag-sub">{[i.sub, multi ? `${fmtDate(i.start, { day: "numeric", month: "short" })} – ${fmtDate(i.end, { day: "numeric", month: "short" })}` : ""].filter(Boolean).join(" · ")}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > MAX && <p className="muted small" style={{ marginBottom: 0 }}>และอีก {shown.length - MAX} รายการ ดูในปฏิทิน</p>}
    </section>
  );
}
