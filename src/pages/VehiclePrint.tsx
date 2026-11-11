import { useEffect, useState } from "react";
import { errText, supabase } from "../lib/supabase";
import { navigate } from "../lib/router";
import { fmtDate } from "../lib/time";
import { EXPENSES, STEP_SELECT, type Step, type Traveler } from "../lib/vehicle";
import { VB_SELECT, type VBooking } from "./Vehicles";

const SCHOOL = "โรงเรียนวังหลวงพิทยาสรรพ์";

type Full = VBooking & { driver: { full_name: string } | null };

const d = (iso: string, o: Intl.DateTimeFormatOptions) => fmtDate(iso, o);
const day = (iso: string) => d(iso, { day: "numeric" });
const month = (iso: string) => d(iso, { month: "long" });
const year = (iso: string) => d(iso, { year: "numeric" }).replace(/^พ\.ศ\.\s*/, "");

/** "ในวันที่ 25 พฤศจิกายน 2569" / "ระหว่างวันที่ 25 – 27 พฤศจิกายน 2569" / ข้ามเดือน / ข้ามปี */
function dateText(s: string, e: string): string {
  if (d(s, { dateStyle: "short" }) === d(e, { dateStyle: "short" })) return `ในวันที่ ${day(s)} ${month(s)} ${year(s)}`;
  if (year(s) !== year(e)) return `ระหว่างวันที่ ${day(s)} ${month(s)} ${year(s)} – ${day(e)} ${month(e)} ${year(e)}`;
  if (month(s) !== month(e)) return `ระหว่างวันที่ ${day(s)} ${month(s)} – ${day(e)} ${month(e)} ${year(e)}`;
  return `ระหว่างวันที่ ${day(s)} – ${day(e)} ${month(e)} ${year(e)}`;
}

/**
 * คำสั่งโรงเรียน เรื่อง การอนุมัติการเดินทางไปราชการ (ตามแบบของโรงเรียน)
 * พิมพ์ได้เมื่อ ผอ. อนุมัติในระบบแล้ว — ช่องลงนาม ผอ. เว้นไว้ให้เซ็นจริง, เลขที่คำสั่งเว้นให้งานสารบรรณกรอก
 */
export default function VehiclePrint({ id }: { id: number }) {
  const [b, setB] = useState<Full | null>(null);
  const [director, setDirector] = useState<Step | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      supabase.from("vehicle_bookings").select(`${VB_SELECT},driver:drivers(full_name)`).eq("id", id).maybeSingle(),
      supabase.from("vehicle_booking_steps").select(STEP_SELECT).eq("booking_id", id).eq("stage", "director").eq("action", "forward")
        .order("acted_at", { ascending: false }).limit(1),
    ]).then(([bk, st]) => {
      const e = bk.error || st.error;
      if (e) return setErr(errText(e));
      if (!bk.data) return setErr("ไม่พบคำขอนี้");
      setB(bk.data as unknown as Full);
      setDirector(((st.data as unknown as Step[]) ?? [])[0] ?? null);
    });
  }, [id]);

  if (err) return <p className="error">{err}</p>;
  if (!b) return <div className="spinner" />;
  if (b.status !== "approved") {
    return (
      <div className="card">
        <p>คำสั่งไปราชการพิมพ์ได้เมื่อผู้อำนวยการอนุมัติแล้วเท่านั้น</p>
        <button className="btn" onClick={() => navigate("/vehicles")}>กลับ</button>
      </div>
    );
  }

  const people: Traveler[] = b.travelers?.length
    ? [...b.travelers]
    : [{ name: b.requester?.full_name || b.requester?.email || "", position: "" }];
  if (b.driver && !people.some((p) => p.name.replace(/\s/g, "").includes(b.driver!.full_name.replace(/\s/g, "")))) {
    people.push({ name: b.driver.full_name, position: "พนักงานขับรถ" });
  }
  const orderAt = director?.acted_at ?? new Date().toISOString();
  const directorName = director?.actor?.full_name;

  return (
    <>
      <div className="no-print print-toolbar">
        <button className="btn" onClick={() => navigate("/vehicles")}>‹ กลับ</button>
        <button className="btn primary" onClick={() => window.print()}>🖨️ พิมพ์</button>
        <span className="muted small">คำขอ #{b.id} · เลขที่คำสั่งเว้นไว้ให้งานสารบรรณกรอก</span>
      </div>

      <article className="print-doc order">
        <img className="od-garuda" src="/garuda.png" alt="ตราครุฑ" />
        <div className="od-head">
          <div>คำสั่ง{SCHOOL}</div>
          <div>ที่ ………… / {year(orderAt)}</div>
          <div>เรื่อง การอนุมัติการเดินทางไปราชการ</div>
          <div>……………………………………………………</div>
        </div>

        <p className="od-para">
          อาศัยอำนาจตามคำสั่งสำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน ที่ ๑๓๖๕/๒๕๖๐ เรื่อง มอบอำนาจการอนุมัติการเดินทางไปราชการ
          ลงวันที่ 28 สิงหาคม 2560 โดยเลขาธิการคณะกรรมการการศึกษาขั้นพื้นฐานได้มอบอำนาจให้ผู้อำนวยการสถานศึกษาปฏิบัติราชการแทน
          ในการพิจารณาอนุมัติการเดินทางไปราชการภายในราชอาณาจักรของข้าราชการ ลูกจ้างทุกตำแหน่งและพนักงานราชการในสถานศึกษา{SCHOOL} จึงอนุมัติให้
        </p>

        <ol className="od-people">
          {people.map((p, i) => (
            <li key={i}><span className="od-no">{i + 1}.</span><span className="od-name">{p.name}</span><span>ตำแหน่ง {p.position || "…………………"}</span></li>
          ))}
        </ol>

        <p className="od-para">
          ไปราชการเพื่อ{b.purpose} {dateText(b.starts_at, b.ends_at)} ณ {b.destination}
          {" "}อนุญาตให้เบิกเงินอุดหนุนการศึกษา/เงินรายได้สถานศึกษาของ{SCHOOL}
        </p>

        <ul className="od-exp">
          {EXPENSES.map((x) => <li key={x.key}>( {b.expenses?.includes(x.key) ? "✓" : " "} ) {x.label}</li>)}
        </ul>

        <div className="od-sign">
          <div>สั่ง ณ วันที่ {day(orderAt)} เดือน {month(orderAt)} พ.ศ. {year(orderAt)}</div>
          <div className="od-sigline">(ลงชื่อ)</div>
          <div>( {directorName || "……………………………………"} )</div>
          <div>ผู้อำนวยการ{SCHOOL}</div>
        </div>
      </article>
    </>
  );
}
