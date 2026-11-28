// เรียก edge function lodging-public จากหน้าสาธารณะ /stay (ไม่มีบัญชี — anon แตะ DB ตรงไม่ได้)
const URL_ = import.meta.env.VITE_SUPABASE_URL || "https://placeholder.supabase.co";
const KEY = import.meta.env.VITE_SUPABASE_KEY || "placeholder";

export const ERR: Record<string, string> = {
  not_found: "ไม่พบงานหรือรายการนี้",
  closed: "ปิดรับคำขอที่พักแล้ว",
  rate_limited: "ส่งถี่เกินไป รอสักครู่แล้วลองใหม่",
  not_pending: "คำขอนี้ได้รับการพิจารณาแล้ว ยกเลิกเองไม่ได้ ติดต่อฝ่ายอาคารสถานที่",
  find_bad: "ใส่ชื่อโรงเรียนและเบอร์โทรที่ใช้ตอนขอที่พัก",
  bad_request: "กรอกข้อมูลให้ครบ (เบอร์โทร 9–10 หลัก และจำนวนคนอย่างน้อย 1)",
  bad_photo: "รูปใหญ่เกินไปหรืออ่านไม่ได้ ลองรูปอื่น หรือส่งโดยไม่มีรูป",
  server_error: "ระบบขัดข้อง ลองใหม่อีกครั้ง",
};

export async function call<T>(body: object, errs: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${URL_}/functions/v1/lodging-public`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errs[j.error] ?? ERR[j.error] ?? ERR.server_error);
  return j as T;
}

export const go = (path: string) => { window.history.pushState(null, "", path); window.dispatchEvent(new PopStateEvent("popstate")); };

/** รายการที่จำไว้ในเครื่องนี้ (localStorage อาจถูกปิด — ไม่พัง) */
export function loadList<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
}
export function saveList<T>(key: string, list: T[]) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage blocked */ }
}
