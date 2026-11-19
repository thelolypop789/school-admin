import { CalendarDays, CarFront, FileClock, Presentation, Wrench, type LucideIcon } from "lucide-react";
import type { Kind } from "./gaItems";

/** ประเภทงาน → สีประจำงาน + ไอคอน (ตรงกับเมนู) */
export const KIND_STYLE: Record<Kind, { mod: string; icon: LucideIcon; label: string }> = {
  repair: { mod: "c-fix", icon: Wrench, label: "งานซ่อม" },
  trip: { mod: "c-car", icon: CarFront, label: "รถไปราชการ" },
  room: { mod: "c-room", icon: Presentation, label: "ห้องประชุม" },
  event: { mod: "c-ga", icon: CalendarDays, label: "กิจกรรมฝ่าย" },
  doc: { mod: "c-ga", icon: FileClock, label: "เอกสารหมดอายุ" },
};
