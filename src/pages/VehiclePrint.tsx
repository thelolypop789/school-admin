import { useEffect, useState } from "react";
import { errText, supabase } from "../lib/supabase";
import { navigate } from "../lib/router";
import { fmtDate, fmtTime } from "../lib/time";
import { STEP_SELECT, type Step } from "../lib/vehicle";
import { VB_SELECT, type VBooking } from "./Vehicles";

type Full = VBooking & {
  vehicle: { name: string; plate: string | null } | null;
  driver: { full_name: string; phone: string | null } | null;
};

const longDate = (iso: string) => fmtDate(iso, { day: "numeric", month: "long", year: "numeric" });
const DOTS = "……………………………………";

/**
 * ใบขออนุญาตไปราชการและใช้รถยนต์ส่วนกลาง (พิมพ์ได้เมื่อ ผอ. อนุมัติแล้ว)
 * ผู้ขอ / หัวหน้างาน / รอง ผอ. แสดงชื่อและเวลาที่ดำเนินการในระบบ ส่วน ผอ. เว้นช่องให้ลงนามจริง
 */
export default function VehiclePrint({ id }: { id: number }) {
  const [b, setB] = useState<Full | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      supabase.from("vehicle_bookings").select(`${VB_SELECT},vehicle:vehicles(name,plate),driver:drivers(full_name,phone)`).eq("id", id).maybeSingle(),
      supabase.from("vehicle_booking_steps").select(STEP_SELECT).eq("booking_id", id).order("acted_at"),
    ]).then(([bk, st]) => {
      const e = bk.error || st.error;
      if (e) return setErr(errText(e));
      if (!bk.data) return setErr("ไม่พบคำขอนี้");
      setB(bk.data as unknown as Full);
      setSteps((st.data as unknown as Step[]) ?? []);
    });
  }, [id]);

  if (err) return <p className="error">{err}</p>;
  if (!b) return <div className="spinner" />;
  if (b.status !== "approved") {
    return (
      <div className="card">
        <p>ใบขออนุญาตพิมพ์ได้เมื่อผู้อำนวยการอนุมัติแล้วเท่านั้น</p>
        <button className="btn" onClick={() => navigate("/vehicles")}>กลับ</button>
      </div>
    );
  }

  // ขั้นล่าสุดของแต่ละบทบาท (กรณีเคยถูกส่งกลับ ใช้ครั้งที่ส่งต่อครั้งสุดท้าย)
  const last = (stage: string, action: Step["action"]) => [...steps].reverse().find((s) => s.stage === stage && s.action === action);
  const submit = last("requester", "submit");
  const head = last("head", "forward");
  const deputy = last("deputy", "forward");
  const director = last("director", "forward");
  const nameOf = (s?: Step) => s?.actor?.full_name || s?.actor?.email || DOTS;
  const done = (s?: Step) => (s ? `ดำเนินการในระบบ ${longDate(s.acted_at)} เวลา ${fmtTime(s.acted_at)} น.` : "");
  const sameDay = longDate(b.starts_at) === longDate(b.ends_at);

  return (
    <>
      <div className="no-print print-toolbar">
        <button className="btn" onClick={() => navigate("/vehicles")}>‹ กลับ</button>
        <button className="btn primary" onClick={() => window.print()}>🖨️ พิมพ์</button>
      </div>

      <article className="print-doc">
        <h1 className="pd-title">บันทึกข้อความ</h1>
        <div className="pd-meta">
          <div><b>ส่วนราชการ</b> โรงเรียนวังหลวงพิทยาสาร</div>
          <div className="pd-row"><span><b>ที่</b> {DOTS}</span><span><b>วันที่</b> {longDate(submit?.acted_at ?? b.starts_at)}</span></div>
          <div><b>เรื่อง</b> ขออนุญาตไปราชการและขอใช้รถยนต์ส่วนกลาง</div>
        </div>
        <hr />
        <p><b>เรียน</b> ผู้อำนวยการโรงเรียนวังหลวงพิทยาสาร</p>
        <p className="pd-indent">
          ด้วยข้าพเจ้า {b.requester?.full_name || b.requester?.email} ตำแหน่ง {DOTS} มีความประสงค์ขออนุญาตไปราชการที่ <u>{b.destination}</u> เพื่อ <u>{b.purpose}</u>{" "}
          {sameDay
            ? <>ในวันที่ {longDate(b.starts_at)} ตั้งแต่เวลา {fmtTime(b.starts_at)} น. ถึง {fmtTime(b.ends_at)} น.</>
            : <>ตั้งแต่วันที่ {longDate(b.starts_at)} เวลา {fmtTime(b.starts_at)} น. ถึงวันที่ {longDate(b.ends_at)} เวลา {fmtTime(b.ends_at)} น.</>}
          {" "}มีผู้เดินทางรวม {b.passengers} คน และขออนุญาตใช้รถยนต์ส่วนกลางของโรงเรียน
        </p>
        <p className="pd-indent">จึงเรียนมาเพื่อโปรดพิจารณาอนุญาต</p>
        <Sign name={nameOf(submit)} role="ผู้ขออนุญาต" sub={done(submit)} />

        <div className="pd-grid">
          <section>
            <h2>ความเห็นหัวหน้างานยานพาหนะ</h2>
            <p>จัดรถ {b.vehicle?.name ?? DOTS}{b.vehicle?.plate ? ` ทะเบียน ${b.vehicle.plate}` : ""}</p>
            <p>พนักงานขับรถ {b.driver?.full_name ?? "ผู้ขอขับเอง / ไม่ระบุ"}</p>
            {head?.note && <p>หมายเหตุ {head.note}</p>}
            <Sign name={nameOf(head)} role="หัวหน้างานยานพาหนะ" sub={done(head)} />
          </section>
          <section>
            <h2>ความเห็นรองผู้อำนวยการฝ่ายบริหารทั่วไป</h2>
            <p>☑ เห็นควรอนุญาต</p>
            {deputy?.note && <p>หมายเหตุ {deputy.note}</p>}
            <Sign name={nameOf(deputy)} role="รองผู้อำนวยการฝ่ายบริหารทั่วไป" sub={done(deputy)} />
          </section>
        </div>

        <section className="pd-director">
          <h2>คำสั่งผู้อำนวยการ</h2>
          <p>☑ อนุญาต &nbsp;&nbsp; ☐ ไม่อนุญาต</p>
          {director?.note && <p>หมายเหตุ {director.note}</p>}
          <Sign name={nameOf(director)} role="ผู้อำนวยการโรงเรียนวังหลวงพิทยาสาร" sub={director ? `อนุมัติในระบบ ${longDate(director.acted_at)}` : ""} live />
        </section>
        <p className="pd-foot">เลขที่คำขอ #{b.id} · พิมพ์จากระบบงานบริหารทั่วไป</p>
      </article>
    </>
  );
}

function Sign({ name, role, sub, live }: { name: string; role: string; sub: string; live?: boolean }) {
  return (
    <div className={`pd-sign${live ? " live" : ""}`}>
      <div>ลงชื่อ {live ? "……………………………………………" : <i>(ดำเนินการในระบบ)</i>}</div>
      <div>( {name} )</div>
      <div>{role}</div>
      {sub && <div className="pd-sub">{sub}</div>}
      {live && <div>วันที่ ……… / ……… / ………</div>}
    </div>
  );
}
