import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, Megaphone, Plus, Shield, Upload } from "lucide-react";
import { errText, supabase } from "../lib/supabase";
import { useMe } from "../lib/me";
import { navigate, usePath } from "../lib/router";
import { useSignedUrls } from "../lib/photos";
import { addDays, dayRange, fmtDate, hhmm, todayISO, toISO } from "../lib/time";
import {
  ATTEND, DUTY, dutyShown, groupLabel, isNstStaff, isWedKind, KIND, mapImport, parseTable, PLANNED_KINDS,
  type Attend, type Checkin, type Duty, type DutyStatus, type Post, type Session, type SessionKind, type Settings, type Student, type Swap,
} from "../lib/nst";
import { DateNav, Empty, Field, Modal, ModuleHero } from "../components/ui";
import { EventDays } from "./NstEvent";

const TABS = [
  { path: "/nst", label: "วันนี้" },
  { path: "/nst/sessions", label: "คาบเช็คชื่อ" },
  { path: "/nst/duty", label: "เวรจราจร" },
  { path: "/nst/students", label: "นักเรียน" },
  { path: "/nst/summary", label: "สรุป" },
];
const t5 = (t: string) => t.slice(0, 5);
const STUDENT_COLS = "id,student_code,full_name,class_room,nst_year,group_name,pin_set,active,failed_attempts,locked_until";

/** นศท. ฝั่งครูผู้กำกับ: ดูการเช็คชื่อ/เวรวันนี้ ตั้งคาบ จัดเวรอัตโนมัติ นำเข้ารายชื่อ สรุปผล (ผู้บริหารดูได้อย่างเดียว) */
export default function Nst() {
  const path = usePath();
  const me = useMe();
  const staff = isNstStaff(me);
  const tab = TABS.find((t) => t.path !== "/nst" && path.startsWith(t.path)) ?? TABS[0];
  const [stats, setStats] = useState<{ students: number; pinSet: number; swaps: number } | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("nst_students").select("pin_set").eq("active", true),
      supabase.from("nst_swaps").select("id", { count: "exact", head: true }).eq("status", "accepted"),
    ]).then(([s, w]) => {
      const rows = (s.data ?? []) as { pin_set: boolean }[];
      setStats({ students: rows.length, pinSet: rows.filter((r) => r.pin_set).length, swaps: w.count ?? 0 });
    });
  }, [path]);

  return (
    <div className="c-nst">
      <ModuleHero mod="c-nst" icon={Shield} title="นศท." desc="เช็คชื่อเช้าวันพุธและคาบกิจกรรม เวรจราจร นักเรียนรายงานตัวเองด้วยเซลฟี่ที่ /s"
        stats={[
          { n: stats?.students ?? "–", label: "นักเรียน" },
          { n: stats ? `${stats.pinSet}/${stats.students}` : "–", label: "เข้าระบบแล้ว" },
          { n: stats?.swaps ?? "–", label: "แลกเวรรออนุมัติ" },
        ]}>
        <div className="mh-tabs" role="tablist">
          {TABS.map((t) => <button key={t.path} role="tab" aria-selected={t.path === tab.path} className={t.path === tab.path ? "on" : ""} onClick={() => navigate(t.path)}>{t.label}</button>)}
        </div>
      </ModuleHero>
      {tab.path === "/nst" && <Today staff={staff} />}
      {tab.path === "/nst/sessions" && <Sessions staff={staff} />}
      {tab.path === "/nst/duty" && <DutyAdmin staff={staff} />}
      {tab.path === "/nst/students" && <Students staff={staff} />}
      {tab.path === "/nst/summary" && <Summary />}
    </div>
  );
}

/* ================================================================== วันนี้ */
function Today({ staff }: { staff: boolean }) {
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState<{ sessions: Session[]; checkins: Checkin[]; students: Student[]; duties: Duty[]; posts: Post[]; settings: Settings | null } | null>(null);
  const [openSession, setOpenSession] = useState<number | null>(null);
  const [callup, setCallup] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [from, to] = dayRange(date);
    const [ss, st, du, po, se] = await Promise.all([
      supabase.from("nst_sessions").select("*").gte("opens_at", from).lt("opens_at", to).order("opens_at"),
      supabase.from("nst_students").select(STUDENT_COLS).eq("active", true).order("class_room").order("full_name"),
      supabase.from("nst_duties").select("*").eq("duty_date", date),
      supabase.from("nst_posts").select("*").order("sort").order("starts"),
      supabase.from("nst_settings").select("*").maybeSingle(),
    ]);
    const sessions = (ss.data as Session[]) ?? [];
    const ck = sessions.length ? await supabase.from("nst_checkins").select("*").in("session_id", sessions.map((s) => s.id)) : { data: [] };
    const e = ss.error ?? st.error ?? du.error;
    setErr(e ? errText(e) : "");
    setData({ sessions, checkins: (ck.data as Checkin[]) ?? [], students: (st.data as Student[]) ?? [], duties: (du.data as Duty[]) ?? [],
      posts: (po.data as Post[]) ?? [], settings: (se.data as Settings) ?? null });
    if (sessions.length === 1) setOpenSession(sessions[0].id);
  }, [date]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="spinner" />;
  const radius = data.settings?.radius_m ?? 400;
  const studentById = new Map(data.students.map((s) => [s.id, s]));
  const postById = new Map(data.posts.map((p) => [p.id, p]));

  return (
    <>
      <div className="clean-bar"><DateNav date={date} onChange={setDate} /></div>
      {err && <p className="error">{err}</p>}
      <section>
        <div className="section-title"><h2>เช็คชื่อ</h2>
          {staff && date === todayISO() && <button className="btn primary sm" onClick={() => setCallup(true)}><Megaphone size={16} />เรียกรวมตอนนี้</button>}
        </div>
        {data.sessions.length === 0 ? <Empty>วันนี้ไม่มีคาบเช็คชื่อ — เพิ่มได้ที่แท็บ “คาบเช็คชื่อ” หรือกด “เรียกรวมตอนนี้”</Empty> : data.sessions.map((s) => {
          const eligible = data.students.filter((st) => s.nst_years.length === 0 || (st.nst_year != null && s.nst_years.includes(st.nst_year)));
          const mine = data.checkins.filter((c) => c.session_id === s.id);
          const count = (k: Attend) => mine.filter((c) => c.status === k).length;
          const closed = new Date(s.closes_at) < new Date();
          const missing = eligible.length - mine.length;
          return (
            <div key={s.id} className="card nst-session">
              <button className="nst-session-head" onClick={() => setOpenSession(openSession === s.id ? null : s.id)} aria-expanded={openSession === s.id}>
                <span><b>{s.title || KIND[s.kind]}</b><small>{s.kind === "callup"
                  ? `เรียกรวม · เริ่ม ${hhmm(s.opens_at)}${closed ? ` · ปิด ${hhmm(s.closes_at)}` : " · ครูเช็คชื่อ"}`
                  : `${hhmm(s.opens_at)}–${hhmm(s.closes_at)} · สายหลัง ${hhmm(s.late_at)}`}</small></span>
                <span className="nst-counts">
                  <span className="chip ok">มา {count("present")}</span><span className="chip warn">สาย {count("late")}</span>
                  <span className="chip info">ลา {count("leave")}</span>
                  <span className="chip bad">{closed ? "ขาด" : s.kind === "callup" ? "ยังไม่เช็ค" : "ยังไม่รายงาน"} {count("absent") + missing}</span>
                </span>
              </button>
              {staff && !closed && (s.kind === "callup"
                ? <CallupActions session={s} missing={missing} onChanged={load} />
                : <SelfReportSwitch session={s} onChanged={load} />)}
              {openSession === s.id && (
                <AttendanceList session={s} students={eligible} checkins={mine} radius={radius} staff={staff} closed={closed} onChanged={load} />
              )}
            </div>
          );
        })}
      </section>

      <section>
        <div className="section-title"><h2>เวรจราจร</h2></div>
        {data.duties.length === 0 ? <Empty>วันนี้ไม่มีเวรจราจร</Empty> : (
          <DutyList duties={data.duties} studentById={studentById} postById={postById} radius={radius} staff={staff} onChanged={load} />
        )}
      </section>
      {callup && <CallupForm onClose={() => setCallup(false)} onStarted={(id) => { setCallup(false); setOpenSession(id); load(); }} />}
    </>
  );
}

/** เรียกรวมเฉพาะกิจ: ไม่มีกำหนดการ เริ่มทันที ครูเช็คเองเท่านั้น เลือกชั้นปีได้ (ไม่เลือก = ทุกชั้นปี) */
function CallupForm({ onClose, onStarted }: { onClose: () => void; onStarted: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [years, setYears] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const start = async () => {
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("nst_callup_start", { p_title: title, p_years: years });
    setBusy(false);
    if (error) setErr(errText(error)); else onStarted(Number(data));
  };
  return (
    <Modal title="เรียกรวม นศท." onClose={onClose}>
      <p className="muted small">เริ่มเช็คชื่อทันที ไม่มีเวลาสาย ครูเลือกสถานะของแต่ละคนเอง (นักเรียนไม่ต้องกดรายงานตัว)</p>
      <Field label="เรื่อง (ไม่บังคับ)"><input value={title} maxLength={120} placeholder="เช่น เรียกรวมซ้อมพิธี" onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="ชั้นปี นศท." hint="ไม่เลือก = ทุกชั้นปี">
        <span className="row wrap">{[1, 2, 3, 4, 5].map((y) => (
          <label key={y} className="check"><input type="checkbox" checked={years.includes(y)} onChange={() => setYears(years.includes(y) ? years.filter((x) => x !== y) : [...years, y])} /> ปี {y}</label>
        ))}</span>
      </Field>
      {err && <p className="error">{err}</p>}
      <button className="btn primary big" disabled={busy} onClick={start}><Megaphone size={18} />{busy ? "กำลังเริ่ม…" : "เริ่มเช็คชื่อ"}</button>
    </Modal>
  );
}

/** ปุ่มของคาบเรียกรวม: เติมคนที่เหลือเป็น "มา" ครั้งเดียว · ปิดการเรียกรวม (ที่ยังไม่เช็คนับเป็นขาด) */
function CallupActions({ session, missing, onChanged }: { session: Session; missing: number; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (fn: () => PromiseLike<{ error: unknown }>) => {
    setBusy(true); setErr("");
    const { error } = await fn();
    setBusy(false);
    if (error) setErr(errText(error)); else onChanged();
  };
  const fill = () => { if (confirm(`ให้อีก ${missing} คนที่ยังไม่เช็คเป็น “มา” ทั้งหมด?`)) run(() => supabase.rpc("nst_callup_fill", { p_id: session.id, p_status: "present" })); };
  const close = () => { if (confirm(missing ? `ปิดการเรียกรวม? อีก ${missing} คนที่ยังไม่เช็คจะนับเป็น “ขาด”` : "ปิดการเรียกรวม?")) run(() => supabase.rpc("nst_callup_close", { p_id: session.id })); };
  return (
    <div className="nst-self">
      <span className="chip">ครูเป็นผู้เช็คชื่อ</span>
      {missing > 0 && <button className="btn sm" disabled={busy} onClick={fill}>ที่เหลือ = มา</button>}
      <button className="btn sm" disabled={busy} onClick={close}>ปิดการเรียกรวม</button>
      {err && <span className="error">{err}</span>}
    </div>
  );
}

/** สวิตช์ต่อคาบ: ครูติดธุระ เปิดให้ นศท. กดรายงานตัวเอง (พุธเช้า/เย็นครูเช็คเองเป็นหลัก จึงปิดไว้เป็นค่าเริ่มต้น) */
function SelfReportSwitch({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const toggle = async () => {
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("nst_session_self_report", { p_id: session.id, p_on: !session.self_report });
    setBusy(false);
    if (error) setErr(errText(error)); else onChanged();
  };
  return (
    <div className="nst-self">
      <span className={`chip ${session.self_report ? "ok" : ""}`}>{session.self_report ? "นศท. รายงานตัวเองได้" : "ครูเป็นผู้เช็คชื่อ"}</span>
      <button className="btn sm" disabled={busy} onClick={toggle}>
        {session.self_report ? "ปิด — ครูเช็คเอง" : isWedKind(session.kind) ? "ติดธุระ — เปิดให้ นศท. รายงานเอง" : "เปิดให้ นศท. รายงานเอง"}
      </button>
      {err && <span className="error">{err}</span>}
    </div>
  );
}

function distanceNote(d: number | null, radius: number) {
  if (d == null) return <span className="chip warn">ไม่มีพิกัด</span>;
  if (d > radius) return <span className="chip bad">นอกโรงเรียน ~{Math.round(d)} ม.</span>;
  return null;
}

function AttendanceList({ session, students, checkins, radius, staff, closed, onChanged }: {
  session: Session; students: Student[]; checkins: Checkin[]; radius: number; staff: boolean; closed: boolean; onChanged: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "missing" | "flag">("all");
  const [photo, setPhoto] = useState<string | null>(null);
  const byStudent = new Map(checkins.map((c) => [c.student_id, c]));
  const urls = useSignedUrls("nst-photos", checkins.map((c) => c.photo_path));
  const set = async (studentId: number, status: Attend) => {
    const { error } = await supabase.rpc("nst_set_attendance", { p_session: session.id, p_student: studentId, p_status: status, p_note: null });
    if (error) alert(errText(error)); else onChanged();
  };
  const rows = students.filter((s) => {
    const c = byStudent.get(s.id);
    if (filter === "missing") return !c;
    if (filter === "flag") return c && !c.set_by && (c.distance_m == null || c.distance_m > radius);
    return true;
  });
  return (
    <div className="nst-list">
      <div className="tabs scroll">
        <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>ทั้งหมด {students.length}</button>
        <button className={filter === "missing" ? "on" : ""} onClick={() => setFilter("missing")}>{closed ? "ขาด" : "ยังไม่รายงาน"} {students.length - checkins.length}</button>
        <button className={filter === "flag" ? "on" : ""} onClick={() => setFilter("flag")}>ตรวจพิกัด</button>
      </div>
      {rows.map((s) => {
        const c = byStudent.get(s.id);
        const st: Attend | null = c?.status ?? (closed ? "absent" : null);
        return (
          <div key={s.id} className="nst-person">
            {c?.photo_path && urls[c.photo_path]
              ? <button className="nst-thumb" onClick={() => setPhoto(urls[c.photo_path!])} aria-label={`ดูรูปของ ${s.full_name}`}><img src={urls[c.photo_path]} alt="" /></button>
              : <span className="nst-thumb empty" aria-hidden />}
            <span className="nst-person-text"><b>{s.full_name}</b><small>{s.class_room}{s.group_name ? ` · ${groupLabel(s.group_name)}` : ""}{c?.checked_at ? ` · ${hhmm(c.checked_at)}` : ""}{c?.set_by ? " · ครูบันทึก" : ""}</small></span>
            {c && !c.set_by && distanceNote(c.distance_m, radius)}
            {staff ? (
              <select value={st ?? ""} onChange={(e) => set(s.id, e.target.value as Attend)} aria-label={`สถานะของ ${s.full_name}`}>
                {!st && <option value="">–</option>}
                {(Object.keys(ATTEND) as Attend[]).map((k) => <option key={k} value={k}>{ATTEND[k].label}</option>)}
              </select>
            ) : st ? <span className={`chip ${ATTEND[st].tone}`}>{ATTEND[st].label}</span> : <span className="chip">–</span>}
          </div>
        );
      })}
      {photo && <Modal title="รูปรายงานตัว" onClose={() => setPhoto(null)}><img src={photo} alt="เซลฟี่รายงานตัว" style={{ width: "100%", borderRadius: 12 }} /></Modal>}
    </div>
  );
}

function DutyList({ duties, studentById, postById, radius, staff, onChanged }: {
  duties: Duty[]; studentById: Map<number, Student>; postById: Map<number, Post>; radius: number; staff: boolean; onChanged: () => void;
}) {
  const urls = useSignedUrls("nst-photos", duties.map((d) => d.photo_path));
  const [photo, setPhoto] = useState<string | null>(null);
  const set = async (id: number, status: DutyStatus) => {
    const { error } = await supabase.rpc("nst_set_duty", { p_duty: id, p_status: status, p_note: null });
    if (error) alert(errText(error)); else onChanged();
  };
  const posts = [...new Set(duties.map((d) => d.post_id))].map((id) => postById.get(id)).filter((p): p is Post => !!p)
    .sort((a, b) => a.sort - b.sort || a.starts.localeCompare(b.starts));
  return (
    <div className="card nst-list">
      {posts.map((p) => (
        <div key={p.id}>
          <h3 className="nst-post-title">{p.name} <small>{t5(p.starts)}–{t5(p.ends)}</small></h3>
          {duties.filter((d) => d.post_id === p.id).map((d) => {
            const s = studentById.get(d.student_id);
            const shown = dutyShown(d.status, d.duty_date, p.ends);
            return (
              <div key={d.id} className="nst-person">
                {d.photo_path && urls[d.photo_path]
                  ? <button className="nst-thumb" onClick={() => setPhoto(urls[d.photo_path!])} aria-label="ดูรูป"><img src={urls[d.photo_path]} alt="" /></button>
                  : <span className="nst-thumb empty" aria-hidden />}
                <span className="nst-person-text"><b>{s?.full_name ?? "—"}</b><small>{s?.class_room}{d.reported_at ? ` · ${hhmm(d.reported_at)}` : ""}</small></span>
                {d.reported_at && distanceNote(d.distance_m, radius)}
                {staff ? (
                  <select value={shown} onChange={(e) => set(d.id, e.target.value as DutyStatus)} aria-label="สถานะเวร">
                    {(Object.keys(DUTY) as DutyStatus[]).map((k) => <option key={k} value={k}>{DUTY[k].label}</option>)}
                  </select>
                ) : <span className={`chip ${DUTY[shown].tone}`}>{DUTY[shown].label}</span>}
              </div>
            );
          })}
        </div>
      ))}
      {photo && <Modal title="รูปรายงานตัวเวร" onClose={() => setPhoto(null)}><img src={photo} alt="เซลฟี่รายงานตัวเวร" style={{ width: "100%", borderRadius: 12 }} /></Modal>}
    </div>
  );
}

/* ================================================================== คาบเช็คชื่อ */
function Sessions({ staff }: { staff: boolean }) {
  const [rows, setRows] = useState<Session[] | null>(null);
  const [form, setForm] = useState<"one" | "weekly" | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    const { data, error } = await supabase.from("nst_sessions").select("*").gte("opens_at", toISO(addDays(todayISO(), -14), "00:00")).order("opens_at").limit(200);
    if (error) setErr(errText(error));
    setRows((data as Session[]) ?? []);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  const remove = async (id: number) => {
    const { error } = await supabase.rpc("nst_session_remove", { p_id: id });
    if (error) setErr(/has_checkins/.test(error.message) ? "ลบไม่ได้ คาบนี้มีการเช็คชื่อแล้ว" : errText(error)); else load();
  };
  return (
    <>
      {staff && (
        <div className="row wrap" style={{ marginBottom: ".8rem" }}>
          <button className="btn primary" onClick={() => setForm("weekly")}><Plus size={16} />สร้างคาบทุกสัปดาห์</button>
          <button className="btn" onClick={() => setForm("one")}><Plus size={16} />เพิ่มคาบเดียว</button>
        </div>
      )}
      {err && <p className="error">{err}</p>}
      {rows === null ? <div className="spinner" /> : rows.length === 0 ? <Empty>ยังไม่มีคาบเช็คชื่อ</Empty> : (
        <div className="card nst-list">
          {rows.map((s) => (
            <div key={s.id} className="nst-person">
              <span className="nst-person-text">
                <b>{fmtDate(s.opens_at, { weekday: "short", day: "numeric", month: "short" })} · {s.title || KIND[s.kind]}</b>
                <small>{s.kind === "callup" ? `เรียกรวม เริ่ม ${hhmm(s.opens_at)}` : `${hhmm(s.opens_at)}–${hhmm(s.closes_at)} · สายหลัง ${hhmm(s.late_at)}`}{s.nst_years.length ? ` · ชั้นปี ${s.nst_years.join(", ")}` : ""} · {s.self_report ? "นศท. รายงานเองได้" : "ครูเช็คชื่อ"}</small>
              </span>
              {staff && new Date(s.opens_at) > new Date() && <button className="btn sm" onClick={() => remove(s.id)}>ลบ</button>}
            </div>
          ))}
        </div>
      )}
      {form && <SessionForm mode={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </>
  );
}

function SessionForm({ mode, onClose, onSaved }: { mode: "one" | "weekly"; onClose: () => void; onSaved: () => void }) {
  const today = todayISO();
  const [kind, setKind] = useState<SessionKind>(mode === "weekly" ? "wed" : "activity");
  const [title, setTitle] = useState(mode === "weekly" ? "ฝึกเช้าวันพุธ" : "");
  const [date, setDate] = useState(today);
  const [to, setTo] = useState(addDays(today, 120));
  const [dow, setDow] = useState(3);
  const [open, setOpen] = useState("07:30");
  const [late, setLate] = useState("08:00");
  const [close, setClose] = useState("08:30");
  const [years, setYears] = useState<number[]>([]);
  // null = ค่าเริ่มต้นตามประเภท (พุธเช้า/เย็น = ครูเช็คเอง, คาบอื่น = นศท. รายงานเองได้)
  const [selfOpt, setSelfOpt] = useState<boolean | null>(null);
  const self = selfOpt ?? !isWedKind(kind);
  // พุธเช้า/เย็น: เติมชื่อและเวลาเริ่มต้นให้ (แก้ได้) — เฉพาะตอนยังเป็นค่าเริ่มต้นของประเภทเดิม
  const changeKind = (k: SessionKind) => {
    const defaults: Partial<Record<SessionKind, [string, string, string, string]>> = {
      wed: ["ฝึกเช้าวันพุธ", "07:30", "08:00", "08:30"], wed_pm: ["ฝึกเย็นวันพุธ", "15:30", "16:00", "16:30"],
    };
    const prev = defaults[kind];
    const next = defaults[k];
    if (next && (!prev || (title === prev[0] && open === prev[1] && late === prev[2] && close === prev[3]) || title === "")) {
      setTitle(next[0]); setOpen(next[1]); setLate(next[2]); setClose(next[3]);
    }
    setKind(k); setSelfOpt(null);
  };
  const [err, setErr] = useState("");
  const save = async () => {
    if (!(open < close && late >= open && late <= close)) { setErr("เวลาเปิดต้องก่อนเวลาปิด และเวลาสายอยู่ระหว่างนั้น"); return; }
    const { data, error } = mode === "weekly"
      ? await supabase.rpc("nst_sessions_weekly", { p_from: date, p_to: to, p_dow: dow, p_kind: kind, p_title: title, p_open: open, p_late: late, p_close: close, p_self: self })
      : await supabase.rpc("nst_session_save", { p_id: null, p_kind: kind, p_title: title, p_opens: toISO(date, open), p_late: toISO(date, late), p_closes: toISO(date, close), p_years: years, p_self: self });
    if (error) setErr(errText(error));
    else { if (mode === "weekly") alert(`สร้างแล้ว ${data} คาบ`); onSaved(); }
  };
  return (
    <Modal title={mode === "weekly" ? "สร้างคาบทุกสัปดาห์" : "เพิ่มคาบเช็คชื่อ"} onClose={onClose}>
      <div className="row2">
        <Field label="ประเภท"><select value={kind} onChange={(e) => changeKind(e.target.value as SessionKind)}>{PLANNED_KINDS.map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select></Field>
        <Field label="ชื่อคาบ"><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
      </div>
      {mode === "weekly" ? (
        <div className="row2">
          <Field label="ตั้งแต่"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="ถึง"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="ทุกวัน"><select value={dow} onChange={(e) => setDow(Number(e.target.value))}>{["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"].map((d, i) => <option key={i} value={i}>{d}</option>)}</select></Field>
        </div>
      ) : <Field label="วันที่"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
      <div className="row2">
        <Field label="เปิดรายงานตัว"><input type="time" value={open} onChange={(e) => setOpen(e.target.value)} /></Field>
        <Field label="หลังเวลานี้ = สาย"><input type="time" value={late} onChange={(e) => setLate(e.target.value)} /></Field>
        <Field label="ปิด"><input type="time" value={close} onChange={(e) => setClose(e.target.value)} /></Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={self} onChange={(e) => setSelfOpt(e.target.checked)} /> เปิดให้ นศท. รายงานตัวเองได้ตั้งแต่แรก
      </label>
      {isWedKind(kind) && !self && <p className="muted small">พุธเช้า/เย็นครูเป็นผู้เช็คชื่อ ถ้าติดธุระ เปิดสวิตช์ “ให้ นศท. รายงานเอง” ในหน้า วันนี้ ของคาบนั้น</p>}
      {mode === "one" && (
        <Field label="ชั้นปี นศท." hint="ไม่เลือก = ทุกชั้นปี">
          <span className="row wrap">{[1, 2, 3, 4, 5].map((y) => (
            <label key={y} className="check"><input type="checkbox" checked={years.includes(y)} onChange={() => setYears(years.includes(y) ? years.filter((x) => x !== y) : [...years, y])} /> ปี {y}</label>
          ))}</span>
        </Field>
      )}
      {mode === "weekly" && <p className="muted small">ข้ามวันงดกิจกรรม/วันหยุดที่ตั้งไว้ในแท็บเวรจราจร และวันที่มีคาบประเภทเดียวกันอยู่แล้ว</p>}
      {err && <p className="error">{err}</p>}
      <button className="btn primary big" onClick={save}>บันทึก</button>
    </Modal>
  );
}

/* ================================================================== เวรจราจร */
function DutyAdmin({ staff }: { staff: boolean }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [noDays, setNoDays] = useState<{ day: string; note: string }[]>([]);
  const [swaps, setSwaps] = useState<(Swap & { a?: Duty; b?: Duty })[]>([]);
  const [upcoming, setUpcoming] = useState<Duty[]>([]);
  const [students, setStudents] = useState<Map<number, Student>>(new Map());
  const [editPost, setEditPost] = useState<Post | "new" | null>(null);
  const [gen, setGen] = useState(false);
  const [evDay, setEvDay] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const today = todayISO();

  const load = useCallback(async () => {
    const [p, s, st, nd, sw, up] = await Promise.all([
      supabase.from("nst_posts").select("*").order("sort").order("starts"),
      supabase.from("nst_settings").select("*").maybeSingle(),
      supabase.from("nst_students").select(STUDENT_COLS).eq("active", true),
      supabase.from("nst_no_duty_days").select("*").gte("day", today).order("day"),
      supabase.from("nst_swaps").select("*").eq("status", "accepted").order("created_at"),
      supabase.from("nst_duties").select("*").gte("duty_date", today).lte("duty_date", addDays(today, 20)).order("duty_date"),
    ]);
    const e = p.error ?? s.error;
    setErr(e ? errText(e) : "");
    setPosts((p.data as Post[]) ?? []);
    setSettings((s.data as Settings) ?? null);
    const stl = (st.data as Student[]) ?? [];
    setStudents(new Map(stl.map((x) => [x.id, x])));
    setGroups([...new Set(stl.map((x) => x.group_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th")));
    setNoDays((nd.data as { day: string; note: string }[]) ?? []);
    const swl = (sw.data as Swap[]) ?? [];
    const ids = swl.flatMap((w) => [w.from_duty, w.to_duty]);
    const dmap = new Map<number, Duty>();
    if (ids.length) ((await supabase.from("nst_duties").select("*").in("id", ids)).data as Duty[] ?? []).forEach((d) => dmap.set(d.id, d));
    setSwaps(swl.map((w) => ({ ...w, a: dmap.get(w.from_duty), b: dmap.get(w.to_duty) })));
    setUpcoming((up.data as Duty[]) ?? []);
  }, [today]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const order = settings?.group_order?.length ? [...settings.group_order.filter((g) => groups.includes(g)), ...groups.filter((g) => !settings.group_order.includes(g))] : groups;
  const saveOrder = async (o: string[]) => {
    const { error } = await supabase.rpc("nst_settings_save", { p_group_order: o, p_lat: null, p_lng: null, p_radius: null });
    if (error) setErr(errText(error)); else load();
  };
  const move = (i: number, d: -1 | 1) => { const o = [...order]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; saveOrder(o); };
  const decide = async (id: number, ok: boolean) => {
    const { error } = await supabase.rpc("nst_swap_decide", { p_swap: id, p_approve: ok });
    if (error) setErr(/conflict/.test(error.message) ? "อนุมัติไม่ได้ นักเรียนมีเวรซ้อนวันเดียวกัน" : errText(error)); else load();
  };
  const postName = (id?: number) => posts?.find((p) => p.id === id)?.name ?? "";
  const regular = useMemo(() => (posts ?? []).filter((p) => !p.event_day), [posts]);
  const byDay = useMemo(() => {
    const m = new Map<string, { group: string; n: number; done: number }>();
    const ids = new Set(regular.map((p) => p.id));
    for (const d of upcoming) {
      if (!ids.has(d.post_id)) continue; const x = m.get(d.duty_date) ?? { group: d.group_name, n: 0, done: 0 }; x.n++; if (d.status !== "assigned") x.done++; m.set(d.duty_date, x); }
    return [...m.entries()];
  }, [upcoming, regular]);

  if (!posts) return <div className="spinner" />;
  if (evDay) return <EventDays staff={staff} open={evDay} setOpen={(d) => { setEvDay(d); if (!d) load(); }} />;
  return (
    <>
      {err && <p className="error">{err}</p>}
      {swaps.length > 0 && (
        <section>
          <div className="section-title"><h2>แลกเวรรอครูอนุมัติ</h2></div>
          <div className="card nst-list">
            {swaps.map((w) => (
              <div key={w.id} className="nst-person">
                <span className="nst-person-text">
                  <b>{students.get(w.a?.student_id ?? 0)?.full_name} ↔ {students.get(w.b?.student_id ?? 0)?.full_name}</b>
                  <small>{w.a && fmtDate(w.a.duty_date, { day: "numeric", month: "short" })} {postName(w.a?.post_id)} ↔ {w.b && fmtDate(w.b.duty_date, { day: "numeric", month: "short" })} {postName(w.b?.post_id)} · เพื่อนรับแล้ว</small>
                </span>
                {staff && <div className="row"><button className="btn sm" onClick={() => decide(w.id, false)}>ไม่อนุมัติ</button><button className="btn primary sm" onClick={() => decide(w.id, true)}>อนุมัติ</button></div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <EventDays staff={staff} open={null} setOpen={setEvDay} />

      <section>
        <div className="section-title"><h2>จุดเวร</h2>{staff && <button className="link" onClick={() => setEditPost("new")}><Plus size={14} style={{ verticalAlign: "-2px" }} />เพิ่มจุด</button>}</div>
        {regular.length === 0 ? <Empty>ยังไม่มีจุดเวร เพิ่มจุด เช่น หน้าประตู 07:00–08:00 ต้องการ 4 คน</Empty> : (
          <div className="card nst-list">
            {regular.map((p) => (
              <div key={p.id} className={`nst-person${p.active ? "" : " off"}`}>
                <span className="nst-person-text"><b>{p.name}</b><small>{t5(p.starts)}–{t5(p.ends)} · {p.need} คน{p.active ? "" : " · ปิดใช้"}</small></span>
                {staff && <button className="btn sm" onClick={() => setEditPost(p)}>แก้ไข</button>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-title"><h2>ลำดับกลุ่มเวร</h2></div>
        {groups.length === 0 ? <Empty>ยังไม่มีกลุ่ม — นำเข้ารายชื่อพร้อมคอลัมน์ “กลุ่ม” ในแท็บนักเรียน</Empty> : (
          <div className="card nst-list">
            <p className="muted small">วันเรียนละ 1 กลุ่ม เวียนตามลำดับนี้ (จ.–ศ. ข้ามวันงดเวร)</p>
            {order.map((g, i) => (
              <div key={g} className="nst-person">
                <span className="nst-order">{i + 1}</span>
                <span className="nst-person-text"><b>{groupLabel(g)}</b><small>{[...students.values()].filter((s) => s.group_name === g).length} คน</small></span>
                {staff && <div className="row"><button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`เลื่อน${groupLabel(g)} ขึ้น`}><ArrowUp size={16} /></button><button className="icon-btn" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`เลื่อน${groupLabel(g)} ลง`}><ArrowDown size={16} /></button></div>}
              </div>
            ))}
            {staff && <button className="btn primary big" onClick={() => { if (!settings?.group_order?.length || settings.group_order.join() !== order.join()) saveOrder(order); setGen(true); }}>จัดเวรอัตโนมัติ</button>}
          </div>
        )}
      </section>

      <section>
        <div className="section-title"><h2>เวร 3 สัปดาห์ข้างหน้า</h2></div>
        {byDay.length === 0 ? <Empty>ยังไม่ได้จัดเวร</Empty> : (
          <div className="card nst-list">
            {byDay.map(([day, x]) => (
              <div key={day} className="nst-person"><span className="nst-person-text"><b>{fmtDate(day, { weekday: "short", day: "numeric", month: "short" })} · {groupLabel(x.group)}</b><small>{x.n} คน{x.done ? ` · รายงานแล้ว ${x.done}` : ""}</small></span></div>
            ))}
          </div>
        )}
      </section>

      <NoDutyDays days={noDays} staff={staff} onChanged={load} />
      {editPost && <PostForm post={editPost === "new" ? null : editPost} onClose={() => setEditPost(null)} onSaved={() => { setEditPost(null); load(); }} />}
      {gen && <GenerateForm groups={order} onClose={() => setGen(false)} onDone={() => { setGen(false); load(); }} />}
    </>
  );
}

function NoDutyDays({ days, staff, onChanged }: { days: { day: string; note: string }[]; staff: boolean; onChanged: () => void }) {
  const [day, setDay] = useState(todayISO());
  const [note, setNote] = useState("");
  const set = async (d: string, on: boolean, n = "") => {
    const { error } = await supabase.rpc("nst_no_duty_day", { p_day: d, p_note: n, p_on: on });
    if (error) alert(errText(error)); else { setNote(""); onChanged(); }
  };
  return (
    <section>
      <div className="section-title"><h2>วันงดเวร / งดกิจกรรม</h2></div>
      <div className="card nst-list">
        {days.length === 0 && <p className="muted small">ยังไม่มี — ใส่วันหยุดราชการ วันสอบ วันกิจกรรมโรงเรียน</p>}
        {days.map((d) => (
          <div key={d.day} className="nst-person"><span className="nst-person-text"><b>{fmtDate(d.day, { weekday: "short", day: "numeric", month: "short", year: "2-digit" })}</b><small>{d.note || "—"}</small></span>
            {staff && <button className="btn sm" onClick={() => set(d.day, false)}>เอาออก</button>}</div>
        ))}
        {staff && (
          <div className="row wrap">
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="วันงดเวร" />
            <input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="เหตุผล เช่น สอบกลางภาค" aria-label="เหตุผล" style={{ flex: 1, minWidth: 160 }} />
            <button className="btn" onClick={() => set(day, true, note)}><Plus size={16} />เพิ่ม</button>
          </div>
        )}
      </div>
    </section>
  );
}

function PostForm({ post, onClose, onSaved }: { post: Post | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(post?.name ?? "");
  const [starts, setStarts] = useState(post ? t5(post.starts) : "07:00");
  const [ends, setEnds] = useState(post ? t5(post.ends) : "08:00");
  const [need, setNeed] = useState(post?.need ?? 2);
  const [sort, setSort] = useState(post?.sort ?? 0);
  const [active, setActive] = useState(post?.active ?? true);
  const [err, setErr] = useState("");
  const save = async () => {
    if (!name.trim() || ends <= starts) { setErr("ใส่ชื่อจุด และเวลาเลิกต้องหลังเวลาเริ่ม"); return; }
    const { error } = await supabase.rpc("nst_post_save", { p_id: post?.id ?? null, p_name: name, p_starts: starts, p_ends: ends, p_need: need, p_sort: sort, p_active: active });
    if (error) setErr(errText(error)); else onSaved();
  };
  return (
    <Modal title={post ? `แก้ไขจุด ${post.name}` : "เพิ่มจุดเวร"} onClose={onClose}>
      <Field label="ชื่อจุด"><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="เช่น หน้าประตูใหญ่ (เช้า)" /></Field>
      <div className="row2">
        <Field label="เริ่ม"><input type="time" value={starts} onChange={(e) => setStarts(e.target.value)} /></Field>
        <Field label="เลิก"><input type="time" value={ends} onChange={(e) => setEnds(e.target.value)} /></Field>
        <Field label="จำนวนคน"><input type="number" min={1} max={30} value={need} onChange={(e) => setNeed(Number(e.target.value) || 1)} /></Field>
        <Field label="ลำดับ"><input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value) || 0)} /></Field>
      </div>
      {post && <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> ใช้จุดนี้ในการจัดเวร</label>}
      {err && <p className="error">{err}</p>}
      <button className="btn primary big" onClick={save}>บันทึกจุด</button>
    </Modal>
  );
}

function GenerateForm({ groups, onClose, onDone }: { groups: string[]; onClose: () => void; onDone: () => void }) {
  const today = todayISO();
  const [from, setFrom] = useState(addDays(today, 1));
  const [to, setTo] = useState(addDays(today, 30));
  const [start, setStart] = useState(groups[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async () => {
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("nst_generate_duties", { p_from: from, p_to: to, p_start_group: start });
    setBusy(false);
    if (error) setErr(/no_posts/.test(error.message) ? "ยังไม่มีจุดเวรที่เปิดใช้" : /no_groups/.test(error.message) ? "ยังไม่มีลำดับกลุ่ม" : errText(error));
    else { alert(`จัดเวรแล้ว ${data} เวร`); onDone(); }
  };
  return (
    <Modal title="จัดเวรอัตโนมัติ" onClose={onClose}>
      <div className="row2">
        <Field label="ตั้งแต่"><input type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="ถึง"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Field label="เริ่มที่กลุ่ม"><select value={start} onChange={(e) => setStart(e.target.value)}>{groups.map((g) => <option key={g} value={g}>{groupLabel(g)}</option>)}</select></Field>
      <p className="muted small">วันเรียน (จ.–ศ.) วันละ 1 กลุ่ม ข้ามวันงดเวร · เวรในช่วงนี้ที่ยังไม่รายงานและครูยังไม่ได้แก้ จะถูกจัดใหม่ · เวรที่กำลังขอแลกคงไว้</p>
      {err && <p className="error">{err}</p>}
      <button className="btn primary big" disabled={busy} onClick={run}>{busy ? "กำลังจัด…" : "จัดเวร"}</button>
    </Modal>
  );
}

/* ================================================================== นักเรียน */
function Students({ staff }: { staff: boolean }) {
  const [rows, setRows] = useState<Student[] | null>(null);
  const [q, setQ] = useState("");
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    const { data, error } = await supabase.from("nst_students").select(STUDENT_COLS).order("class_room").order("full_name");
    if (error) setErr(errText(error));
    setRows((data as Student[]) ?? []);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  const act = async (s: Student, action: "reset_pin" | "activate" | "deactivate") => {
    if (action === "reset_pin" && !confirm(`รีเซ็ต PIN ของ ${s.full_name}? นักเรียนต้องเข้าแบบ “ครั้งแรก” ด้วยเลขบัตรประชาชนใหม่`)) return;
    const { error } = await supabase.rpc("nst_student_update", { p_id: s.id, p_action: action });
    if (error) setErr(errText(error)); else load();
  };
  const shown = (rows ?? []).filter((s) => !q.trim() || `${s.student_code} ${s.full_name} ${s.class_room} ${s.group_name}`.toLowerCase().includes(q.trim().toLowerCase()));
  const locked = (s: Student) => s.locked_until && new Date(s.locked_until) > new Date();
  return (
    <>
      <div className="row wrap" style={{ marginBottom: ".8rem" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหารหัส ชื่อ ห้อง กลุ่ม" aria-label="ค้นหานักเรียน" style={{ flex: 1, minWidth: 200 }} />
        {staff && <button className="btn primary" onClick={() => setImporting(true)}><Upload size={16} />นำเข้ารายชื่อ</button>}
      </div>
      {err && <p className="error">{err}</p>}
      {rows === null ? <div className="spinner" /> : rows.length === 0 ? <Empty>ยังไม่มีรายชื่อ นศท. — กด “นำเข้ารายชื่อ” แล้ววางจาก Excel / Google Sheets</Empty> : (
        <div className="card nst-list">
          <p className="muted small">{shown.length} คน · ตั้ง PIN แล้ว {shown.filter((s) => s.pin_set).length}</p>
          {shown.map((s) => (
            <div key={s.id} className={`nst-person${s.active ? "" : " off"}`}>
              <span className="nst-person-text"><b>{s.full_name}</b><small>{s.student_code} · {s.class_room}{s.nst_year ? ` · ปี ${s.nst_year}` : ""}{s.group_name ? ` · ${groupLabel(s.group_name)}` : ""}</small></span>
              {locked(s) ? <span className="chip bad">ล็อก</span> : s.pin_set ? <span className="chip ok">ตั้ง PIN แล้ว</span> : <span className="chip">ยังไม่เข้า</span>}
              {staff && (
                <div className="row">
                  {(s.pin_set || locked(s)) && <button className="btn sm" onClick={() => act(s, "reset_pin")}>รีเซ็ต PIN</button>}
                  <button className="btn sm" onClick={() => act(s, s.active ? "deactivate" : "activate")}>{s.active ? "ปิด" : "เปิด"}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {importing && <ImportForm onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
    </>
  );
}

function ImportForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const parsed = useMemo(() => mapImport(parseTable(text)), [text]);
  const withNid = parsed.rows.filter((r) => r.nid).length;
  const badNid = parsed.rows.filter((r) => r.nid && r.nid.length !== 13);
  const run = async () => {
    setBusy(true); setErr("");
    const payload = parsed.rows.map((r) => ({ code: r.code, name: r.name, class_room: r.class_room, nst_year: r.nst_year, group_name: r.group_name, nid: r.nid || null }));
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabase.rpc("nst_import", { p_rows: payload.slice(i, i + 500) });
      if (error) { setBusy(false); setErr(errText(error)); return; }
    }
    setBusy(false); setText(""); alert(`นำเข้าแล้ว ${payload.length} คน`); onDone();
  };
  return (
    <Modal title="นำเข้ารายชื่อ นศท." onClose={onClose}>
      <p className="muted small">คัดลอกตารางจาก Excel / Google Sheets ทั้งตาราง (รวมแถวหัวตาราง) มาวาง หรือเลือกไฟล์ .csv · คอลัมน์: รหัสนักเรียน, ชื่อ-สกุล, ชั้น, ชั้นปี, กลุ่ม, เลขบัตรประชาชน · รหัสซ้ำ = อัปเดตข้อมูลเดิม</p>
      <p className="muted small">เลขบัตรประชาชนถูกเข้ารหัสทางเดียวทันทีที่ถึงฐานข้อมูล ไม่มีใครเปิดดูได้ ใช้แค่ยืนยันตัวตอนนักเรียนเข้าครั้งแรก</p>
      <textarea id="nst-import" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"รหัสนักเรียน\tชื่อ-สกุล\tชั้น\tชั้นปี\tกลุ่ม\tเลขบัตรประชาชน"} />
      <label className="btn sm" style={{ alignSelf: "flex-start" }}><Upload size={16} />เลือกไฟล์ CSV
        <input type="file" accept=".csv,.tsv,.txt,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setText(await f.text()); }} />
      </label>
      {text && (parsed.missing.length ? <p className="error">ไม่พบคอลัมน์ {parsed.missing.map((m) => (m === "code" ? "รหัสนักเรียน" : "ชื่อ-สกุล")).join(", ")} ในแถวหัวตาราง</p>
        : <p className="small">พบ {parsed.rows.length} คน · มีเลขบัตร {withNid} คน{badNid.length ? ` · เลขบัตรไม่ครบ 13 หลัก ${badNid.length} คน (${badNid.slice(0, 3).map((r) => r.code).join(", ")})` : ""}</p>)}
      {err && <p className="error">{err}</p>}
      <button className="btn primary big" disabled={busy || !parsed.rows.length || parsed.missing.length > 0 || badNid.length > 0} onClick={run}>{busy ? "กำลังนำเข้า…" : `นำเข้า ${parsed.rows.length} คน`}</button>
    </Modal>
  );
}

/* ================================================================== สรุป */
function Summary() {
  const today = todayISO();
  const [from, setFrom] = useState(addDays(today, -60));
  const [to, setTo] = useState(today);
  const [data, setData] = useState<{ students: Student[]; sessions: Session[]; checkins: Checkin[]; duties: Duty[]; posts: Post[] } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [st, ss, du, po] = await Promise.all([
        supabase.from("nst_students").select(STUDENT_COLS).eq("active", true).order("class_room").order("full_name"),
        supabase.from("nst_sessions").select("*").gte("opens_at", toISO(from, "00:00")).lte("opens_at", toISO(to, "23:59")).lt("closes_at", new Date().toISOString()),
        supabase.from("nst_duties").select("*").gte("duty_date", from).lte("duty_date", to).lte("duty_date", today),
        supabase.from("nst_posts").select("*"),
      ]);
      const sessions = (ss.data as Session[]) ?? [];
      const ck = sessions.length ? (await supabase.from("nst_checkins").select("*").in("session_id", sessions.map((s) => s.id))).data : [];
      if (alive) setData({ students: (st.data as Student[]) ?? [], sessions, checkins: (ck as Checkin[]) ?? [], duties: (du.data as Duty[]) ?? [], posts: (po.data as Post[]) ?? [] });
    })();
    return () => { alive = false; };
  }, [from, to, today]);

  const rows = useMemo(() => {
    if (!data) return [];
    const post = new Map(data.posts.map((p) => [p.id, p]));
    return data.students.map((s) => {
      const mine = data.sessions.filter((x) => x.nst_years.length === 0 || (s.nst_year != null && x.nst_years.includes(s.nst_year)));
      const ck = new Map(data.checkins.filter((c) => c.student_id === s.id).map((c) => [c.session_id, c.status]));
      const c = { present: 0, late: 0, leave: 0, absent: 0 } as Record<Attend, number>;
      mine.forEach((x) => { c[ck.get(x.id) ?? "absent"]++; });
      const du = data.duties.filter((d) => d.student_id === s.id);
      const dd = { dDone: 0, dLate: 0, dMissed: 0 };
      du.forEach((d) => { const st = dutyShown(d.status, d.duty_date, post.get(d.post_id)?.ends ?? "23:59"); if (st === "done") dd.dDone++; else if (st === "late") dd.dLate++; else if (st === "missed") dd.dMissed++; });
      return { s, sessions: mine.length, ...c, duties: du.length, ...dd };
    }).sort((a, b) => b.absent - a.absent || b.dMissed - a.dMissed || a.s.full_name.localeCompare(b.s.full_name, "th"));
  }, [data]);

  const csv = () => {
    const head = ["รหัส", "ชื่อ-สกุล", "ชั้น", "กลุ่ม", "คาบทั้งหมด", "มา", "สาย", "ลา", "ขาด", "เวรทั้งหมด", "มาเวร", "มาเวรสาย", "ไม่มาเวร"];
    const lines = [head, ...rows.map((r) => [r.s.student_code, r.s.full_name, r.s.class_room, r.s.group_name, r.sessions, r.present, r.late, r.leave, r.absent, r.duties, r.dDone, r.dLate, r.dMissed])]
      .map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `nst-summary-${from}-${to}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="row wrap" style={{ marginBottom: ".8rem", alignItems: "flex-end" }}>
        <Field label="ตั้งแต่"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="ถึง"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <button className="btn" onClick={csv} disabled={!rows.length}><Download size={16} />ส่งออก CSV</button>
      </div>
      {!data ? <div className="spinner" /> : rows.length === 0 ? <Empty>ยังไม่มีข้อมูลในช่วงนี้</Empty> : (
        <div className="card table-wrap">
          <table className="nst-table">
            <thead><tr><th>นักเรียน</th><th>คาบ</th><th>มา</th><th>สาย</th><th>ลา</th><th>ขาด</th><th>เวร</th><th>มาเวร</th><th>ไม่มาเวร</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.s.id}>
                  <td><b>{r.s.full_name}</b><small className="muted"> {r.s.class_room}{r.s.group_name ? ` · ${r.s.group_name}` : ""}</small></td>
                  <td>{r.sessions}</td><td>{r.present}</td><td>{r.late}</td><td>{r.leave}</td>
                  <td className={r.absent ? "bad-t" : ""}>{r.absent}</td><td>{r.duties}</td><td>{r.dDone + r.dLate}</td>
                  <td className={r.dMissed ? "bad-t" : ""}>{r.dMissed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
