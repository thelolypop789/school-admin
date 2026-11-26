// Edge function lodging-public (deploy ด้วย verify_jwt = false)
// หน้าขอที่พักสาธารณะ /stay ของโรงเรียนที่มาแข่ง (ไม่ต้องมีบัญชี) — anon แตะ DB ตรงไม่ได้ จึงผ่านฟังก์ชันนี้เท่านั้น
//   { action: "event", slug? }                 งานที่เปิดอยู่ + ห้องว่าง/เต็ม (ไม่มีชื่อโรงเรียน)
//   { action: "submit", slug, school, contact, phone, male, female, teachers, note, website }  ขอที่พัก → รหัสติดตาม
//   { action: "status", ref }                  สถานะ + ห้องที่ได้ (เมื่ออนุมัติ)
//   { action: "cancel", ref }                  ยกเลิกคำขอที่ยังรอพิจารณา
// กันสแปม: ช่อง website ต้องว่าง (honeypot), จำกัด 6 คำขอ/ชม. ต่อ IP (เก็บแค่ hash) + 120 คำขอ/ชม. ต่องาน ใน DB
import { createClient } from "npm:@supabase/supabase-js@2";

const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE, { auth: { persistSession: false } });

const ORIGINS = new Set([
  "https://school-admin-fromauto.vercel.app",
  "http://localhost:5174",
  "http://localhost:4173",
  ...(Deno.env.get("APP_URL") ? [Deno.env.get("APP_URL")!.replace(/\/+$/, "")] : []),
]);
const KNOWN = ["not_found", "closed", "rate_limited", "not_pending", "bad_request"];

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ORIGINS.has(origin) ? origin : "https://school-admin-fromauto.vercel.app",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });

async function ipHash(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
  const data = new TextEncoder().encode(`${SERVICE.slice(-16)}:${ip}`);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(h.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const int = (v: unknown) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, 600) : 0; };
const isRef = (v: string) => /^[0-9A-Fa-f]{12}$/.test(v);

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405, origin);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "bad_request" }, 400, origin); }

  const fail = (message: string) => {
    const known = KNOWN.find((k) => message.includes(k));
    if (!known) console.error("lodging", message);
    return json({ error: known ?? "server_error" }, known ? 400 : 500, origin);
  };

  if (b.action === "event") {
    const { data, error } = await sb.rpc("lodging_public_event", { p_slug: str(b.slug, 40) });
    if (error) return fail(error.message);
    return data ? json(data, 200, origin) : json({ error: "not_found" }, 404, origin);
  }

  if (b.action === "submit") {
    if (str(b.website, 200)) return json({ ref: "000000000000" }, 200, origin); // honeypot: ทำเหมือนสำเร็จ
    const school = str(b.school, 120), contact = str(b.contact, 80), phone = str(b.phone, 20).replace(/\D/g, "");
    const male = int(b.male), female = int(b.female), teachers = int(b.teachers);
    if (school.length < 2 || contact.length < 2 || !/^0\d{8,9}$/.test(phone) || male + female + teachers < 1) {
      return json({ error: "bad_request" }, 400, origin);
    }
    const { data, error } = await sb.rpc("lodging_public_submit", {
      p_slug: str(b.slug, 40), p_ip_hash: await ipHash(req), p_school: school, p_contact: contact, p_phone: phone,
      p_male: male, p_female: female, p_teachers: teachers, p_note: str(b.note, 500) || null,
    });
    if (error) return fail(error.message);
    return json({ ref: data }, 200, origin);
  }

  if (b.action === "status" || b.action === "cancel") {
    const ref = str(b.ref, 20);
    if (!isRef(ref)) return json({ error: "not_found" }, 404, origin);
    if (b.action === "cancel") {
      const { error } = await sb.rpc("lodging_public_cancel", { p_ref: ref });
      if (error) return fail(error.message);
    }
    const { data, error } = await sb.rpc("lodging_public_status", { p_ref: ref });
    if (error) return fail(error.message);
    return data ? json(data, 200, origin) : json({ error: "not_found" }, 404, origin);
  }

  return json({ error: "bad_request" }, 400, origin);
});
