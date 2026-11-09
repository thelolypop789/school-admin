import { useCallback, useEffect, useState } from "react";
import { errText, supabase } from "../lib/supabase";
import { useMe } from "../lib/me";
import { dayRange, fmtRange, fmtTime, hhmm, toISO, todayISO } from "../lib/time";
import { DateNav, Empty, Field, Modal, StatusChip, Timeline } from "../components/ui";

export type Room = { id: number; name: string; capacity: number | null; equipment: string[]; note: string | null; active: boolean };
type Booking = {
  id: number; room_id: number; booked_by: string; title: string; attendees: number | null;
  starts_at: string; ends_at: string; status: string;
  profiles: { full_name: string; email: string } | null;
};

const SELECT = "id,room_id,booked_by,title,attendees,starts_at,ends_at,status,profiles!room_bookings_booked_by_fkey(full_name,email)";

export default function Rooms() {
  const me = useMe();
  const [date, setDate] = useState(todayISO());
  const [rooms, setRooms] = useState<Room[]>([]);
  const [day, setDay] = useState<Booking[]>([]);
  const [mine, setMine] = useState<Booking[]>([]);
  const [form, setForm] = useState<{ room_id: number; start?: string } | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [from, to] = dayRange(date);
    const [r, d, m] = await Promise.all([
      supabase.from("rooms").select("*").eq("active", true).order("name"),
      supabase.from("room_bookings").select(SELECT).eq("status", "confirmed").lt("starts_at", to).gt("ends_at", from).order("starts_at"),
      supabase.from("room_bookings").select(SELECT).eq("booked_by", me.id).eq("status", "confirmed")
        .gt("ends_at", new Date().toISOString()).order("starts_at").limit(20),
    ]);
    const e = r.error || d.error || m.error;
    if (e) setErr(errText(e));
    setRooms((r.data as Room[]) ?? []);
    setDay((d.data as unknown as Booking[]) ?? []);
    setMine((m.data as unknown as Booking[]) ?? []);
  }, [date, me.id]);

  // load() ตั้ง state หลัง await (ไม่ใช่ sync) — rule มองไม่เห็นข้าม async function
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const cancel = async (b: Booking) => {
    if (!confirm(`ยกเลิกการจอง "${b.title}" ?`)) return;
    const { error } = await supabase.from("room_bookings").update({ status: "cancelled" }).eq("id", b.id);
    if (error) alert(errText(error)); else load();
  };

  const range = dayRange(date);
  return (
    <>
      <div className="page-head">
        <h1>จองห้องประชุม</h1>
        <DateNav date={date} onChange={setDate} />
      </div>
      {err && <p className="error">{err}</p>}
      {rooms.length === 0 && <Empty>ยังไม่มีห้องประชุม{me.role === "admin" ? " — เพิ่มได้ที่เมนู จัดการ" : ""}</Empty>}

      <div className="grid">
        {rooms.map((room) => {
          const list = day.filter((b) => b.room_id === room.id);
          return (
            <section key={room.id} className="card">
              <div className="row between">
                <div>
                  <h3>{room.name}</h3>
                  <p className="muted small">
                    {room.capacity ? `${room.capacity} ที่นั่ง` : ""}
                    {room.equipment.length ? ` · ${room.equipment.join(", ")}` : ""}
                  </p>
                </div>
                <button className="btn primary" onClick={() => setForm({ room_id: room.id })}>+ จอง</button>
              </div>
              <Timeline day={range} items={list.map((b) => ({ id: b.id, starts_at: b.starts_at, ends_at: b.ends_at, label: b.title }))} />
              {list.length === 0 ? <p className="muted small">ว่างทั้งวัน</p> : (
                <ul className="list">
                  {list.map((b) => (
                    <li key={b.id}>
                      <b>{fmtTime(b.starts_at)}–{fmtTime(b.ends_at)}</b> {b.title}
                      <span className="muted small"> · {b.profiles?.full_name || b.profiles?.email}</span>
                      {(b.booked_by === me.id || me.role === "admin") && (
                        <button className="link danger" onClick={() => cancel(b)}>ยกเลิก</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <h2>การจองของฉัน</h2>
      {mine.length === 0 ? <Empty>ยังไม่มีการจองที่กำลังจะถึง</Empty> : (
        <div className="card">
          <ul className="list">
            {mine.map((b) => (
              <li key={b.id}>
                <b>{fmtRange(b.starts_at, b.ends_at)}</b> · {rooms.find((r) => r.id === b.room_id)?.name ?? "ห้อง"} · {b.title} <StatusChip status={b.status} />
                <button className="link danger" onClick={() => cancel(b)}>ยกเลิก</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {form && (
        <BookRoomForm rooms={rooms} date={date} roomId={form.room_id} busy={day}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />
      )}
    </>
  );
}

function BookRoomForm({ rooms, date, roomId, busy, onClose, onSaved }: {
  rooms: Room[]; date: string; roomId: number; busy: Booking[]; onClose: () => void; onSaved: () => void;
}) {
  const [v, setV] = useState({ room_id: roomId, date, start: "09:00", end: "10:00", title: "", attendees: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });

  // เตือนก่อนกดบันทึกถ้าชนกับรายการที่โหลดมาแล้ว (ตัวตัดสินจริงคือ constraint ใน DB)
  const startISO = toISO(v.date, v.start), endISO = toISO(v.date, v.end);
  const clash = v.date === date ? busy.find((b) => b.room_id === Number(v.room_id) && b.starts_at < endISO && b.ends_at > startISO) : undefined;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (endISO <= startISO) return setErr("เวลาสิ้นสุดต้องหลังเวลาเริ่ม");
    setSaving(true);
    const { error } = await supabase.from("room_bookings").insert({
      room_id: Number(v.room_id), title: v.title.trim(), attendees: v.attendees ? Number(v.attendees) : null,
      starts_at: startISO, ends_at: endISO,
    });
    setSaving(false);
    if (error) setErr(errText(error)); else onSaved();
  };

  return (
    <Modal title="จองห้องประชุม" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <Field label="ห้อง">
          <select value={v.room_id} onChange={set("room_id")}>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="วันที่"><input type="date" required value={v.date} onChange={set("date")} /></Field>
        <div className="row2">
          <Field label="เริ่ม"><input type="time" required step={900} value={v.start} onChange={set("start")} /></Field>
          <Field label="สิ้นสุด"><input type="time" required step={900} value={v.end} onChange={set("end")} /></Field>
        </div>
        <Field label="หัวข้อการประชุม"><input required maxLength={200} value={v.title} onChange={set("title")} placeholder="เช่น ประชุมกลุ่มสาระคณิตศาสตร์" /></Field>
        <Field label="จำนวนผู้เข้าร่วม (ไม่บังคับ)"><input type="number" min={1} inputMode="numeric" value={v.attendees} onChange={set("attendees")} /></Field>
        {clash && <p className="warn-box">ชนกับ "{clash.title}" {hhmm(clash.starts_at)}–{hhmm(clash.ends_at)}</p>}
        {err && <p className="error">{err}</p>}
        <button className="btn primary big" disabled={saving}>{saving ? "กำลังบันทึก…" : "ยืนยันการจอง"}</button>
      </form>
    </Modal>
  );
}
