// Edge function nst-auth (deploy ด้วย verify_jwt = false)
// 1) เข้าระบบนักเรียน นศท.: { action: "login", code, pin } หรือ ครั้งแรก/หลังรีเซ็ต { action: "setup", code, nid, pin }
//    ตรวจรหัสใน DB (public.nst_auth: bcrypt + ล็อก 15 นาทีเมื่อผิด 5 ครั้ง) แล้วออก session ของ Supabase Auth ให้
//    (บัญชี auth ของนักเรียนใช้อีเมลสมมติ nst-<id>@students.wangluangpitt.ac.th ไม่มีการส่งอีเมลจริง และไม่ได้ profile บุคลากร)
// 2) ลบรูปหลักฐานเก่ากว่า 30 วัน: { action: "purge" } + header x-purge-secret (เรียกจาก pg_cron ทุกคืน)
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const anon = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });

const ORIGINS = new Set([
  "https://school-admin-fromauto.vercel.app",
  "http://localhost:5174",
  "http://localhost:4173",
  ...(Deno.env.get("APP_URL") ? [Deno.env.get("APP_URL")!.replace(/\/+$/, "")] : []),
]);
const KNOWN = ["bad_credentials", "locked", "pin_not_set", "pin_already_set", "nid_not_set", "weak_pin", "bad_request"];

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

async function purge() {
  let total = 0;
  for (let round = 0; round < 20; round++) {
    const { data, error } = await sb.rpc("nst_old_photos", { p_limit: 100 });
    if (error) throw error;
    const names = (data ?? []) as string[];
    if (!names.length) break;
    const rm = await sb.storage.from("nst-photos").remove(names);
    if (rm.error) throw rm.error;
    await sb.rpc("nst_photos_purged", { p_paths: names });
    total += names.length;
  }
  return total;
}

async function sessionFor(studentId: number, authUserId: string | null) {
  const email = `nst-${studentId}@students.wangluangpitt.ac.th`;
  let uid = authUserId;
  if (!uid) {
    const created = await sb.auth.admin.createUser({ email, email_confirm: true, app_metadata: { nst: true } });
    if (created.data.user) uid = created.data.user.id;
  }
  const link = await sb.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data.user) throw link.error ?? new Error("generate_link_failed");
  if (!uid || uid !== link.data.user.id) uid = link.data.user.id;
  if (!authUserId) {
    const l = await sb.rpc("nst_link_auth", { p_student: studentId, p_uid: uid });
    if (l.error) throw l.error;
  }
  const v = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
  if (v.error || !v.data.session) throw v.error ?? new Error("verify_failed");
  const s = v.data.session;
  return { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400, origin); }

  if (body.action === "purge") {
    const secret = req.headers.get("x-purge-secret") ?? "";
    const ok = (await sb.rpc("nst_purge_secret_ok", { p_secret: secret })).data === true;
    if (!ok) return json({ error: "unauthorized" }, 401, origin);
    try { return json({ purged: await purge() }, 200, origin); }
    catch (e) { console.error("purge", e); return json({ error: "purge_failed" }, 500, origin); }
  }

  const pin = String(body.pin ?? "").trim();
  if (!/^\d{6}$/.test(pin)) return json({ error: "bad_credentials" }, 400, origin);
  if (body.action !== "setup" && body.action !== "login") return json({ error: "bad_request" }, 400, origin);

  // เข้าด้วยชื่อ นามสกุล (ไม่ต้องมีคำนำหน้า): ครั้งแรกตั้ง PIN ได้เลย · ทางเดิมรหัสนักเรียน + เลขบัตร/PIN ยังใช้ได้
  const name = typeof body.name === "string" ? body.name.trim() : "";
  let rpc: { fn: string; args: Record<string, unknown> };
  if (name) {
    if (name.length > 120) return json({ error: "bad_credentials" }, 400, origin);
    rpc = { fn: "nst_auth_name", args: { p_name: name, p_kind: body.action === "setup" ? "first" : "pin", p_pin: pin } };
  } else {
    const code = String(body.code ?? "").trim();
    if (!/^[0-9A-Za-z-]{1,20}$/.test(code)) return json({ error: "bad_credentials" }, 400, origin);
    rpc = body.action === "setup"
      ? { fn: "nst_auth", args: { p_code: code, p_kind: "nid", p_secret: String(body.nid ?? ""), p_new_pin: pin } }
      : { fn: "nst_auth", args: { p_code: code, p_kind: "pin", p_secret: pin, p_new_pin: null } };
  }

  const { data, error } = await sb.rpc(rpc.fn, rpc.args);
  if (error) {
    const known = KNOWN.find((k) => error.message.includes(k));
    if (!known) console.error("nst_auth", error.message);
    return json({ error: known ?? "server_error" }, known ? 400 : 500, origin);
  }
  const r = data as { ok: boolean; student_id?: number; auth_user_id?: string | null };
  if (!r.ok || !r.student_id) return json({ error: "bad_credentials" }, 401, origin);

  try {
    return json(await sessionFor(r.student_id, r.auth_user_id ?? null), 200, origin);
  } catch (e) {
    console.error("session", e);
    return json({ error: "server_error" }, 500, origin);
  }
});
