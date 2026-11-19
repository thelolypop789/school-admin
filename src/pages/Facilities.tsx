import { lazy, Suspense } from "react";
import { navigate, usePath } from "../lib/router";
import { PageHeader } from "../components/ui";
import { Wrench } from "lucide-react";
import Repairs from "./Repairs";

const GaCalendar = lazy(() => import("./GaCalendar"));

/** งานอาคารสถานที่: แจ้งซ่อม · ปฏิทินงานฝ่าย (ทุกคนดูได้) · (ต่อไป) เขตทำความสะอาด */
export default function Facilities() {
  const path = usePath();
  const tabs = [
    { path: "/facilities", label: "แจ้งซ่อม" },
    { path: "/facilities/calendar", label: "ปฏิทินงานฝ่าย" },
  ];
  const tab = tabs.find((t) => t.path !== "/facilities" && path.startsWith(t.path)) ?? tabs[0];
  return (
    <>
      <PageHeader icon={Wrench} tone="toilets" title="งานอาคารสถานที่"
        desc={tab.path === "/facilities" ? "แจ้งซ่อม → หัวหน้างานลงวันที่ เสนอผู้บริหาร → ซ่อม → เสร็จ เรียงเรื่องตามความเร่งด่วน"
          : "งานซ่อม รถ ห้องประชุม วันหมดอายุเอกสารรถ และกิจกรรมของฝ่าย รวมในปฏิทินเดียว"} />
      {tabs.length > 1 && (
        <div className="tabs scroll">
          {tabs.map((t) => <button key={t.path} className={t.path === tab.path ? "on" : ""} onClick={() => navigate(t.path)}>{t.label}</button>)}
        </div>
      )}
      {tab.path === "/facilities" ? <Repairs /> : <Suspense fallback={<div className="spinner" />}><GaCalendar /></Suspense>}
    </>
  );
}
