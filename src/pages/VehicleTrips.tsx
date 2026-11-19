import { useCallback, useEffect, useState } from "react";
import { errText, supabase } from "../lib/supabase";
import { addDays, fmtDate, fmtDateTime, fmtRange, todayISO } from "../lib/time";
import { licenseDaysLeft, TRIP_CHECKLIST, type Trip } from "../lib/vehicle";
import { Empty, Field, Modal, StatusChip } from "../components/ui";
import type { Driver, Vehicle } from "./Vehicles";

// เจ้าหน้าที่/หัวหน้างานยานพาหนะบันทึกเอง: ออกเดินทาง (ไมล์ก่อนออก + checklist) → ปิดงาน (ไมล์กลับ + น้ำมัน)
type Job = {
  id: number; destination: string; starts_at: string; ends_at: string; status: string; passengers: number;
  vehicle_id: number | null; driver_id: number | null;
  requester: { full_name: string; email: string } | null;
};
const JOB_SELECT = "id,destination,starts_at,ends_at,status,passengers,vehicle_id,driver_id,requester:profiles!vehicle_bookings_booked_by_fkey(full_name,email)";

type TripRow = Trip & { booking: { destination: string; starts_at: string; ends_at: string; driver_id: number | null } | null };

export default function VehicleTrips({ vehicles, drivers, onChanged }: { vehicles: Vehicle[]; drivers: Driver[]; onChanged: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [trips, setTrips] = useState<Record<number, Trip>>({});
  const [lastOdo, setLastOdo] = useState<Record<number, number>>({});
  const [depart, setDepart] = useState<Job | null>(null);
  const [closing, setClosing] = useState<Job | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [j, t] = await Promise.all([
      supabase.from("vehicle_bookings").select(JOB_SELECT).in("status", ["approved", "on_trip"]).order("starts_at"),
      // เลขไมล์ล่าสุดของแต่ละคัน (ใช้เป็นค่าเริ่มต้นตอนออกเดินทาง)
      supabase.from("vehicle_trips").select("*").order("departed_at", { ascending: false }).limit(300),
    ]);
    setErr(j.error ? errText(j.error) : t.error ? errText(t.error) : "");
    setJobs((j.data as unknown as Job[]) ?? []);
    const rows = (t.data as Trip[]) ?? [];
    setTrips(Object.fromEntries(rows.map((r) => [r.booking_id, r])));
    const odo: Record<number, number> = {};
    for (const r of rows) odo[r.vehicle_id] = Math.max(odo[r.vehicle_id] ?? 0, r.end_odometer ?? r.start_odometer);
    setLastOdo(odo);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- load() ตั้ง state หลัง await
  useEffect(() => { load(); }, [load]);

  const done = () => { setDepart(null); setClosing(null); load(); onChanged(); };
  const vname = (id: number | null) => vehicles.find((v) => v.id === id)?.name ?? "—";
  const dname = (id: number | null) => drivers.find((d) => d.id === id)?.full_name;
  const [now] = useState(() => Date.now()); // เวลาที่เปิดหน้า (render ต้อง pure)
  const toDepart = jobs.filter((j) => j.status === "approved");
  const onTrip = jobs.filter((j) => j.status === "on_trip");

  // ใบขับขี่หมดแล้ว / หมดใน 30 วัน / ยังไม่กรอก
  const licenseAlerts = drivers
    .map((d) => ({ d, left: licenseDaysLeft(d.license_expiry) }))
    .filter((x) => x.left === null || x.left <= 30);

  const jobLine = (j: Job) => (
    <>
      <b>{fmtRange(j.starts_at, j.ends_at)}</b> · {j.destination}
      <div className="small">🚐 {vname(j.vehicle_id)}{dname(j.driver_id) ? ` · คนขับ ${dname(j.driver_id)}` : ""} · {j.passengers} คน · ผู้ขอ {j.requester?.full_name || j.requester?.email}</div>
    </>
  );

  return (
    <>
      {err && <p className="error">{err}</p>}
      {licenseAlerts.length > 0 && (
        <div className="warn-box">
          <b>ใบขับขี่ที่ต้องดูแล</b>
          <ul className="plain">
            {licenseAlerts.map(({ d, left }) => (
              <li key={d.id}>{d.full_name}: {left === null ? "ยังไม่กรอกวันหมดอายุ (เมนู จัดการ → คนขับ)" : left < 0 ? `หมดอายุแล้ว (${fmtDate(d.license_expiry!)})` : `หมดอายุใน ${left} วัน (${fmtDate(d.license_expiry!)})`}</li>
            ))}
          </ul>
        </div>
      )}

      <h2>รอออกเดินทาง</h2>
      {toDepart.length === 0 ? <Empty>ไม่มีงานที่อนุมัติแล้วรอออกเดินทาง</Empty> : (
        <div className="card">
          <ul className="list">
            {toDepart.map((j) => (
              <li key={j.id}>
                <div>{jobLine(j)}{new Date(j.starts_at).getTime() < now && <span className="chip bad">เลยเวลาออกแล้ว ยังไม่บันทึก</span>}</div>
                <button className="btn primary" onClick={() => setDepart(j)}>ออกเดินทาง</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2>กำลังเดินทาง · รอปิดงาน</h2>
      {onTrip.length === 0 ? <Empty>ไม่มีรถที่กำลังเดินทาง</Empty> : (
        <div className="card">
          <ul className="list">
            {onTrip.map((j) => (
              <li key={j.id}>
                <div>
                  {jobLine(j)}
                  <div className="small muted">ออก {trips[j.id] ? `${fmtDateTime(trips[j.id].departed_at)} · ไมล์ ${trips[j.id].start_odometer.toLocaleString()}` : ""}</div>
                  {new Date(j.ends_at).getTime() < now && <span className="chip bad">เลยกำหนดกลับ ยังไม่ปิดงาน</span>}
                </div>
                <button className="btn primary" onClick={() => setClosing(j)}>ปิดงาน</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <MonthSummary vehicles={vehicles} drivers={drivers} />

      {depart && <DepartForm job={depart} vehicle={vname(depart.vehicle_id)} lastOdo={depart.vehicle_id ? lastOdo[depart.vehicle_id] : undefined} onClose={() => setDepart(null)} onDone={done} />}
      {closing && trips[closing.id] && <CloseForm job={closing} trip={trips[closing.id]} vehicle={vname(closing.vehicle_id)} onClose={() => setClosing(null)} onDone={done} />}
    </>
  );
}

function DepartForm({ job, vehicle, lastOdo, onClose, onDone }: { job: Job; vehicle: string; lastOdo?: number; onClose: () => void; onDone: () => void }) {
  const [odo, setOdo] = useState(lastOdo !== undefined ? String(lastOdo) : "");
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const allChecked = TRIP_CHECKLIST.every((c) => checks[c.key]);
  const n = Number(odo);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allChecked) return setErr("ตรวจให้ครบทุกข้อก่อนออกเดินทาง — ถ้าข้อไหนไม่ผ่าน ให้แก้ก่อนหรือเปลี่ยนรถ");
    setSaving(true); setErr("");
    const { error } = await supabase.rpc("start_vehicle_trip", { p_id: job.id, p_start_odometer: n, p_checklist: checks });
    setSaving(false);
    if (error) setErr(errText(error)); else onDone();
  };

  return (
    <Modal title="บันทึกออกเดินทาง" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <div className="card soft"><b>{vehicle}</b> · {job.destination}<div className="small">{fmtRange(job.starts_at, job.ends_at)}</div></div>
        <Field label="เลขไมล์ก่อนออก (กม.)" hint={lastOdo !== undefined ? `ครั้งล่าสุดของคันนี้: ${lastOdo.toLocaleString()}` : "ยังไม่มีบันทึกของคันนี้"}>
          <input type="number" inputMode="numeric" min={0} required value={odo} onChange={(e) => setOdo(e.target.value)} />
        </Field>
        {lastOdo !== undefined && odo !== "" && n < lastOdo && <p className="warn-box">น้อยกว่าเลขไมล์ครั้งล่าสุด ({lastOdo.toLocaleString()}) — ตรวจอีกครั้ง</p>}
        <fieldset className="fs">
          <legend>ตรวจก่อนออกเดินทาง</legend>
          {TRIP_CHECKLIST.map((c) => (
            <label key={c.key} className="check">
              <input type="checkbox" checked={!!checks[c.key]} onChange={(e) => setChecks({ ...checks, [c.key]: e.target.checked })} /> {c.label}
            </label>
          ))}
        </fieldset>
        {err && <p className="error">{err}</p>}
        <button className="btn primary big" disabled={saving || !allChecked || odo === ""}>{saving ? "กำลังบันทึก…" : "ยืนยันออกเดินทาง"}</button>
      </form>
    </Modal>
  );
}

function CloseForm({ job, trip, vehicle, onClose, onDone }: { job: Job; trip: Trip; vehicle: string; onClose: () => void; onDone: () => void }) {
  const [odo, setOdo] = useState("");
  const [liters, setLiters] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const dist = odo === "" ? null : Number(odo) - trip.start_odometer;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dist === null || dist < 0) return setErr("เลขไมล์กลับต้องไม่น้อยกว่าเลขไมล์ก่อนออก");
    setSaving(true); setErr("");
    const { error } = await supabase.rpc("close_vehicle_trip", {
      p_id: job.id, p_end_odometer: Number(odo),
      p_fuel_liters: liters === "" ? null : Number(liters), p_fuel_cost: cost === "" ? null : Number(cost), p_note: note,
    });
    setSaving(false);
    if (error) setErr(errText(error)); else onDone();
  };

  return (
    <Modal title="ปิดงาน" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <div className="card soft">
          <b>{vehicle}</b> · {job.destination}
          <div className="small">ออก {fmtDateTime(trip.departed_at)} · ไมล์ก่อนออก {trip.start_odometer.toLocaleString()}</div>
        </div>
        <Field label="เลขไมล์เมื่อกลับ (กม.)">
          <input type="number" inputMode="numeric" min={trip.start_odometer} required value={odo} onChange={(e) => setOdo(e.target.value)} />
        </Field>
        {dist !== null && dist >= 0 && <p className="small">ระยะทาง <b>{dist.toLocaleString()} กม.</b></p>}
        <div className="row2">
          <Field label="เติมน้ำมัน (ลิตร)" hint="ไม่ได้เติม เว้นว่าง"><input type="number" inputMode="decimal" min={0} step="0.01" value={liters} onChange={(e) => setLiters(e.target.value)} /></Field>
          <Field label="ค่าน้ำมัน (บาท)"><input type="number" inputMode="decimal" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        </div>
        <Field label="หมายเหตุ (ไม่บังคับ)"><input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ยางหลังซ้ายอ่อน ควรเช็ก" /></Field>
        {err && <p className="error">{err}</p>}
        <button className="btn primary big" disabled={saving}>{saving ? "กำลังบันทึก…" : "ปิดงาน"}</button>
      </form>
    </Modal>
  );
}

/** สรุปการใช้รถรายเดือน (นับตามวันที่ปิดงาน) + ส่งออก CSV */
function MonthSummary({ vehicles, drivers }: { vehicles: Vehicle[]; drivers: Driver[] }) {
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [rows, setRows] = useState<TripRow[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    const from = `${month}-01`;
    const to = addDays(`${month}-28`, 4).slice(0, 7) + "-01"; // วันที่ 1 ของเดือนถัดไป
    supabase.from("vehicle_trips").select("*,booking:vehicle_bookings(destination,starts_at,ends_at,driver_id)")
      .not("closed_at", "is", null)
      .gte("closed_at", `${from}T00:00:00+07:00`).lt("closed_at", `${to}T00:00:00+07:00`)
      .order("closed_at")
      .then(({ data, error }) => { setErr(error ? errText(error) : ""); setRows((data as unknown as TripRow[]) ?? []); });
  }, [month]);

  const km = (r: TripRow) => (r.end_odometer ?? r.start_odometer) - r.start_odometer;
  const byVehicle = vehicles.map((v) => {
    const list = rows.filter((r) => r.vehicle_id === v.id);
    return {
      v, trips: list.length,
      km: list.reduce((a, r) => a + km(r), 0),
      liters: list.reduce((a, r) => a + Number(r.fuel_liters ?? 0), 0),
      cost: list.reduce((a, r) => a + Number(r.fuel_cost ?? 0), 0),
    };
  }).filter((x) => x.trips > 0);
  const vname = (id: number) => vehicles.find((v) => v.id === id)?.name ?? `#${id}`;
  const dname = (id: number | null | undefined) => drivers.find((d) => d.id === id)?.full_name ?? "";

  const exportCsv = () => {
    const head = ["วันที่ออก", "รถ", "คนขับ", "สถานที่", "ไมล์ออก", "ไมล์กลับ", "ระยะทาง(กม.)", "น้ำมัน(ลิตร)", "ค่าน้ำมัน(บาท)", "หมายเหตุ"];
    const lines = rows.map((r) => [fmtDateTime(r.departed_at), vname(r.vehicle_id), dname(r.booking?.driver_id), r.booking?.destination ?? "",
      String(r.start_odometer), String(r.end_odometer ?? ""), String(km(r)), String(r.fuel_liters ?? ""), String(r.fuel_cost ?? ""), r.note ?? ""]);
    const csv = [head, ...lines].map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `การใช้รถ_${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <h2>สรุปการใช้รถรายเดือน</h2>
      <div className="card row wrap">
        <Field label="เดือน"><input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>
        <button className="btn" onClick={exportCsv} disabled={!rows.length}>ส่งออก Excel (CSV)</button>
      </div>
      {err && <p className="error">{err}</p>}
      {byVehicle.length === 0 ? <Empty>ยังไม่มีงานที่ปิดในเดือนนี้</Empty> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>รถ</th><th>เที่ยว</th><th>ระยะทาง (กม.)</th><th>น้ำมัน (ลิตร)</th><th>ค่าน้ำมัน (บาท)</th><th>บาท/กม.</th></tr></thead>
            <tbody>
              {byVehicle.map((x) => (
                <tr key={x.v.id}>
                  <td>{x.v.name} <span className="muted small">{x.v.plate}</span></td>
                  <td>{x.trips}</td>
                  <td>{x.km.toLocaleString()}</td>
                  <td>{x.liters.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  <td>{x.cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  <td>{x.km > 0 && x.cost > 0 ? (x.cost / x.km).toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <details className="card">
          <summary>รายการเดินทาง {rows.length} เที่ยว</summary>
          <ul className="list">
            {rows.map((r) => (
              <li key={r.booking_id}>
                <span><b>{fmtDate(r.departed_at, { day: "numeric", month: "short" })}</b> {vname(r.vehicle_id)} · {r.booking?.destination} <span className="muted small">· {km(r).toLocaleString()} กม.{r.fuel_cost ? ` · ${Number(r.fuel_cost).toLocaleString()} บาท` : ""}</span>
                  {r.note && <div className="small muted">{r.note}</div>}</span>
                <StatusChip status="completed" />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
