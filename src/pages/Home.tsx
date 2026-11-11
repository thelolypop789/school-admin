import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useMe } from "../lib/me";
import { navigate } from "../lib/router";
import { dayRange, fmtDate, fmtRange, fmtTime, todayISO } from "../lib/time";
import { StatusChip } from "../components/ui";
import { OPEN, REVIEW_STATUS } from "../lib/vehicle";

type Upcoming = { kind: "room" | "vehicle"; id: number; title: string; starts_at: string; ends_at: string; status: string };

export default function Home() {
  const me = useMe();
  const reviewStatus = REVIEW_STATUS[me.role];
  const [todayRooms, setTodayRooms] = useState<{ id: number; title: string; starts_at: string; ends_at: string; rooms: { name: string } | null }[]>([]);
  const [mine, setMine] = useState<Upcoming[]>([]);
  const [pending, setPending] = useState(0);
  const [toilet, setToilet] = useState<{ total: number; notToday: number } | null>(null);

  useEffect(() => {
    const [from, to] = dayRange(todayISO());
    const now = new Date().toISOString();
    Promise.all([
      supabase.from("room_bookings").select("id,title,starts_at,ends_at,rooms(name)").eq("status", "confirmed")
        .lt("starts_at", to).gt("ends_at", from).order("starts_at"),
      supabase.from("room_bookings").select("id,title,starts_at,ends_at,status").eq("booked_by", me.id).eq("status", "confirmed").gt("ends_at", now).order("starts_at").limit(5),
      supabase.from("vehicle_bookings").select("id,destination,starts_at,ends_at,status").eq("booked_by", me.id).in("status", OPEN).gt("ends_at", now).order("starts_at").limit(5),
      reviewStatus ? supabase.from("vehicle_bookings").select("id", { count: "exact", head: true }).eq("status", reviewStatus) : Promise.resolve({ count: 0 }),
      supabase.rpc("toilet_status"),
    ]).then(([tr, rb, vb, pc, ts]) => {
      setTodayRooms((tr.data as unknown as typeof todayRooms) ?? []);
      const up: Upcoming[] = [
        ...((rb.data ?? []) as { id: number; title: string; starts_at: string; ends_at: string; status: string }[]).map((r) => ({ kind: "room" as const, ...r })),
        ...((vb.data ?? []) as { id: number; destination: string; starts_at: string; ends_at: string; status: string }[])
          .map((v) => ({ kind: "vehicle" as const, id: v.id, title: v.destination, starts_at: v.starts_at, ends_at: v.ends_at, status: v.status })),
      ].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      setMine(up);
      setPending(pc.count ?? 0);
      const st = (ts.data as { checks_today: number }[] | null) ?? [];
      setToilet({ total: st.length, notToday: st.filter((s) => s.checks_today === 0).length });
    });
  }, [me.id, reviewStatus]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>สวัสดี {me.full_name.split(" ")[0] || ""}</h1>
          <p className="muted">{fmtDate(todayISO(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
      </div>

      {reviewStatus && pending > 0 && (
        <button className="alert-card" onClick={() => navigate("/vehicles")}>
          🚐 มีคำขอใช้รถรอคุณพิจารณา <b>{pending}</b> รายการ →
        </button>
      )}

      <div className="tiles">
        <button className="tile" onClick={() => navigate("/rooms")}><span>🏛️</span>จองห้องประชุม</button>
        <button className="tile" onClick={() => navigate("/vehicles")}><span>🚐</span>ขอใช้รถ</button>
        <button className="tile" onClick={() => navigate("/toilets")}>
          <span>🚻</span>ห้องน้ำ
          {toilet && toilet.total > 0 && <small>{toilet.notToday ? `ยังไม่ตรวจ ${toilet.notToday} จุด` : "ตรวจครบวันนี้ ✓"}</small>}
        </button>
      </div>

      <div className="grid">
        <section className="card">
          <h3>ห้องประชุมวันนี้</h3>
          {todayRooms.length === 0 ? <p className="muted small">ไม่มีการจองวันนี้</p> : (
            <ul className="list">
              {todayRooms.map((b) => <li key={b.id}><b>{fmtTime(b.starts_at)}–{fmtTime(b.ends_at)}</b> {b.rooms?.name} · {b.title}</li>)}
            </ul>
          )}
        </section>
        <section className="card">
          <h3>รายการของฉันที่กำลังจะถึง</h3>
          {mine.length === 0 ? <p className="muted small">ไม่มี</p> : (
            <ul className="list">
              {mine.map((u) => (
                <li key={`${u.kind}${u.id}`}>
                  {u.kind === "room" ? "🏛️" : "🚐"} <b>{fmtRange(u.starts_at, u.ends_at)}</b> {u.title} {u.kind === "vehicle" && <StatusChip status={u.status} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
