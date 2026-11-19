import { lazy, Suspense, useState } from "react";
import { CalendarDays, Wrench } from "lucide-react";
import { navigate, usePath } from "../lib/router";
import Repairs, { type RepairStats } from "./Repairs";

const GaCalendar = lazy(() => import("./GaCalendar"));

const TABS = [
  { path: "/facilities", label: "แจ้งซ่อม", mod: "c-fix", icon: Wrench, desc: "เรียงเรื่องตามความเร่งด่วน หัวหน้างานลงวันที่ เสนอผู้บริหาร แล้วซ่อม" },
  { path: "/facilities/calendar", label: "ปฏิทินงานฝ่าย", mod: "c-ga", icon: CalendarDays, desc: "งานซ่อม รถ ห้องประชุม และกิจกรรมของฝ่ายบริหารทั่วไป ในปฏิทินเดียว" },
];

/** งานอาคารสถานที่: หัวหน้าเป็นแผ่นสีประจำงาน (ส้ม = แจ้งซ่อม, เบอร์กันดี = ปฏิทินงานฝ่าย) สลับแท็บในแผ่นสี */
export default function Facilities() {
  const path = usePath();
  const [stats, setStats] = useState<RepairStats | null>(null);
  const tab = TABS.find((t) => t.path !== "/facilities" && path.startsWith(t.path)) ?? TABS[0];
  const repairs = tab.path === "/facilities";
  return (
    <>
      <header className={`mhero ${tab.mod}`}>
        <tab.icon size={64} strokeWidth={1.5} className="mh-ic" aria-hidden />
        <h1>{tab.label}</h1>
        <p>{tab.desc}</p>
        {repairs && (
          <div className="mh-stats" aria-live="polite">
            <div><b>{stats?.urgent ?? "–"}</b>ด่วนมาก</div>
            <div><b>{stats?.plan ?? "–"}</b>รอลงวันที่</div>
            <div><b>{stats?.scheduled ?? "–"}</b>กำหนดวันแล้ว</div>
          </div>
        )}
        <div className="mh-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.path} role="tab" aria-selected={t.path === tab.path} className={t.path === tab.path ? "on" : ""} onClick={() => navigate(t.path)}>{t.label}</button>
          ))}
        </div>
      </header>
      {repairs ? <Repairs onStats={setStats} /> : <Suspense fallback={<div className="spinner" />}><GaCalendar /></Suspense>}
    </>
  );
}
