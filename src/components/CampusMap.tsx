import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { createCampus, type Campus, type Pt, type ZoneShape } from "../campus/campus3d";

const NO_POINTS: Pt[] = [];

/**
 * แผนที่ 3 มิติของโรงเรียน (three.js) ซ้อนเขตทำความสะอาดเป็นแผ่นสีตามสถานะ
 * โหลดแบบ lazy (three.js ~600 KB) — ถ้าเครื่องไม่มี WebGL แสดงข้อความแทน หน้าเรียกใช้มีรายชื่อเขตเป็นทางสำรอง
 */
export default function CampusMap({ zones, selected, onPick, drawing = false, draft = NO_POINTS, onDrawPoint, children }: {
  zones: ZoneShape[]; selected: number | null; onPick: (id: number | null) => void;
  drawing?: boolean; draft?: Pt[]; onDrawPoint?: (p: Pt) => void; children?: ReactNode;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const needle = useRef<SVGSVGElement>(null);
  const campus = useRef<Campus | null>(null);
  const cb = useRef({ onPick, onDrawPoint });
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState("overview");
  const [bld, setBld] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => { cb.current = { onPick, onDrawPoint }; }, [onPick, onDrawPoint]);

  useEffect(() => {
    if (!stage.current) return;
    let c: Campus;
    try {
      c = createCampus(stage.current, {
        onPick: (id) => cb.current.onPick(id),
        onDrawPoint: (p) => cb.current.onDrawPoint?.(p),
        onUserMove: () => setView(""),
        onHeading: (rad) => needle.current?.style.setProperty("transform", `rotate(${(rad * 180) / Math.PI}deg)`),
      });
    } catch {
      // WebGL ใช้ไม่ได้ — แจ้งใน UI แทน
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailed(true);
      return;
    }
    campus.current = c;
    c.setLabels({ buildings: false });
    return () => { c.dispose(); campus.current = null; };
  }, []);

  useEffect(() => { campus.current?.setZones(zones); }, [zones]);
  useEffect(() => { campus.current?.selectZone(selected, selected != null); }, [selected]);
  useEffect(() => { campus.current?.setDrawing(drawing); }, [drawing]);
  useEffect(() => { campus.current?.setDraft(draft); }, [draft]);
  useEffect(() => { campus.current?.setLabels({ buildings: bld }); }, [bld]);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [full]);

  if (failed) {
    return <div className="campus3d failed"><p>เครื่องนี้แสดงแผนที่ 3 มิติไม่ได้ (เบราว์เซอร์ไม่รองรับ WebGL) — เลือกเขตจากรายชื่อด้านล่างได้เลย</p></div>;
  }
  const views = [{ id: "overview", name: "ภาพรวม" }, { id: "top", name: "มุมบน" }];
  return (
    <div className={`campus3d${full ? " full" : ""}${drawing ? " drawing" : ""}`}>
      <div ref={stage} className="c3-stage" aria-label="แผนที่ 3 มิติของโรงเรียน ลากเพื่อหมุน บีบหรือเลื่อนล้อเมาส์เพื่อซูม แตะเขตเพื่อดูรายละเอียด" role="application" />
      <div className="c3-bar">
        {views.map((v) => (
          <button key={v.id} type="button" className={view === v.id ? "on" : ""} aria-pressed={view === v.id}
            onClick={() => { setView(v.id); campus.current?.setView(v.id); }}>{v.name}</button>
        ))}
        <button type="button" className={bld ? "on" : ""} aria-pressed={bld} onClick={() => setBld(!bld)}>ชื่ออาคาร</button>
      </div>
      <div className="c3-tools">
        <button type="button" className="c3-ic" onClick={() => campus.current?.northUp()} aria-label="หันทิศเหนือขึ้นด้านบน" title="ทิศเหนือ">
          <svg ref={needle} viewBox="0 0 40 40" aria-hidden><path d="M20 5 L25 20 L20 17 L15 20 Z" fill="#d8344a" /><path d="M20 35 L25 20 L20 23 L15 20 Z" fill="currentColor" opacity=".45" /></svg>
        </button>
        <button type="button" className="c3-ic" onClick={() => setFull(!full)} aria-label={full ? "ย่อแผนที่" : "ขยายเต็มจอ"}>
          {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>
      {children}
    </div>
  );
}
