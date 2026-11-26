import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { PencilRuler, Undo2, X } from "lucide-react";
import type { Pt, ZoneShape } from "../campus/campus3d";
import { free, type RoomUse } from "../lib/lodging";

const CampusMap = lazy(() => import("./CampusMap"));
export type LodgingBuilding = { name: string; poly: Pt[] };

const loading = <div className="campus3d loading"><div className="spinner" /><p>กำลังสร้างแผนที่ 3 มิติ…</p></div>;
// สีตามที่ว่างของทั้งอาคาร: ว่างมาก (เขียว) · ใกล้เต็ม (ทอง) · เต็ม (เทา)
const tone = (left: number, cap: number) => (left === 0 ? "#8b8f98" : left / cap < 0.25 ? "#d9a520" : "#2f9e55");

/** อาคารที่เป็นที่พักบนแผนที่ 3 มิติ: แผ่นสีตามที่ว่าง + ป้าย "ว่าง n ที่" · แตะอาคารเพื่อเลือก (ดูห้องของอาคารนั้น) */
export function LodgingMap({ rooms, buildings, selected, onPick }: {
  rooms: RoomUse[]; buildings: LodgingBuilding[]; selected: string | null; onPick: (name: string | null) => void;
}) {
  const zones: ZoneShape[] = useMemo(() => buildings.map((b, i) => {
    const rs = rooms.filter((r) => r.building === b.name);
    const cap = rs.reduce((n, r) => n + r.capacity, 0), left = rs.reduce((n, r) => n + free(r), 0);
    const sub = cap ? (left ? `ว่าง ${left}/${cap} ที่` : "เต็ม") : "ไม่มีห้องพัก";
    return { id: i + 1, poly: b.poly, color: tone(left, cap || 1), label: b.name, sub, aria: `${b.name} ${sub}`, dim: !cap };
  }), [rooms, buildings]);
  const sel = buildings.findIndex((b) => b.name === selected);
  const pick = useCallback((id: number | null) => onPick(id ? buildings[id - 1]?.name ?? null : null), [buildings, onPick]);
  if (!buildings.length) return null;
  return (
    <div className="stay-map">
      <Suspense fallback={loading}>
        <CampusMap zones={zones} selected={sel >= 0 ? sel + 1 : null} onPick={pick} />
      </Suspense>
      <p className="muted small stay-map-legend">
        <i style={{ background: "#2f9e55" }} /> ว่าง <i style={{ background: "#d9a520" }} /> ใกล้เต็ม <i style={{ background: "#8b8f98" }} /> เต็ม · แตะอาคารเพื่อดูห้อง
      </p>
    </div>
  );
}

/** วาดตำแหน่งอาคารใหม่: แตะมุมอาคารบนพื้นทีละจุด (อย่างน้อย 3 จุด) — อาคารอื่นแสดงจางไว้เทียบ */
export function BuildingDrawer({ name, buildings, onSave, onCancel }: {
  name: string; buildings: LodgingBuilding[]; onSave: (poly: Pt[]) => void; onCancel: () => void;
}) {
  const [pts, setPts] = useState<Pt[]>([]);
  const zones: ZoneShape[] = useMemo(() => buildings.filter((b) => b.name !== name || !pts.length)
    .map((b, i) => ({ id: i + 1, poly: b.poly, color: b.name === name ? "#8a3fb8" : "#8b8f98", label: b.name, dim: true })), [buildings, name, pts.length]);
  const add = useCallback((p: Pt) => setPts((x) => [...x, [Math.round(p[0]), Math.round(p[1])]]), []);
  const noop = useCallback(() => {}, []);
  return (
    <div className="map-pick">
      <Suspense fallback={loading}>
        <CampusMap zones={zones} selected={null} onPick={noop} drawing draft={pts} onDrawPoint={add}>
          <div className="c3-draw">
            <p><PencilRuler size={16} /> แตะมุมของ{name}บนพื้นทีละมุม ({pts.length} จุด) · ลากเพื่อหมุน</p>
            <div className="row wrap">
              <button type="button" className="btn sm" disabled={!pts.length} onClick={() => setPts(pts.slice(0, -1))}><Undo2 size={15} />ย้อนจุด</button>
              <button type="button" className="btn sm" onClick={onCancel}><X size={15} />ยกเลิก</button>
              <button type="button" className="btn sm primary" disabled={pts.length < 3} onClick={() => onSave(pts)}>บันทึกตำแหน่ง</button>
            </div>
          </div>
        </CampusMap>
      </Suspense>
    </div>
  );
}
