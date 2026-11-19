import { useEffect, useMemo, useState } from "react";
import { errText, supabase } from "../lib/supabase";
import { addDays, fmtDate, todayISO } from "../lib/time";
import { STATUS_GROUP } from "../lib/vehicle";
import { Field } from "../components/ui";
import type { Vehicle } from "./Vehicles";

type Row = { id: number; status: string; starts_at: string; vehicle_id: number | null };
type TripRow = { booking_id: number; vehicle_id: number; start_odometer: number; end_odometer: number | null; fuel_cost: number | null; departed_at: string };

const ymOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(iso)).slice(0, 7);
const prevMonth = (ym: string, n: number) => addDays(`${ym}-15`, -30 * n).slice(0, 7);
const monthStart = (ym: string) => `${ym}-01T00:00:00+07:00`;
const nextMonthStart = (ym: string) => `${addDays(`${ym}-28`, 4).slice(0, 7)}-01T00:00:00+07:00`;

/** ภาพรวมการใช้รถสำหรับผู้บริหาร: ตัวเลขเดือนที่เลือก · คำขอ 6 เดือน · การใช้รถรายคัน */
export default function VehicleDashboard({ vehicles }: { vehicles: Vehicle[] }) {
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([]);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [err, setErr] = useState("");
  const months = useMemo(() => [5, 4, 3, 2, 1, 0].map((n) => prevMonth(month, n)), [month]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from("vehicle_bookings").select("id,status,starts_at,vehicle_id")
        .gte("starts_at", monthStart(months[0])).lt("starts_at", nextMonthStart(month)),
      supabase.from("vehicle_trips").select("booking_id,vehicle_id,start_odometer,end_odometer,fuel_cost,departed_at")
        .gte("departed_at", monthStart(month)).lt("departed_at", nextMonthStart(month)),
    ]).then(([b, t]) => {
      if (!alive) return;
      setErr(b.error ? errText(b.error) : t.error ? errText(t.error) : "");
      setRows((b.data as Row[]) ?? []);
      setTrips((t.data as TripRow[]) ?? []);
    });
    return () => { alive = false; };
  }, [month, months]);

  const inMonth = rows.filter((r) => ymOf(r.starts_at) === month);
  const count = (g: string) => inMonth.filter((r) => STATUS_GROUP[r.status] === g).length;
  const tiles = [
    { label: "คำขอทั้งหมด", value: inMonth.filter((r) => r.status !== "cancelled").length },
    { label: "อนุมัติแล้ว", value: count("approved") },
    { label: "รอพิจารณา", value: count("waiting") },
    { label: "ส่งกลับ / ไม่อนุมัติ", value: count("back") },
    { label: "ยกเลิก", value: count("cancelled") },
  ];
  const series = months.map((m) => ({ m, n: rows.filter((r) => r.status !== "cancelled" && ymOf(r.starts_at) === m).length }));

  const perVehicle = vehicles.map((v) => {
    const t = trips.filter((x) => x.vehicle_id === v.id);
    return {
      v,
      bookings: inMonth.filter((r) => r.vehicle_id === v.id && STATUS_GROUP[r.status] === "approved").length,
      km: t.reduce((a, x) => a + ((x.end_odometer ?? x.start_odometer) - x.start_odometer), 0),
      cost: t.reduce((a, x) => a + Number(x.fuel_cost ?? 0), 0),
    };
  }).sort((a, b) => b.bookings - a.bookings || b.km - a.km);

  return (
    <>
      <div className="row wrap" style={{ marginBottom: "1rem" }}>
        <Field label="เดือน"><input type="month" value={month} max={todayISO().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>
      </div>
      {err && <p className="error">{err}</p>}

      <div className="stats">
        {tiles.map((t) => <div key={t.label} className="stat"><b>{t.value}</b><span>{t.label}</span></div>)}
      </div>

      <section className="card">
        <h3>คำขอใช้รถรายเดือน</h3>
        <p className="muted small">จำนวนคำขอ (ไม่นับที่ยกเลิก) ตามเดือนที่เดินทาง 6 เดือนล่าสุด</p>
        <MonthBars data={series} selected={month} />
        <details className="table-toggle">
          <summary>ดูเป็นตาราง</summary>
          <table>
            <thead><tr><th>เดือน</th><th>คำขอ</th></tr></thead>
            <tbody>{series.map((s) => <tr key={s.m}><td>{fmtDate(`${s.m}-01`, { month: "long", year: "numeric" })}</td><td className="num">{s.n}</td></tr>)}</tbody>
          </table>
        </details>
      </section>

      <section className="card table-wrap">
        <h3 style={{ padding: "1.15rem 1.15rem 0" }}>การใช้รถรายคัน · {fmtDate(`${month}-01`, { month: "long", year: "numeric" })}</h3>
        {perVehicle.length === 0 ? <p className="muted small" style={{ padding: "0 1.15rem 1rem" }}>ยังไม่มีข้อมูลรถ</p> : (
          <table>
            <thead><tr><th>รถ</th><th>งานที่อนุมัติ</th><th>ระยะทาง (กม.)</th><th>ค่าน้ำมัน (บาท)</th></tr></thead>
            <tbody>
              {perVehicle.map((x) => (
                <tr key={x.v.id}>
                  <td>{x.v.name} <span className="muted small">{x.v.plate}</span></td>
                  <td className="num">{x.bookings}</td>
                  <td className="num">{x.km.toLocaleString()}</td>
                  <td className="num">{x.cost ? x.cost.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

/** แท่งรายเดือน (ชุดข้อมูลเดียว): แท่งกว้าง ≤ 24px ปลายมน 4px · ป้ายค่าเฉพาะเดือนที่เลือกและค่าสูงสุด · hover แสดงค่าทุกแท่ง */
function MonthBars({ data, selected }: { data: { m: string; n: number }[]; selected: string }) {
  const max = Math.max(...data.map((d) => d.n), 0);
  const top = max <= 4 ? 4 : Math.ceil(max / 4) * 4; // หาร 2 ลงตัว → เส้นกลางเป็นจำนวนเต็ม (นับคำขอ)
  const ticks = [0, top / 2, top];
  const maxIdx = data.findIndex((d) => d.n === max && max > 0);
  return (
    <div className="mbars" role="img" aria-label={data.map((d) => `${fmtDate(`${d.m}-01`, { month: "short", year: "2-digit" })} ${d.n} คำขอ`).join(", ")}>
      <div className="mbars-plot">
        {ticks.map((t) => (
          <div key={t} className="mbars-grid" style={{ bottom: `${(t / top) * 100}%` }}><span>{t}</span></div>
        ))}
        {data.map((d, i) => {
          const label = d.m === selected || i === maxIdx;
          return (
            <div key={d.m} className={`mbars-col ${d.m === selected ? "sel" : ""}`} tabIndex={0}>
              <span className="mbars-bar" style={{ height: `${(d.n / top) * 100}%` }}>
                {label && d.n > 0 && <span className="mbars-val">{d.n}</span>}
              </span>
              <span className="mbars-tip" role="tooltip">{fmtDate(`${d.m}-01`, { month: "long", year: "numeric" })}: {d.n} คำขอ</span>
            </div>
          );
        })}
      </div>
      <div className="mbars-x">
        {data.map((d) => <span key={d.m}>{fmtDate(`${d.m}-01`, { month: "short" })}</span>)}
      </div>
    </div>
  );
}
