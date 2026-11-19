import { useEffect, useState } from "react";
import { Bell, CarFront, ChevronRight, MessageCircle, Presentation, Toilet, Wrench } from "lucide-react";
import { InstallNudge } from "../components/Install";
import { GaUpcoming } from "../components/GaUpcoming";
import { canInspectToilets, isToiletTeam } from "../lib/toilet";
import { supabase } from "../lib/supabase";
import { useMe } from "../lib/me";
import { navigate } from "../lib/router";
import { dayRange, fmtDate, fmtTime, todayISO } from "../lib/time";
import { StatusChip } from "../components/ui";
import { licenseDaysLeft, OPEN, VEHICLE_DOCS } from "../lib/vehicle";
import { hasRole, reviewStatuses, rolesLabel } from "../lib/roles";
import { isRepairExec, isRepairHead } from "../lib/repair";
import { LOGO, SCHOOL_NAME } from "../lib/brand";

type Upcoming = { kind: "room" | "vehicle"; id: number; title: string; starts_at: string; ends_at: string; status: string };
type Todo = { key: string; title: string; sub: string; count: number; path: string };
type Counts = {
  review: number; returned: number; trips: number; toiletsLeft: number; toiletsTotal: number; docs: number;
  repairsDecide: number; repairsPlan: number; repairsOpen: number; repairsUrgent: number; carsToday: number;
};

const HELLO_STRIP = /^(นางสาว|นาง|นาย|ว่าที่ร้อยตรี|ดร\.)\s*/;

/** หน้าแรก: ทักทาย → เรื่องที่รอคุณ → แผ่นสีประจำงาน (ตัวเลขสด) → สัปดาห์นี้ของฝ่าย → นัดหมายของฉัน */
export default function Home({ onEditProfile }: { onEditProfile: () => void }) {
  const me = useMe();
  const review = reviewStatuses(me);
  const reviewKey = review.join(",");
  const logsTrips = hasRole(me, "vehicle_head", "admin");
  const inspects = canInspectToilets(me);
  const repairExec = isRepairExec(me), repairHead = isRepairHead(me);
  const [todayRooms, setTodayRooms] = useState<{ id: number; title: string; starts_at: string; ends_at: string; rooms: { name: string } | null }[] | null>(null);
  const [mine, setMine] = useState<Upcoming[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [showTodos, setShowTodos] = useState(false);

  useEffect(() => {
    const [from, to] = dayRange(todayISO());
    const now = new Date().toISOString();
    const zero = Promise.resolve({ count: 0 });
    const head = { count: "exact" as const, head: true };
    Promise.all([
      supabase.from("room_bookings").select("id,title,starts_at,ends_at,rooms(name)").eq("status", "confirmed")
        .lt("starts_at", to).gt("ends_at", from).order("starts_at"),
      supabase.from("room_bookings").select("id,title,starts_at,ends_at,status").eq("booked_by", me.id).eq("status", "confirmed").gt("ends_at", now).order("starts_at").limit(5),
      supabase.from("vehicle_bookings").select("id,destination,starts_at,ends_at,status").eq("booked_by", me.id).in("status", [...OPEN, "on_trip"]).gt("ends_at", now).order("starts_at").limit(5),
      reviewKey ? supabase.from("vehicle_bookings").select("id", head).in("status", reviewKey.split(",")) : zero,
      supabase.from("vehicle_bookings").select("id", head).eq("booked_by", me.id).eq("status", "returned"),
      // งานรถที่ถึงเวลาต้องบันทึก: อนุมัติแล้วและถึงเวลาออก (ยังไม่บันทึกออก) + เดินทางแล้วเลยกำหนดกลับ (ยังไม่ปิดงาน)
      logsTrips ? supabase.from("vehicle_bookings").select("id", head).eq("status", "approved").lte("starts_at", to) : zero,
      logsTrips ? supabase.from("vehicle_bookings").select("id", head).eq("status", "on_trip").lt("ends_at", now) : zero,
      supabase.rpc("toilet_status"),
      logsTrips ? supabase.from("vehicles").select("act_expiry,tax_expiry,insurance_expiry").eq("active", true) : Promise.resolve({ data: [] }),
      logsTrips ? supabase.from("drivers").select("license_expiry").eq("active", true) : Promise.resolve({ data: [] }),
      // แจ้งซ่อม: ผู้บริหารรอตัดสิน · หัวหน้างานอาคารสถานที่รอลงวันที่
      repairExec ? supabase.from("repair_requests").select("id", head).eq("status", "proposed") : zero,
      repairHead ? supabase.from("repair_requests").select("id", head).eq("status", "new") : zero,
      // ตัวเลขสดบนแผ่นสี: เรื่องซ่อมที่ยังไม่เสร็จ/ด่วนมาก · รถที่ออกวันนี้
      supabase.from("repair_requests").select("id", head).in("status", ["new", "proposed", "scheduled"]),
      supabase.from("repair_requests").select("id", head).in("status", ["new", "proposed", "scheduled"]).eq("priority", "urgent"),
      supabase.from("vehicle_bookings").select("id", head).in("status", ["approved", "on_trip"]).lt("starts_at", to).gt("ends_at", from),
    ]).then(([tr, rb, vb, rv, rt, td, tc, ts, vd, dl, rx, rh, ro, ru, ct]) => {
      // เอกสารที่หมดแล้วหรือเหลือ ≤ 30 วัน: พ.ร.บ./ภาษี/ประกันของรถ + ใบขับขี่คนขับ
      const soon = (d: string | null) => { const l = licenseDaysLeft(d); return l !== null && l <= 30; };
      const docs = ((vd.data ?? []) as Record<string, string | null>[]).reduce((n, v) => n + VEHICLE_DOCS.filter((x) => soon(v[x.key])).length, 0)
        + ((dl.data ?? []) as { license_expiry: string | null }[]).filter((d) => soon(d.license_expiry)).length;
      setTodayRooms((tr.data as unknown as NonNullable<typeof todayRooms>) ?? []);
      setMine([
        ...((rb.data ?? []) as { id: number; title: string; starts_at: string; ends_at: string; status: string }[]).map((r) => ({ kind: "room" as const, ...r })),
        ...((vb.data ?? []) as { id: number; destination: string; starts_at: string; ends_at: string; status: string }[])
          .map((v) => ({ kind: "vehicle" as const, id: v.id, title: v.destination, starts_at: v.starts_at, ends_at: v.ends_at, status: v.status })),
      ].sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
      const st = (ts.data as { checks_today: number }[] | null) ?? [];
      setCounts({
        review: rv.count ?? 0, returned: rt.count ?? 0, trips: (td.count ?? 0) + (tc.count ?? 0),
        toiletsLeft: st.filter((s) => s.checks_today === 0).length, toiletsTotal: st.length, docs,
        repairsDecide: rx.count ?? 0, repairsPlan: rh.count ?? 0,
        repairsOpen: ro.count ?? 0, repairsUrgent: ru.count ?? 0, carsToday: ct.count ?? 0,
      });
    });
  }, [me.id, reviewKey, logsTrips, repairExec, repairHead]);

  const firstName = me.full_name.replace(HELLO_STRIP, "").split(" ")[0];
  const todos: Todo[] = counts ? [
    { key: "review", count: counts.review, path: "/vehicles",
      title: reviewKey === "pending_director" ? "คำขอใช้รถรอคุณอนุมัติ" : "คำขอใช้รถรอคุณพิจารณา", sub: "เปิดดูรายละเอียด แล้วส่งต่อหรือส่งกลับ" },
    { key: "repairDecide", count: repairExec ? counts.repairsDecide : 0, path: "/facilities",
      title: "เรื่องแจ้งซ่อมรอคุณพิจารณา", sub: "เห็นควรตามเสนอ ให้ด่วน หรือให้ทำงานอื่นก่อน" },
    { key: "repairPlan", count: repairHead ? counts.repairsPlan : 0, path: "/facilities",
      title: "เรื่องแจ้งซ่อมรอลงวันที่", sub: "ดูเรื่องที่เร่งด่วนก่อน แล้วลงวันที่ทำได้เสนอผู้บริหาร" },
    { key: "returned", count: counts.returned, path: "/vehicles",
      title: "คำขอใช้รถของคุณถูกส่งกลับ", sub: "อ่านเหตุผล แก้ไข แล้วส่งใหม่" },
    { key: "trips", count: logsTrips ? counts.trips : 0, path: "/vehicles",
      title: "งานรถรอบันทึกเลขไมล์", sub: "บันทึกออกเดินทาง หรือปิดงานที่กลับมาแล้ว" },
    { key: "docs", count: logsTrips ? counts.docs : 0, path: "/vehicles",
      title: "เอกสารรถ/ใบขับขี่ใกล้หมดอายุ", sub: "หมดแล้วหรือเหลือไม่เกิน 30 วัน (ดูที่แท็บ รถ)" },
    { key: "toilets", count: inspects ? counts.toiletsLeft : 0, path: "/toilets",
      title: "ห้องน้ำยังไม่ได้ตรวจวันนี้", sub: "สแกน QR หน้าห้องน้ำ หรือกด ตรวจ ในหน้าห้องน้ำ" },
  ].filter((t) => t.count > 0) : [];
  const waiting = todos.reduce((n, t) => n + t.count, 0);
  const openTodo = () => (todos.length === 1 ? navigate(todos[0].path) : setShowTodos((v) => !v));

  const rooms = todayRooms?.length ?? 0;
  const toiletsDone = counts ? counts.toiletsTotal - counts.toiletsLeft : 0;

  return (
    <>
      <section className="hhero">
        <div className="who">
          <span className="seal"><img src={LOGO} alt={`ตรา${SCHOOL_NAME}`} /></span>
          <span><b>บริหารทั่วไป</b><small>{SCHOOL_NAME}</small></span>
        </div>
        <div className="date">{fmtDate(todayISO(), { weekday: "long", day: "numeric", month: "long" })}</div>
        <h1>สวัสดี{firstName ? ` ${firstName}` : ""}</h1>
        <div className="who-line">
          <span>{rolesLabel(me)}{me.position ? ` · ${me.position}` : ""}</span>
          <button className="link" onClick={onEditProfile}>{me.position ? "แก้ไขชื่อและตำแหน่ง" : "ตั้งชื่อและตำแหน่ง (ใช้ในเอกสารราชการ)"}</button>
        </div>
      </section>

      {waiting > 0 && (
        <>
          <button className="alert" onClick={openTodo} aria-expanded={todos.length > 1 ? showTodos : undefined}>
            <span className="gloss c-ga"><Bell size={20} /></span>
            <span className="al-text"><b>{waiting} เรื่องรอคุณ</b><small>{todos.map((t) => t.title).join(" · ")}</small></span>
            <em>{todos.length > 1 && showTodos ? "ซ่อน" : "ดู"}</em>
          </button>
          {showTodos && todos.length > 1 && (
            <ul className="alert-list">
              {todos.map((t) => (
                <li key={t.key}>
                  <button onClick={() => navigate(t.path)}>
                    <span className="n">{t.count}</span>
                    <span>{t.title}<small>{t.sub}</small></span>
                    <ChevronRight size={18} className="muted" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <InstallNudge />

      {!me.line_linked && hasRole(me, "deputy", "director", "vehicle_head", "facilities_head") && (
        <button className="line-nudge" onClick={onEditProfile}>
          <MessageCircle size={22} />
          <span><b>อนุมัติและรับแจ้งเตือนผ่าน LINE ได้แล้ว</b><small>เชื่อม LINE ครั้งเดียว แล้วเรื่องที่รอคุณจะส่งเข้าแชทพร้อมปุ่มอนุมัติ</small></span>
          <ChevronRight size={20} />
        </button>
      )}

      <div className="bento">
        <button className="bx c-fix tall" onClick={() => navigate("/facilities")}>
          <b>แจ้งซ่อม</b><small>ไฟฟ้า ประปา อาคาร เครื่องเรือน</small>
          <span className="bx-n">{counts ? (counts.repairsUrgent || counts.repairsOpen) : "–"}
            <small>{counts && counts.repairsUrgent ? "ด่วนมาก" : "เรื่องค้าง"}</small></span>
          <Wrench size={56} strokeWidth={1.6} className="bx-ic" />
        </button>
        <button className="bx c-room" onClick={() => navigate("/rooms")}>
          <b>จองห้องประชุม</b><small>{todayRooms === null ? "…" : rooms ? `วันนี้มีจอง ${rooms} รายการ` : "วันนี้ยังว่างทุกห้อง"}</small>
          <Presentation size={50} strokeWidth={1.6} className="bx-ic" />
        </button>
        <button className="bx c-car" onClick={() => navigate("/vehicles")}>
          <b>ขอใช้รถ</b><small>{counts === null ? "…" : counts.carsToday ? `ออกวันนี้ ${counts.carsToday} คัน` : "วันนี้ไม่มีรถออก"}</small>
          <CarFront size={50} strokeWidth={1.6} className="bx-ic" />
        </button>
        <button className="bx c-wc wide" onClick={() => navigate("/toilets")}>
          <span><b>{isToiletTeam(me) ? "ตรวจห้องน้ำ" : "รายงานห้องน้ำ"}</b><br />
            <small>{counts && counts.toiletsTotal ? `ตรวจแล้ว ${toiletsDone} จาก ${counts.toiletsTotal} จุด` : "สุขาดี มีความสุข"}</small></span>
          {counts && counts.toiletsTotal > 0 && <span className="bx-bar" aria-hidden><i style={{ width: `${(100 * toiletsDone) / counts.toiletsTotal}%` }} /></span>}
          <Toilet size={44} strokeWidth={1.6} className="bx-ic" />
        </button>
      </div>

      <GaUpcoming />

      <div className="grid" style={{ marginTop: "1.25rem" }}>
        <section className="card">
          <h3>ห้องประชุมวันนี้</h3>
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
          <h3>นัดหมายของฉัน</h3>
          {mine === null ? <div className="spinner" /> : mine.length === 0 ? (
            <p className="muted small">ไม่มีการจองห้องหรือคำขอใช้รถที่กำลังจะถึง</p>
          ) : (
            <ul className="agenda">
              {mine.map((u) => (
                <li key={`${u.kind}${u.id}`}>
                  <time>{fmtDate(u.starts_at, { day: "numeric", month: "short" })}<small>{fmtTime(u.starts_at)}</small></time>
                  <span className="ag-what">
                    <span className={`ag-kind ${u.kind === "room" ? "c-room" : "c-car"}`}>
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
