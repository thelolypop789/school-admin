import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { errText, ROLE_LABEL, supabase, type Profile, type Role } from "../lib/supabase";
import { useMe } from "../lib/me";
import { Empty, Modal, ModuleHero } from "../components/ui";
import { Camera, CarFront, Plus, Printer, Settings } from "lucide-react";
import { CAT_LABEL, GENDER_LABEL } from "../lib/toilet";
import { CONDITION_LABEL, licenseDaysLeft } from "../lib/vehicle";
import { compressImage } from "../lib/image";
import { useSignedUrls } from "../lib/photos";
import { EXTRA_ROLES } from "../lib/roles";
import { fmtDate } from "../lib/time";

type Tab = "rooms" | "vehicles" | "drivers" | "toilets" | "checklist" | "users";
const TABS: [Tab, string][] = [
  ["rooms", "ห้องประชุม"], ["vehicles", "รถ"], ["drivers", "คนขับ"],
  ["toilets", "ห้องน้ำ + QR"], ["checklist", "รายการตรวจ"], ["users", "ผู้ใช้"],
];

// ช่องข้อมูลของแต่ละตารางหลัก
type Col = { key: string; label: string; type?: "text" | "number" | "list" | "select" | "date"; options?: Record<string, string>; required?: boolean };
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
    { key: "condition", label: "สภาพ", type: "select", options: CONDITION_LABEL, required: true },
    { key: "condition_note", label: "หมายเหตุสภาพรถ" },
    { key: "act_expiry", label: "พ.ร.บ. หมดอายุ", type: "date" },
    { key: "tax_expiry", label: "ภาษีหมดอายุ", type: "date" },
    { key: "insurance_expiry", label: "ประกันภัยหมดอายุ", type: "date" },
  ] },
  drivers: { table: "drivers", order: "full_name", cols: [
    { key: "full_name", label: "ชื่อ-สกุล", required: true },
    { key: "phone", label: "เบอร์โทร" },
    { key: "license_expiry", label: "ใบขับขี่หมดอายุ", type: "date" },
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
      <ModuleHero mod="c-ga" icon={Settings} title="จัดการระบบ" desc="ข้อมูลห้อง รถ คนขับ ห้องน้ำ รายการตรวจ และสิทธิ์ของผู้ใช้" />
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
  const photos = useSignedUrls("vehicle-photos", kind === "vehicles" ? rows.map((r) => r.photo_path as string | null) : []);
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
    if (c.type === "date") {
      const left = licenseDaysLeft(String(v));
      return <>{fmtDate(String(v))}{left !== null && left < 0 ? <span className="chip bad">หมดอายุ</span> : left !== null && left <= 30 ? <span className="chip warn">อีก {left} วัน</span> : null}</>;
    }
    return String(v);
  };

  return (
    <>
      <div className="row">
        <button className="btn primary" onClick={() => setEdit("new")}><Plus size={18} />เพิ่ม</button>
        {kind === "toilets" && <button className="btn" onClick={() => setShowQr(true)} disabled={!rows.some((r) => r.active)}><Printer size={18} />พิมพ์ QR ทุกจุด</button>}
      </div>
      {kind === "checklist" && <p className="muted small">แก้ข้อความหรือปิดข้อที่ไม่ใช้ได้ (ผลตรวจเก่ายังเก็บไว้) · เทียบกับแบบประเมิน HAS ฉบับล่าสุดของกรมอนามัยก่อนใช้จริง</p>}
      {err && <p className="error">{err}</p>}
      {rows.length === 0 ? <Empty>ยังไม่มีข้อมูล</Empty> : (
        <div className="card table-wrap">
          <table>
            <thead><tr>{kind === "vehicles" && <th>รูป</th>}{cfg.cols.map((c) => <th key={c.key}>{c.label}</th>)}<th>สถานะ</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.active ? "" : "inactive"}>
                  {kind === "vehicles" && <td><VehiclePhoto row={r} url={r.photo_path ? photos[String(r.photo_path)] : undefined} onDone={load} /></td>}
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
              <input type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"} required={c.required} value={String(v[c.key] ?? "")}
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
    const { data, error } = await supabase.from("profiles").select("id,email,full_name,role,extra_roles,line_linked,position").order("full_name");
    if (error) setErr(errText(error));
    setRows((data as Profile[]) ?? []);
  }, []);
  // load() ตั้ง state หลัง await (ไม่ใช่ sync) — rule มองไม่เห็นข้าม async function
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const [editing, setEditing] = useState<Profile | null>(null);
  const setRoles = async (u: Profile, role: Role, extra: Role[]) => {
    const { error } = await supabase.rpc("admin_set_roles", { p_user: u.id, p_role: role, p_extra: extra });
    if (error) alert(errText(error)); else load();
  };

  const list = rows.filter((r) => !q || `${r.full_name} ${r.email}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <p className="muted small">ครูจะปรากฏในรายการหลังเข้าสู่ระบบครั้งแรก · ทุกคนเริ่มเป็น "บุคลากร" · คนที่ถือหลายหน้าที่ (เช่น หัวหน้าฝ่ายบริหารทั่วไปที่ควบงานยานพาหนะ) ให้เพิ่มเป็น "บทบาทเสริม" — เปลี่ยนคนเมื่อไหร่ก็ย้ายบทบาทได้เลย</p>
      <input className="search" placeholder="ค้นหาชื่อหรืออีเมล" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <p className="error">{err}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>ชื่อ</th><th>อีเมล</th><th>LINE</th><th>บทบาทหลัก</th><th>บทบาทเสริม</th></tr></thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                <td>{u.full_name || "—"}</td>
                <td className="small">{u.email}</td>
                <td>{u.line_linked ? <span className="chip ok">เชื่อมแล้ว</span> : <span className="muted small">—</span>}</td>
                <td>
                  <select value={u.role} disabled={u.id === me.id} onChange={(e) => setRoles(u, e.target.value as Role, u.extra_roles ?? [])}>
                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </td>
                <td>
                  <div className="extra-roles">
                    {(u.extra_roles ?? []).map((r) => <span key={r} className="chip">{ROLE_LABEL[r]}</span>)}
                    <button className="link" onClick={() => setEditing(u)}>{u.extra_roles?.length ? "แก้ไข" : "+ เพิ่ม"}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length === 0 && <Empty>ไม่พบผู้ใช้</Empty>}
      {editing && (
        <ExtraRolesForm user={editing} onClose={() => setEditing(null)}
          onSave={async (extra) => { await setRoles(editing, editing.role, extra); setEditing(null); }} />
      )}
    </>
  );
}

function ExtraRolesForm({ user, onClose, onSave }: { user: Profile; onClose: () => void; onSave: (extra: Role[]) => void }) {
  const [sel, setSel] = useState<Role[]>(user.extra_roles ?? []);
  const toggle = (r: Role) => setSel(sel.includes(r) ? sel.filter((x) => x !== r) : [...sel, r]);
  return (
    <Modal title={`บทบาทเสริม · ${user.full_name || user.email}`} onClose={onClose}>
      <div className="form">
        <p className="muted small">บทบาทหลัก: {ROLE_LABEL[user.role]} — เลือกหน้าที่อื่นที่คนนี้ทำควบด้วย</p>
        {EXTRA_ROLES.filter((r) => r !== user.role).map((r) => (
          <label key={r} className="check"><input type="checkbox" checked={sel.includes(r)} onChange={() => toggle(r)} /> {ROLE_LABEL[r]}<span className="muted small"> — {ROLE_HINT[r]}</span></label>
        ))}
        <button className="btn primary big" onClick={() => onSave(sel)}>บันทึกบทบาทเสริม</button>
      </div>
    </Modal>
  );
}

const ROLE_HINT: Partial<Record<Role, string>> = {
  vehicle_head: "จัดรถ เลือกคนขับ บันทึกเดินทาง",
  facilities_head: "ตรวจห้องน้ำ อัปโหลดรูป",
  ga_head: "ดูได้ทุกอย่างของฝ่ายบริหารทั่วไป (ไม่อนุมัติ/แก้ไข)",
  inspector: "ตรวจห้องน้ำ",
  deputy: "เห็นชอบคำขอใช้รถ ขั้นรอง ผอ.",
  director: "อนุมัติคำขอใช้รถ",
};

/** รูปรถ: ย่อ/บีบก่อนอัปโหลด แล้วบันทึก path ลงแถวรถ (ลบรูปเก่าออก) */
function VehiclePhoto({ row, url, onDone }: { row: Row; url?: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await compressImage(file, 1200, 0.8);
      const path = `${row.id}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("vehicle-photos").upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) throw up.error;
      const { error } = await supabase.from("vehicles").update({ photo_path: path }).eq("id", row.id);
      if (error) throw error;
      if (row.photo_path) await supabase.storage.from("vehicle-photos").remove([String(row.photo_path)]);
      onDone();
    } catch (e) {
      alert(`อัปโหลดรูปไม่สำเร็จ: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="vphoto" title="เปลี่ยนรูปรถ">
      {url ? <img src={url} alt="" /> : <CarFront size={22} aria-hidden />}
      <span className="vphoto-btn"><Camera size={12} />{busy ? "…" : url ? "เปลี่ยน" : "ใส่รูป"}</span>
      <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );
}
