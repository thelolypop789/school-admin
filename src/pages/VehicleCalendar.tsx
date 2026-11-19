import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { errText, supabase } from "../lib/supabase";
import { addDays, dayRange, fmtDate, fmtRange, fmtTime, todayISO } from "../lib/time";
import { STATUS_GROUP } from "../lib/vehicle";
import { StatusChip, Timeline } from "../components/ui";
import type { Driver, Vehicle } from "./Vehicles";

type Ev = {
  id: number; destination: string; starts_at: string; ends_at: string; status: string;
  vehicle_id: number | null; driver_id: number | null; requester: { full_name: string; email: string } | null;
};
const SHOWN = ["pending", "pending_deputy", "pending_director", "approved", "on_trip", "completed"];
const WEEK = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

/** สีในปฏิทิน: อนุมัติ/เดินทาง = เบอร์กันดี · รอพิจารณา = ทอง · ปิดงานแล้ว = เทา */
const evClass = (s: string) => (s === "completed" ? "ev done" : STATUS_GROUP[s] === "approved" ? "ev ok" : "ev wait");

const dow = (dateISO: string) => new Date(`${dateISO}T12:00:00+07:00`).getUTCDay();

export default function VehicleCalendar({ vehicles, drivers }: { vehicles: Vehicle[]; drivers: Driver[] }) {
  const today = todayISO();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [events, setEvents] = useState<Ev[]>([]);
  const [err, setErr] = useState("");

  // ตารางเริ่มวันอาทิตย์ก่อนวันที่ 1 จบวันเสาร์หลังวันสุดท้ายของเดือน
  const days = useMemo(() => {
    const first = `${month}-01`;
    const start = addDays(first, -dow(first));
    const nextMonth = addDays(`${month}-28`, 4).slice(0, 7) + "-01";
    const last = addDays(nextMonth, -1);
    const end = addDays(last, 6 - dow(last));
    const out: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);

  useEffect(() => {
    const from = dayRange(days[0])[0], to = dayRange(days[days.length - 1])[1];
    let alive = true;
    supabase.from("vehicle_bookings")
      .select("id,destination,starts_at,ends_at,status,vehicle_id,driver_id,requester:profiles!vehicle_bookings_booked_by_fkey(full_name,email)")
      .in("status", SHOWN).lt("starts_at", to).gt("ends_at", from).order("starts_at")
      .then(({ data, error }) => {
        if (!alive) return;
        setErr(error ? errText(error) : "");
        setEvents((data as unknown as Ev[]) ?? []);
      });
    return () => { alive = false; };
  }, [days]);

  const on = (d: string) => {
    const [a, b] = dayRange(d);
    return events.filter((e) => e.starts_at < b && e.ends_at > a);
  };
  const vname = (id: number | null) => vehicles.find((v) => v.id === id)?.name ?? "ยังไม่ได้จัดรถ";
  const dname = (id: number | null) => drivers.find((d) => d.id === id)?.full_name;
  const shift = (n: number) => setMonth(addDays(`${month}-15`, n * 30).slice(0, 7));

  const dayEvents = on(selected);
  const byVehicle = vehicles.map((v) => ({ v, list: dayEvents.filter((e) => e.vehicle_id === v.id) })).filter((x) => x.list.length);
  const unassigned = dayEvents.filter((e) => !e.vehicle_id);
  const todayList = on(today).filter((e) => STATUS_GROUP[e.status] === "approved");

  return (
    <>
      {todayList.length > 0 && (
        <section className="card today-out">
          <h3>รถออกวันนี้</h3>
          <ul className="agenda">
            {todayList.map((e) => (
              <li key={e.id}>
                <time>{fmtTime(e.starts_at)}<small>ถึง {fmtTime(e.ends_at)}</small></time>
                <span className="ag-what">{e.destination}
                  <span className="ag-sub">{vname(e.vehicle_id)}{dname(e.driver_id) ? ` · ${dname(e.driver_id)}` : ""} · {e.requester?.full_name}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card cal">
        <div className="cal-head">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="เดือนก่อน"><ChevronLeft size={18} /></button>
          <h3>{fmtDate(`${month}-01`, { month: "long", year: "numeric" })}</h3>
          <button className="icon-btn" onClick={() => shift(1)} aria-label="เดือนถัดไป"><ChevronRight size={18} /></button>
          {month !== today.slice(0, 7) && <button className="link" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>วันนี้</button>}
          <ul className="cal-legend" aria-label="คำอธิบายสี">
            <li><span className="ev ok" />อนุมัติแล้ว</li>
            <li><span className="ev wait" />รอพิจารณา</li>
            <li><span className="ev done" />ปิดงานแล้ว</li>
          </ul>
        </div>
        {err && <p className="error">{err}</p>}
        <div className="cal-grid" role="grid">
          {WEEK.map((w) => <div key={w} className="cal-dow" role="columnheader">{w}</div>)}
          {days.map((d) => {
            const list = on(d);
            const cls = ["cal-day", d.slice(0, 7) !== month && "out", d === today && "today", d === selected && "sel"].filter(Boolean).join(" ");
            return (
              <button key={d} className={cls} onClick={() => setSelected(d)} role="gridcell"
                aria-label={`${fmtDate(d, { day: "numeric", month: "long" })} ${list.length ? `${list.length} รายการ` : "ว่าง"}`}>
                <span className="cal-num">{Number(d.slice(8))}</span>
                <span className="cal-evs">
                  {list.slice(0, 2).map((e) => (
                    <span key={e.id} className={evClass(e.status)}>{fmtTime(e.starts_at)} {e.vehicle_id ? vname(e.vehicle_id) : e.destination}</span>
                  ))}
                  {list.length > 2 && <span className="cal-more">+{list.length - 2}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h3>{fmtDate(selected, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h3>
        {dayEvents.length === 0 ? <p className="muted small">วันนี้ไม่มีการใช้รถ รถทุกคันว่าง</p> : (
          <>
            {byVehicle.map(({ v, list }) => (
              <div key={v.id} className="cal-vehicle">
                <b>{v.name}</b> <span className="muted small">{v.plate}</span>
                <Timeline day={dayRange(selected)} from={6} to={20}
                  items={list.map((e) => ({ id: e.id, starts_at: e.starts_at, ends_at: e.ends_at, label: e.destination, tone: STATUS_GROUP[e.status] === "approved" ? "busy" : "pending" }))} />
                <ul className="list">
                  {list.map((e) => (
                    <li key={e.id}><span><b>{fmtRange(e.starts_at, e.ends_at)}</b> {e.destination} <span className="muted small">· {e.requester?.full_name}</span></span><StatusChip status={e.status} /></li>
                  ))}
                </ul>
              </div>
            ))}
            {unassigned.length > 0 && (
              <div className="cal-vehicle">
                <b>ยังไม่ได้จัดรถ</b>
                <ul className="list">
                  {unassigned.map((e) => (
                    <li key={e.id}><span><b>{fmtRange(e.starts_at, e.ends_at)}</b> {e.destination} <span className="muted small">· {e.requester?.full_name}</span></span><StatusChip status={e.status} /></li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
