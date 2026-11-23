import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ATTEND, DUTY, dutyShown, KIND, type Attend, type DutyStatus, type SessionKind } from "../lib/nst";
import { addDays, fmtDate, hhmm, todayISO } from "../lib/time";
import { errText } from "../lib/supabase";

type CalSession = { id: number; kind: SessionKind; title: string; opens_at: string; closes_at: string; status: Attend | null };
type CalDuty = { id: number; date: string; post: string; starts: string; ends: string; status: DutyStatus };
type Cal = {
  from: string; to: string; now: string; sessions: CalSession[]; duties: CalDuty[];
  stats: { attend: Record<Attend, number>; duty: { done: number; late: number; excused: number; missed: number } };
};

const WEEK = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const t5 = (t: string) => t.slice(0, 5);
const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
const dow = (d: string) => new Date(`${d}T12:00:00+07:00`).getUTCDay();

/** สีสถานะของกราฟ (ผ่านตัวตรวจสี: แยกได้สำหรับคนตาบอดสีเมื่อมีป้ายกำกับ/ช่องว่างระหว่างชิ้น) — ลำดับคงที่ ดี → แย่ */
const SLICE = { good: "var(--st-good)", late: "var(--st-late)", info: "var(--st-info)", bad: "var(--st-bad)" } as const;

/** ปฏิทินของฉัน + สถิติของฉัน (แอปนักเรียน) */
export function StudentCalendar({ sb }: { sb: SupabaseClient }) {
  const today = todayISO();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [cal, setCal] = useState<Cal | null>(null);
  const [selected, setSelected] = useState(today);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await sb.rpc("nst_my_calendar", { p_month: `${month}-01` });
    if (error) { setErr(errText(error)); return; }
    setErr(""); setCal(data as Cal);
  }, [sb, month]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const days = useMemo(() => {
    const first = `${month}-01`;
    const start = addDays(first, -dow(first));
    const lastOfMonth = addDays(addDays(`${month}-28`, 4).slice(0, 7) + "-01", -1);
    const end = addDays(lastOfMonth, 6 - dow(lastOfMonth));
    const out: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);

  const shift = (n: number) => { const m = addDays(`${month}-15`, n * 30).slice(0, 7); setMonth(m); setSelected(m === today.slice(0, 7) ? today : `${m}-01`); };
  const now = cal ? new Date(cal.now) : new Date();
  const sessionsOn = (d: string) => (cal?.sessions ?? []).filter((s) => dateOf(s.opens_at) === d);
  const dutiesOn = (d: string) => (cal?.duties ?? []).filter((x) => x.date === d);
  const dayS = sessionsOn(selected), dayD = dutiesOn(selected);

  return (
    <>
      {cal && <MyStats stats={cal.stats} />}

      <section>
        <div className="section-title"><h2>ปฏิทินของฉัน</h2></div>
        {err && <p className="error">{err}</p>}
        <div className="card scal">
          <div className="scal-head">
            <button className="icon-btn" onClick={() => shift(-1)} aria-label="เดือนก่อน"><ChevronLeft size={18} /></button>
            <h3>{fmtDate(`${month}-01`, { month: "long", year: "numeric" })}</h3>
            <button className="icon-btn" onClick={() => shift(1)} aria-label="เดือนถัดไป"><ChevronRight size={18} /></button>
          </div>
          <div className="scal-grid" role="grid">
            {WEEK.map((w) => <div key={w} className="scal-dow" role="columnheader">{w}</div>)}
            {days.map((d) => {
              const ss = sessionsOn(d), dd = dutiesOn(d);
              const cls = ["scal-day", d.slice(0, 7) !== month && "out", d === today && "today", d === selected && "sel"].filter(Boolean).join(" ");
              return (
                <button key={d} className={cls} onClick={() => setSelected(d)} role="gridcell"
                  aria-label={`${fmtDate(d, { day: "numeric", month: "long" })}${ss.length ? ` เช็คชื่อ ${ss.length}` : ""}${dd.length ? ` เวร ${dd.length}` : ""}`}>
                  <span className="scal-num">{Number(d.slice(8))}</span>
                  <span className="scal-marks" aria-hidden>
                    {ss.map((s) => <i key={`s${s.id}`} className={`mk ring ${s.status ? ATTEND[s.status].tone : "plan"}`} />)}
                    {dd.map((x) => { const st = dutyShown(x.status, x.date, x.ends, now); return <i key={`d${x.id}`} className={`mk sq ${st === "assigned" ? "plan" : DUTY[st].tone}`} />; })}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="scal-key"><span><i className="mk ring plan" /> เช็คชื่อ</span><span><i className="mk sq plan" /> เวรจราจร</span><span className="muted">สีเขียว = มา/รายงานแล้ว · แดง = ขาด</span></p>
        </div>

        <div className="scal-list">
          <h3>{fmtDate(selected, { weekday: "long", day: "numeric", month: "long" })}</h3>
          {!cal ? <div className="spinner" /> : dayS.length + dayD.length === 0 ? <p className="note-line">ไม่มีคาบเช็คชื่อหรือเวรในวันนี้</p> : (
            <>
              {dayS.map((s) => (
                <div key={`s${s.id}`} className="nst-row">
                  <div className="nst-row-text"><b>{s.title || KIND[s.kind]}</b>
                    <small>{s.kind === "callup" ? `เรียกรวม ${hhmm(s.opens_at)}` : `${hhmm(s.opens_at)}–${hhmm(s.closes_at)}`}</small></div>
                  {s.status ? <span className={`chip ${ATTEND[s.status].tone}`}>{ATTEND[s.status].label}</span>
                    : <span className="chip">{now < new Date(s.opens_at) ? "ยังไม่ถึง" : "รอเช็คชื่อ"}</span>}
                </div>
              ))}
              {dayD.map((x) => { const st = dutyShown(x.status, x.date, x.ends, now); return (
                <div key={`d${x.id}`} className="nst-row">
                  <div className="nst-row-text"><b>เวร · {x.post}</b><small>{t5(x.starts)}–{t5(x.ends)} น.</small></div>
                  <span className={`chip ${st === "assigned" ? "" : DUTY[st].tone}`}>{st === "assigned" ? (x.date >= today ? "ยังไม่ถึง" : DUTY[st].label) : DUTY[st].label}</span>
                </div>
              ); })}
            </>
          )}
        </div>
      </section>
    </>
  );
}

/** สถิติสะสม: วงกลม (โดนัท) 2 วง — เช็คชื่อ และ เวรจราจร พร้อมตัวเลขทุกชิ้น */
function MyStats({ stats }: { stats: Cal["stats"] }) {
  const a = stats.attend, d = stats.duty;
  return (
    <section>
      <div className="section-title"><h2>สถิติของฉัน</h2></div>
      <div className="sstats">
        <Donut title="เช็คชื่อ" unit="คาบ" centerLabel="มาเข้าแถว" parts={[
          { label: "มา", n: a.present, color: SLICE.good }, { label: "สาย", n: a.late, color: SLICE.late },
          { label: "ลา", n: a.leave, color: SLICE.info }, { label: "ขาด", n: a.absent, color: SLICE.bad },
        ]} goodKeys={["มา", "สาย"]} />
        <Donut title="เวรจราจร" unit="ครั้ง" centerLabel="มาเวร" parts={[
          { label: "รายงานแล้ว", n: d.done, color: SLICE.good }, { label: "สาย", n: d.late, color: SLICE.late },
          { label: "ได้รับอนุญาต", n: d.excused, color: SLICE.info }, { label: "ไม่มาเวร", n: d.missed, color: SLICE.bad },
        ]} goodKeys={["รายงานแล้ว", "สาย"]} />
      </div>
    </section>
  );
}

function Donut({ title, unit, centerLabel, parts, goodKeys }: {
  title: string; unit: string; centerLabel: string; goodKeys: string[];
  parts: { label: string; n: number; color: string }[];
}) {
  const total = parts.reduce((s, p) => s + p.n, 0);
  const good = parts.filter((p) => goodKeys.includes(p.label)).reduce((s, p) => s + p.n, 0);
  const [hover, setHover] = useState<number | null>(null);
  const R = 42, C = 2 * Math.PI * R, GAP = total > 1 && parts.filter((p) => p.n).length > 1 ? 2.2 : 0;
  let acc = 0;
  const shown = hover != null ? parts[hover] : null;
  return (
    <figure className="card sdonut" aria-label={`${title}: ${parts.map((p) => `${p.label} ${p.n}`).join(", ")}`}>
      <figcaption><b>{title}</b><small>ทั้งหมด {total} {unit}</small></figcaption>
      <div className="sdonut-body">
        <svg viewBox="0 0 100 100" role="img" aria-hidden>
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--line)" strokeWidth="11" />
          {total > 0 && parts.map((p, i) => {
            if (!p.n) return null;
            const len = (p.n / total) * C;
            const el = (
              <circle key={p.label} cx="50" cy="50" r={R} fill="none" stroke={p.color} strokeWidth={hover === i ? 13 : 11}
                strokeDasharray={`${Math.max(len - GAP, 0.01)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 50 50)"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)}
                style={{ cursor: "pointer", transition: "stroke-width .12s" }}>
                <title>{`${p.label} ${p.n} ${unit}`}</title>
              </circle>
            );
            acc += len;
            return el;
          })}
          <text x="50" y="49" textAnchor="middle" className="sd-num">{shown ? shown.n : total ? `${Math.round((100 * good) / total)}%` : "–"}</text>
          <text x="50" y="62" textAnchor="middle" className="sd-lbl">{shown ? shown.label : total ? centerLabel : "ยังไม่มีข้อมูล"}</text>
        </svg>
        <ul className="sd-legend">
          {parts.map((p, i) => (
            <li key={p.label} className={hover === i ? "on" : ""} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <i style={{ background: p.color }} />{p.label}<b>{p.n}</b>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
