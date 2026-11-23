import { useCallback, useEffect, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import { ArrowLeftRight, Camera, LogOut, MapPin, Shield, TrafficCone } from "lucide-react";
import { LOGO, SCHOOL_NAME } from "../lib/brand";
import { ATTEND, DUTY, dutyShown, KIND, LOGIN_ERR, type Attend, type DutyStatus, type SessionKind } from "../lib/nst";
import { currentPosition } from "../lib/geo";
import { fmtDate, hhmm, todayISO } from "../lib/time";
import { errText } from "../lib/supabase";
import { Field, Modal } from "../components/ui";
import { SelfieCamera } from "../components/SelfieCamera";

const URL_ = import.meta.env.VITE_SUPABASE_URL || "https://placeholder.supabase.co";
const KEY = import.meta.env.VITE_SUPABASE_KEY || "placeholder";
// แยก session จากแอปบุคลากร (เครื่องเดียวกันใช้ได้ทั้งสองแบบ)
const sb = createClient(URL_, KEY, { auth: { storageKey: "school-admin-nst", persistSession: true, detectSessionInUrl: false } });

type Home = {
  me: { id: number; code: string; name: string; class_room: string; nst_year: number | null; group_name: string };
  now: string;
  sessions: { id: number; kind: SessionKind; title: string; opens_at: string; late_at: string; closes_at: string; self_report: boolean; status: Attend | null; checked_at: string | null }[];
  duties: { id: number; date: string; post: string; starts: string; ends: string; status: DutyStatus; reported_at: string | null }[];
  swaps: { id: number; status: string; mine: boolean; from: SwapSide; to: SwapSide }[];
  history: { opens_at: string; kind: SessionKind; title: string; status: Attend | null }[];
};
type SwapSide = { date: string; post: string; starts: string; student: string };
type Target = { kind: "session"; id: number; title: string } | { kind: "duty"; id: number; title: string };

const t5 = (t: string) => t.slice(0, 5);

/** แอปนักเรียน นศท. (/s): เข้าด้วยรหัสนักเรียน + PIN → เช็คชื่อ รายงานตัวเวรจราจร แลกเวร */
export default function StudentApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => { document.title = "นศท. · เช็คชื่อและเวรจราจร"; }, []);
  if (session === undefined) return <div className="nst-app"><div className="spinner" /></div>;
  return <div className="nst-app c-nst">{session ? <StudentHome uid={session.user.id} /> : <Login />}</div>;
}

function Login() {
  const [first, setFirst] = useState(false);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [nid, setNid] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (first && pin !== pin2) { setErr("PIN สองช่องไม่ตรงกัน"); return; }
    if (first && nid.replace(/\D/g, "").length !== 13) { setErr("เลขบัตรประชาชนต้องมี 13 หลัก"); return; }
    setBusy(true);
    try {
      const res = await fetch(`${URL_}/functions/v1/nst-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` },
        body: JSON.stringify(first ? { action: "setup", code: code.trim(), nid: nid.replace(/\D/g, ""), pin } : { action: "login", code: code.trim(), pin }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.access_token) { setErr(LOGIN_ERR[j.error] ?? LOGIN_ERR.server_error); return; }
      const { error } = await sb.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token });
      if (error) setErr(errText(error));
    } catch {
      setErr("เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ต");
    } finally { setBusy(false); }
  };

  return (
    <main className="nst-login">
      <div className="nst-brand">
        <span className="seal"><img src={LOGO} alt={`ตรา${SCHOOL_NAME}`} /></span>
        <div><b>นศท. เช็คชื่อและเวรจราจร</b><small>{SCHOOL_NAME}</small></div>
      </div>
      <form className="card form" onSubmit={submit}>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={!first} className={!first ? "on" : ""} onClick={() => { setFirst(false); setErr(""); }}>เข้าด้วย PIN</button>
          <button type="button" role="tab" aria-selected={first} className={first ? "on" : ""} onClick={() => { setFirst(true); setErr(""); }}>เข้าครั้งแรก / ลืม PIN</button>
        </div>
        <Field label="รหัสนักเรียน"><input id="nst-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="username" required maxLength={20} /></Field>
        {first && (
          <Field label="เลขบัตรประชาชน 13 หลัก" hint="ใช้ยืนยันตัวครั้งแรกเท่านั้น ระบบเก็บแบบเข้ารหัส อ่านกลับไม่ได้">
            <input id="nst-nid" value={nid} onChange={(e) => setNid(e.target.value)} inputMode="numeric" autoComplete="off" required maxLength={17} />
          </Field>
        )}
        <Field label={first ? "ตั้ง PIN 6 หลัก" : "PIN 6 หลัก"} hint={first ? "ห้ามเลขซ้ำกันทั้งหมดหรือเรียงกัน เช่น 111111 123456" : undefined}>
          <input id="nst-pin" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete={first ? "new-password" : "current-password"} required minLength={6} maxLength={6} />
        </Field>
        {first && <Field label="ยืนยัน PIN"><input id="nst-pin2" type="password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="new-password" required minLength={6} maxLength={6} /></Field>}
        {err && <p className="error">{err}</p>}
        <button className="btn primary big" disabled={busy}>{busy ? "กำลังเข้าระบบ…" : first ? "ยืนยันตัวและตั้ง PIN" : "เข้าระบบ"}</button>
        {!first && <p className="muted small">ลืม PIN: ให้ครูผู้กำกับ นศท. รีเซ็ต แล้วเข้าแบบ “ครั้งแรก” ใหม่</p>}
      </form>
    </main>
  );
}

function StudentHome({ uid }: { uid: string }) {
  const [home, setHome] = useState<Home | null>(null);
  const [err, setErr] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const [swapFor, setSwapFor] = useState<number | null>(null);
  const today = todayISO();

  const load = useCallback(async () => {
    const { data, error } = await sb.rpc("nst_home");
    if (error) {
      if (/not_student/.test(error.message)) { await sb.auth.signOut(); return; }
      setErr(errText(error)); return;
    }
    setErr(""); setHome(data as Home);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const respond = async (id: number, action: "accept" | "decline" | "cancel") => {
    const { error } = await sb.rpc("nst_swap_respond", { p_swap: id, p_action: action });
    if (error) setErr(errText(error)); else load();
  };

  if (!home) return <main className="nst-main">{err ? <p className="error">{err}</p> : <div className="spinner" />}</main>;
  const now = new Date(home.now);
  const todayDuties = home.duties.filter((d) => d.date === today);
  const nextDuties = home.duties.filter((d) => d.date > today);
  const incoming = home.swaps.filter((s) => !s.mine && s.status === "pending");

  return (
    <main className="nst-main">
      <header className="mhero c-nst">
        <Shield size={64} strokeWidth={1.5} className="mh-ic" aria-hidden />
        <h1>{home.me.name}</h1>
        <p>รหัส {home.me.code} · {home.me.class_room}{home.me.nst_year ? ` · นศท. ชั้นปีที่ ${home.me.nst_year}` : ""}{home.me.group_name ? ` · กลุ่ม ${home.me.group_name}` : ""}</p>
        <div className="mh-actions"><button className="btn sm" onClick={() => sb.auth.signOut()}><LogOut size={16} />ออกจากระบบ</button></div>
      </header>
      {err && <p className="error">{err}</p>}

      <section>
        <div className="section-title"><h2>เช็คชื่อวันนี้</h2></div>
        {home.sessions.length === 0 ? <p className="note-line">วันนี้ไม่มีคาบเช็คชื่อ</p> : home.sessions.map((s) => {
          const open = now >= new Date(s.opens_at) && now <= new Date(s.closes_at);
          return (
            <div key={s.id} className="nst-row">
              <div className="nst-row-text">
                <b>{s.title || KIND[s.kind]}</b>
                <small>{s.kind === "callup" ? `เรียกรวม ${hhmm(s.opens_at)} · ครูเช็คชื่อ` : `เปิด ${hhmm(s.opens_at)}–${hhmm(s.closes_at)} · หลัง ${hhmm(s.late_at)} นับสาย`}</small>
              </div>
              {s.status ? <span className={`chip ${ATTEND[s.status].tone}`}>{ATTEND[s.status].label}{s.checked_at ? ` ${hhmm(s.checked_at)}` : ""}</span>
                : open && !s.self_report ? <span className="chip info">รอครูเช็คชื่อ</span>
                : open ? <button className="btn primary sm" onClick={() => setTarget({ kind: "session", id: s.id, title: s.title || KIND[s.kind] })}><Camera size={16} />รายงานตัว</button>
                : <span className="chip">{now < new Date(s.opens_at) ? `เปิด ${hhmm(s.opens_at)}` : "ปิดแล้ว · ขาด"}</span>}
            </div>
          );
        })}
      </section>

      <section>
        <div className="section-title"><h2>เวรจราจร</h2></div>
        {incoming.map((s) => (
          <div key={s.id} className="nst-row swap-in">
            <div className="nst-row-text">
              <b>{s.from.student} ขอแลกเวร</b>
              <small>เขาไปแทนคุณ: {fmtDate(s.to.date, { weekday: "short", day: "numeric", month: "short" })} {s.to.post} · คุณไปแทนเขา: {fmtDate(s.from.date, { weekday: "short", day: "numeric", month: "short" })} {s.from.post}</small>
            </div>
            <div className="row"><button className="btn sm" onClick={() => respond(s.id, "decline")}>ไม่รับ</button><button className="btn primary sm" onClick={() => respond(s.id, "accept")}>รับแลก</button></div>
          </div>
        ))}
        {todayDuties.length === 0 && nextDuties.length === 0 && <p className="note-line">ยังไม่มีเวรใน 2 สัปดาห์นี้</p>}
        {[...todayDuties, ...nextDuties].map((d) => {
          const shown = dutyShown(d.status, d.date, d.ends, now);
          const start = new Date(`${d.date}T${t5(d.starts)}:00+07:00`);
          const open = d.status === "assigned" && now >= new Date(start.getTime() - 30 * 60000) && now <= new Date(`${d.date}T${t5(d.ends)}:00+07:00`);
          const pendingSwap = home.swaps.some((s) => s.mine && ["pending", "accepted"].includes(s.status) && s.from.date === d.date && s.from.post === d.post);
          return (
            <div key={d.id} className={`nst-row${d.date === today ? " today" : ""}`}>
              <TrafficCone size={22} className="nst-ic" aria-hidden />
              <div className="nst-row-text">
                <b>{d.date === today ? "วันนี้" : fmtDate(d.date, { weekday: "short", day: "numeric", month: "short" })} · {d.post}</b>
                <small>{t5(d.starts)}–{t5(d.ends)} น. · รายงานตัวได้ตั้งแต่ 30 นาทีก่อนเริ่ม</small>
              </div>
              {open ? <button className="btn primary sm" onClick={() => setTarget({ kind: "duty", id: d.id, title: `เวร ${d.post}` })}><Camera size={16} />รายงานตัว</button>
                : d.date > today && d.status === "assigned" ? (pendingSwap ? <span className="chip info">รอแลกเวร</span>
                  : <button className="btn sm" onClick={() => setSwapFor(d.id)}><ArrowLeftRight size={16} />ขอแลก</button>)
                : <span className={`chip ${DUTY[shown].tone}`}>{DUTY[shown].label}</span>}
            </div>
          );
        })}
        {home.swaps.filter((s) => s.mine).slice(0, 5).map((s) => (
          <div key={s.id} className="nst-row muted-row">
            <div className="nst-row-text"><b>ขอแลกกับ {s.to.student}</b><small>{fmtDate(s.from.date, { day: "numeric", month: "short" })} {s.from.post} ↔ {fmtDate(s.to.date, { day: "numeric", month: "short" })} {s.to.post}</small></div>
            {["pending", "accepted"].includes(s.status)
              ? <div className="row"><span className="chip info">{s.status === "pending" ? "รอเพื่อนตอบ" : "รอครูอนุมัติ"}</span><button className="btn sm" onClick={() => respond(s.id, "cancel")}>ยกเลิก</button></div>
              : <span className={`chip ${s.status === "approved" ? "ok" : "bad"}`}>{({ approved: "แลกแล้ว", rejected: "ครูไม่อนุมัติ", declined: "เพื่อนไม่รับ", cancelled: "ยกเลิก" } as Record<string, string>)[s.status] ?? s.status}</span>}
          </div>
        ))}
      </section>

      {home.history.length > 0 && (
        <section>
          <div className="section-title"><h2>เช็คชื่อย้อนหลัง</h2></div>
          <div className="nst-history">
            {home.history.map((h) => (
              <div key={h.opens_at}><small>{fmtDate(h.opens_at, { day: "numeric", month: "short" })} {KIND[h.kind]}</small>
                {h.status ? <span className={`chip ${ATTEND[h.status].tone}`}>{ATTEND[h.status].label}</span> : <span className="chip">–</span>}</div>
            ))}
          </div>
        </section>
      )}

      {target && <ReportModal uid={uid} target={target} onClose={() => setTarget(null)} onDone={load} />}
      {swapFor && <SwapModal duty={swapFor} onClose={() => setSwapFor(null)} onDone={load} />}
    </main>
  );
}

function ReportModal({ uid, target, onClose, onDone }: { uid: string; target: Target; onClose: () => void; onDone: () => void }) {
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const send = async () => {
    if (!photo) { setErr("ถ่ายเซลฟี่ก่อน"); return; }
    setErr("");
    try {
      setBusy("กำลังหาพิกัด…");
      const pos = await currentPosition();
      setBusy("กำลังส่งรูป…");
      const path = `${uid}/${crypto.randomUUID()}.jpg`;
      const up = await sb.storage.from("nst-photos").upload(path, photo, { contentType: "image/jpeg" });
      if (up.error) throw new Error(`ส่งรูปไม่สำเร็จ: ${errText(up.error)}`);
      const args = { p_photo: path, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null, p_acc: pos?.acc ?? null };
      const { data, error } = target.kind === "session"
        ? await sb.rpc("nst_check_in", { p_session: target.id, ...args })
        : await sb.rpc("nst_duty_report", { p_duty: target.id, ...args });
      if (error) throw error;
      setResult(String(data)); onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(""); }
  };

  return (
    <Modal title={`รายงานตัว · ${target.title}`} onClose={onClose}>
      {result ? (
        <div className="nst-done">
          <p className={`chip ${result === "present" || result === "done" ? "ok" : "warn"}`}>
            {result === "present" ? "มา · รายงานตัวแล้ว" : result === "late" ? "รายงานตัวแล้ว · สาย" : "รายงานตัวแล้ว"}
          </p>
          <button className="btn primary big" onClick={onClose}>เสร็จ</button>
        </div>
      ) : (
        <>
          <p className="muted small">ถ่ายเซลฟี่ให้เห็นหน้าและบริเวณที่อยู่ · ระบบแนบพิกัด · รูปเห็นเฉพาะคุณและครูผู้กำกับ ลบอัตโนมัติใน 30 วัน</p>
          <SelfieCamera onShot={(b) => setPhoto(b)} />
          <p className="muted small"><MapPin size={14} style={{ verticalAlign: "-2px" }} /> เบราว์เซอร์จะขอใช้ตำแหน่ง กด “อนุญาต”</p>
          {err && <p className="error">{err}</p>}
          <button className="btn primary big" disabled={!photo || !!busy} onClick={send}>{busy || "ส่งรายงานตัว"}</button>
        </>
      )}
    </Modal>
  );
}

type Option = { id: number; date: string; post: string; starts: string; student: string; class_room: string; group_name: string };
function SwapModal({ duty, onClose, onDone }: { duty: number; onClose: () => void; onDone: () => void }) {
  const [opts, setOpts] = useState<Option[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    sb.rpc("nst_swap_options", { p_my_duty: duty }).then(({ data, error }) => { if (error) setErr(errText(error)); setOpts((data as Option[]) ?? []); });
  }, [duty]);
  const ask = async (o: Option) => {
    const { error } = await sb.rpc("nst_swap_request", { p_my_duty: duty, p_their_duty: o.id });
    if (error) setErr(errText(error)); else { onDone(); onClose(); }
  };
  const shown = (opts ?? []).filter((o) => !q.trim() || `${o.student} ${o.class_room} ${o.group_name}`.includes(q.trim()));
  return (
    <Modal title="ขอแลกเวร" onClose={onClose}>
      <p className="muted small">เลือกเวรของเพื่อนที่จะแลก · เพื่อนต้องกดรับ แล้วครูผู้กำกับอนุมัติ</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ ห้อง หรือกลุ่ม" aria-label="ค้นหา" />
      {err && <p className="error">{err}</p>}
      {opts === null ? <div className="spinner" /> : shown.length === 0 ? <p className="muted">ไม่มีเวรที่แลกได้</p> : (
        <ul className="pick-list nst-opts">
          {shown.slice(0, 60).map((o) => (
            <li key={o.id}><button type="button" onClick={() => ask(o)}>
              <b>{fmtDate(o.date, { weekday: "short", day: "numeric", month: "short" })} · {o.post} {t5(o.starts)}</b>
              <small>{o.student} · {o.class_room}{o.group_name ? ` · กลุ่ม ${o.group_name}` : ""}</small>
            </button></li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
