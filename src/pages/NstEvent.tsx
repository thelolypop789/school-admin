import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, MapPin, Move, Plus, Trash2, UserPlus, X } from "lucide-react";
import { errText, supabase } from "../lib/supabase";
import { addDays, fmtDate, todayISO } from "../lib/time";
import { DUTY, groupLabel, type Duty, type Post, type Student } from "../lib/nst";
import type { Pt, ZoneShape } from "../campus/campus3d";
import { Empty, Field, Modal } from "../components/ui";

const CampusMap = lazy(() => import("../components/CampusMap"));
const t5 = (t: string) => t.slice(0, 5);
const STUDENT_COLS = "id,student_code,full_name,class_room,nst_year,group_name,pin_set,active,failed_attempts,locked_until";
const PIN = "#3a4419";
const err2 = (e: unknown) => {
  const m = (e as { message?: string })?.message ?? "";
  if (/excused/.test(m)) return "มีนักเรียนที่ถูกตั้งว่ามีหน้าที่อื่นวันนั้น เอาออกจาก “มีหน้าที่อื่น” ก่อน";
  if (/conflict/.test(m)) return "มีนักเรียนที่มีเวรอื่นในวันเดียวกันแล้ว (คนหนึ่งลงได้วันละ 1 จุด)";
  if (/has_checkins/.test(m)) return "มีนักเรียนรายงานตัวที่จุดนี้แล้ว เอาออก/ลบไม่ได้";
  return errText(e);
};
const byName = (a: Student, b: Student) => a.full_name.localeCompare(b.full_name, "th");

async function fetchEventDays(today: string) {
  const { data: ps } = await supabase.from("nst_posts").select("id,event_day").gte("event_day", today);
  const posts = (ps as { id: number; event_day: string }[]) ?? [];
  const ids = posts.map((p) => p.id);
  const { data: ds } = ids.length ? await supabase.from("nst_duties").select("post_id").in("post_id", ids) : { data: [] };
  const m = new Map<string, { posts: number; people: number }>();
  for (const p of posts) { const x = m.get(p.event_day) ?? { posts: 0, people: 0 }; x.posts++; m.set(p.event_day, x); }
  for (const d of (ds as { post_id: number }[]) ?? []) { const p = posts.find((q) => q.id === d.post_id); const x = p && m.get(p.event_day); if (x) x.people++; }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, x]) => ({ day, ...x }));
}

/** เวรจราจรเฉพาะกิจ: รายการวันที่มีเวรเฉพาะกิจ + เปิดจัดเวรของวันนั้น */
export function EventDays({ staff, open, setOpen }: { staff: boolean; open: string | null; setOpen: (day: string | null) => void }) {
  const today = todayISO();
  const [days, setDays] = useState<{ day: string; posts: number; people: number }[] | null>(null);
  const [newDay, setNewDay] = useState(addDays(today, 1));

  useEffect(() => {
    if (open) return;
    let live = true;
    fetchEventDays(today).then((d) => { if (live) setDays(d); });
    return () => { live = false; };
  }, [today, open]);

  if (open) return <EventEditor day={open} staff={staff} onBack={() => setOpen(null)} />;
  return (
    <section>
      <div className="section-title"><h2>เวรเฉพาะกิจ</h2></div>
      <div className="card nst-list">
        <p className="muted small">สำหรับงานพิเศษ เช่น วันกีฬา — วางจุดเวรบนแผนที่ 3 มิติ แล้วเลือกคนลงทีละจุด นักเรียนเห็นในแอปและรายงานตัวด้วยเซลฟี่เหมือนเวรปกติ ถ้าวันนั้นไม่ต้องมีเวรปกติ ให้ใส่เป็นวันงดเวรแล้วกดจัดเวรอัตโนมัติใหม่</p>
        {days === null ? <div className="spinner" /> : days.map((d) => (
          <div key={d.day} className="nst-person">
            <span className="nst-person-text"><b>{fmtDate(d.day, { weekday: "short", day: "numeric", month: "short", year: "2-digit" })}</b><small>{d.posts} จุด · ลงเวรแล้ว {d.people} คน</small></span>
            <button className="btn sm" onClick={() => setOpen(d.day)}>{staff ? "จัดเวร" : "ดู"}</button>
          </div>
        ))}
        {staff && (
          <div className="row wrap">
            <input type="date" min={today} value={newDay} onChange={(e) => setNewDay(e.target.value)} aria-label="วันที่มีเวรเฉพาะกิจ" />
            <button className="btn primary" disabled={!newDay || newDay < today} onClick={() => setOpen(newDay)}><Plus size={16} />จัดเวรเฉพาะกิจวันนี้</button>
          </div>
        )}
      </div>
    </section>
  );
}

type Excused = { day: string; student_id: number; note: string };
type Picker = { kind: "assign"; post: Post } | { kind: "excuse" };
type PointDraft = { post: Post | null; x: number | null; y: number | null };

function EventEditor({ day, staff, onBack }: { day: string; staff: boolean; onBack: () => void }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [duties, setDuties] = useState<Duty[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [excused, setExcused] = useState<Excused[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [placing, setPlacing] = useState<{ move: Post | null } | null>(null);
  const [draft, setDraft] = useState<PointDraft | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [p, d, s, e] = await Promise.all([
      supabase.from("nst_posts").select("*").eq("event_day", day).order("sort").order("id"),
      supabase.from("nst_duties").select("*").eq("duty_date", day),
      supabase.from("nst_students").select(STUDENT_COLS).eq("active", true),
      supabase.from("nst_event_excused").select("*").eq("day", day),
    ]);
    const er = p.error ?? d.error ?? s.error ?? e.error;
    setErr(er ? errText(er) : "");
    setPosts((p.data as Post[]) ?? []);
    setDuties((d.data as Duty[]) ?? []);
    setStudents(((s.data as Student[]) ?? []).sort(byName));
    setExcused((e.data as Excused[]) ?? []);
  }, [day]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const stu = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const eventIds = useMemo(() => new Set((posts ?? []).map((p) => p.id)), [posts]);
  const shapes: ZoneShape[] = useMemo(() => (posts ?? []).filter((p) => p.map_x != null && p.map_y != null).map((p) => {
    const i = posts!.indexOf(p) + 1, x = p.map_x!, y = p.map_y!, r = 7;
    return { id: p.id, poly: [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]] as Pt[], color: PIN,
      label: `${i} ${p.name}`, sub: `${duties.filter((d) => d.post_id === p.id).length} คน`, aria: `จุดที่ ${i} ${p.name}` };
  }), [posts, duties]);

  const busy = new Set(duties.map((d) => d.student_id));
  const exc = new Set(excused.map((e) => e.student_id));
  const onDuty = duties.filter((d) => eventIds.has(d.post_id)).length;
  const free = students.filter((s) => !busy.has(s.id) && !exc.has(s.id));
  const regular = duties.filter((d) => !eventIds.has(d.post_id)).length;

  const assign = async (post: Post, ids: number[]) => {
    const { error } = await supabase.rpc("nst_event_assign", { p_post: post.id, p_students: ids });
    if (error) setErr(err2(error)); else { setErr(""); load(); }
  };
  const excuse = async (id: number, on: boolean, note = "") => {
    const { error } = await supabase.rpc("nst_event_excuse", { p_day: day, p_student: id, p_note: note, p_on: on });
    if (error) setErr(err2(error)); else { setErr(""); load(); }
  };
  const remove = async (p: Post) => {
    if (!confirm(`ลบจุด “${p.name}” และรายชื่อคนในจุดนี้?`)) return;
    const { error } = await supabase.rpc("nst_event_post_remove", { p_id: p.id });
    if (error) setErr(err2(error)); else load();
  };
  const savePoint = async (p: Post | null, name: string, starts: string, ends: string, x: number | null, y: number | null) => {
    const sort = p?.sort ?? Math.max(0, ...(posts ?? []).map((q) => q.sort)) + 1;
    const { error } = await supabase.rpc("nst_event_post_save", { p_id: p?.id ?? null, p_day: day, p_name: name, p_starts: starts, p_ends: ends, p_sort: sort, p_x: x, p_y: y });
    if (error) return err2(error);
    setDraft(null); load(); return "";
  };
  const onMapPoint = useCallback((pt: Pt) => {
    setPlacing((pl) => {
      if (!pl) return pl;
      if (pl.move) {
        const m = pl.move;
        supabase.rpc("nst_event_post_save", { p_id: m.id, p_day: day, p_name: m.name, p_starts: t5(m.starts), p_ends: t5(m.ends), p_sort: m.sort, p_x: pt[0], p_y: pt[1] })
          .then(({ error }) => { if (error) setErr(err2(error)); else load(); });
      } else setDraft({ post: null, x: pt[0], y: pt[1] });
      return null;
    });
  }, [day, load]);
  const pick = useCallback((id: number | null) => {
    setSelected(id);
    if (id != null) document.getElementById(`evp-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);
  const noop = useCallback(() => {}, []);

  if (!posts) return <div className="spinner" />;
  const last = posts[posts.length - 1];
  return (
    <>
      <div className="section-title">
        <h2><button className="icon-btn" onClick={onBack} aria-label="กลับไปเวรจราจร"><ArrowLeft size={18} /></button> เวรเฉพาะกิจ {fmtDate(day, { weekday: "short", day: "numeric", month: "short", year: "2-digit" })}</h2>
      </div>
      <p className="nst-counts">
        <span className="chip">{posts.length} จุด</span><span className="chip ok">ลงเวร {onDuty} คน</span>
        <span className="chip info">หน้าที่อื่น {excused.length} คน</span><span className={`chip ${free.length ? "warn" : ""}`}>ยังว่าง {free.length} คน</span>
        {regular > 0 && <span className="chip bad">มีเวรปกติวันนี้ {regular} คน</span>}
      </p>
      {regular > 0 && staff && <p className="muted small">วันนี้ยังมีเวรปกติอยู่ ถ้าไม่ต้องการ ใส่วันนี้เป็น “วันงดเวร” แล้วกด “จัดเวรอัตโนมัติ” ใหม่ คนที่มีเวรปกติวันนี้เลือกลงจุดเฉพาะกิจไม่ได้</p>}
      {err && <p className="error">{err}</p>}

      <Suspense fallback={<div className="campus3d loading"><div className="spinner" /><p>กำลังสร้างแผนที่ 3 มิติ…</p></div>}>
        <CampusMap zones={shapes} selected={placing ? null : selected} onPick={placing ? noop : pick} drawing={!!placing} onDrawPoint={onMapPoint}>
          {placing && (
            <div className="c3-draw">
              <p><MapPin size={16} /> {placing.move ? `แตะตำแหน่งใหม่ของ “${placing.move.name}”` : "แตะบนแผนที่ตรงที่จะให้ยืนเวร"}</p>
              <div className="row"><button className="btn sm" onClick={() => setPlacing(null)}>ยกเลิก</button></div>
            </div>
          )}
        </CampusMap>
      </Suspense>
      {staff && !placing && (
        <div className="row wrap" style={{ marginBottom: "1rem" }}>
          <button className="btn primary" onClick={() => { setPlacing({ move: null }); window.scrollTo({ top: 0, behavior: "smooth" }); }}><MapPin size={16} />เพิ่มจุดบนแผนที่</button>
          <button className="btn" onClick={() => setDraft({ post: null, x: null, y: null })}><Plus size={16} />เพิ่มจุดไม่ระบุตำแหน่ง</button>
        </div>
      )}

      {posts.length === 0 ? <Empty>ยังไม่มีจุดเวร — กด “เพิ่มจุดบนแผนที่” แล้วแตะตรงที่จะให้ยืนเวร</Empty> : posts.map((p, i) => {
        const ds = duties.filter((d) => d.post_id === p.id);
        return (
          <div key={p.id} id={`evp-${p.id}`} className={`card nst-list ev-point${selected === p.id ? " on" : ""}`}>
            <div className="nst-person">
              <span className="nst-order">{i + 1}</span>
              <span className="nst-person-text"><b>{p.name}</b><small>{t5(p.starts)}–{t5(p.ends)} น. · {ds.length} คน{p.map_x == null ? " · ยังไม่ได้วางบนแผนที่" : ""}</small></span>
              {staff && (
                <div className="row">
                  <button className="icon-btn" onClick={() => { setPlacing({ move: p }); window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-label={`ย้ายจุด ${p.name} บนแผนที่`} title="ย้ายบนแผนที่"><Move size={16} /></button>
                  <button className="btn sm" onClick={() => setDraft({ post: p, x: p.map_x ?? null, y: p.map_y ?? null })}>แก้ไข</button>
                  <button className="icon-btn" onClick={() => remove(p)} aria-label={`ลบจุด ${p.name}`}><Trash2 size={16} /></button>
                </div>
              )}
            </div>
            <div className="advisor-pick ev-people">
              {ds.map((d) => {
                const s = stu.get(d.student_id);
                const done = d.status !== "assigned";
                return (
                  <span key={d.id} className={`chip ${done ? DUTY[d.status].tone : ""}`}>
                    {s?.full_name ?? "?"}{s?.group_name ? <small> · {groupLabel(s.group_name)}</small> : null}{done ? ` · ${DUTY[d.status].label}` : ""}
                    {staff && !done && <button className="chip-x" onClick={() => assign(p, ds.filter((x) => x.id !== d.id).map((x) => x.student_id))} aria-label={`เอา ${s?.full_name} ออกจากจุดนี้`}><X size={13} /></button>}
                  </span>
                );
              })}
              {staff && <button className="btn sm" onClick={() => setPicker({ kind: "assign", post: p })}><UserPlus size={15} />เพิ่มคน</button>}
            </div>
          </div>
        );
      })}

      <section>
        <div className="section-title"><h2>มีหน้าที่อื่นวันนี้</h2>{staff && <button className="link" onClick={() => setPicker({ kind: "excuse" })}><Plus size={14} style={{ verticalAlign: "-2px" }} />เลือกคน</button>}</div>
        <div className="card nst-list">
          <p className="muted small">เช่น ถือธง การแสดงพิธีเปิด — คนในรายการนี้จะไม่ถูกเลือกลงจุดเวร</p>
          <div className="advisor-pick">
            {excused.length === 0 && <span className="muted small">ยังไม่มี</span>}
            {excused.map((e) => (
              <span key={e.student_id} className="chip info">{stu.get(e.student_id)?.full_name ?? "?"}{e.note ? <small> · {e.note}</small> : null}
                {staff && <button className="chip-x" onClick={() => excuse(e.student_id, false)} aria-label={`เอา ${stu.get(e.student_id)?.full_name} ออกจากรายการหน้าที่อื่น`}><X size={13} /></button>}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="section-title"><h2>ยังไม่มีหน้าที่ ({free.length})</h2></div>
        <div className="card nst-list">
          {free.length === 0 ? <p className="muted small">ทุกคนมีหน้าที่แล้ว</p> : <p className="small">{free.map((s) => s.full_name).join(" · ")}</p>}
        </div>
      </section>
      <div className="fab-space" />

      {draft && <PointForm draft={draft} last={last} onClose={() => setDraft(null)} onSave={savePoint} />}
      {picker && (
        <StudentPicker
          title={picker.kind === "assign" ? `เพิ่มคนลงจุด ${picker.post.name}` : "คนที่มีหน้าที่อื่นวันนี้"}
          candidates={picker.kind === "assign" ? free : students.filter((s) => !exc.has(s.id) && !duties.some((d) => d.student_id === s.id && d.status !== "assigned"))}
          note={picker.kind === "excuse"}
          busyIds={picker.kind === "excuse" ? busy : undefined}
          onClose={() => setPicker(null)}
          onPick={async (ids, note) => {
            if (picker.kind === "assign") await assign(picker.post, [...duties.filter((d) => d.post_id === picker.post.id).map((d) => d.student_id), ...ids]);
            else for (const id of ids) await excuse(id, true, note);
            setPicker(null);
          }} />
      )}
    </>
  );
}

function PointForm({ draft, last, onClose, onSave }: {
  draft: PointDraft; last?: Post; onClose: () => void;
  onSave: (p: Post | null, name: string, starts: string, ends: string, x: number | null, y: number | null) => Promise<string>;
}) {
  const p = draft.post;
  const [name, setName] = useState(p?.name ?? "");
  const [starts, setStarts] = useState(p ? t5(p.starts) : last ? t5(last.starts) : "07:00");
  const [ends, setEnds] = useState(p ? t5(p.ends) : last ? t5(last.ends) : "09:00");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim() || ends <= starts) { setErr("ใส่ชื่อจุด และเวลาเลิกต้องหลังเวลาเริ่ม"); return; }
    setSaving(true); const e = await onSave(p, name.trim(), starts, ends, draft.x, draft.y); setSaving(false); setErr(e);
  };
  return (
    <Modal title={p ? `แก้ไขจุด ${p.name}` : "เพิ่มจุดเวร"} onClose={onClose}>
      {!p && draft.x != null && <p className="muted small"><MapPin size={14} style={{ verticalAlign: "-2px" }} /> วางตามตำแหน่งที่แตะบนแผนที่</p>}
      <Field label="ชื่อจุด"><input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="เช่น หน้าประตู · โบกรถเข้าลานจอด" /></Field>
      <div className="row2">
        <Field label="เริ่ม"><input type="time" value={starts} onChange={(e) => setStarts(e.target.value)} /></Field>
        <Field label="เลิก"><input type="time" value={ends} onChange={(e) => setEnds(e.target.value)} /></Field>
      </div>
      <p className="muted small">นักเรียนรายงานตัวได้ตั้งแต่ 30 นาทีก่อนเริ่ม หลังเริ่ม 10 นาที = สาย</p>
      {err && <p className="error">{err}</p>}
      <button className="btn primary big" disabled={saving} onClick={save}>บันทึกจุด</button>
    </Modal>
  );
}

function StudentPicker({ title, candidates, note: withNote, busyIds, onClose, onPick }: {
  title: string; candidates: Student[]; note: boolean; busyIds?: Set<number>; onClose: () => void; onPick: (ids: number[], note: string) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const key = q.replace(/\s+/g, "");
  const list = candidates.filter((s) => !key || s.full_name.replace(/\s+/g, "").includes(key) || s.class_room.includes(key) || s.group_name.includes(key));
  const toggle = (id: number) => setSel((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Modal title={title} onClose={onClose}>
      {withNote && <Field label="หน้าที่"><input value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ถือธง / การแสดงพิธีเปิด" /></Field>}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ ห้อง หรือกลุ่ม" aria-label="ค้นหานักเรียน" style={{ marginBottom: ".5rem" }} />
      <div className="ev-pick">
        {list.length === 0 && <p className="muted small">ไม่มีรายชื่อที่เลือกได้</p>}
        {list.map((s) => (
          <label key={s.id} className={sel.has(s.id) ? "on" : ""}>
            <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)} />
            <span><b>{s.full_name}</b><small>{[s.class_room, s.group_name && groupLabel(s.group_name), busyIds?.has(s.id) ? "อยู่ในจุดเวรแล้ว (จะเอาออกจากจุด)" : ""].filter(Boolean).join(" · ")}</small></span>
          </label>
        ))}
      </div>
      <button className="btn primary big" disabled={!sel.size || saving} onClick={async () => { setSaving(true); await onPick([...sel], note); setSaving(false); }}>
        เลือก {sel.size} คน
      </button>
    </Modal>
  );
}
