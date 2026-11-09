import { useCallback, useEffect, useState } from "react";
import { errText, supabase } from "../lib/supabase";
import { useMe } from "../lib/me";
import { dayRange, fmtRange, toISO, todayISO } from "../lib/time";
import { DateNav, Empty, Field, Modal, StatusChip, Timeline } from "../components/ui";

export type Vehicle = { id: number; name: string; plate: string | null; seats: number | null; active: boolean };
export type Driver = { id: number; full_name: string; phone: string | null; active: boolean };
type VBooking = {
  id: number; booked_by: string; destination: string; purpose: string; passengers: number;
  starts_at: string; ends_at: string; status: string;
  vehicle_id: number | null; driver_id: number | null; approver_note: string | null;
  requester: { full_name: string; email: string } | null;
};

const SELECT = "id,booked_by,destination,purpose,passengers,starts_at,ends_at,status,vehicle_id,driver_id,approver_note,requester:profiles!vehicle_bookings_booked_by_fkey(full_name,email)";
type Tab = "mine" | "calendar" | "approve";

export default function Vehicles() {
  const me = useMe();
  const canApprove = me.role === "approver" || me.role === "admin";
  const [tab, setTab] = useState<Tab>(canApprove ? "approve" : "mine");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [mine, setMine] = useState<VBooking[]>([]);
  const [pending, setPending] = useState<VBooking[]>([]);
  const [date, setDate] = useState(todayISO());
  const [day, setDay] = useState<VBooking[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [deciding, setDeciding] = useState<VBooking | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [from, to] = dayRange(date);
    const [v, d, m, p, c] = await Promise.all([
      supabase.from("vehicles").select("*").eq("active", true).order("name"),
      supabase.from("drivers").select("*").eq("active", true).order("full_name"),
      supabase.from("vehicle_bookings").select(SELECT).eq("booked_by", me.id).order("starts_at", { ascending: false }).limit(30),
      canApprove
        ? supabase.from("vehicle_bookings").select(SELECT).eq("status", "pending").order("starts_at")
        : Promise.resolve({ data: [], error: null }),
      supabase.from("vehicle_bookings").select(SELECT).in("status", ["approved", "pending"]).lt("starts_at", to).gt("ends_at", from).order("starts_at"),
    ]);
    const e = v.error || d.error || m.error || p.error || c.error;
    if (e) setErr(errText(e));
    setVehicles((v.data as Vehicle[]) ?? []);
    setDrivers((d.data as Driver[]) ?? []);
    setMine((m.data as unknown as VBooking[]) ?? []);
    setPending((p.data as unknown as VBooking[]) ?? []);
    setDay((c.data as unknown as VBooking[]) ?? []);
  }, [date, me.id, canApprove]);

  // load() ตั้ง state หลัง await (ไม่ใช่ sync) — rule มองไม่เห็นข้าม async function
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const cancel = async (b: VBooking) => {
    if (!confirm(`ยกเลิกคำขอใช้รถไป "${b.destination}" ?`)) return;
    const { error } = await supabase.from("vehicle_bookings").update({ status: "cancelled" }).eq("id", b.id);
    if (error) alert(errText(error)); else load();
  };

  const vname = (id: number | null) => vehicles.find((v) => v.id === id)?.name ?? "";
  const dname = (id: number | null) => drivers.find((d) => d.id === id)?.full_name ?? "";
  const range = dayRange(date);

  return (
    <>
      <div className="page-head">
        <h1>จองรถ</h1>
        <button className="btn primary" onClick={() => setShowForm(true)}>+ ขอใช้รถ</button>
      </div>
      <div className="tabs">
        {canApprove && <button className={tab === "approve" ? "on" : ""} onClick={() => setTab("approve")}>รออนุมัติ {pending.length > 0 && <span className="badge">{pending.length}</span>}</button>}
        <button className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>คำขอของฉัน</button>
        <button className={tab === "calendar" ? "on" : ""} onClick={() => setTab("calendar")}>ตารางรถ</button>
      </div>
      {err && <p className="error">{err}</p>}

      {tab === "approve" && (pending.length === 0 ? <Empty>ไม่มีคำขอรออนุมัติ</Empty> : (
        <div className="grid">
          {pending.map((b) => (
            <section key={b.id} className="card">
              <h3>{b.destination}</h3>
              <p><b>{fmtRange(b.starts_at, b.ends_at)}</b></p>
              <p className="muted">{b.purpose} · {b.passengers} คน</p>
              <p className="small">ผู้ขอ: {b.requester?.full_name || b.requester?.email}</p>
              <button className="btn primary" onClick={() => setDeciding(b)}>พิจารณา</button>
            </section>
          ))}
        </div>
      ))}

      {tab === "mine" && (mine.length === 0 ? <Empty>ยังไม่มีคำขอใช้รถ</Empty> : (
        <div className="card">
          <ul className="list">
            {mine.map((b) => (
              <li key={b.id}>
                <div>
                  <b>{fmtRange(b.starts_at, b.ends_at)}</b> · {b.destination} <StatusChip status={b.status} />
                  {b.status === "approved" && <div className="small">🚐 {vname(b.vehicle_id)}{b.driver_id ? ` · คนขับ ${dname(b.driver_id)}` : ""}</div>}
                  {b.approver_note && <div className="small muted">หมายเหตุ: {b.approver_note}</div>}
                </div>
                {(b.status === "pending" || b.status === "approved") && new Date(b.ends_at) > new Date() && (
                  <button className="link danger" onClick={() => cancel(b)}>ยกเลิก</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {tab === "calendar" && (
        <>
          <DateNav date={date} onChange={setDate} />
          {vehicles.length === 0 && <Empty>ยังไม่มีข้อมูลรถ</Empty>}
          <div className="grid">
            {vehicles.map((v) => {
              const list = day.filter((b) => b.status === "approved" && b.vehicle_id === v.id);
              return (
                <section key={v.id} className="card">
                  <h3>{v.name} <span className="muted small">{v.plate} {v.seats ? `· ${v.seats} ที่นั่ง` : ""}</span></h3>
                  <Timeline day={range} from={6} to={20} items={list.map((b) => ({ id: b.id, starts_at: b.starts_at, ends_at: b.ends_at, label: b.destination }))} />
                  {list.length === 0 ? <p className="muted small">ว่าง</p> : (
                    <ul className="list">
                      {list.map((b) => <li key={b.id}><b>{fmtRange(b.starts_at, b.ends_at)}</b> {b.destination} <span className="muted small">· {b.requester?.full_name}</span></li>)}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
          {day.some((b) => b.status === "pending") && (
            <p className="muted small">มีคำขอรออนุมัติในวันนี้ {day.filter((b) => b.status === "pending").length} รายการ</p>
          )}
        </>
      )}

      {showForm && <RequestForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); setTab("mine"); load(); }} />}
      {deciding && (
        <DecideForm booking={deciding} vehicles={vehicles} drivers={drivers}
          onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); load(); }} />
      )}
    </>
  );
}

function RequestForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = todayISO();
  const [v, setV] = useState({ destination: "", purpose: "", passengers: "1", sDate: t, sTime: "08:00", eDate: t, eTime: "16:30" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = { ...v, [k]: e.target.value };
    if (k === "sDate" && v.eDate < e.target.value) next.eDate = e.target.value;
    setV(next);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const starts_at = toISO(v.sDate, v.sTime), ends_at = toISO(v.eDate, v.eTime);
    if (ends_at <= starts_at) return setErr("เวลากลับต้องหลังเวลาออกเดินทาง");
    setSaving(true); setErr("");
    const { error } = await supabase.from("vehicle_bookings").insert({
      destination: v.destination.trim(), purpose: v.purpose.trim(), passengers: Number(v.passengers), starts_at, ends_at,
    });
    setSaving(false);
    if (error) setErr(errText(error)); else onSaved();
  };

  return (
    <Modal title="ขออนุญาตใช้รถ" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <Field label="สถานที่ไป"><input required maxLength={200} value={v.destination} onChange={set("destination")} placeholder="เช่น สพม.หนองคาย" /></Field>
        <Field label="วัตถุประสงค์"><textarea required rows={2} maxLength={500} value={v.purpose} onChange={set("purpose")} placeholder="เช่น ไปราชการ ประชุมผู้บริหาร" /></Field>
        <Field label="จำนวนผู้โดยสาร"><input type="number" min={1} required inputMode="numeric" value={v.passengers} onChange={set("passengers")} /></Field>
        <div className="row2">
          <Field label="วันที่ออก"><input type="date" required value={v.sDate} onChange={set("sDate")} /></Field>
          <Field label="เวลาออก"><input type="time" required value={v.sTime} onChange={set("sTime")} /></Field>
        </div>
        <div className="row2">
          <Field label="วันที่กลับ"><input type="date" required min={v.sDate} value={v.eDate} onChange={set("eDate")} /></Field>
          <Field label="เวลากลับ"><input type="time" required value={v.eTime} onChange={set("eTime")} /></Field>
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn primary big" disabled={saving}>{saving ? "กำลังส่ง…" : "ส่งคำขอ"}</button>
      </form>
    </Modal>
  );
}

function DecideForm({ booking, vehicles, drivers, onClose, onDone }: {
  booking: VBooking; vehicles: Vehicle[]; drivers: Driver[]; onClose: () => void; onDone: () => void;
}) {
  const [busy, setBusy] = useState<{ vehicle_id: number | null; driver_id: number | null }[] | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // รถ/คนขับที่ติดงานอื่นที่อนุมัติแล้วในช่วงเวลาเดียวกัน
  useEffect(() => {
    supabase.from("vehicle_bookings").select("vehicle_id,driver_id").eq("status", "approved")
      .lt("starts_at", booking.ends_at).gt("ends_at", booking.starts_at)
      .then(({ data }) => setBusy(data ?? []));
  }, [booking]);

  const busyV = new Set(busy?.map((b) => b.vehicle_id));
  const busyD = new Set(busy?.map((b) => b.driver_id));

  const decide = async (approve: boolean) => {
    if (approve && !vehicleId) return setErr("กรุณาเลือกรถ");
    setSaving(true); setErr("");
    const { error } = await supabase.rpc("decide_vehicle_booking", {
      p_id: booking.id, p_approve: approve,
      p_vehicle_id: approve ? Number(vehicleId) : null,
      p_driver_id: approve && driverId ? Number(driverId) : null,
      p_note: note,
    });
    setSaving(false);
    if (error) setErr(errText(error)); else onDone();
  };

  return (
    <Modal title="พิจารณาคำขอใช้รถ" onClose={onClose}>
      <div className="form">
        <div className="card soft">
          <b>{booking.destination}</b>
          <div>{fmtRange(booking.starts_at, booking.ends_at)}</div>
          <div className="muted small">{booking.purpose} · {booking.passengers} คน · ผู้ขอ {booking.requester?.full_name || booking.requester?.email}</div>
        </div>
        <Field label="รถ">
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={!busy}>
            <option value="">— เลือกรถ —</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id} disabled={busyV.has(v.id)}>
                {v.name}{v.seats ? ` (${v.seats} ที่นั่ง)` : ""}{busyV.has(v.id) ? " — ไม่ว่าง" : ""}
                {v.seats && v.seats < booking.passengers ? " — ที่นั่งไม่พอ" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="คนขับ (ไม่บังคับ)">
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} disabled={!busy}>
            <option value="">— ไม่ระบุ / ขับเอง —</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id} disabled={busyD.has(d.id)}>{d.full_name}{busyD.has(d.id) ? " — ติดงาน" : ""}</option>
            ))}
          </select>
        </Field>
        <Field label="หมายเหตุถึงผู้ขอ (ไม่บังคับ)"><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
        {err && <p className="error">{err}</p>}
        <div className="row2">
          <button className="btn danger big" disabled={saving} onClick={() => decide(false)}>ไม่อนุมัติ</button>
          <button className="btn primary big" disabled={saving} onClick={() => decide(true)}>อนุมัติ</button>
        </div>
      </div>
    </Modal>
  );
}
