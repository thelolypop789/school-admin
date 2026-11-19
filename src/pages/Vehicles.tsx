import { useCallback, useEffect, useState } from "react";
import { errText, supabase } from "../lib/supabase";
import { useMe } from "../lib/me";
import { navigate } from "../lib/router";
import { fmtDateTime, fmtRange, hhmm, toISO, todayISO } from "../lib/time";
import { EXPENSES, LEAD_DAYS, licenseDaysLeft, VEHICLE_DOCS, OPEN, PRINTABLE, RESERVED, STAGE_LABEL, STEP_SELECT, stepText, type Step, type Traveler } from "../lib/vehicle";
import VehicleTrips from "./VehicleTrips";
import VehicleCalendar from "./VehicleCalendar";
import VehicleFleet from "./VehicleFleet";
import VehicleDashboard from "./VehicleDashboard";
import { useSignedUrls } from "../lib/photos";
import { hasRole, reviewStatuses } from "../lib/roles";
import { Empty, Field, Modal, PageHeader, StatusChip } from "../components/ui";
import { Check, CarFront, Plus, Printer, X } from "lucide-react";

export type Vehicle = {
  id: number; name: string; plate: string | null; seats: number | null; active: boolean;
  photo_path: string | null; condition: "ready" | "maintenance"; condition_note: string | null;
  insurance_expiry: string | null; act_expiry: string | null; tax_expiry: string | null;
};
export type Driver = { id: number; full_name: string; phone: string | null; license_expiry: string | null; active: boolean };
export type VBooking = {
  id: number; booked_by: string; destination: string; purpose: string; passengers: number;
  starts_at: string; ends_at: string; status: string; created_at: string;
  vehicle_id: number | null; driver_id: number | null; approver_note: string | null;
  travelers: Traveler[]; expenses: string[];
  requester: { full_name: string; email: string } | null;
};

export const VB_SELECT = "id,booked_by,destination,purpose,passengers,starts_at,ends_at,status,created_at,vehicle_id,driver_id,approver_note,travelers,expenses,requester:profiles!vehicle_bookings_booked_by_fkey(full_name,email)";
type Tab = "mine" | "calendar" | "fleet" | "overview" | "review" | "trips";

export default function Vehicles() {
  const me = useMe();
  const reviewKey = reviewStatuses(me).join(",");
  const reviewStatus = reviewKey || null;
  const canLogTrips = hasRole(me, "vehicle_head", "admin");
  // หัวหน้าฝ่ายบริหารทั่วไป/รอง ผอ./ผอ. ดูบันทึกเดินทางได้ (อ่านอย่างเดียว)
  const canViewTrips = canLogTrips || hasRole(me, "ga_head", "deputy", "director");
  const isExec = hasRole(me, "vehicle_head", "ga_head", "deputy", "director", "admin");
  const [tab, setTab] = useState<Tab>(reviewStatus ? "review" : "mine");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [mine, setMine] = useState<VBooking[]>([]);
  const [toReview, setToReview] = useState<VBooking[]>([]);
  // edit = แก้คำขอที่ถูกส่งกลับ; copy = ขอเพิ่มอีกคัน (ใช้ข้อมูลเดิมเป็นค่าเริ่มต้น)
  const [form, setForm] = useState<{ edit: VBooking | null; copy?: VBooking } | null>(null);
  const [reviewing, setReviewing] = useState<VBooking | null>(null);
  const [history, setHistory] = useState<VBooking | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [v, d, m, p] = await Promise.all([
      supabase.from("vehicles").select("*").eq("active", true).order("name"),
      supabase.from("drivers").select("*").eq("active", true).order("full_name"),
      supabase.from("vehicle_bookings").select(VB_SELECT).eq("booked_by", me.id).order("starts_at", { ascending: false }).limit(30),
      reviewStatus
        ? supabase.from("vehicle_bookings").select(VB_SELECT).in("status", reviewStatus.split(",")).order("starts_at")
        : Promise.resolve({ data: [], error: null }),
    ]);
    const e = v.error || d.error || m.error || p.error;
    if (e) setErr(errText(e));
    setVehicles((v.data as Vehicle[]) ?? []);
    setDrivers((d.data as Driver[]) ?? []);
    setMine((m.data as unknown as VBooking[]) ?? []);
    setToReview((p.data as unknown as VBooking[]) ?? []);
  }, [me.id, reviewStatus]);

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
  const photos = useSignedUrls("vehicle-photos", vehicles.map((v) => v.photo_path));
  const vphoto = (id: number | null) => { const p = vehicles.find((v) => v.id === id)?.photo_path; return p ? photos[p] : undefined; };
  const reviewTitle = reviewKey === "pending_director" ? "รออนุมัติ" : "รอพิจารณา";

  return (
    <>
      <PageHeader icon={CarFront} tone="vehicles" title="ขอใช้รถไปราชการ"
        desc="ยื่นคำขอ → งานยานพาหนะจัดรถ → รอง ผอ. → ผอ. อนุมัติ → พิมพ์คำสั่ง → เดินทาง → ปิดงาน">
        <button className="btn primary" onClick={() => setForm({ edit: null })}><Plus size={18} />ขอใช้รถ</button>
      </PageHeader>
      <div className="tabs scroll">
        {reviewStatus && <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>{reviewTitle} {toReview.length > 0 && <span className="badge">{toReview.length}</span>}</button>}
        <button className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>คำขอของฉัน</button>
        <button className={tab === "calendar" ? "on" : ""} onClick={() => setTab("calendar")}>ปฏิทิน</button>
        <button className={tab === "fleet" ? "on" : ""} onClick={() => setTab("fleet")}>รถ</button>
        {canViewTrips && <button className={tab === "trips" ? "on" : ""} onClick={() => setTab("trips")}>บันทึกเดินทาง</button>}
        {isExec && <button className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>ภาพรวม</button>}
      </div>
      {err && <p className="error">{err}</p>}

      {tab === "review" && (toReview.length === 0 ? <Empty>ไม่มีคำขอที่รอคุณพิจารณา</Empty> : (
        <div className="grid">
          {toReview.map((b) => (
            <section key={b.id} className="card review-card">
              {vphoto(b.vehicle_id) && <img className="review-photo" src={vphoto(b.vehicle_id)} alt={vname(b.vehicle_id)} loading="lazy" />}
              <h3>{b.destination}</h3>
              <p><b>{fmtRange(b.starts_at, b.ends_at)}</b> <LeadChip b={b} /></p>
              <p className="muted">{b.purpose} · {b.passengers} คน</p>
              {b.travelers?.length > 0 && <p className="small muted">{b.travelers.map((t) => t.name).join(", ")}</p>}
              <p className="small">ผู้ขอ: {b.requester?.full_name || b.requester?.email}</p>
              {b.vehicle_id && <p className="small"><CarFront size={14} style={{ verticalAlign: "-2px" }} /> {vname(b.vehicle_id)}{b.driver_id ? ` · คนขับ ${dname(b.driver_id)}` : ""}</p>}
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
                <div className="req">
                  <div className="req-head"><b>{b.destination}</b> <StatusChip status={b.status} /></div>
                  <div className="small muted">{fmtRange(b.starts_at, b.ends_at)}</div>
                  <Progress status={b.status} />
                  {RESERVED.includes(b.status) && b.vehicle_id && <div className="small"><CarFront size={14} style={{ verticalAlign: "-2px" }} /> {vname(b.vehicle_id)}{b.driver_id ? ` · คนขับ ${dname(b.driver_id)}` : ""}</div>}
                  {b.status === "returned" && b.approver_note && <div className="small error">เหตุผลที่ส่งกลับ: {b.approver_note}</div>}
                  {b.status === "rejected" && b.approver_note && <div className="small error">เหตุผลที่ไม่อนุมัติ: {b.approver_note}</div>}
                  <div className="actions">
                    <button className="link" onClick={() => setHistory(b)}>ดูขั้นตอน</button>
                    {b.status === "returned" && new Date(b.ends_at) > new Date() && <button className="link" onClick={() => setForm({ edit: b })}>แก้ไขแล้วส่งใหม่</button>}
                    {PRINTABLE.includes(b.status) && <button className="link" onClick={() => navigate(`/vehicles/print/${b.id}`)}><Printer size={14} style={{ verticalAlign: "-2px" }} /> พิมพ์ใบขออนุญาต</button>}
                    {OPEN.includes(b.status) && b.status !== "returned" && new Date(b.ends_at) > new Date() && (
                      <button className="link" onClick={() => setForm({ edit: null, copy: b })} title="คนไม่พอรถคันเดียว: ส่งคำขอคันที่ 2 ด้วยข้อมูลเดิม">+ ขอเพิ่มอีกคัน</button>
                    )}
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

      {tab === "calendar" && <VehicleCalendar vehicles={vehicles} drivers={drivers} />}
      {tab === "fleet" && <VehicleFleet vehicles={vehicles} photos={photos} isAdmin={hasRole(me, "admin")} />}
      {tab === "overview" && isExec && <VehicleDashboard vehicles={vehicles} />}

      {tab === "trips" && canViewTrips && <VehicleTrips vehicles={vehicles} drivers={drivers} onChanged={load} readOnly={!canLogTrips} />}

      {form && <RequestForm edit={form.edit} copy={form.copy} onClose={() => setForm(null)} onSaved={() => { setForm(null); setTab("mine"); load(); }} />}
      {reviewing && (
        <ReviewForm booking={reviewing} vehicles={vehicles} drivers={drivers}
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
          <div className="small muted">{fmtDateTime(s.acted_at)}{s.channel === "line" && " · ผ่าน LINE"}</div>
          {s.note && <div className="small">“{s.note}”</div>}
        </li>
      ))}
    </ol>
  );
}

function RequestForm({ edit, copy, onClose, onSaved }: { edit: VBooking | null; copy?: VBooking; onClose: () => void; onSaved: () => void }) {
  const me = useMe();
  const t = todayISO();
  const dateOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(iso));
  const base = edit ?? copy;
  const [v, setV] = useState(base
    ? { destination: base.destination, purpose: base.purpose, sDate: dateOf(base.starts_at), sTime: hhmm(base.starts_at), eDate: dateOf(base.ends_at), eTime: hhmm(base.ends_at) }
    : { destination: "", purpose: "", sDate: t, sTime: "08:00", eDate: t, eTime: "16:30" });
  // คันที่ 2 เป็นคนละกลุ่มผู้เดินทาง → เริ่มรายชื่อว่าง
  const [travelers, setTravelers] = useState<Traveler[]>(
    edit?.travelers?.length ? edit.travelers : copy ? [{ name: "", position: "" }] : [{ name: me.full_name, position: me.position ?? "" }],
  );
  const [expenses, setExpenses] = useState<string[]>(base?.expenses ?? []);
  const [openedAt] = useState(() => Date.now()); // render ต้อง pure
  const leadDays = (new Date(toISO(v.sDate, v.sTime)).getTime() - openedAt) / 86400000;
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = { ...v, [k]: e.target.value };
    if (k === "sDate" && v.eDate < e.target.value) next.eDate = e.target.value;
    setV(next);
  };
  const setT = (i: number, k: keyof Traveler, val: string) => setTravelers(travelers.map((x, j) => (j === i ? { ...x, [k]: val } : x)));
  const toggleExp = (key: string) => setExpenses(expenses.includes(key) ? expenses.filter((x) => x !== key) : [...expenses, key]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const starts_at = toISO(v.sDate, v.sTime), ends_at = toISO(v.eDate, v.eTime);
    if (ends_at <= starts_at) return setErr("เวลากลับต้องหลังเวลาออกเดินทาง");
    const list = travelers.map((x) => ({ name: x.name.trim(), position: x.position.trim() })).filter((x) => x.name);
    if (list.length === 0) return setErr("กรุณาใส่รายชื่อผู้เดินทางอย่างน้อย 1 คน");
    if (list.some((x) => !x.position)) return setErr("กรุณาใส่ตำแหน่งของผู้เดินทางทุกคน (เช่น ครู, นักเรียน)");
    const exps = EXPENSES.map((x) => x.key).filter((k) => expenses.includes(k));
    setSaving(true); setErr("");
    const { error } = edit
      ? await supabase.rpc("resubmit_vehicle_booking", {
          p_id: edit.id, p_destination: v.destination.trim(), p_purpose: v.purpose.trim(),
          p_passengers: list.length, p_starts_at: starts_at, p_ends_at: ends_at, p_travelers: list, p_expenses: exps,
        })
      : await supabase.from("vehicle_bookings").insert({
          destination: v.destination.trim(), purpose: v.purpose.trim(), passengers: list.length, starts_at, ends_at,
          travelers: list, expenses: exps,
        });
    setSaving(false);
    if (error) setErr(errText(error)); else onSaved();
  };

  return (
    <Modal title={edit ? "แก้ไขคำขอแล้วส่งใหม่" : copy ? "ขอเพิ่มอีกคัน" : "ขออนุญาตไปราชการและใช้รถ"} onClose={onClose}>
      <form className="form" onSubmit={save}>
        {copy && <p className="muted small">ใช้ข้อมูลจากคำขอไป “{copy.destination}” — ใส่รายชื่อผู้เดินทางของคันนี้ แล้วส่ง (เป็นคำขอแยก พิจารณาทีละคัน)</p>}
        {edit?.approver_note && <p className="error">เหตุผลที่ส่งกลับ: {edit.approver_note}</p>}
        <Field label="ไปราชการเพื่อ" hint="ข้อความนี้จะพิมพ์ต่อจากคำว่า “ไปราชการเพื่อ” ในคำสั่ง">
          <textarea id="vr-purpose" required rows={3} maxLength={1000} value={v.purpose} onChange={set("purpose")} placeholder="เช่น นำนักเรียนเข้าร่วมการแข่งขันวอลเลย์บอลระดับภูมิภาค (รอบโซน)" />
        </Field>
        <Field label="สถานที่ (ณ)"><input id="vr-dest" required maxLength={300} value={v.destination} onChange={set("destination")} placeholder="เช่น โรงเรียนหนองคายวิทยาคาร อำเภอเมือง จังหวัดหนองคาย" /></Field>
        <div className="row2">
          <Field label="วันที่ออก"><input id="vr-sdate" type="date" required value={v.sDate} onChange={set("sDate")} /></Field>
          <Field label="เวลาออก"><input id="vr-stime" type="time" required value={v.sTime} onChange={set("sTime")} /></Field>
        </div>
        <div className="row2">
          <Field label="วันที่กลับ"><input id="vr-edate" type="date" required min={v.sDate} value={v.eDate} onChange={set("eDate")} /></Field>
          <Field label="เวลากลับ"><input id="vr-etime" type="time" required value={v.eTime} onChange={set("eTime")} /></Field>
        </div>

        <fieldset className="fs">
          <legend>ผู้เดินทาง ({travelers.filter((x) => x.name.trim()).length} คน)</legend>
          {travelers.map((x, i) => (
            <div key={i} className="trav-row">
              <span className="muted small">{i + 1}.</span>
              <input id={`tv-name-${i}`} aria-label={`ชื่อผู้เดินทางคนที่ ${i + 1}`} placeholder="ชื่อ-นามสกุล (มีคำนำหน้า)" maxLength={120} value={x.name} onChange={(e) => setT(i, "name", e.target.value)} />
              <input id={`tv-pos-${i}`} aria-label={`ตำแหน่งคนที่ ${i + 1}`} placeholder="ตำแหน่ง" list="positions" maxLength={120} value={x.position} onChange={(e) => setT(i, "position", e.target.value)} />
              <button type="button" className="icon-btn" aria-label="ลบ" disabled={travelers.length === 1} onClick={() => setTravelers(travelers.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <datalist id="positions"><option value="ครู" /><option value="นักเรียน" /><option value="ครูผู้ช่วย" /><option value="พนักงานราชการ" /><option value="ลูกจ้างชั่วคราว" /></datalist>
          <button type="button" className="link" onClick={() => setTravelers([...travelers, { name: "", position: "" }])}>+ เพิ่มผู้เดินทาง</button>
          <p className="muted small">พนักงานขับรถที่หัวหน้างานจัดให้ จะถูกเพิ่มท้ายรายชื่อในคำสั่งเอง</p>
        </fieldset>

        <fieldset className="fs">
          <legend>ขอเบิกจากเงินอุดหนุนการศึกษา/เงินรายได้สถานศึกษา</legend>
          {EXPENSES.map((x) => (
            <label key={x.key} className="check">
              <input id={`exp-${x.key}`} type="checkbox" checked={expenses.includes(x.key)} onChange={() => toggleExp(x.key)} /> {x.label}
            </label>
          ))}
        </fieldset>
        {leadDays > 0 && leadDays < LEAD_DAYS && (
          <p className="warn-box">ยื่นล่วงหน้าน้อยกว่า {LEAD_DAYS} วัน — ผู้พิจารณาอาจจัดรถไม่ทัน ส่งได้ แต่ควรแจ้งงานยานพาหนะด้วย</p>
        )}
        {err && <p className="error">{err}</p>}
        <button className="btn primary big" disabled={saving}>{saving ? "กำลังส่ง…" : edit ? "ส่งใหม่" : "ส่งคำขอ"}</button>
      </form>
    </Modal>
  );
}

function ReviewForm({ booking, vehicles, drivers, onClose, onDone }: {
  booking: VBooking; vehicles: Vehicle[]; drivers: Driver[]; onClose: () => void; onDone: () => void;
}) {
  // ขั้นมาจากสถานะคำขอ (คนเดียวถือหลายบทบาทได้)
  const role = booking.status === "pending" ? "vehicle_head" : booking.status === "pending_deputy" ? "deputy" : "director";
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

  const reject = async () => {
    if (!note.trim()) return setErr("กรุณาระบุเหตุผลที่ไม่อนุมัติ");
    if (!confirm("ไม่อนุมัติและยุติเรื่อง? ผู้ขอจะต้องยื่นคำขอใหม่ถ้าจะไป")) return;
    setSaving(true); setErr("");
    const { error } = await supabase.rpc("reject_vehicle_booking", { p_id: booking.id, p_note: note });
    setSaving(false);
    if (error) setErr(errText(error)); else onDone();
  };

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
          {!isHead && vname && <div className="small"><CarFront size={14} style={{ verticalAlign: "-2px" }} /> {vname}{dname ? ` · คนขับ ${dname}` : ""}</div>}
          {booking.travelers?.length > 0 && (
            <ol className="small trav-list">{booking.travelers.map((t, i) => <li key={i}>{t.name} <span className="muted">· {t.position}</span></li>)}</ol>
          )}
          {booking.expenses?.length > 0 && <div className="small muted">ขอเบิก: {EXPENSES.filter((x) => booking.expenses.includes(x.key)).map((x) => x.label.split(" (")[0]).join(", ")}</div>}
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
                {vehicles.map((v) => {
                  // พ.ร.บ./ภาษีต้องใช้ได้ถึงวันกลับ, รถต้องไม่ซ่อมบำรุง (DB ตรวจซ้ำ)
                  const docsOut = VEHICLE_DOCS.filter((d) => d.required).some((d) => { const l = licenseDaysLeft(v[d.key], booking.ends_at); return l !== null && l < 0; });
                  const insLeft = licenseDaysLeft(v.insurance_expiry, booking.ends_at);
                  const why = v.condition !== "ready" ? " — ซ่อมบำรุง" : docsOut ? " — พ.ร.บ./ภาษีหมด" : busyV.has(v.id) ? " — ไม่ว่าง" : "";
                  return (
                    <option key={v.id} value={v.id} disabled={!!why}>
                      {v.name}{v.seats ? ` (${v.seats} ที่นั่ง)` : ""}{why}
                      {!why && v.seats && v.seats < booking.passengers ? " — ที่นั่งไม่พอ" : ""}
                      {!why && insLeft !== null && insLeft < 0 ? " — ประกันภัยหมด" : ""}
                    </option>
                  );
                })}
              </select>
            </Field>
            <Field label="คนขับ (ไม่บังคับ)">
              <select value={driverId} onChange={(e) => setDriverId(e.target.value)} disabled={!busy}>
                <option value="">— ไม่ระบุ / ขับเอง —</option>
                {drivers.map((d) => {
                  // ใบขับขี่ต้องใช้ได้ถึงวันกลับ (DB ตรวจซ้ำ)
                  const left = licenseDaysLeft(d.license_expiry, booking.ends_at);
                  const expired = left !== null && left < 0;
                  return (
                    <option key={d.id} value={d.id} disabled={busyD.has(d.id) || expired}>
                      {d.full_name}{busyD.has(d.id) ? " — ติดงาน" : ""}{expired ? " — ใบขับขี่หมดอายุ" : left === null ? " — ยังไม่กรอกวันหมดอายุใบขับขี่" : ""}
                    </option>
                  );
                })}
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
        {role === "director" && (
          <button className="link danger" disabled={saving} onClick={reject}>ไม่อนุมัติ (ยุติเรื่อง ไม่ต้องแก้ส่งใหม่)</button>
        )}
      </div>
    </Modal>
  );
}

/** เตือนเมื่อยื่นล่วงหน้าน้อยกว่าเกณฑ์ */
function LeadChip({ b }: { b: VBooking }) {
  const days = (new Date(b.starts_at).getTime() - new Date(b.created_at).getTime()) / 86400000;
  if (days >= LEAD_DAYS) return null;
  return <span className="chip warn">ยื่นล่วงหน้า {days < 1 ? "ไม่ถึง 1" : Math.floor(days)} วัน</span>;
}

/** ลำดับขั้นของคำขอ (ตรงกับ flow ใน DB): ยื่นคำขอ → จัดรถ → รอง ผอ. → ผอ. → เดินทาง → ปิดงาน */
const PROGRESS = ["ยื่นคำขอ", "จัดรถ", "รอง ผอ.", "ผอ.", "เดินทาง", "ปิดงาน"];
const AT: Record<string, number> = { returned: 0, pending: 1, pending_deputy: 2, pending_director: 3, rejected: 3, approved: 4, on_trip: 4, completed: 6 };
function Progress({ status }: { status: string }) {
  if (status === "cancelled") return null;
  const at = AT[status] ?? 0;
  const stop = status === "returned" || status === "rejected";
  return (
    <ol className="progress" aria-label="ขั้นตอนของคำขอ">
      {PROGRESS.map((label, i) => {
        const cls = i < at ? "done" : i === at ? (stop ? "stop" : "now") : "";
        return (
          <li key={label} className={cls} aria-current={i === at ? "step" : undefined}>
            <span className="dot">{i < at ? <Check size={12} strokeWidth={3} /> : i === at && stop ? <X size={12} strokeWidth={3} /> : null}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
