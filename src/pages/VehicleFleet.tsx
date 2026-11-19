import { useEffect, useState } from "react";
import { CarFront, Users, Wrench } from "lucide-react";
import { supabase } from "../lib/supabase";
import { dayRange, fmtDate, fmtTime, todayISO } from "../lib/time";
import { CONDITION_LABEL, expiryTone, licenseDaysLeft, VEHICLE_DOCS } from "../lib/vehicle";
import { Empty } from "../components/ui";
import type { Vehicle } from "./Vehicles";

type Trip = { id: number; vehicle_id: number; destination: string; starts_at: string; ends_at: string; status: string };

/** รถทุกคัน: รูป · พร้อมใช้หรือไม่ · วันนี้ว่างหรือออกงาน · วันหมดอายุเอกสาร */
export default function VehicleFleet({ vehicles, photos, isAdmin }: { vehicles: Vehicle[]; photos: Record<string, string>; isAdmin: boolean }) {
  const [today, setToday] = useState<Trip[]>([]);
  useEffect(() => {
    const [from, to] = dayRange(todayISO());
    supabase.from("vehicle_bookings").select("id,vehicle_id,destination,starts_at,ends_at,status")
      .in("status", ["pending_deputy", "pending_director", "approved", "on_trip"]).not("vehicle_id", "is", null)
      .lt("starts_at", to).gt("ends_at", from).order("starts_at")
      .then(({ data }) => setToday((data as Trip[]) ?? []));
  }, []);

  if (!vehicles.length) return <Empty>ยังไม่มีข้อมูลรถ{isAdmin ? " — เพิ่มได้ที่เมนู จัดการ → รถ" : ""}</Empty>;

  return (
    <div className="fleet">
      {vehicles.map((v) => {
        const trips = today.filter((t) => t.vehicle_id === v.id);
        const ready = v.condition === "ready";
        return (
          <article key={v.id} className={`fleet-card ${ready ? "" : "off"}`}>
            <div className="fleet-photo">
              {v.photo_path && photos[v.photo_path]
                ? <img src={photos[v.photo_path]} alt={`รูป${v.name}`} loading="lazy" />
                : <CarFront size={56} strokeWidth={1.2} aria-hidden />}
              <span className={`chip ${ready ? "ok" : "bad"} fleet-cond`}>{ready ? null : <Wrench size={12} />}{CONDITION_LABEL[v.condition]}</span>
            </div>
            <div className="fleet-body">
              <div className="fleet-title">
                <h3>{v.name}</h3>
                {v.plate && <span className="plate">{v.plate}</span>}
              </div>
              <p className="small muted">{v.seats ? <><Users size={14} style={{ verticalAlign: "-2px" }} /> {v.seats} ที่นั่ง</> : "ไม่ระบุที่นั่ง"}</p>
              {!ready && v.condition_note && <p className="small error">{v.condition_note}</p>}
              <div className="fleet-today">
                {trips.length === 0
                  ? <span className="ok-text">วันนี้ว่าง</span>
                  : trips.map((t) => (
                    <span key={t.id}>วันนี้ {fmtTime(t.starts_at)}–{fmtTime(t.ends_at)} · {t.destination}{t.status !== "approved" && t.status !== "on_trip" ? " (รออนุมัติ)" : ""}</span>
                  ))}
              </div>
              <ul className="docs">
                {VEHICLE_DOCS.map((d) => {
                  const date = v[d.key];
                  const left = licenseDaysLeft(date);
                  const tone = expiryTone(left);
                  const pct = left === null ? 0 : Math.max(0, Math.min(100, (left / 365) * 100));
                  return (
                    <li key={d.key}>
                      <span className="doc-label">{d.label}</span>
                      <span className={`doc-bar ${tone}`} aria-hidden><span style={{ width: `${pct}%` }} /></span>
                      <span className={`doc-left ${tone}`}>
                        {left === null ? "ยังไม่กรอก" : left < 0 ? `หมดแล้ว (${fmtDate(date!)})` : `อีก ${left} วัน`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </article>
        );
      })}
    </div>
  );
}
