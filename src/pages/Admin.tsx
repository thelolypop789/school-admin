import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { errText, ROLE_LABEL, supabase, type Profile, type Role } from "../lib/supabase";
import { useMe } from "../lib/me";
import { Empty, Modal } from "../components/ui";
import { CAT_LABEL, GENDER_LABEL } from "../lib/toilet";

type Tab = "rooms" | "vehicles" | "drivers" | "toilets" | "checklist" | "users";
const TABS: [Tab, string][] = [
  ["rooms", "ห้องประชุม"], ["vehicles", "รถ"], ["drivers", "คนขับ"],
  ["toilets", "ห้องน้ำ + QR"], ["checklist", "รายการตรวจ"], ["users", "ผู้ใช้"],
];

// ช่องข้อมูลของแต่ละตารางหลัก
type Col = { key: string; label: string; type?: "text" | "number" | "list" | "select"; options?: Record<string, string>; required?: boolean };
const TABLES: Record<Exclude<Tab, "users">, { table: string; order: string; cols: Col[] }> = {
  rooms: { table: "rooms", order: "name", cols: [
    { key: "name", label: "ชื่อห้อง", required: true },
    { key: "capacity", label: "ความจุ (คน)", type: "number" },
    { key: "equipment", label: "อุปกรณ์ (คั่นด้วย ,)", type: "list" },
    { key: "note", label: "หมายเหตุ" },
  ] },
  vehicles: { table: "vehicles", order: "name", cols: [
    { key: "name", label: "ชื่อรถ", required: true },
    { key: "plate", label: "ทะเบียน" },
    { key: "seats", label: "ที่นั่ง", type: "number" },
  ] },
  drivers: { table: "drivers", order: "full_name", cols: [
    { key: "full_name", label: "ชื่อ-สกุล", required: true },
    { key: "phone", label: "เบอร์โทร" },
  ] },
  toilets: { table: "toilets", order: "name", cols: [
    { key: "name", label: "ชื่อจุด", required: true },
    { key: "building", label: "อาคาร" },
    { key: "gender", label: "ประเภท", type: "select", options: GENDER_LABEL, required: true },
  ] },
  checklist: { table: "toilet_checklist_items", order: "sort", cols: [
    { key: "category", label: "หมวด", type: "select", options: CAT_LABEL, required: true },
    { key: "label", label: "ข้อตรวจ", required: true },
    { key: "sort", label: "ลำดับ", type: "number" },
  ] },
};

type Row = Record<string, unknown> & { id: number; active: boolean };

export default function Admin() {
  const [tab, setTab] = useState<Tab>("rooms");
  return (
    <>
      <div className="page-head"><h1>จัดการระบบ</h1></div>
      <div className="tabs scroll">
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === "users" ? <Users /> : <TableEditor key={tab} kind={tab} />}
    </>
  );
}

function TableEditor({ kind }: { kind: Exclude<Tab, "users"> }) {
  const cfg = TABLES[kind];
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from(cfg.table).select("*").order(cfg.order);
    if (error) setErr(errText(error));
    setRows((data as Row[]) ?? []);
  }, [cfg]);
  // load() ตั้ง state หลัง await (ไม่ใช่ sync) — rule มองไม่เห็นข้าม async function
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const toggle = async (r: Row) => {
    const { error } = await supabase.from(cfg.table).update({ active: !r.active }).eq("id", r.id);
    if (error) alert(errText(error)); else load();
  };

  const show = (r: Row, c: Col) => {
    const v = r[c.key];
    if (v === null || v === undefined || v === "") return "—";
    if (c.type === "list") return (v as string[]).join(", ") || "—";
    if (c.type === "select") return c.options?.[String(v)] ?? String(v);
    return String(v);
  };

  return (
    <>
      <div className="row">
        <button className="btn primary" onClick={() => setEdit("new")}>+ เพิ่ม</button>
        {kind === "toilets" && <button className="btn" onClick={() => setShowQr(true)} disabled={!rows.some((r) => r.active)}>🖨️ พิมพ์ QR ทุกจุด</button>}
      </div>
      {kind === "checklist" && <p className="muted small">แก้ข้อความหรือปิดข้อที่ไม่ใช้ได้ (ผลตรวจเก่ายังเก็บไว้) · เทียบกับแบบประเมิน HAS ฉบับล่าสุดของกรมอนามัยก่อนใช้จริง</p>}
      {err && <p className="error">{err}</p>}
      {rows.length === 0 ? <Empty>ยังไม่มีข้อมูล</Empty> : (
        <div className="card table-wrap">
          <table>
            <thead><tr>{cfg.cols.map((c) => <th key={c.key}>{c.label}</th>)}<th>สถานะ</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.active ? "" : "inactive"}>
                  {cfg.cols.map((c) => <td key={c.key}>{show(r, c)}</td>)}
                  <td><button className={`chip ${r.active ? "ok" : "mute"}`} onClick={() => toggle(r)}>{r.active ? "ใช้งาน" : "ปิด"}</button></td>
                  <td><button className="link" onClick={() => setEdit(r)}>แก้ไข</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <RowForm cfg={cfg} row={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {showQr && <QrSheet toilets={rows.filter((r) => r.active)} onClose={() => setShowQr(false)} />}
    </>
  );
}

function RowForm({ cfg, row, onClose, onSaved }: {
  cfg: (typeof TABLES)[keyof typeof TABLES]; row: Row | null; onClose: () => void; onSaved: () => void;
}) {
  const init = Object.fromEntries(cfg.cols.map((c) => {
    const v = row?.[c.key];
    if (c.type === "list") return [c.key, ((v as string[] | undefined) ?? []).join(", ")];
    if (c.type === "select") return [c.key, v ?? Object.keys(c.options ?? {})[0]];
    return [c.key, v ?? ""];
  }));
  const [v, setV] = useState<Record<string, unknown>>(init);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = Object.fromEntries(cfg.cols.map((c) => {
      const raw = String(v[c.key] ?? "").trim();
      if (c.type === "number") return [c.key, raw === "" ? (c.key === "sort" ? 0 : null) : Number(raw)];
      if (c.type === "list") return [c.key, raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : []];
      return [c.key, raw === "" ? null : raw];
    }));
    setSaving(true);
    const q = row ? supabase.from(cfg.table).update(payload).eq("id", row.id) : supabase.from(cfg.table).insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) setErr(errText(error)); else onSaved();
  };

  return (
    <Modal title={row ? "แก้ไข" : "เพิ่ม"} onClose={onClose}>
      <form className="form" onSubmit={save}>
        {cfg.cols.map((c) => (
          <label key={c.key} className="field">
            <span>{c.label}</span>
            {c.type === "select" ? (
              <select value={String(v[c.key])} onChange={(e) => setV({ ...v, [c.key]: e.target.value })}>
                {Object.entries(c.options ?? {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            ) : (
              <input type={c.type === "number" ? "number" : "text"} required={c.required} value={String(v[c.key] ?? "")}
                onChange={(e) => setV({ ...v, [c.key]: e.target.value })} />
            )}
          </label>
        ))}
        {err && <p className="error">{err}</p>}
        <button className="btn primary big" disabled={saving}>{saving ? "กำลังบันทึก…" : "บันทึก"}</button>
      </form>
    </Modal>
  );
}

/** แผ่น QR สำหรับปริ้นติดหน้าห้องน้ำ (A4 ได้ 6 จุด) */
function QrSheet({ toilets, onClose }: { toilets: Row[]; onClose: () => void }) {
  const [codes, setCodes] = useState<{ id: number; name: string; sub: string; src: string }[]>([]);
  useEffect(() => {
    Promise.all(toilets.map(async (t) => ({
      id: t.id,
      name: String(t.name),
      sub: [t.building, GENDER_LABEL[String(t.gender)]].filter(Boolean).join(" · "),
      src: await QRCode.toDataURL(`${window.location.origin}/t/${t.qr_token}`, { width: 480, margin: 1, errorCorrectionLevel: "M" }),
    }))).then(setCodes);
  }, [toilets]);
  return (
    <div className="qr-print">
      <div className="qr-toolbar no-print">
        <button className="btn" onClick={onClose}>← กลับ</button>
        <button className="btn primary" onClick={() => window.print()}>พิมพ์</button>
      </div>
      <div className="qr-grid">
        {codes.map((c) => (
          <div key={c.id} className="qr-card">
            <div className="qr-title">สุขาดี มีความสุข</div>
            <img src={c.src} alt={`QR ${c.name}`} />
            <div className="qr-name">{c.name}</div>
            <div className="qr-sub">{c.sub}</div>
            <div className="qr-hint">ผู้ตรวจ: สแกนเพื่อบันทึกผลตรวจ</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Users() {
  const me = useMe();
  const [rows, setRows] = useState<Profile[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    const { data, error } = await supabase.from("profiles").select("id,email,full_name,role,line_user_id,position").order("full_name");
    if (error) setErr(errText(error));
    setRows((data as Profile[]) ?? []);
  }, []);
  // load() ตั้ง state หลัง await (ไม่ใช่ sync) — rule มองไม่เห็นข้าม async function
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const setRole = async (u: Profile, role: Role) => {
    const { error } = await supabase.rpc("admin_set_role", { p_user: u.id, p_role: role });
    if (error) alert(errText(error)); else load();
  };

  const list = rows.filter((r) => !q || `${r.full_name} ${r.email}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <p className="muted small">ครูจะปรากฏในรายการหลังเข้าสู่ระบบครั้งแรก · ทุกคนเริ่มเป็น "บุคลากร"</p>
      <input className="search" placeholder="ค้นหาชื่อหรืออีเมล" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <p className="error">{err}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>ชื่อ</th><th>อีเมล</th><th>บทบาท</th></tr></thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                <td>{u.full_name || "—"}</td>
                <td className="small">{u.email}</td>
                <td>
                  <select value={u.role} disabled={u.id === me.id} onChange={(e) => setRole(u, e.target.value as Role)}>
                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length === 0 && <Empty>ไม่พบผู้ใช้</Empty>}
    </>
  );
}
