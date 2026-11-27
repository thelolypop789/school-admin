import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { MapPin, Navigation, Pencil, Phone } from "lucide-react";
import { fmtDate, fmtTime } from "../lib/time";
import { GEO_NOTE, mapsUrl, telHref, VENUE_CAT, VENUE_STATUS, venueLeft, type Venue } from "../lib/lodging";

const VenueMap = lazy(() => import("./VenueMap"));
type Filter = "all" | "confirmed" | "school" | "government" | "hotel";
const FILTERS: [Filter, string][] = [["all", "ทั้งหมด"], ["confirmed", "รับแล้ว"], ["school", "โรงเรียน/วัด"], ["government", "หน่วยงานราชการ"], ["hotel", "โรงแรม/รีสอร์ท"]];
/** จัดกลุ่มตามอำเภอ เรียงกลุ่มตามระยะทางที่ใกล้ที่สุดในกลุ่ม (อำเภอของโรงเรียนขึ้นก่อน) — ที่ไม่ระบุอำเภอไว้ท้าย */
function byDistrict(list: Venue[]): { key: string; label: string; items: Venue[] }[] {
  const m = new Map<string, Venue[]>();
  for (const v of list) { const k = v.district ?? ""; if (!m.has(k)) m.set(k, []); m.get(k)!.push(v); }
  const near = (items: Venue[]) => Math.min(...items.map((v) => (v.is_home ? -1 : v.distance_km ?? 999)));
  return [...m.entries()]
    .map(([key, items]) => ({ key, items, label: key ? `อ.${key}${items[0].province ? ` จ.${items[0].province}` : ""}` : "ไม่ระบุอำเภอ" }))
    .sort((a, b) => (a.key === "") === (b.key === "") ? near(a.items) - near(b.items) : a.key === "" ? 1 : -1);
}
const match = (v: Venue, f: Filter) =>
  v.is_home || f === "all" || (f === "confirmed" ? v.status === "confirmed" : f === "school" ? v.category === "school" || v.category === "temple" : v.category === f);

/** ที่พักรอบโรงเรียน: แผนที่จริง + รายชื่อ (เบอร์โทร/นำทาง) — ใช้ทั้งหน้าโรงเรียน /stay/near และหน้าฝ่าย */
export function NearbyVenues({ venues, editable = false, onMove, onEdit, initialFilter = "all" }: {
  venues: Venue[]; editable?: boolean; onMove?: (id: number, lat: number, lng: number) => void; onEdit?: (v: Venue) => void;
  /** หน้าโรงเรียนเปิดที่ "รับแล้ว" (ที่ขอผ่านระบบได้) ก่อน — ที่เหลือคือรายชื่อติดต่อเอง */
  initialFilter?: Filter;
}) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [sel, setSel] = useState<number | null>(null);
  // ข้อมูลดึงสดทุกครั้งที่โหลด — เวลาที่ได้ข้อมูลชุดนี้ = "ข้อมูล ณ"
  const [asOf, setAsOf] = useState(() => new Date().toISOString());
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setAsOf(new Date().toISOString()); }, [venues]);
  const shown = useMemo(() => venues.filter((v) => match(v, filter)), [venues, filter]);
  const groups = useMemo(() => byDistrict(shown), [shown]);
  const confirmed = venues.filter((v) => v.status === "confirmed");
  const cap = confirmed.reduce((n, v) => n + (v.capacity ?? 0), 0);
  const count = (f: Filter) => venues.filter((v) => !v.is_home && match(v, f)).length;
  return (
    <div className="nearby">
      <p className="nearby-asof">ข้อมูลล่าสุด ณ {fmtDate(asOf, { day: "numeric", month: "long", year: "numeric" })} เวลา {fmtTime(asOf)} น.</p>
      <p className="nearby-sum">ยืนยันรับแล้ว <b>{confirmed.length} แห่ง</b> รับได้รวม <b>{cap.toLocaleString("th-TH")} คน</b> · รายชื่อที่พักอื่นสำหรับติดต่อเองอีก {venues.length - confirmed.length} แห่ง</p>
      <div className="tabs scroll" role="tablist">
        {FILTERS.map(([f, label]) => (
          <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{label} {count(f)}</button>
        ))}
      </div>
      <Suspense fallback={<div className="venue-map loading"><div className="spinner" /></div>}>
        <VenueMap venues={shown} selected={sel} onSelect={setSel} editable={editable} onMove={onMove} />
      </Suspense>
      <p className="muted small vm-key">
        <span><i className="vm-pin home" />โรงเรียนวังหลวงพิทยาสรรพ์</span>
        <span><i className="vm-pin ok" />รับแล้ว (ตัวเลข = ที่ว่าง)</span>
        <span><i className="vm-pin maybe" />ยังไม่ยืนยัน ติดต่อเอง</span>
        <span><i className="vm-pin maybe approx" />ตำแหน่งโดยประมาณ</span>
        {editable && <span>· ลากหมุดเพื่อแก้ตำแหน่ง</span>}
      </p>
      {groups.map((g) => (
      <section key={g.key} className="venue-group">
      <h3 className="venue-group-title">{g.label} <small>{g.items.length} แห่ง</small></h3>
      <ul className="venue-list">
        {g.items.map((v) => {
          const left = venueLeft(v);
          return (
            <li key={v.id} className={`${v.id === sel ? "on" : ""}${v.status === "confirmed" ? " ok" : ""}`}>
              <button className="venue-main" onClick={() => setSel(v.id)}>
                <b>{v.name}</b>
                <small>{[VENUE_CAT[v.category], v.is_home ? "" : v.distance_km != null ? `${v.distance_km} กม.` : "", v.subdistrict && `ต.${v.subdistrict}`, v.district && `อ.${v.district}`].filter(Boolean).join(" · ")}</small>
                {v.contact && <small>{v.contact}</small>}
                {GEO_NOTE[v.geo_precision] && <small className="vm-approx"><MapPin size={12} /> {GEO_NOTE[v.geo_precision]}</small>}
              </button>
              <div className="venue-side">
                {v.is_home ? <span className="chip info">ที่นี่</span>
                  : <span className={`chip ${VENUE_STATUS[v.status].tone}`}>{v.status === "confirmed" && v.capacity != null ? `รับได้ ${v.capacity} · ว่าง ${left}` : VENUE_STATUS[v.status].label}</span>}
                <div className="venue-acts">
                  {[v.phone1, v.phone2].filter(Boolean).map((p) => <a key={p} className="btn sm" href={telHref(p!)}><Phone size={14} />{p}</a>)}
                  <a className="btn sm" href={mapsUrl(v)} target="_blank" rel="noreferrer"><Navigation size={14} />นำทาง</a>
                  {onEdit && <button className="btn sm" onClick={() => onEdit(v)}><Pencil size={14} />แก้ไข</button>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      </section>
      ))}
      <p className="muted small">ภาพดาวเทียมจาก Esri · แผนที่ถนนจาก OpenStreetMap · ระยะทางเป็นระยะทางถนนจากโรงเรียนวังหลวงพิทยาสรรพ์ · เบอร์โทรใช้ประสานเรื่องที่พักงานนี้เท่านั้น</p>
    </div>
  );
}
