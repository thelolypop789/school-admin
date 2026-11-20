import { lazy, Suspense, useState } from "react";
import { CalendarDays, Sparkles, Wrench } from "lucide-react";
import { navigate, usePath } from "../lib/router";
import Repairs, { type RepairStats } from "./Repairs";
import { ModuleHero } from "../components/ui";
import type { CleanStats } from "./CleanZones";

const GaCalendar = lazy(() => import("./GaCalendar"));
const CleanZones = lazy(() => import("./CleanZones"));

const TABS = [
  { path: "/facilities", label: "แจ้งซ่อม", mod: "c-fix", icon: Wrench, desc: "เรียงเรื่องตามความเร่งด่วน หัวหน้างานลงวันที่ เสนอผู้บริหาร แล้วซ่อม" },
  { path: "/facilities/zones", label: "เขตทำความสะอาด", mod: "c-zone", icon: Sparkles, desc: "ครูที่ปรึกษาถ่ายรูปรายงานทุกวันที่มีเรียน เจ้าหน้าที่ตรวจยืนยัน สีบนแผนที่บอกสถานะ" },
  { path: "/facilities/calendar", label: "ปฏิทินงานฝ่าย", mod: "c-ga", icon: CalendarDays, desc: "งานซ่อม รถ ห้องประชุม และกิจกรรมของฝ่ายบริหารทั่วไป ในปฏิทินเดียว" },
];

/** งานอาคารสถานที่: หัวหน้าเป็นแผ่นสีประจำงาน (ส้ม = แจ้งซ่อม, เขียวใบไม้ = เขตทำความสะอาด, เบอร์กันดี = ปฏิทินงานฝ่าย) สลับแท็บในแผ่นสี */
export default function Facilities() {
  const path = usePath();
  const [stats, setStats] = useState<RepairStats | null>(null);
  const [clean, setClean] = useState<CleanStats | null>(null);
  const tab = TABS.find((t) => t.path !== "/facilities" && path.startsWith(t.path)) ?? TABS[0];
  const repairs = tab.path === "/facilities";
  return (
    <>
      <ModuleHero mod={tab.mod} icon={tab.icon} title={tab.label} desc={tab.desc}
        stats={repairs ? [
          { n: stats?.urgent ?? "–", label: "ด่วนมาก" },
          { n: stats?.plan ?? "–", label: "รอลงวันที่" },
          { n: stats?.scheduled ?? "–", label: "กำหนดวันแล้ว" },
        ] : tab.path === "/facilities/zones" ? [
          { n: clean ? `${clean.reported}/${clean.total}` : "–", label: "รายงานแล้ว" },
          { n: clean?.pass ?? "–", label: "สะอาด" },
          { n: clean?.fail ?? "–", label: "ต้องปรับปรุง" },
        ] : undefined}>
        <div className="mh-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.path} role="tab" aria-selected={t.path === tab.path} className={t.path === tab.path ? "on" : ""} onClick={() => navigate(t.path)}>{t.label}</button>
          ))}
        </div>
      </ModuleHero>
      {repairs ? <Repairs onStats={setStats} /> : (
        <Suspense fallback={<div className="spinner" />}>{tab.path === "/facilities/zones" ? <CleanZones onStats={setClean} /> : <GaCalendar />}</Suspense>
      )}
    </>
  );
}
