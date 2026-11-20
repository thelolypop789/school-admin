import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { navigate } from "../lib/router";
import { addDays, fmtDate, todayISO } from "../lib/time";
import { byTime, loadGaItems, type Item } from "../lib/gaItems";
import { KIND_STYLE } from "../lib/gaKinds";

const DAYS = 7;
const SHORT_DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

/**
 * แผงหน้าแรก "สัปดาห์นี้ของฝ่าย": 7 วันข้างหน้า แต่ละวันมีจุดสีประจำงาน กดวันเพื่อดูรายการ
 * ทุกคนเห็น (ไม่รวมข้อมูลภายใน เช่น วันหมดอายุเอกสารรถ, งานซ่อมที่ยังรอผู้บริหาร, ห้องประชุมซึ่งมีกล่องของตัวเอง)
 */
export function GaUpcoming() {
  const today = todayISO();
  const last = addDays(today, DAYS - 1);
  const [items, setItems] = useState<Item[] | null>(null);
  const [day, setDay] = useState(today);

  useEffect(() => {
    let alive = true;
    loadGaItems(today, last, { docs: false, rooms: false, tentative: false }).then((r) => { if (alive) setItems(r.items); });
    return () => { alive = false; };
  }, [today, last]);

  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i));
  const on = (d: string) => (items ?? []).filter((i) => i.start <= d && i.end >= d).sort(byTime);
  const list = on(day);
  const dow = (d: string) => SHORT_DOW[new Date(`${d}T12:00:00+07:00`).getUTCDay()];

  return (
    <section>
      <div className="section-title">
        <h2>สัปดาห์นี้ของฝ่าย</h2>
        <button className="link" onClick={() => navigate("/calendar")}>ปฏิทิน<ChevronRight size={14} style={{ verticalAlign: "-2px" }} /></button>
      </div>
      <div className="week" role="tablist" aria-label="เลือกวัน">
        {days.map((d) => {
          const kinds = [...new Set(on(d).map((i) => i.kind))].slice(0, 3);
          return (
            <button key={d} role="tab" aria-selected={d === day} className={d === day ? "on" : ""} onClick={() => setDay(d)}
              aria-label={`${fmtDate(d, { weekday: "long", day: "numeric", month: "long" })} ${on(d).length} รายการ`}>
              {d === today ? "วันนี้" : dow(d)}<b>{Number(d.slice(8))}</b>
              <span className="dots">{kinds.map((k) => <i key={k} className={KIND_STYLE[k].mod} />)}</span>
            </button>
          );
        })}
      </div>
      {items === null ? <div className="spinner" /> : list.length === 0 ? (
        <p className="muted small" style={{ margin: ".2rem .2rem 0" }}>{day === today ? "วันนี้" : `วัน${fmtDate(day, { weekday: "long" })}นี้`}ฝ่ายยังไม่มีงานที่กำหนดไว้</p>
      ) : (
        <div className="evs">
          {list.map((i) => {
            const K = KIND_STYLE[i.kind];
            return (
              <button key={i.key} className="ev-row" onClick={() => navigate(i.path ?? "/calendar")}>
                <span className={`gloss sm ${K.mod}`}><K.icon size={16} /></span>
                <span className="ev-text">{i.title}<small>{i.sub || K.label}{i.start !== i.end ? ` · ${fmtDate(i.start, { day: "numeric", month: "short" })} – ${fmtDate(i.end, { day: "numeric", month: "short" })}` : ""}</small></span>
                <time>{i.time ?? (i.start !== i.end ? "หลายวัน" : "ทั้งวัน")}</time>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
