import { useEffect, useState } from "react";
import { errText, supabase } from "../lib/supabase";
import { useMe } from "../lib/me";
import { navigate } from "../lib/router";
import { compressImage } from "../lib/image";
import { Empty } from "../components/ui";
import { CAT_LABEL, GENDER_LABEL, type Item } from "../lib/toilet";

type Toilet = { id: number; name: string; building: string | null; gender: string };
const MAX_PHOTOS = 3;

/** หน้าตรวจห้องน้ำ: เปิดจาก QR ที่ติดหน้าห้องน้ำ (/t/<qr_token>) */
export default function Inspect({ token }: { token: string }) {
  const me = useMe();
  const canInspect = me.role === "inspector" || me.role === "admin";
  const [toilet, setToilet] = useState<Toilet | null | undefined>(undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [answers, setAnswers] = useState<Record<number, boolean>>({});
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<{ blob: Blob; url: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ score: number; safetyFail: boolean } | null>(null);

  useEffect(() => {
    const valid = /^[0-9a-f-]{36}$/i.test(token);
    Promise.all([
      valid ? supabase.rpc("toilet_by_token", { p_token: token }) : Promise.resolve({ data: [], error: null }),
      supabase.from("toilet_checklist_items").select("*").eq("active", true).order("sort"),
    ]).then(([t, i]) => {
      setToilet(((t.data as Toilet[] | null) ?? [])[0] ?? null);
      setItems((i.data as Item[]) ?? []);
    });
  }, [token]);

  if (toilet === undefined) return <div className="spinner" />;
  if (!toilet) return <Empty>ไม่พบห้องน้ำนี้ — QR อาจเก่าหรือถูกปิดใช้งาน</Empty>;
  if (!canInspect) return (
    <div className="card">
      <h2>{toilet.name}</h2>
      <p>บัญชีของคุณยังไม่มีสิทธิ์ตรวจห้องน้ำ ติดต่อผู้ดูแลระบบให้เพิ่มบทบาท "ผู้ตรวจห้องน้ำ"</p>
    </div>
  );

  if (done) return (
    <div className="card center-text">
      <div className={`score-big ${done.score >= 80 && !done.safetyFail ? "ok" : done.score >= 60 ? "warn" : "bad"}`}>{Math.round(done.score)}%</div>
      <h2>บันทึกผลตรวจแล้ว</h2>
      <p>{toilet.name}</p>
      {done.safetyFail && <p className="warn-box">มีข้อด้านความปลอดภัยไม่ผ่าน — แจ้งผู้รับผิดชอบอาคารด้วย</p>}
      <div className="row2">
        <button className="btn" onClick={() => navigate("/toilets")}>ดูภาพรวม</button>
        <button className="btn primary" onClick={() => { setDone(null); setAnswers({}); setNote(""); setPhotos([]); }}>ตรวจอีกครั้ง</button>
      </div>
    </div>
  );

  const answered = items.filter((i) => answers[i.id] !== undefined).length;
  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    setErr("");
    try {
      const next = [...photos];
      for (const f of Array.from(files).slice(0, MAX_PHOTOS - photos.length)) {
        const blob = await compressImage(f);
        next.push({ blob, url: URL.createObjectURL(blob) });
      }
      setPhotos(next);
    } catch (e) { setErr(errText(e)); }
  };

  const submit = async () => {
    if (answered < items.length) return setErr(`ยังตอบไม่ครบ (${answered}/${items.length})`);
    setSaving(true); setErr("");
    const paths: string[] = [];
    for (const p of photos) {
      const path = `${toilet.id}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from("toilet-photos").upload(path, p.blob, { contentType: "image/jpeg" });
      if (error) { setSaving(false); return setErr(`อัปโหลดรูปไม่สำเร็จ: ${errText(error)}`); }
      paths.push(path);
    }
    const { error } = await supabase.rpc("submit_toilet_inspection", {
      p_toilet_id: toilet.id, p_answers: answers, p_note: note, p_photo_paths: paths,
    });
    setSaving(false);
    if (error) return setErr(errText(error));
    const pass = items.filter((i) => answers[i.id]).length;
    setDone({ score: (100 * pass) / items.length, safetyFail: items.some((i) => i.category === "S" && !answers[i.id]) });
  };

  const setAll = (v: boolean) => setAnswers(Object.fromEntries(items.map((i) => [i.id, v])));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ตรวจห้องน้ำ</h1>
          <p className="muted">{toilet.name}{toilet.building ? ` · ${toilet.building}` : ""} · {GENDER_LABEL[toilet.gender]}</p>
        </div>
        <button className="btn" onClick={() => setAll(true)}>ผ่านทุกข้อ</button>
      </div>

      {(["H", "A", "S"] as const).map((cat) => {
        const list = items.filter((i) => i.category === cat);
        if (!list.length) return null;
        return (
          <section key={cat} className="card">
            <h3 className={`cat cat-${cat}`}>{CAT_LABEL[cat]}</h3>
            {list.map((i) => (
              <div key={i.id} className="check-row">
                <span>{i.label}</span>
                <div className="yesno">
                  <button className={answers[i.id] === true ? "yes on" : "yes"} onClick={() => setAnswers({ ...answers, [i.id]: true })} aria-label="ผ่าน">✓</button>
                  <button className={answers[i.id] === false ? "no on" : "no"} onClick={() => setAnswers({ ...answers, [i.id]: false })} aria-label="ไม่ผ่าน">✕</button>
                </div>
              </div>
            ))}
          </section>
        );
      })}

      <section className="card">
        <h3>รูปถ่ายและหมายเหตุ</h3>
        <p className="muted small">ถ่ายเฉพาะสภาพห้องน้ำ ห้ามมีบุคคลในภาพ (สูงสุด {MAX_PHOTOS} รูป)</p>
        <div className="photos">
          {photos.map((p, idx) => (
            <div key={p.url} className="photo">
              <img src={p.url} alt="" />
              <button className="icon-btn" onClick={() => { URL.revokeObjectURL(p.url); setPhotos(photos.filter((_, j) => j !== idx)); }} aria-label="ลบรูป">✕</button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label className="photo add">
              📷<span>เพิ่มรูป</span>
              <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
            </label>
          )}
        </div>
        <textarea rows={2} placeholder="หมายเหตุ เช่น ก๊อกน้ำห้อง 2 รั่ว" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </section>

      {err && <p className="error">{err}</p>}
      <div className="sticky-actions">
        <span className="muted">{answered}/{items.length} ข้อ</span>
        <button className="btn primary big" disabled={saving} onClick={submit}>{saving ? "กำลังบันทึก…" : "บันทึกผลตรวจ"}</button>
      </div>
    </>
  );
}
