import { useCallback, useEffect, useState } from "react";
import { errText, supabase } from "../lib/supabase";
import { useMe } from "../lib/me";
import { navigate } from "../lib/router";
import { addDays, fmtDateTime, todayISO } from "../lib/time";
import { Empty, Field, Modal } from "../components/ui";
import { CAT_LABEL, GENDER_LABEL, tone, type Item } from "../lib/toilet";

type Status = {
  id: number; name: string; building: string | null; gender: string;
  last_at: string | null; last_score: number | null; last_safety_fail: boolean | null; checks_today: number;
};
type ItemReport = { item_id: number; category: Item["category"]; label: string; checks: number; fails: number };
type Inspection = {
  id: number; toilet_id: number; inspected_at: string; score: number; safety_fail: boolean;
  note: string | null; photo_paths: string[]; answers: Record<string, boolean>;
  inspector: { full_name: string; email: string } | null;
};

export default function Toilets() {
  const me = useMe();
  const canReport = me.role === "admin" || me.role === "approver";
  const canInspect = me.role === "admin" || me.role === "inspector";
  const [tab, setTab] = useState<"status" | "report">("status");
  const [status, setStatus] = useState<Status[]>([]);
  const [tokens, setTokens] = useState<Record<number, string>>({});
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      supabase.rpc("toilet_status"),
      supabase.from("toilets").select("id,qr_token").eq("active", true),
    ]).then(([s, t]) => {
      if (s.error) setErr(errText(s.error));
      setStatus((s.data as Status[]) ?? []);
      setTokens(Object.fromEntries(((t.data as { id: number; qr_token: string }[]) ?? []).map((x) => [x.id, x.qr_token])));
    });
  }, []);

  const notToday = status.filter((s) => s.checks_today === 0).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>สุขาดี มีความสุข</h1>
          <p className="muted">แบบตรวจห้องน้ำตามหลัก HAS · สะอาด เพียงพอ ปลอดภัย</p>
        </div>
      </div>
      {canReport && (
        <div className="tabs">
          <button className={tab === "status" ? "on" : ""} onClick={() => setTab("status")}>สถานะวันนี้</button>
          <button className={tab === "report" ? "on" : ""} onClick={() => setTab("report")}>รายงาน</button>
        </div>
      )}
      {err && <p className="error">{err}</p>}

      {tab === "status" && (
        <>
          {status.length > 0 && (
            <div className="stats">
              <div className="stat"><b>{status.length}</b><span>จุดทั้งหมด</span></div>
              <div className="stat"><b>{status.length - notToday}</b><span>ตรวจแล้ววันนี้</span></div>
              <div className={`stat ${notToday ? "warn" : ""}`}><b>{notToday}</b><span>ยังไม่ตรวจ</span></div>
              <div className="stat bad"><b>{status.filter((s) => tone(s.last_score, s.last_safety_fail) === "bad").length}</b><span>ต้องแก้ไข</span></div>
            </div>
          )}
          {status.length === 0 && <Empty>ยังไม่มีจุดห้องน้ำ{me.role === "admin" ? " — เพิ่มได้ที่เมนู จัดการ" : ""}</Empty>}
          <div className="grid">
            {status.map((s) => (
              <section key={s.id} className={`card toilet ${tone(s.last_score, s.last_safety_fail)}`}>
                <div className="row between">
                  <div>
                    <h3>{s.name}</h3>
                    <p className="muted small">{s.building ? `${s.building} · ` : ""}{GENDER_LABEL[s.gender]}</p>
                  </div>
                  <div className={`score ${tone(s.last_score, s.last_safety_fail)}`}>{s.last_score === null ? "—" : `${Math.round(s.last_score)}%`}</div>
                </div>
                <p className="small">
                  {s.last_at ? `ตรวจล่าสุด ${fmtDateTime(s.last_at)}` : "ยังไม่เคยตรวจ"}
                  {s.checks_today === 0 ? <span className="chip warn">ยังไม่ตรวจวันนี้</span> : <span className="chip ok">วันนี้ {s.checks_today} ครั้ง</span>}
                  {s.last_safety_fail && <span className="chip bad">ความปลอดภัยไม่ผ่าน</span>}
                </p>
                {canInspect && tokens[s.id] && <button className="btn primary" onClick={() => navigate(`/t/${tokens[s.id]}`)}>ตรวจ</button>}
              </section>
            ))}
          </div>
          {canInspect && <p className="muted small">เคล็ดลับ: สแกน QR ที่ติดหน้าห้องน้ำ จะเปิดหน้าตรวจของจุดนั้นทันที</p>}
        </>
      )}

      {tab === "report" && canReport && <Report toilets={status} />}
    </>
  );
}

function Report({ toilets }: { toilets: Status[] }) {
  const [from, setFrom] = useState(addDays(todayISO(), -6));
  const [to, setTo] = useState(todayISO());
  const [items, setItems] = useState<ItemReport[]>([]);
  const [rows, setRows] = useState<Inspection[]>([]);
  const [open, setOpen] = useState<Inspection | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [r, i] = await Promise.all([
      supabase.rpc("toilet_item_report", { p_from: from, p_to: to }),
      supabase.from("toilet_inspections")
        .select("id,toilet_id,inspected_at,score,safety_fail,note,photo_paths,answers,inspector:profiles!toilet_inspections_inspector_id_fkey(full_name,email)")
        .gte("inspected_at", `${from}T00:00:00+07:00`).lt("inspected_at", `${addDays(to, 1)}T00:00:00+07:00`)
        .order("inspected_at", { ascending: false }).limit(300),
    ]);
    setErr(r.error ? errText(r.error) : i.error ? errText(i.error) : "");
    setItems((r.data as ItemReport[]) ?? []);
    setRows((i.data as unknown as Inspection[]) ?? []);
  }, [from, to]);

  // load() ตั้ง state หลัง await (ไม่ใช่ sync) — rule มองไม่เห็นข้าม async function
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const tname = (id: number) => toilets.find((t) => t.id === id)?.name ?? `#${id}`;
  const avg = rows.length ? rows.reduce((a, r) => a + Number(r.score), 0) / rows.length : null;

  const exportCsv = () => {
    const head = ["วันเวลา", "ห้องน้ำ", "ผู้ตรวจ", "คะแนน(%)", "ความปลอดภัยไม่ผ่าน", "หมายเหตุ"];
    const lines = rows.map((r) => [fmtDateTime(r.inspected_at), tname(r.toilet_id), r.inspector?.full_name || r.inspector?.email || "",
      String(r.score), r.safety_fail ? "ใช่" : "", r.note ?? ""]);
    const csv = [head, ...lines].map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `ตรวจห้องน้ำ_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="card row wrap">
        <Field label="ตั้งแต่"><input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
        <Field label="ถึง"><input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
        <button className="btn" onClick={exportCsv} disabled={!rows.length}>ส่งออก Excel (CSV)</button>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="stats">
        <div className="stat"><b>{rows.length}</b><span>ครั้งที่ตรวจ</span></div>
        <div className="stat"><b>{avg === null ? "—" : `${Math.round(avg)}%`}</b><span>คะแนนเฉลี่ย</span></div>
        <div className="stat bad"><b>{rows.filter((r) => r.safety_fail).length}</b><span>ความปลอดภัยไม่ผ่าน</span></div>
      </div>

      <section className="card">
        <h3>ข้อที่ไม่ผ่านบ่อย</h3>
        {items.filter((i) => i.fails > 0).length === 0 ? <p className="muted small">ไม่มีข้อที่ไม่ผ่านในช่วงนี้</p> : (
          <ul className="bars">
            {items.filter((i) => i.fails > 0).map((i) => (
              <li key={i.item_id}>
                <span className="bar-label"><span className={`cat-dot cat-${i.category}`} title={CAT_LABEL[i.category]} />{i.label}</span>
                <span className="bar"><span style={{ width: `${(100 * i.fails) / Math.max(1, i.checks)}%` }} /></span>
                <span className="bar-val">{i.fails}/{i.checks}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3>บันทึกการตรวจ</h3>
        {rows.length === 0 ? <p className="muted small">ไม่มีบันทึกในช่วงนี้</p> : (
          <ul className="list">
            {rows.map((r) => (
              <li key={r.id} className="clickable" onClick={() => setOpen(r)}>
                <span className={`score sm ${tone(r.score, r.safety_fail)}`}>{Math.round(r.score)}%</span>
                <span><b>{tname(r.toilet_id)}</b> <span className="muted small">· {fmtDateTime(r.inspected_at)} · {r.inspector?.full_name || r.inspector?.email}</span>
                  {r.photo_paths.length > 0 && " 📷"}{r.note && <div className="small muted">{r.note}</div>}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {open && <InspectionDetail row={open} title={tname(open.toilet_id)} onClose={() => setOpen(null)} />}
    </>
  );
}

function InspectionDetail({ row, title, onClose }: { row: Inspection; title: string; onClose: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    supabase.from("toilet_checklist_items").select("*").order("sort").then(({ data }) => setItems((data as Item[]) ?? []));
    if (row.photo_paths.length)
      supabase.storage.from("toilet-photos").createSignedUrls(row.photo_paths, 600)
        .then(({ data }) => setUrls((data ?? []).map((d) => d.signedUrl).filter(Boolean) as string[]));
  }, [row]);
  const failed = items.filter((i) => row.answers[String(i.id)] === false);
  return (
    <Modal title={`${title} · ${fmtDateTime(row.inspected_at)}`} onClose={onClose}>
      <p>คะแนน <b>{Math.round(row.score)}%</b> · ผู้ตรวจ {row.inspector?.full_name || row.inspector?.email}</p>
      {failed.length === 0 ? <p className="muted">ผ่านทุกข้อ</p> : (
        <>
          <h4>ข้อที่ไม่ผ่าน</h4>
          <ul>{failed.map((i) => <li key={i.id}><span className={`cat-dot cat-${i.category}`} /> {i.label}</li>)}</ul>
        </>
      )}
      {row.note && <p>หมายเหตุ: {row.note}</p>}
      {urls.length > 0 && <div className="photos">{urls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="photo"><img src={u} alt="" /></a>)}</div>}
    </Modal>
  );
}
