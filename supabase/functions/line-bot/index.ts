// Edge function line-bot (deploy ด้วย verify_jwt = false)
// รับ 2 แบบ:
//   1. LINE webhook — เชื่อถือเมื่อ x-line-signature ตรงกับ LINE_CHANNEL_SECRET เท่านั้น
//      รหัส 6 หลัก = ผูกบัญชี · ปุ่ม (postback) = เห็นชอบ/อนุมัติ/ส่งกลับ/ไม่อนุมัติ · "งาน" = ดูคำขอที่รอ
//   2. แจ้งเตือนจาก trigger ใน DB (pg_net) — เชื่อถือเมื่อ x-notify-secret ตรงกับ private.config (ตรวจผ่าน line_notify_secret_ok)
// สิทธิ์ทุกอย่างตรวจใน DB (line_decide) — ที่นี่แค่แปลงข้อความ
// secrets: LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN; ตัวเลือก APP_URL (ค่าเริ่มต้นคือ URL ของ Vercel)
import { createClient } from "npm:@supabase/supabase-js@2";
import * as L from "./logic.ts";

const SECRET = (Deno.env.get("LINE_CHANNEL_SECRET") ?? "").trim();
const TOKEN = (Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "").trim();
const APP_URL = (Deno.env.get("APP_URL") ?? "https://school-admin-fromauto.vercel.app").replace(/\/+$/, "");
const REASON_TTL_MS = 10 * 60_000;

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const BOOKING_SELECT =
  "id,destination,purpose,passengers,starts_at,ends_at,status,approver_note,travelers," +
  "requester:profiles!vehicle_bookings_booked_by_fkey(full_name,email,line_user_id),vehicle:vehicles(name,plate),driver:drivers(full_name)";

const REPAIR_SELECT =
  "id,title,detail,location,category,priority,status,plan_start,plan_end,proposal,exec_decision,exec_note,done_note," +
  "reporter:profiles!repair_requests_reported_by_fkey(full_name,email,line_user_id)";

async function hmacB64(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return btoa(String.fromCharCode(...sig));
}

async function lineApi(path: string, payload: unknown) {
  if (!TOKEN) { console.error("LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้ง"); return; }
  const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error(`LINE ${path} ${res.status}: ${await res.text()}`);
}
const reply = (replyToken: string, messages: unknown[]) => lineApi("reply", { replyToken, messages });
const replyText = (replyToken: string, text: string, quick?: string[]) =>
  reply(replyToken, [{
    type: "text", text,
    ...(quick ? { quickReply: { items: quick.map((q) => ({ type: "action", action: { type: "message", label: q, text: q } })) } } : {}),
  }]);

async function loadBooking(id: number): Promise<L.Booking | null> {
  const { data, error } = await sb.from("vehicle_bookings").select(BOOKING_SELECT).eq("id", id).maybeSingle();
  if (error) console.error("loadBooking", error.message);
  return (data as unknown as L.Booking) ?? null;
}

async function loadRepair(id: number): Promise<L.Repair | null> {
  const { data, error } = await sb.from("repair_requests").select(REPAIR_SELECT).eq("id", id).maybeSingle();
  if (error) console.error("loadRepair", error.message);
  return (data as unknown as L.Repair) ?? null;
}

// ผู้รับ LINE ตามบทบาท (บทบาทหลักหรือบทบาทเสริม — คนเดียวถือหลายหน้าที่ได้)
async function lineIdsOfRole(r: string): Promise<string[]> {
  const { data } = await sb.from("profiles").select("line_user_id").or(`role.eq.${r},extra_roles.cs.{${r}}`).not("line_user_id", "is", null);
  return (data ?? []).map((x: { line_user_id: string }) => x.line_user_id);
}
async function sendTo(to: string[], messages: unknown[]) {
  if (to.length === 1) await lineApi("push", { to: to[0], messages });
  else if (to.length > 1) await lineApi("multicast", { to, messages });
}

// ---------------------------------------------------------------- แจ้งเตือนจาก trigger
async function notify(evt: { booking_id: number; status: string; from: string | null }) {
  const b = await loadBooking(evt.booking_id);
  if (!b || b.status !== evt.status) return; // สถานะเปลี่ยนไปแล้วระหว่างรอคิว — ตัวใหม่จะส่งเอง
  for (const plan of L.notifyPlan(b, evt.from ?? null, APP_URL)) {
    let to: string[] = [];
    if (plan.to === "requester") {
      if (b.requester?.line_user_id) to = [b.requester.line_user_id];
    } else {
      to = await lineIdsOfRole(plan.to.role);
    }
    await sendTo(to, plan.messages);
  }
}

async function notifyRepair(evt: { repair_id: number; status: string; from: string | null }) {
  const r = await loadRepair(evt.repair_id);
  if (!r || r.status !== evt.status) return; // สถานะเปลี่ยนไปแล้วระหว่างรอคิว — ตัวใหม่จะส่งเอง
  for (const plan of L.repairNotifyPlan(r, evt.from ?? null, APP_URL)) {
    const to = plan.to === "requester" ? (r.reporter?.line_user_id ? [r.reporter.line_user_id] : []) : await lineIdsOfRole(plan.to.role);
    await sendTo(to, plan.messages);
  }
}

async function notifyCleanFail(evt: { report_id: number }) {
  const { data, error } = await sb.rpc("line_clean_report_info", { p_report: evt.report_id });
  if (error) console.error("cleanInfo", error.message);
  const { to, messages } = L.cleanFailMessages((data as L.CleanFail) ?? null, APP_URL);
  if (to.length > 150) for (let i = 0; i < to.length; i += 150) await sendTo(to.slice(i, i + 150), messages);
  else await sendTo(to, messages);
}

async function notifyLodging(evt: { request_id: number }) {
  const { data, error } = await sb.rpc("line_lodging_info", { p_request: evt.request_id });
  if (error) console.error("lodgingInfo", error.message);
  const messages = L.lodgingNewMessages((data as L.LodgingNew) ?? null, APP_URL);
  if (!messages.length) return;
  const to = [...new Set([...(await lineIdsOfRole("facilities_head")), ...(await lineIdsOfRole("admin"))])];
  await sendTo(to, messages);
}

async function notifyIncident(evt: { incident_id: number }) {
  const { data, error } = await sb.rpc("line_incident_info", { p_id: evt.incident_id });
  if (error) console.error("incidentInfo", error.message);
  const q = (data as L.IncidentInfo) ?? null;
  const messages = L.incidentMessages(q, APP_URL);
  if (!q || !messages.length) return;
  const ids = (await Promise.all(L.incidentRoles(q.category).map(lineIdsOfRole))).flat();
  await sendTo([...new Set(ids)], messages);
}

async function updateIncident(replyToken: string, user: string, a: L.IncidentAction, id: number) {
  const { data, error } = await sb.rpc("line_incident_update", { p_line_user: user, p_id: id, p_status: a === "ack" ? "acknowledged" : "resolved" });
  if (error) return replyText(replyToken, L.incidentErrorText(error.message));
  return reply(replyToken, [L.incidentDoneReply(a, data as { category: string; location: string }, id)]);
}

// ---------------------------------------------------------------- LINE webhook
type LineEvent = {
  type: string; replyToken?: string; source?: { type: string; userId?: string };
  message?: { type: string; text?: string }; postback?: { data: string };
};

async function decide(replyToken: string, user: string, a: L.Action, id: number, expected: string, note?: string) {
  const { data, error } = await sb.rpc("line_decide", { p_line_user: user, p_id: id, p_action: a, p_expected: expected, p_note: note ?? null });
  if (error) return replyText(replyToken, L.errorText(error.message));
  const r = data as { status: string; destination: string };
  return replyText(replyToken, L.doneText(a, r.status, r.destination));
}

async function decideRepair(replyToken: string, user: string, d: L.RepairDecision, id: number, expected: string) {
  const { data, error } = await sb.rpc("line_repair_decide", { p_line_user: user, p_id: id, p_decision: d, p_expected: expected });
  if (error) return replyText(replyToken, L.errorText(error.message));
  return replyText(replyToken, L.repairDoneText(d, (data as { title: string }).title));
}

async function handle(ev: LineEvent) {
  const user = ev.source?.userId;
  if (ev.source?.type !== "user" || !user || !ev.replyToken) return; // กลุ่ม/ห้อง: ไม่ตอบ
  const rt = ev.replyToken;

  if (ev.type === "follow") return replyText(rt, L.WELCOME_TEXT);

  if (ev.type === "postback" && ev.postback) {
    const ip = L.parseIncidentPostback(ev.postback.data);
    if (ip) return updateIncident(rt, user, ip.a, ip.id);
    const rp = L.parseRepairPostback(ev.postback.data);
    if (rp) return decideRepair(rt, user, rp.a, rp.id, rp.s);
    const p = L.parsePostback(ev.postback.data);
    if (!p) return replyText(rt, "ปุ่มนี้ใช้ไม่ได้แล้ว พิมพ์ งาน เพื่อดูคำขอล่าสุด");
    if (p.a === "forward") return decide(rt, user, p.a, p.id, p.s);
    // ส่งกลับ/ไม่อนุมัติ: ต้องมีเหตุผล → เช็กก่อนว่ายังทำได้ แล้วรอข้อความถัดไป
    const [{ data: me }, b] = await Promise.all([
      sb.from("profiles").select("id").eq("line_user_id", user).maybeSingle(),
      loadBooking(p.id),
    ]);
    if (!me) return replyText(rt, L.errorText("not_linked"));
    if (!b || b.status !== p.s) return replyText(rt, L.errorText("not_pending"));
    await sb.from("line_pending_reasons").upsert({ line_user_id: user, booking_id: p.id, action: p.a, expected: p.s, created_at: new Date().toISOString() });
    return replyText(rt, L.askReasonText(p.a, b.destination), ["ยกเลิก"]);
  }

  if (ev.type !== "message" || ev.message?.type !== "text") return replyText(rt, L.HELP_TEXT);
  const text = (ev.message.text ?? "").trim();

  // กำลังรอเหตุผลอยู่ → ข้อความนี้คือเหตุผล
  const { data: pending } = await sb.from("line_pending_reasons").select("*").eq("line_user_id", user).maybeSingle();
  if (pending) {
    await sb.from("line_pending_reasons").delete().eq("line_user_id", user);
    const fresh = Date.now() - Date.parse(pending.created_at) < REASON_TTL_MS;
    if (fresh && L.isCancel(text)) return replyText(rt, "ยกเลิกแล้ว ไม่ได้ทำรายการ");
    if (fresh && !L.isLinkCode(text) && !L.isQueueCommand(text)) {
      return decide(rt, user, pending.action as L.Action, pending.booking_id, pending.expected, text);
    }
  }

  if (L.isLinkCode(text)) {
    const { data, error } = await sb.rpc("line_link_account", { p_line_user: user, p_code: text });
    if (error) return replyText(rt, L.errorText(error.message));
    const r = data as { full_name: string; role: string };
    return replyText(rt, L.LINKED_TEXT(r.full_name, r.role));
  }

  if (L.isQueueCommand(text)) {
    const { data: me } = await sb.from("profiles").select("id").eq("line_user_id", user).maybeSingle();
    if (!me) return replyText(rt, L.errorText("not_linked"));
    const [{ data: rows }, { data: rrows }] = await Promise.all([
      sb.rpc("line_my_queue", { p_line_user: user }),
      sb.rpc("line_my_repair_queue", { p_line_user: user }),
    ]);
    const ids = ((rows ?? []) as { id: number }[]).map((r) => r.id);
    const rids = ((rrows ?? []) as { id: number }[]).map((r) => r.id);
    const [full, fullRepairs] = await Promise.all([Promise.all(ids.map(loadBooking)), Promise.all(rids.map(loadRepair))]);
    return reply(rt, [L.queueMessage(full.filter((b): b is L.Booking => !!b), APP_URL, fullRepairs.filter((r): r is L.Repair => !!r))]);
  }

  return replyText(rt, L.HELP_TEXT, ["งาน"]);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const body = await req.text();

  const sig = req.headers.get("x-line-signature");
  if (sig) {
    if (!SECRET || !L.signatureOk(await hmacB64(body), sig)) return new Response("bad signature", { status: 401 });
    const events: LineEvent[] = JSON.parse(body).events ?? [];
    await Promise.all(events.map((ev) => handle(ev).catch((e) => console.error("event", e))));
    return new Response("ok");
  }

  const ns = req.headers.get("x-notify-secret");
  if (ns && (await sb.rpc("line_notify_secret_ok", { p_secret: ns })).data === true) {
    try {
      const evt = JSON.parse(body);
      if (evt.type === "repair_status") await notifyRepair(evt);
      else if (evt.type === "clean_fail") await notifyCleanFail(evt);
      else if (evt.type === "lodging_new") await notifyLodging(evt);
      else if (evt.type === "lodging_incident") await notifyIncident(evt);
      else await notify(evt);
    } catch (e) { console.error("notify", e); }
    return new Response("ok");
  }
  return new Response("unauthorized", { status: 401 });
});
