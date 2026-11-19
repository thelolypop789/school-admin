import { useEffect, useState } from "react";
import { CalendarDays, CarFront, CircleCheck, ClipboardCheck, Gauge, Presentation, Toilet, Undo2, UserPen, type LucideIcon } from "lucide-react";
import { ROLE_LABEL, supabase } from "../lib/supabase";
import { useMe } from "../lib/me";
import { navigate } from "../lib/router";
import { LOGO, SCHOOL_NAME } from "../lib/brand";
import { dayRange, fmtDate, fmtTime, todayISO } from "../lib/time";
import { StatusChip, type Tone } from "../components/ui";
import { OPEN, REVIEW_STATUS } from "../lib/vehicle";

type Upcoming = { kind: "room" | "vehicle"; id: number; title: string; starts_at: string; ends_at: string; status: string };
type Todo = { key: string; icon: LucideIcon; tone: Tone; title: string; sub: string; count: number; path: string };
type Counts = { review: number; returned: number; trips: number; toiletsLeft: number; toiletsTotal: number };

const HELLO_STRIP = /^(นางสาว|นาง|นาย|ว่าที่ร้อยตรี|ดร\.)\s*/;

export default function Home({ onEditProfile }: { onEditProfile: () => void }) {
  const me = useMe();
  const reviewStatus = REVIEW_STATUS[me.role];
  const logsTrips = me.role === "vehicle_head" || me.role === "admin";
  const inspects = me.role === "inspector" || me.role === "admin";
  const [todayRooms, setTodayRooms] = useState<{ id: number; title: string; starts_at: string; ends_at: string; rooms: { name: string } | null }[] | null>(null);
  const [mine, setMine] = useState<Upcoming[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    const [from, to] = dayRange(todayISO());
    const now = new Date().toISOString();
    const zero = Promise.resolve({ count: 0 });
    Promise.all([
      supabase.from("room_bookings").select("id,title,starts_at,ends_at,rooms(name)").eq("status", "confirmed")
        .lt("starts_at", to).gt("ends_at", from).order("starts_at"),
      supabase.from("room_bookings").select("id,title,starts_at,ends_at,status").eq("booked_by", me.id).eq("status", "confirmed").gt("ends_at", now).order("starts_at").limit(5),
      supabase.from("vehicle_bookings").select("id,destination,starts_at,ends_at,status").eq("booked_by", me.id).in("status", [...OPEN, "on_trip"]).gt("ends_at", now).order("starts_at").limit(5),
      reviewStatus ? (supabase.from("vehicle_bookings").select("id", { count: "exact", head: true }).eq("status", reviewStatus)) : zero,
      (supabase.from("vehicle_bookings").select("id", { count: "exact", head: true }).eq("booked_by", me.id).eq("status", "returned")),
      // งานรถที่ถึงเวลาต้องบันทึก: อนุมัติแล้วและถึงเวลาออก (ยังไม่บันทึกออก) + เดินทางแล้วเลยกำหนดกลับ (ยังไม่ปิดงาน)
      logsTrips ? (supabase.from("vehicle_bookings").select("id", { count: "exact", head: true }).eq("status", "approved").lte("starts_at", to)) : zero,
      logsTrips ? (supabase.from("vehicle_bookings").select("id", { count: "exact", head: true }).eq("status", "on_trip").lt("ends_at", now)) : zero,
      supabase.rpc("toilet_status"),
    ]).then(([tr, rb, vb, rv, rt, td, tc, ts]) => {
      setTodayRooms((tr.data as unknown as NonNullable<typeof todayRooms>) ?? []);
      setMine([
        ...((rb.data ?? []) as { id: number; title: string; starts_at: string; ends_at: string; status: string }[]).map((r) => ({ kind: "room" as const, ...r })),
        ...((vb.data ?? []) as { id: number; destination: string; starts_at: string; ends_at: string; status: string }[])
          .map((v) => ({ kind: "vehicle" as const, id: v.id, title: v.destination, starts_at: v.starts_at, ends_at: v.ends_at, status: v.status })),
      ].sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
      const st = (ts.data as { checks_today: number }[] | null) ?? [];
      setCounts({
        review: rv.count ?? 0, returned: rt.count ?? 0, trips: (td.count ?? 0) + (tc.count ?? 0),
        toiletsLeft: st.filter((s) => s.checks_today === 0).length, toiletsTotal: st.length,
      });
    });
  }, [me.id, reviewStatus, logsTrips]);

  const firstName = me.full_name.replace(HELLO_STRIP, "").split(" ")[0];
  const todos: Todo[] = counts ? [
    { key: "review", icon: ClipboardCheck, tone: "vehicles" as Tone, count: counts.review, path: "/vehicles",
      title: me.role === "director" ? "คำขอใช้รถรอคุณอนุมัติ" : "คำขอใช้รถรอคุณพิจารณา", sub: "เปิดดูรายละเอียด แล้วส่งต่อหรือส่งกลับ" },
    { key: "returned", icon: Undo2, tone: "brand" as Tone, count: counts.returned, path: "/vehicles",
      title: "คำขอใช้รถของคุณถูกส่งกลับ", sub: "อ่านเหตุผล แก้ไข แล้วส่งใหม่" },
    { key: "trips", icon: Gauge, tone: "vehicles" as Tone, count: logsTrips ? counts.trips : 0, path: "/vehicles",
      title: "งานรถรอบันทึกเลขไมล์", sub: "บันทึกออกเดินทาง หรือปิดงานที่กลับมาแล้ว (แท็บ บันทึกเดินทาง)" },
    { key: "toilets", icon: Toilet, tone: "toilets" as Tone, count: inspects ? counts.toiletsLeft : 0, path: "/toilets",
      title: "ห้องน้ำยังไม่ได้ตรวจวันนี้", sub: "สแกน QR หน้าห้องน้ำ หรือกด ตรวจ ในหน้าห้องน้ำ" },
  ].filter((t) => t.count > 0) : [];

  return (
    <>
      <section className="hero rays">
        <img src={LOGO} alt={`ตรา${SCHOOL_NAME}`} />
        <div>
          <h1>สวัสดี{firstName ? ` คุณ${firstName}` : ""}</h1>
          <p className="when">{fmtDate(todayISO(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
          <div className="who-line">
            <span className="chip">{ROLE_LABEL[me.role]}</span>
            <button className="link small" onClick={onEditProfile}>
              <UserPen size={14} style={{ verticalAlign: "-2px" }} /> {me.position ? me.position : "ตั้งชื่อและตำแหน่ง (ใช้ในเอกสารราชการ)"}
            </button>
          </div>
        </div>
      </section>

      {counts && (todos.length > 0 ? (
        <>
          <div className="section-title"><h2>สิ่งที่รอคุณ</h2></div>
          <ul className="todo">
            {todos.map((t) => (
              <li key={t.key}>
                <button onClick={() => navigate(t.path)}>
                  <span className={`todo-ic tone-${t.tone}`}><t.icon size={20} /></span>
                  <span className="todo-text"><b>{t.title}</b><span>{t.sub}</span></span>
                  <span className="todo-count">{t.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="all-clear"><CircleCheck size={20} />ไม่มีงานค้างที่ต้องทำตอนนี้</div>
      ))}

      <div className="section-title"><h2>เริ่มงาน</h2></div>
      <div className="tiles">
        <button className="tile" onClick={() => navigate("/rooms")}>
          <span className="tile-ic tone-rooms"><Presentation size={24} /></span>
          <span className="tile-text"><b>จองห้องประชุม</b><small>ดูห้องว่างตามวัน แล้วจองได้ทันที</small></span>
        </button>
        <button className="tile" onClick={() => navigate("/vehicles")}>
          <span className="tile-ic tone-vehicles"><CarFront size={24} /></span>
          <span className="tile-text"><b>ขอใช้รถไปราชการ</b><small>ยื่นคำขอ ติดตามการอนุมัติ พิมพ์คำสั่ง</small></span>
        </button>
        <button className="tile" onClick={() => navigate("/toilets")}>
          <span className="tile-ic tone-toilets"><Toilet size={24} /></span>
          <span className="tile-text"><b>ตรวจห้องน้ำ</b>
            <small>{counts && counts.toiletsTotal > 0
              ? (counts.toiletsLeft ? `วันนี้ยังไม่ตรวจ ${counts.toiletsLeft} จาก ${counts.toiletsTotal} จุด` : `ตรวจครบทั้ง ${counts.toiletsTotal} จุดแล้ววันนี้`)
              : "สุขาดี มีความสุข · ผลตรวจรายวัน"}</small>
          </span>
        </button>
      </div>

      <div className="grid">
        <section className="card">
          <h3><Presentation size={18} color="var(--wave)" /> ห้องประชุมวันนี้</h3>
          {todayRooms === null ? <div className="spinner" /> : todayRooms.length === 0 ? (
            <p className="muted small">วันนี้ยังไม่มีใครจองห้อง</p>
          ) : (
            <ul className="agenda">
              {todayRooms.map((b) => (
                <li key={b.id}>
                  <time>{fmtTime(b.starts_at)}<small>ถึง {fmtTime(b.ends_at)}</small></time>
                  <span className="ag-what">{b.title}<span className="ag-sub">{b.rooms?.name}</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h3><CalendarDays size={18} color="var(--brand)" /> นัดหมายของฉัน</h3>
          {mine === null ? <div className="spinner" /> : mine.length === 0 ? (
            <p className="muted small">ไม่มีการจองห้องหรือคำขอใช้รถที่กำลังจะถึง</p>
          ) : (
            <ul className="agenda">
              {mine.map((u) => (
                <li key={`${u.kind}${u.id}`}>
                  <time>{fmtDate(u.starts_at, { day: "numeric", month: "short" })}<small>{fmtTime(u.starts_at)}</small></time>
                  <span className="ag-what">
                    <span className={`ag-kind tone-${u.kind === "room" ? "rooms" : "vehicles"}`}>
                      {u.kind === "room" ? <Presentation size={12} /> : <CarFront size={12} />}{u.kind === "room" ? "ห้องประชุม" : "รถ"}
                    </span>
                    {u.title}
                    {u.kind === "vehicle" && <span className="ag-sub"><StatusChip status={u.status} /></span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
