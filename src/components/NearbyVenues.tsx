import { lazy, Suspense, useMemo, useState } from "react";
import { MapPin, Navigation, Pencil, Phone } from "lucide-react";
import { GEO_NOTE, mapsUrl, telHref, VENUE_CAT, VENUE_STATUS, venueLeft, type Venue } from "../lib/lodging";

const VenueMap = lazy(() => import("./VenueMap"));
type Filter = "all" | "confirmed" | "school" | "government" | "hotel";
const FILTERS: [Filter, string][] = [["all", "ทั้งหมด"], ["confirmed", "รับแล้ว"], ["school", "โรงเรียน/วัด"], ["government", "หน่วยงานราชการ"], ["hotel", "โรงแรม/รีสอร์ท"]];
const match = (v: Venue, f: Filter) =>
  v.is_home || f === "all" || (f === "confirmed" ? v.status === "confirmed" : f === "school" ? v.category === "school" || v.category === "temple" : v.category === f);

/** ที่พักรอบโรงเรียน: แผนที่จริง + รายชื่อ (เบอร์โทร/นำทาง) — ใช้ทั้งหน้าโรงเรียน /stay/near และหน้าฝ่าย */
export function NearbyVenues({ venues, editable = false, onMove, onEdit }: {
  venues: Venue[]; editable?: boolean; onMove?: (id: number, lat: number, lng: number) => void; onEdit?: (v: Venue) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sel, setSel] = useState<number | null>(null);
  const shown = useMemo(() => venues.filter((v) => match(v, filter)), [venues, filter]);
  const confirmed = venues.filter((v) => v.status === "confirmed");
  const cap = confirmed.reduce((n, v) => n + (v.capacity ?? 0), 0);
  const count = (f: Filter) => venues.filter((v) => !v.is_home && match(v, f)).length;
  return (
    <div className="nearby">
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
      <ul className="venue-list">
        {shown.map((v) => {
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
      <p className="muted small">ภาพดาวเทียมจาก Esri · แผนที่ถนนจาก OpenStreetMap · ระยะทางเป็นระยะทางถนนจากโรงเรียนวังหลวงพิทยาสรรพ์ · เบอร์โทรใช้ประสานเรื่องที่พักงานนี้เท่านั้น</p>
    </div>
  );
}
