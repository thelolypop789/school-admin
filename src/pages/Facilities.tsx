import { navigate, usePath } from "../lib/router";
import { PageHeader } from "../components/ui";
import { Wrench } from "lucide-react";
import Repairs from "./Repairs";

/** งานอาคารสถานที่: รวมแจ้งซ่อม (ต่อไปจะมีปฏิทินงานฝ่ายและเขตทำความสะอาดเป็นแท็บ) */
const TABS: { path: string; label: string }[] = [
  { path: "/facilities", label: "แจ้งซ่อม" },
];

export default function Facilities() {
  const path = usePath();
  const tab = TABS.find((t) => t.path !== "/facilities" && path.startsWith(t.path)) ?? TABS[0];
  return (
    <>
      <PageHeader icon={Wrench} tone="toilets" title="งานอาคารสถานที่" desc="แจ้งซ่อม → หัวหน้างานลงวันที่ เสนอผู้บริหาร → ซ่อม → เสร็จ เรียงเรื่องตามความเร่งด่วน" />
      {TABS.length > 1 && (
        <div className="tabs scroll">
          {TABS.map((t) => <button key={t.path} className={t.path === tab.path ? "on" : ""} onClick={() => navigate(t.path)}>{t.label}</button>)}
        </div>
      )}
      <Repairs />
    </>
  );
}
