import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Camera, MapPin, Pencil, Plus, Undo2 } from "lucide-react";
import { errText, supabase } from "../lib/supabase";
import { useMe } from "../lib/me";
import { useSignedUrls } from "../lib/photos";
import { addDays, fmtDate, fmtDateTime, todayISO } from "../lib/time";
import {
  areaM2, canEditZones, canReport, canVerifyClean, isAdvisorOf, isSchoolDay, REPORT_SELECT, RESULTS, seesAllCleanPhotos,
  STATE, stateOf, summarize, type Report, type Result, type Zone,
} from "../lib/clean";
import { PhotoPicker } from "../components/PhotoPicker";
import { uploadPics, type Pic } from "../lib/upload";
import { DateNav, Empty, Field, Modal } from "../components/ui";
import type { Pt, ZoneShape } from "../campus/campus3d";

const CampusMap = lazy(() => import("../components/CampusMap"));
const PX_PER_M = 1 / 0.3485;

export type CleanStats = { reported: number; total: number; pass: number; fail: number };
type View = "map" | "rank";
type Draft = { id: number | null; class_name: string; area: string; advisor_names: string; advisor_ids: string[]; polygon: Pt[]; sort: number; active: boolean };
type Person = { id: string; full_name: string; email: string };

const toDraft = (z: Zone | null, nextSort: number): Draft => z
  ? { id: z.id, class_name: z.class_name, area: z.area, advisor_names: z.advisor_names, advisor_ids: z.advisor_ids, polygon: z.polygon, sort: z.sort, active: z.active }
  : { id: null, class_name: "", area: "", advisor_names: "", advisor_ids: [], polygon: [], sort: nextSort, active: true };

/** เขตทำความสะอาด: ครูที่ปรึกษาถ่ายรูปรายงานทุกวันที่มีเรียน → เจ้าหน้าที่อาคารสถานที่ยืนยันผล/สุ่มตรวจ · แผนที่ 3 มิติระบายสีตามสถานะ */
export default function CleanZones({ onStats }: { onStats?: (s: CleanStats) => void }) {
  const me = useMe();
  const verifier = canVerifyClean(me), editor = canEditZones(me);
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [view, setView] = useState<View>("map");
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [drawing, setDrawing] = useState<Draft | null>(null);
  const [origPoly, setOrigPoly] = useState<Pt[]>([]);
  const [err, setErr] = useState("");

  const loadZones = useCallback(async () => {
    let q = supabase.from("clean_zones").select("*").order("sort").order("class_name");
    if (!editor) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) setErr(errText(error));
    setZones((data as Zone[]) ?? []);
  }, [editor]);
  const loadReports = useCallback(async () => {
    const { data, error } = await supabase.from("clean_reports").select(REPORT_SELECT).eq("report_date", date);
    if (error) setErr(errText(error));
    setReports((data as unknown as Report[]) ?? []);
  }, [date]);
  // โหลดหลัง await (ไม่ใช่ sync) — rule มองไม่เห็นข้าม async function
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadZones(); }, [loadZones]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadReports(); }, [loadReports]);

  const active = useMemo(() => (zones ?? []).filter((z) => z.active), [zones]);
  const byZone = useMemo(() => new Map(reports.map((r) => [r.zone_id, r])), [reports]);
  const mine = active.filter((z) => isAdvisorOf(z, me.id));

  useEffect(() => {
    if (!zones || !onStats) return;
    const rs = active.map((z) => byZone.get(z.id));
    onStats({
      reported: rs.filter((r) => r?.reported_by).length, total: active.length,
      pass: rs.filter((r) => r?.result === "pass").length, fail: rs.filter((r) => r?.result === "fail").length,
    });
  }, [zones, active, byZone, onStats]);

  // ตอนวาดเขต: เขตอื่นจางลงเป็นแนวอ้างอิง (ไม่แสดงเขตที่กำลังวาดใหม่)
  const drawingId = drawing?.id;
  const isDrawing = !!drawing;
  const shapes: ZoneShape[] = useMemo(() => active.filter((z) => z.id !== drawingId).map((z) => {
    const st = STATE[stateOf(byZone.get(z.id))];
    return { id: z.id, poly: z.polygon, color: isDrawing ? "#8a8f98" : st.color, label: z.class_name,
      // สถานะเป็นคำเฉพาะเขตที่มีความเคลื่อนไหว (ยังไม่รายงาน = จุดเทาอย่างเดียว ลดป้ายซ้อนกัน)
      sub: isDrawing || stateOf(byZone.get(z.id)) === "none" ? undefined : st.short,
      mine: isAdvisorOf(z, me.id), dim: isDrawing, aria: `${z.class_name} ${z.area} ${st.label}` };
  }), [active, byZone, me.id, drawingId, isDrawing]);

  const opened = (zones ?? []).find((z) => z.id === openId) ?? null;
  const pick = useCallback((id: number | null) => setOpenId(id), []);
  const addPoint = useCallback((p: Pt) => setDrawing((d) => (d ? { ...d, polygon: [...d.polygon, p] } : d)), []);
  const weekend = !isSchoolDay(date);

  return (
    <div className="c-zone">
      <div className="clean-bar">
        <DateNav date={date} onChange={(d) => setDate(d > today ? today : d)} />
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={view === "map"} className={view === "map" ? "on" : ""} onClick={() => setView("map")}>แผนที่เขต</button>
          <button role="tab" aria-selected={view === "rank"} className={view === "rank" ? "on" : ""} onClick={() => setView("rank")}>สรุป 30 วัน</button>
        </div>
      </div>
      {err && <p className="error">{err}</p>}

      {view === "rank" ? <Ranking zones={active} today={today} /> : (
        <>
          {weekend && <p className="note-line">{fmtDate(date, { weekday: "long", day: "numeric", month: "long" })} ไม่มีเรียน — ไม่ต้องรายงาน</p>}

          {mine.length > 0 && !drawing && (
            <section className="my-zones">
              {mine.map((z) => {
                const r = byZone.get(z.id), s = stateOf(r), st = STATE[s];
                return (
                  <button key={z.id} className="my-zone" onClick={() => setOpenId(z.id)}>
                    <span className="mz-dot" style={{ background: st.color }} aria-hidden />
                    <span className="mz-text">
                      <small>เขตของฉัน{date === today ? " · วันนี้" : ""}</small>
                      <b>{z.class_name} · {z.area}</b>
                      <em>{st.label}{s === "fail" && r?.verify_note ? ` — ${r.verify_note}` : ""}</em>
                    </span>
                    {(s === "none" || s === "fail") && !weekend && date >= addDays(today, -1)
                      ? <span className="btn primary sm"><Camera size={16} />{s === "fail" ? "แก้แล้ว ส่งใหม่" : "ถ่ายรูปรายงาน"}</span>
                      : null}
                  </button>
                );
              })}
            </section>
          )}

          {zones === null ? <div className="spinner" /> : (
            <Suspense fallback={<div className="campus3d loading"><div className="spinner" /><p>กำลังสร้างแผนที่ 3 มิติ…</p></div>}>
              <CampusMap zones={shapes} selected={drawing ? null : openId} onPick={drawing ? noop : pick}
                drawing={!!drawing} draft={drawing?.polygon} onDrawPoint={addPoint}>
                {drawing ? (
                  <div className="c3-draw">
                    <p><MapPin size={16} /> แตะพื้นทีละมุมรอบเขต{drawing.class_name ? ` ${drawing.class_name}` : ""} · {drawing.polygon.length} จุด
                      {drawing.polygon.length > 2 && ` · ราว ${areaM2(drawing.polygon, PX_PER_M).toLocaleString("th-TH")} ตร.ม.`}</p>
                    <div className="row">
                      <button className="btn sm" disabled={!drawing.polygon.length} onClick={() => setDrawing({ ...drawing, polygon: drawing.polygon.slice(0, -1) })}><Undo2 size={16} />ย้อนจุด</button>
                      <button className="btn sm" onClick={() => { setEdit({ ...drawing, polygon: origPoly }); setDrawing(null); }}>ยกเลิก</button>
                      <button className="btn primary sm" disabled={drawing.polygon.length < 3} onClick={() => { setEdit(drawing); setDrawing(null); }}>ใช้รูปเขตนี้</button>
                    </div>
                  </div>
                ) : (
                  <ul className="c3-legend" aria-label="สีของเขต">
                    {(["none", "waiting", "pass", "fair", "fail"] as const).map((k) => (
                      <li key={k}><i style={{ background: STATE[k].color }} />{STATE[k].label}</li>
                    ))}
                  </ul>
                )}
              </CampusMap>
            </Suspense>
          )}

          {!drawing && zones !== null && (
            <section>
              <div className="section-title">
                <h2>ทุกเขต <span className="muted small">{active.length} เขต</span></h2>
                {editor && <button className="link" onClick={() => setEdit(toDraft(null, (zones.at(-1)?.sort ?? 0) + 10))}><Plus size={14} style={{ verticalAlign: "-2px" }} />เพิ่มเขต</button>}
              </div>
              {(editor ? zones : active).length === 0 ? <Empty>ยังไม่มีเขตทำความสะอาด</Empty> : (
                <div className="zone-grid">
                  {(editor ? zones : active).map((z) => {
                    const r = byZone.get(z.id), st = STATE[stateOf(r)];
                    return (
                      <button key={z.id} className={`zone-chip${z.active ? "" : " off"}${isAdvisorOf(z, me.id) ? " mine" : ""}`} onClick={() => setOpenId(z.id)}>
                        <span className="zc-bar" style={{ background: st.color }} aria-hidden />
                        <b>{z.class_name}</b>
                        <small>{z.active ? st.short : "ปิดใช้งาน"}</small>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {opened && !drawing && (
        <ZoneModal zone={opened} report={byZone.get(opened.id) ?? null} date={date} today={today}
          verifier={verifier} editor={editor} onClose={() => setOpenId(null)}
          onEdit={() => { setEdit(toDraft(opened, opened.sort)); setOpenId(null); }}
          onDone={() => { loadReports(); }} />
      )}
      {edit && (
        <ZoneEditor draft={edit} onChange={setEdit} onClose={() => setEdit(null)}
          onDraw={() => { setOrigPoly(edit.polygon); setDrawing({ ...edit, polygon: [] }); setEdit(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          onSaved={() => { setEdit(null); loadZones(); }} />
      )}
    </div>
  );
}
const noop = () => {};

/* ------------------------------------------------------------------ */
/** รายละเอียดเขต: รูปรายงาน + ผลตรวจ · ครูที่ปรึกษารายงาน · เจ้าหน้าที่ยืนยันผล/สุ่มตรวจ */
function ZoneModal({ zone, report, date, today, verifier, editor, onClose, onEdit, onDone }: {
  zone: Zone; report: Report | null; date: string; today: string; verifier: boolean; editor: boolean;
  onClose: () => void; onEdit: () => void; onDone: () => void;
}) {
  const me = useMe();
  const s = stateOf(report), st = STATE[s];
  const advisor = isAdvisorOf(zone, me.id);
  const canSee = seesAllCleanPhotos(me) || advisor || report?.reported_by === me.id;
  const urls = useSignedUrls("clean-photos", canSee ? [...(report?.photo_paths ?? []), ...(report?.verify_photo_paths ?? [])] : []);
  const reportOpen = zone.active && canReport(zone, me) && (s === "none" || s === "fail" || (s === "waiting" && report?.reported_by === me.id))
    && date >= addDays(today, -1) && date <= today;
  const verifyOpen = zone.active && verifier && date >= addDays(today, -7);

  const [photos, setPhotos] = useState<Pic[]>([]);
  const [note, setNote] = useState("");
  const [vNote, setVNote] = useState("");
  const [vPhotos, setVPhotos] = useState<Pic[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!photos.length) { setErr("ถ่ายรูปเขตอย่างน้อย 1 รูป"); return; }
    setBusy(true); setErr("");
    try {
      const paths = await uploadPics("clean-photos", me.id, photos);
      const { error } = await supabase.rpc("clean_submit", { p_zone: zone.id, p_date: date, p_note: note, p_photo_paths: paths });
      if (error) throw error;
      onDone(); onClose();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const verify = async (result: Result) => {
    if (result === "fail" && !vNote.trim()) { setErr("ระบุสิ่งที่ต้องปรับปรุง เพื่อแจ้งครูที่ปรึกษา"); return; }
    setBusy(true); setErr("");
    try {
      const paths = vPhotos.length ? await uploadPics("clean-photos", me.id, vPhotos) : [];
      const { error } = await supabase.rpc("clean_verify", { p_zone: zone.id, p_date: date, p_result: result, p_note: vNote, p_photo_paths: paths });
      if (error) throw error;
      onDone(); onClose();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  const photoRow = (paths: string[]) => paths.length === 0 ? null : canSee ? (
    <div className="photos ro">{paths.map((p) => urls[p] ? <a key={p} className="photo" href={urls[p]} target="_blank" rel="noreferrer"><img src={urls[p]} alt="รูปเขตทำความสะอาด" /></a> : <div key={p} className="photo" />)}</div>
  ) : <p className="muted small">มีรูป {paths.length} รูป (เห็นเฉพาะครูที่ปรึกษาและทีมตรวจ)</p>;

  return (
    <Modal title={`เขต ${zone.class_name}`} onClose={onClose}>
      <div className="zone-head">
        <p><b>{zone.area || "—"}</b>{zone.advisor_names && <><br /><span className="muted">ครูที่ปรึกษา: {zone.advisor_names}</span></>}</p>
        <span className={`chip ${st.tone}`} style={s === "none" ? undefined : { boxShadow: `inset 3px 0 0 ${st.color}` }}>{st.label}</span>
      </div>
      <p className="muted small">{fmtDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        {zone.advisor_ids.length === 0 && " · ยังไม่ได้ผูกบัญชีครูที่ปรึกษา บุคลากรคนใดก็รายงานแทนได้"}</p>

      {report?.reported_at && (
        <div className="zone-block">
          <h4>รายงานของครูที่ปรึกษา</h4>
          <p className="small muted">{report.reporter?.full_name ?? "—"} · {fmtDateTime(report.reported_at)}</p>
          {report.note && <p>{report.note}</p>}
          {photoRow(report.photo_paths)}
        </div>
      )}
      {report?.result && (
        <div className="zone-block">
          <h4>ผลตรวจ: <span style={{ color: STATE[report.result].color }}>{STATE[report.result].label}</span></h4>
          <p className="small muted">{report.verifier?.full_name ?? "—"}{report.verified_at ? ` · ${fmtDateTime(report.verified_at)}` : ""}{!report.reported_at && " · สุ่มตรวจ"}</p>
          {report.verify_note && <p>{report.verify_note}</p>}
          {photoRow(report.verify_photo_paths)}
        </div>
      )}
      {!report && !reportOpen && <p className="muted">ยังไม่มีรายงานของวันนี้</p>}

      {reportOpen && (
        <div className="zone-block act">
          <h4>{s === "fail" ? "แก้แล้ว ส่งรูปให้ตรวจใหม่" : s === "waiting" ? "ส่งรูปใหม่แทนรายงานเดิม" : "ถ่ายรูปรายงานเขตวันนี้"}</h4>
          <p className="small muted">ถ่ายให้เห็นพื้นที่ทั้งเขต ไม่ให้มีคนอยู่ในภาพ</p>
          <PhotoPicker photos={photos} onChange={setPhotos} onError={setErr} />
          <Field label="หมายเหตุ (ถ้ามี)"><input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="เช่น กวาดใบไม้ เก็บขยะแล้ว" /></Field>
          <button className="btn primary big" disabled={busy} onClick={submit}><Camera size={16} />{busy ? "กำลังส่ง…" : "ส่งรายงาน"}</button>
        </div>
      )}

      {verifyOpen && (
        <div className="zone-block act">
          <h4>{report?.reported_at ? (report.result ? "แก้ผลตรวจ" : "ยืนยันผล") : "สุ่มตรวจ (ไม่ต้องรอรายงาน)"}</h4>
          <Field label="หมายเหตุ" hint="ถ้าให้ ต้องปรับปรุง ต้องระบุ จะส่งไปบอกครูที่ปรึกษาทาง LINE">
            <input value={vNote} maxLength={500} onChange={(e) => setVNote(e.target.value)} placeholder="เช่น ขยะใต้ต้นไม้หน้าอาคาร" />
          </Field>
          <PhotoPicker photos={vPhotos} onChange={setVPhotos} onError={setErr} />
          <div className="verify-btns">
            {RESULTS.map((r) => (
              <button key={r} className={`btn res-${r}`} disabled={busy} onClick={() => verify(r)}>
                <i style={{ background: STATE[r].color }} aria-hidden />{STATE[r].label}
              </button>
            ))}
          </div>
        </div>
      )}
      {err && <p className="error">{err}</p>}
      {editor && <button className="btn big" onClick={onEdit}><Pencil size={16} />ตั้งค่าเขตนี้</button>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/** ตั้งค่าเขต (หัวหน้างานอาคารสถานที่/admin): ชั้นเรียน พื้นที่ ครูที่ปรึกษา (ชื่อ + บัญชีสำหรับรายงาน/แจ้ง LINE) และรูปเขตบนแผนที่ */
function ZoneEditor({ draft, onChange, onClose, onDraw, onSaved }: {
  draft: Draft; onChange: (d: Draft) => void; onClose: () => void; onDraw: () => void; onSaved: () => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    supabase.from("profiles").select("id,full_name,email").order("full_name").then(({ data }) => setPeople((data as Person[]) ?? []));
  }, []);
  const set = (p: Partial<Draft>) => onChange({ ...draft, ...p });
  const picked = (people ?? []).filter((p) => draft.advisor_ids.includes(p.id));
  const found = q.trim() ? (people ?? []).filter((p) => !draft.advisor_ids.includes(p.id) && `${p.full_name} ${p.email}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : [];

  const save = async () => {
    if (!draft.class_name.trim()) { setErr("ใส่ชื่อชั้นเรียน เช่น ม.1/1"); return; }
    if (draft.polygon.length < 3) { setErr("วาดรูปเขตบนแผนที่ก่อน (อย่างน้อย 3 จุด)"); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("clean_zone_save", {
      p_id: draft.id, p_class_name: draft.class_name, p_area: draft.area, p_advisor_names: draft.advisor_names,
      p_advisor_ids: draft.advisor_ids, p_polygon: draft.polygon, p_sort: draft.sort, p_active: draft.active,
    });
    setBusy(false);
    if (error) setErr(errText(error)); else onSaved();
  };

  return (
    <Modal title={draft.id ? `ตั้งค่าเขต ${draft.class_name}` : "เพิ่มเขตทำความสะอาด"} onClose={onClose}>
      <div className="row2">
        <Field label="ชั้นเรียน"><input value={draft.class_name} maxLength={40} onChange={(e) => set({ class_name: e.target.value })} placeholder="ม.1/1" /></Field>
        <Field label="ลำดับ"><input type="number" value={draft.sort} onChange={(e) => set({ sort: Number(e.target.value) || 0 })} /></Field>
      </div>
      <Field label="พื้นที่"><input value={draft.area} maxLength={120} onChange={(e) => set({ area: e.target.value })} placeholder="เช่น หน้าอาคาร 3" /></Field>
      <Field label="ชื่อครูที่ปรึกษา (แสดงผล)"><input value={draft.advisor_names} maxLength={200} onChange={(e) => set({ advisor_names: e.target.value })} placeholder="ครู… , ครู…" /></Field>
      <Field label="บัญชีครูที่ปรึกษา" hint="ผูกบัญชีแล้ว ครูจะเห็น 'เขตของฉัน' รายงานได้ และได้รับแจ้งเตือน LINE เมื่อผลต้องปรับปรุง">
        <span className="advisor-pick">
          {picked.map((p) => (
            <button type="button" key={p.id} className="chip" onClick={() => set({ advisor_ids: draft.advisor_ids.filter((x) => x !== p.id) })} aria-label={`เอา ${p.full_name} ออก`}>{p.full_name || p.email} ✕</button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={people ? "พิมพ์ชื่อหรืออีเมลเพื่อค้นหา" : "กำลังโหลดรายชื่อ…"} />
        </span>
      </Field>
      {found.length > 0 && (
        <ul className="pick-list">
          {found.map((p) => <li key={p.id}><button type="button" onClick={() => { set({ advisor_ids: [...draft.advisor_ids, p.id] }); setQ(""); }}>{p.full_name || "—"} <small>{p.email}</small></button></li>)}
        </ul>
      )}
      <div className="zone-block">
        <h4>รูปเขตบนแผนที่</h4>
        <p className="small muted">{draft.polygon.length >= 3 ? `${draft.polygon.length} มุม · ราว ${areaM2(draft.polygon, PX_PER_M).toLocaleString("th-TH")} ตร.ม.` : "ยังไม่มีรูปเขต"}</p>
        <button type="button" className="btn" onClick={onDraw}><MapPin size={16} />{draft.polygon.length >= 3 ? "วาดรูปเขตใหม่" : "วาดรูปเขตบนแผนที่"}</button>
      </div>
      {draft.id && (
        <label className="check"><input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} /> ใช้งานเขตนี้ (ปิดแทนการลบ ประวัติยังอยู่)</label>
      )}
      {err && <p className="error">{err}</p>}
      <button className="btn primary big" disabled={busy} onClick={save}>{busy ? "กำลังบันทึก…" : "บันทึกเขต"}</button>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/** สรุป 30 วันล่าสุด: คะแนนรายเขต (สะอาด 2 พอใช้ 1 ปรับปรุง/ไม่รายงาน 0) เรียงจากมากไปน้อย */
function Ranking({ zones, today }: { zones: Zone[]; today: string }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const from = addDays(today, -29);
  useEffect(() => {
    supabase.from("clean_reports").select("id,zone_id,report_date,reported_by,result").gte("report_date", from).lte("report_date", today)
      .then(({ data }) => setReports((data as Report[]) ?? []));
  }, [from, today]);
  const rows = useMemo(() => (reports ? summarize(zones, reports, Array.from({ length: 30 }, (_, i) => addDays(from, i))) : []), [zones, reports, from]);
  if (!reports) return <div className="spinner" />;
  if (!zones.length) return <Empty>ยังไม่มีเขตทำความสะอาด</Empty>;
  return (
    <section className="rank">
      <p className="muted small">{fmtDate(from, { day: "numeric", month: "short" })} – {fmtDate(today, { day: "numeric", month: "short" })} · {rows[0]?.days ?? 0} วันที่มีเรียน · คะแนน = สะอาด 2 พอใช้ 1 ต้องปรับปรุงหรือไม่รายงาน 0</p>
      <ol>
        {rows.map((r, i) => (
          <li key={r.zone.id}>
            <span className="rk">{i + 1}</span>
            <span className="rk-main">
              <b>{r.zone.class_name}</b> <span className="muted small">{r.zone.advisor_names || r.zone.area}</span>
              <span className="rk-bar" role="img" aria-label={`คะแนน ${r.score} เปอร์เซ็นต์`}><i style={{ width: `${r.score}%` }} /></span>
              <small className="muted">รายงาน {r.reported}/{r.days} วัน · สะอาด {r.pass} · พอใช้ {r.fair} · ปรับปรุง {r.fail}</small>
            </span>
            <span className="rk-score">{r.score}<small>%</small></span>
          </li>
        ))}
      </ol>
    </section>
  );
}
