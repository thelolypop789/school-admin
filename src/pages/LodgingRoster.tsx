import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { errText, supabase } from "../lib/supabase";
import { navigate } from "../lib/router";
import { useMe } from "../lib/me";
import { fmtDate, fmtDateTime } from "../lib/time";
import { isLodgingViewer, KIND, total, type Allocation, type Kind, type LodgingEvent, type LodgingRequest, type RoomRow, type Venue } from "../lib/lodging";

type Data = { ev: LodgingEvent; reqs: LodgingRequest[]; allocs: Allocation[]; rooms: RoomRow[]; venues: Venue[] };
const ORDER: Kind[] = ["male", "female", "teacher", "mixed"];

/**
 * รายชื่อห้องพักสำหรับโต๊ะต้อนรับวันงาน (พิมพ์ A4): ทุกห้องที่มีคน → โรงเรียน จำนวนแยกประเภท ผู้ประสานงาน เบอร์
 * + โรงเรียนที่ส่งต่อไปที่พักเครือข่าย · เห็นเฉพาะผู้ดูรายละเอียด (มีชื่อและเบอร์โทร)
 */
export default function LodgingRoster() {
  const me = useMe();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      const evs = await supabase.from("lodging_events").select("*").eq("active", true).order("starts_on").limit(1);
      const ev = (evs.data as LodgingEvent[] | null)?.[0];
      if (evs.error || !ev) return setErr(evs.error ? errText(evs.error) : "ยังไม่มีงานที่เปิดอยู่");
      const [rq, rm, vn] = await Promise.all([
        supabase.from("lodging_requests").select("*").eq("event_id", ev.id).in("status", ["pending", "approved"]).order("school_name"),
        supabase.from("lodging_rooms").select("*").order("building").order("floor").order("sort"),
        supabase.rpc("lodging_venues_list"),
      ]);
      const reqs = (rq.data as LodgingRequest[]) ?? [];
      const al = reqs.length ? await supabase.from("lodging_allocations").select("*").in("request_id", reqs.map((r) => r.id)) : { data: [], error: null };
      const e = rq.error || rm.error || al.error;
      if (e) return setErr(errText(e));
      setD({ ev, reqs, allocs: (al.data as Allocation[]) ?? [], rooms: (rm.data as RoomRow[]) ?? [], venues: (vn.data as Venue[]) ?? [] });
    })();
  }, []);

  if (!isLodgingViewer(me)) return <div className="card"><p>รายชื่อนี้มีชื่อและเบอร์โทร เปิดได้เฉพาะฝ่ายอาคารสถานที่และผู้บริหาร</p></div>;
  if (err) return <p className="error">{err}</p>;
  if (!d) return <div className="spinner" />;

  const req = (id: number) => d.reqs.find((r) => r.id === id)!;
  const rows = d.rooms
    .map((room) => {
      const byReq = new Map<number, Allocation[]>();
      for (const a of d.allocs.filter((x) => x.room_id === room.id)) byReq.set(a.request_id, [...(byReq.get(a.request_id) ?? []), a]);
      return { room, groups: [...byReq.entries()].map(([rid, list]) => ({ r: req(rid), list })) };
    })
    .filter((x) => x.groups.length > 0);
  const referred = d.reqs.filter((r) => r.venue_id);
  const waiting = d.reqs.filter((r) => r.status === "pending" && !r.venue_id && !d.allocs.some((a) => a.request_id === r.id));
  const people = (list: Allocation[]) => ORDER.map((k) => [k, list.filter((a) => a.kind === k).reduce((n, a) => n + a.people, 0)] as const)
    .filter(([, n]) => n > 0).map(([k, n]) => `${KIND[k]} ${n}`).join(" · ");
  const phone = (p: string) => (/^0+$/.test(p) ? "— (ยังไม่มีเบอร์)" : p);

  return (
    <>
      <div className="no-print print-toolbar">
        <button className="btn" onClick={() => navigate("/lodging")}>‹ กลับ</button>
        <button className="btn primary" onClick={() => window.print()}><Printer size={18} />พิมพ์</button>
        <span className="muted small">ข้อมูล ณ {fmtDateTime(new Date().toISOString())} น. · พิมพ์ใหม่ทุกครั้งก่อนวันงาน</span>
      </div>
      <article className="print-doc roster">
        <header className="ro-head">
          <h1>รายชื่อห้องพัก · {d.ev.name}</h1>
          <p>{fmtDate(d.ev.starts_on, { day: "numeric", month: "long" })} – {fmtDate(d.ev.ends_on, { day: "numeric", month: "long", year: "numeric" })} · โรงเรียนวังหลวงพิทยาสรรพ์ · พิมพ์เมื่อ {fmtDateTime(new Date().toISOString())} น.</p>
        </header>

        <table className="ro-table">
          <thead><tr><th>ห้อง</th><th>โรงเรียน</th><th>ผู้เข้าพัก</th><th className="n">รวม</th><th>ผู้ประสานงาน / โทร</th></tr></thead>
          <tbody>
            {rows.map(({ room, groups }) => groups.map(({ r, list }, i) => (
              <tr key={`${room.id}-${r.id}`} className={i === 0 ? "first" : ""}>
                {i === 0 && <td rowSpan={groups.length} className="ro-room"><b>{room.name}</b><small>{room.building} ชั้น {room.floor} · นอนได้ {room.capacity}</small></td>}
                <td>{r.school_name}{r.status === "pending" && <em> (รออนุมัติ)</em>}</td>
                <td>{people(list)}</td>
                <td className="n">{list.reduce((n, a) => n + a.people, 0)}</td>
                <td>{r.contact_name}<br /><span className="ro-tel">{phone(r.phone)}</span></td>
              </tr>
            )))}
          </tbody>
        </table>

        {referred.length > 0 && (
          <>
            <h2>ส่งต่อไปที่พักเครือข่าย</h2>
            <table className="ro-table">
              <thead><tr><th>โรงเรียน</th><th className="n">คน</th><th>ที่พัก</th><th>ผู้ประสานงานที่พัก / โทร</th></tr></thead>
              <tbody>
                {referred.map((r) => {
                  const v = d.venues.find((x) => x.id === r.venue_id);
                  return (
                    <tr key={r.id}>
                      <td>{r.school_name}<br /><small>{r.contact_name} · {phone(r.phone)}</small></td>
                      <td className="n">{r.venue_people ?? total(r)}</td>
                      <td>{v?.name ?? "-"}{v?.distance_km != null && <small> ({v.distance_km} กม.)</small>}</td>
                      <td>{v?.contact ?? "-"}<br /><span className="ro-tel">{[v?.phone1, v?.phone2].filter(Boolean).join(", ")}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        {waiting.length > 0 && (
          <p className="ro-wait">ยังไม่ได้จัดห้อง {waiting.length} โรงเรียน: {waiting.map((r) => `${r.school_name} (${total(r)} คน)`).join(", ")}</p>
        )}
      </article>
    </>
  );
}
