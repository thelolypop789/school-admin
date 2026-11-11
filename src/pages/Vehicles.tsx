import { useCallback, useEffect, useState } from "react";
import { errText, supabase } from "../lib/supabase";
import { useMe } from "../lib/me";
import { navigate } from "../lib/router";
import { dayRange, fmtDateTime, fmtRange, hhmm, toISO, todayISO } from "../lib/time";
import { OPEN, RESERVED, REVIEW_STATUS, STAGE_LABEL, STEP_SELECT, stepText, type Step } from "../lib/vehicle";
import { DateNav, Empty, Field, Modal, StatusChip, Timeline } from "../components/ui";

export type Vehicle = { id: number; name: string; plate: string | null; seats: number | null; active: boolean };
export type Driver = { id: number; full_name: string; phone: string | null; active: boolean };
export type VBooking = {
  id: number; booked_by: string; destination: string; purpose: string; passengers: number;
  starts_at: string; ends_at: string; status: string;
  vehicle_id: number | null; driver_id: number | null; approver_note: string | null;
  requester: { full_name: string; email: string } | null;
};

export const VB_SELECT = "id,booked_by,destination,purpose,passengers,starts_at,ends_at,status,vehicle_id,driver_id,approver_note,requester:profiles!vehicle_bookings_booked_by_fkey(full_name,email)";
type Tab = "mine" | "calendar" | "review";

export default function Vehicles() {
  const me = useMe();
  const reviewStatus = REVIEW_STATUS[me.role];
  const [tab, setTab] = useState<Tab>(reviewStatus ? "review" : "mine");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [mine, setMine] = useState<VBooking[]>([]);
  const [toReview, setToReview] = useState<VBooking[]>([]);
  const [date, setDate] = useState(todayISO());
  const [day, setDay] = useState<VBooking[]>([]);
  const [form, setForm] = useState<{ edit: VBooking | null } | null>(null);
  const [reviewing, setReviewing] = useState<VBooking | null>(null);
  const [history, setHistory] = useState<VBooking | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [from, to] = dayRange(date);
    const [v, d, m, p, c] = await Promise.all([
      supabase.from("vehicles").select("*").eq("active", true).order("name"),
      supabase.from("drivers").select("*").eq("active", true).order("full_name"),
      supabase.from("vehicle_bookings").select(VB_SELECT).eq("booked_by", me.id).order("starts_at", { ascending: false }).limit(30),
      reviewStatus
        ? supabase.from("vehicle_bookings").select(VB_SELECT).eq("status", reviewStatus).order("starts_at")
        : Promise.resolve({ data: [], error: null }),
      supabase.from("vehicle_bookings").select(VB_SELECT).in("status", [...RESERVED, "pending"]).lt("starts_at", to).gt("ends_at", from).order("starts_at"),
    ]);
    const e = v.error || d.error || m.error || p.error || c.error;
    if (e) setErr(errText(e));
    setVehicles((v.data as Vehicle[]) ?? []);
    setDrivers((d.data as Driver[]) ?? []);
    setMine((m.data as unknown as VBooking[]) ?? []);
    setToReview((p.data as unknown as VBooking[]) ?? []);
    setDay((c.data as unknown as VBooking[]) ?? []);
  }, [date, me.id, reviewStatus]);

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
  const reviewTitle = me.role === "director" ? "รออนุมัติ" : "รอพิจารณา";

  return (
    <>
      <div className="page-head">
        <h1>จองรถ</h1>
        <button className="btn primary" onClick={() => setForm({ edit: null })}>+ ขอใช้รถ</button>
      </div>
      <p className="muted small">ขั้นตอน: ผู้ขอ → หัวหน้างานยานพาหนะ (จัดรถ) → รอง ผอ. ฝ่ายบริหารทั่วไป → ผู้อำนวยการ (อนุมัติ) → พิมพ์ใบขออนุญาต</p>
      <div className="tabs">
        {reviewStatus && <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>{reviewTitle} {toReview.length > 0 && <span className="badge">{toReview.length}</span>}</button>}
        <button className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>คำขอของฉัน</button>
        <button className={tab === "calendar" ? "on" : ""} onClick={() => setTab("calendar")}>ตารางรถ</button>
      </div>
      {err && <p className="error">{err}</p>}

      {tab === "review" && (toReview.length === 0 ? <Empty>ไม่มีคำขอที่รอคุณพิจารณา</Empty> : (
        <div className="grid">
          {toReview.map((b) => (
            <section key={b.id} className="card">
              <h3>{b.destination}</h3>
              <p><b>{fmtRange(b.starts_at, b.ends_at)}</b></p>
              <p className="muted">{b.purpose} · {b.passengers} คน</p>
              <p className="small">ผู้ขอ: {b.requester?.full_name || b.requester?.email}</p>
              {b.vehicle_id && <p className="small">🚐 {vname(b.vehicle_id)}{b.driver_id ? ` · คนขับ ${dname(b.driver_id)}` : ""}</p>}
              {b.approver_note && <p className="small muted">หมายเหตุล่าสุด: {b.approver_note}</p>}
              <button className="btn primary" onClick={() => setReviewing(b)}>พิจารณา</button>
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
                  {RESERVED.includes(b.status) && b.vehicle_id && <div className="small">🚐 {vname(b.vehicle_id)}{b.driver_id ? ` · คนขับ ${dname(b.driver_id)}` : ""}</div>}
                  {b.status === "returned" && b.approver_note && <div className="small error">เหตุผลที่ส่งกลับ: {b.approver_note}</div>}
                  <div className="actions">
                    <button className="link" onClick={() => setHistory(b)}>ดูขั้นตอน</button>
                    {b.status === "returned" && new Date(b.ends_at) > new Date() && <button className="link" onClick={() => setForm({ edit: b })}>แก้ไขแล้วส่งใหม่</button>}
                    {b.status === "approved" && <button className="link" onClick={() => navigate(`/vehicles/print/${b.id}`)}>🖨️ พิมพ์ใบขออนุญาต</button>}
                  </div>
                </div>
                {OPEN.includes(b.status) && new Date(b.ends_at) > new Date() && (
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
              const list = day.filter((b) => RESERVED.includes(b.status) && b.vehicle_id === v.id);
              return (
                <section key={v.id} className="card">
                  <h3>{v.name} <span className="muted small">{v.plate} {v.seats ? `· ${v.seats} ที่นั่ง` : ""}</span></h3>
                  <Timeline day={range} from={6} to={20} items={list.map((b) => ({ id: b.id, starts_at: b.starts_at, ends_at: b.ends_at, label: b.destination, tone: b.status === "approved" ? "busy" : "pending" }))} />
                  {list.length === 0 ? <p className="muted small">ว่าง</p> : (
                    <ul className="list">
                      {list.map((b) => <li key={b.id}><b>{fmtRange(b.starts_at, b.ends_at)}</b> {b.destination} <span className="muted small">· {b.requester?.full_name}</span> {b.status !== "approved" && <StatusChip status={b.status} />}</li>)}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
          {day.some((b) => b.status === "pending") && (
            <p className="muted small">มีคำขอที่ยังไม่ได้จัดรถในวันนี้ {day.filter((b) => b.status === "pending").length} รายการ</p>
          )}
        </>
      )}

      {form && <RequestForm edit={form.edit} onClose={() => setForm(null)} onSaved={() => { setForm(null); setTab("mine"); load(); }} />}
      {reviewing && (
        <ReviewForm booking={reviewing} role={me.role} vehicles={vehicles} drivers={drivers}
          onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); load(); }} />
      )}
      {history && (
        <Modal title="ขั้นตอนการพิจารณา" onClose={() => setHistory(null)}>
          <Steps bookingId={history.id} />
        </Modal>
      )}
    </>
  );
}

/** ลำดับการพิจารณาของคำขอ */
function Steps({ bookingId }: { bookingId: number }) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  useEffect(() => {
    supabase.from("vehicle_booking_steps").select(STEP_SELECT).eq("booking_id", bookingId).order("acted_at")
      .then(({ data }) => setSteps((data as unknown as Step[]) ?? []));
  }, [bookingId]);
  if (!steps) return <div className="spinner" />;
  return (
    <ol className="steps">
      {steps.map((s) => (
        <li key={s.id} className={s.action === "return" ? "ret" : ""}>
          <b>{stepText(s)}</b> · {STAGE_LABEL[s.stage]} {s.actor?.full_name || s.actor?.email}
          <div className="small muted">{fmtDateTime(s.acted_at)}</div>
          {s.note && <div className="small">“{s.note}”</div>}
        </li>
      ))}
    </ol>
  );
}

function RequestForm({ edit, onClose, onSaved }: { edit: VBooking | null; onClose: () => void; onSaved: () => void }) {
  const t = todayISO();
  const dateOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(iso));
  const [v, setV] = useState(edit
    ? { destination: edit.destination, purpose: edit.purpose, passengers: String(edit.passengers), sDate: dateOf(edit.starts_at), sTime: hhmm(edit.starts_at), eDate: dateOf(edit.ends_at), eTime: hhmm(edit.ends_at) }
    : { destination: "", purpose: "", passengers: "1", sDate: t, sTime: "08:00", eDate: t, eTime: "16:30" });
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
    const { error } = edit
      ? await supabase.rpc("resubmit_vehicle_booking", {
          p_id: edit.id, p_destination: v.destination.trim(), p_purpose: v.purpose.trim(),
          p_passengers: Number(v.passengers), p_starts_at: starts_at, p_ends_at: ends_at,
        })
      : await supabase.from("vehicle_bookings").insert({
          destination: v.destination.trim(), purpose: v.purpose.trim(), passengers: Number(v.passengers), starts_at, ends_at,
        });
    setSaving(false);
    if (error) setErr(errText(error)); else onSaved();
  };

  return (
    <Modal title={edit ? "แก้ไขคำขอแล้วส่งใหม่" : "ขออนุญาตใช้รถ"} onClose={onClose}>
      <form className="form" onSubmit={save}>
        {edit?.approver_note && <p className="error">เหตุผลที่ส่งกลับ: {edit.approver_note}</p>}
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
        <button className="btn primary big" disabled={saving}>{saving ? "กำลังส่ง…" : edit ? "ส่งใหม่" : "ส่งคำขอ"}</button>
      </form>
    </Modal>
  );
}

function ReviewForm({ booking, role, vehicles, drivers, onClose, onDone }: {
  booking: VBooking; role: string; vehicles: Vehicle[]; drivers: Driver[]; onClose: () => void; onDone: () => void;
}) {
  const isHead = role === "vehicle_head";
  const [busy, setBusy] = useState<{ vehicle_id: number | null; driver_id: number | null }[] | null>(isHead ? null : []);
  const [vehicleId, setVehicleId] = useState(booking.vehicle_id ? String(booking.vehicle_id) : "");
  const [driverId, setDriverId] = useState(booking.driver_id ? String(booking.driver_id) : "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // รถ/คนขับที่ถูกจัดให้คำขออื่นในช่วงเวลาเดียวกันแล้ว
  useEffect(() => {
    if (!isHead) return;
    supabase.from("vehicle_bookings").select("vehicle_id,driver_id").in("status", RESERVED).neq("id", booking.id)
      .lt("starts_at", booking.ends_at).gt("ends_at", booking.starts_at)
      .then(({ data }) => setBusy(data ?? []));
  }, [booking, isHead]);

  const busyV = new Set(busy?.map((b) => b.vehicle_id));
  const busyD = new Set(busy?.map((b) => b.driver_id));
  const vname = vehicles.find((v) => v.id === booking.vehicle_id)?.name;
  const dname = drivers.find((d) => d.id === booking.driver_id)?.full_name;

  const [backTo, forwardLabel] =
    role === "vehicle_head" ? ["ส่งกลับผู้ขอ", "จัดรถ ส่งรอง ผอ."]
    : role === "deputy" ? ["ส่งกลับหัวหน้างาน", "เห็นชอบ ส่ง ผอ."]
    : ["ส่งกลับรอง ผอ.", "อนุมัติ"];

  const review = async (approve: boolean) => {
    if (isHead && approve && !vehicleId) return setErr("กรุณาเลือกรถ");
    if (!approve && !note.trim()) return setErr("กรุณาระบุเหตุผลที่ส่งกลับ");
    setSaving(true); setErr("");
    const { error } = await supabase.rpc("review_vehicle_booking", {
      p_id: booking.id, p_approve: approve, p_note: note,
      p_vehicle_id: isHead && approve ? Number(vehicleId) : null,
      p_driver_id: isHead && approve && driverId ? Number(driverId) : null,
    });
    setSaving(false);
    if (error) setErr(errText(error)); else onDone();
  };

  return (
    <Modal title={role === "director" ? "อนุมัติคำขอใช้รถ" : "พิจารณาคำขอใช้รถ"} onClose={onClose}>
      <div className="form">
        <div className="card soft">
          <b>{booking.destination}</b>
          <div>{fmtRange(booking.starts_at, booking.ends_at)}</div>
          <div className="muted small">{booking.purpose} · {booking.passengers} คน · ผู้ขอ {booking.requester?.full_name || booking.requester?.email}</div>
          {!isHead && vname && <div className="small">🚐 {vname}{dname ? ` · คนขับ ${dname}` : ""}</div>}
        </div>
        <details>
          <summary className="small">ขั้นตอนที่ผ่านมา</summary>
          <Steps bookingId={booking.id} />
        </details>
        {isHead && (
          <>
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
          </>
        )}
        <Field label="ความเห็น / เหตุผล" hint="ถ้าส่งกลับต้องระบุเหตุผล"><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
        {err && <p className="error">{err}</p>}
        <div className="row2">
          <button className="btn danger big" disabled={saving} onClick={() => review(false)}>{backTo}</button>
          <button className="btn primary big" disabled={saving} onClick={() => review(true)}>{forwardLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
