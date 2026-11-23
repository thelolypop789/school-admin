import { lazy, Suspense, useCallback, useMemo } from "react";
import { MapPin, X } from "lucide-react";
import type { Pt, ZoneShape } from "../campus/campus3d";

const CampusMap = lazy(() => import("./CampusMap"));
const R = 7; // ครึ่งความกว้างแผ่นจุด (พิกเซลภาพดาวเทียม ≈ 2.4 ม.)
const square = (x: number, y: number): Pt[] => [[x - R, y - R], [x + R, y - R], [x + R, y + R], [x - R, y + R]];

export type MapPoint = { id: number; x: number; y: number; label: string };

/** เลือกตำแหน่งจุดบนแผนที่ 3 มิติ (แตะพื้น) — จุดอื่นแสดงจางไว้เทียบ ; value = [x, y] พิกเซลภาพดาวเทียม แบบเดียวกับ clean_zones */
export function MapPicker({ value, onChange, others = [], label = "จุดนี้" }: {
  value: Pt | null; onChange: (p: Pt | null) => void; others?: MapPoint[]; label?: string;
}) {
  const zones: ZoneShape[] = useMemo(() => [
    ...others.map((o) => ({ id: o.id, poly: square(o.x, o.y), color: "#5c6b2e", label: o.label, dim: true })),
    ...(value ? [{ id: -1, poly: square(value[0], value[1]), color: "#8f1036", label, mine: true }] : []),
  ], [others, value, label]);
  const noop = useCallback(() => {}, []);
  const pick = useCallback((p: Pt) => onChange(p), [onChange]);
  return (
    <div className="map-pick">
      <Suspense fallback={<div className="campus3d loading"><div className="spinner" /><p>กำลังสร้างแผนที่ 3 มิติ…</p></div>}>
        <CampusMap zones={zones} selected={null} onPick={noop} drawing onDrawPoint={pick}>
          <div className="c3-draw">
            <p><MapPin size={16} /> {value ? "วางจุดแล้ว · แตะที่อื่นเพื่อย้าย" : "แตะบนแผนที่ตรงที่ยืนเวร"} · ลากเพื่อหมุน</p>
            {value && <div className="row"><button type="button" className="btn sm" onClick={() => onChange(null)}><X size={15} />ไม่ระบุตำแหน่ง</button></div>}
          </div>
        </CampusMap>
      </Suspense>
    </div>
  );
}
