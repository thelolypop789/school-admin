// ตรรกะล้วนของบอท LINE (ไม่มี I/O) — เทสต์ด้วย node scripts/test_line_bot_logic.mjs
// สี: เบอร์กันดี #6b1027 + ทอง #dcb45a ให้ตรงกับแอป

export const BURGUNDY = "#6b1027";
export const GOLD = "#dcb45a";

export type Role = "staff" | "inspector" | "vehicle_head" | "facilities_head" | "ga_head" | "deputy" | "director" | "admin";
export type Action = "forward" | "return" | "reject";

export type Booking = {
  id: number;
  destination: string;
  purpose: string;
  passengers: number;
  starts_at: string;
  ends_at: string;
  status: string;
  approver_note: string | null;
  travelers?: { name: string; position: string }[] | null;
  requester: { full_name: string | null; email?: string | null; line_user_id?: string | null } | null;
  vehicle: { name: string; plate: string | null } | null;
  driver: { full_name: string } | null;
};

// ---------------------------------------------------------------- ความปลอดภัย
/** เทียบ string แบบเวลาคงที่ (ลายเซ็น LINE / secret ของ trigger) */
export function signatureOk(expected: string, got: string | null): boolean {
  if (!got || !expected || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- postback
const ACTIONS: Action[] = ["forward", "return", "reject"];

export function postbackData(a: Action, id: number, expected: string): string {
  return new URLSearchParams({ v: "1", a, id: String(id), s: expected }).toString();
}

export function parsePostback(data: string): { a: Action; id: number; s: string } | null {
  const p = new URLSearchParams(data);
  const a = p.get("a") as Action;
  const id = Number(p.get("id"));
  const s = p.get("s") ?? "";
  if (p.get("v") !== "1" || !ACTIONS.includes(a) || !Number.isInteger(id) || id <= 0 || !s) return null;
  return { a, id, s };
}

// ---------------------------------------------------------------- ข้อความจากผู้ใช้
export const isLinkCode = (t: string) => /^\d{6}$/.test(t.trim());
export const isCancel = (t: string) => /^(ยกเลิก|cancel)$/i.test(t.trim());
export const isQueueCommand = (t: string) => /^(งาน|งานรอ|รออนุมัติ|รายการ|คำขอ)$/.test(t.trim().replace(/\s+/g, ""));

// ---------------------------------------------------------------- ข้อความแจ้งผิดพลาด
const ERRORS: Record<string, string> = {
  not_linked: "บัญชี LINE นี้ยังไม่ได้เชื่อมกับระบบ\nเข้าระบบ → ข้อมูลของฉัน → เชื่อม LINE แล้วส่งรหัส 6 หลักมาที่แชทนี้",
  not_pending: "คำขอนี้ถูกพิจารณาไปแล้ว หรือไม่ได้อยู่ในขั้นของคุณแล้ว (ปุ่มนี้เก่า)",
  forbidden: "คุณไม่มีสิทธิ์พิจารณาคำขอในขั้นนี้",
  note_required: "ต้องระบุเหตุผล",
  use_app: "ขั้นจัดรถต้องเลือกรถและคนขับ กรุณาทำในระบบ",
  bad_code: "รหัสไม่ถูกต้องหรือหมดอายุแล้ว (ใช้ได้ 15 นาที)\nสร้างรหัสใหม่ในระบบ แล้วส่งมาอีกครั้ง",
  not_found: "ไม่พบคำขอนี้",
  bad_action: "ปุ่มนี้ใช้ไม่ได้แล้ว พิมพ์ งาน เพื่อดูเรื่องล่าสุด",
};
export function errorCode(message: string | undefined | null): string {
  const m = message ?? "";
  return Object.keys(ERRORS).find((k) => m.includes(k)) ?? "unknown";
}
export function errorText(message: string | undefined | null): string {
  return ERRORS[errorCode(message)] ?? "ทำรายการไม่สำเร็จ ลองใหม่ หรือทำในระบบแทน";
}

// ---------------------------------------------------------------- วันที่ (เวลาไทยเสมอ)
const TZ = "Asia/Bangkok";
const dayFmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

/** "ศ. 20 พ.ย. 69 08:00–16:30" หรือข้ามวัน "ศ. 20 พ.ย. 69 08:00 – ส. 21 พ.ย. 69 17:00" */
export function fmtRange(startIso: string, endIso: string): string {
  const s = new Date(startIso), e = new Date(endIso);
  return ymd.format(s) === ymd.format(e)
    ? `${dayFmt.format(s)} ${timeFmt.format(s)}–${timeFmt.format(e)}`
    : `${dayFmt.format(s)} ${timeFmt.format(s)} – ${dayFmt.format(e)} ${timeFmt.format(e)}`;
}

// ---------------------------------------------------------------- Flex message
type Btn = { label: string; style: "primary" | "secondary" | "link"; action: Record<string, string> };
const postbackBtn = (label: string, style: Btn["style"], a: Action, b: Booking, displayText: string): Btn =>
  ({ label, style, action: { type: "postback", label, data: postbackData(a, b.id, b.status), displayText } });
/** เปิดลิงก์ในเบราว์เซอร์ภายนอก — Google ไม่ให้ล็อกอินในเบราว์เซอร์ของแอป LINE */
export function externalUrl(uri: string): string {
  return uri + (uri.includes("?") ? "&" : "?") + "openExternalBrowser=1";
}
const uriBtn = (label: string, uri: string, style: Btn["style"] = "link"): Btn => ({ label, style, action: { type: "uri", label, uri: externalUrl(uri) } });

function row(label: string, value: string) {
  return {
    type: "box", layout: "baseline", spacing: "md",
    contents: [
      { type: "text", text: label, color: "#8a8486", size: "sm", flex: 2 },
      { type: "text", text: value || "-", color: "#1d1a1b", size: "sm", flex: 5, wrap: true },
    ],
  };
}

export function bookingBubble(b: Booking, title: string, buttons: Btn[], extra?: { label: string; value: string }) {
  const people = b.travelers?.length ? `${b.passengers} คน (${b.travelers.slice(0, 3).map((t) => t.name).join(", ")}${b.travelers.length > 3 ? " …" : ""})` : `${b.passengers} คน`;
  const car = b.vehicle ? `${b.vehicle.name}${b.vehicle.plate ? ` ${b.vehicle.plate}` : ""}${b.driver ? ` · ${b.driver.full_name}` : ""}` : "ยังไม่ได้จัดรถ";
  return {
    type: "bubble", size: "mega",
    header: {
      type: "box", layout: "vertical", backgroundColor: BURGUNDY, paddingAll: "16px", spacing: "xs",
      contents: [
        { type: "text", text: title, color: GOLD, size: "sm", weight: "bold", wrap: true },
        { type: "text", text: b.destination, color: "#ffffff", size: "lg", weight: "bold", wrap: true },
      ],
    },
    body: {
      type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px",
      contents: [
        row("วันเวลา", fmtRange(b.starts_at, b.ends_at)),
        row("ไปเพื่อ", b.purpose),
        row("ผู้เดินทาง", people),
        row("ผู้ขอ", b.requester?.full_name || b.requester?.email || "-"),
        row("รถ", car),
        ...(extra ? [row(extra.label, extra.value)] : []),
      ],
    },
    ...(buttons.length ? {
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px",
        contents: buttons.map((x) => ({
          type: "button", style: x.style, height: "sm", action: x.action,
          ...(x.style === "primary" ? { color: BURGUNDY } : {}),
        })),
      },
    } : {}),
  };
}

const flex = (altText: string, contents: unknown) => ({ type: "flex", altText: altText.slice(0, 400), contents });

/** การ์ดให้ผู้พิจารณาขั้นปัจจุบัน (ใช้ทั้งตอนแจ้งเตือนและคำสั่ง "งาน") */
export function reviewCard(b: Booking, appUrl: string, title?: string) {
  const open = uriBtn("ดูรายละเอียดในระบบ", `${appUrl}/vehicles`);
  const note = b.approver_note ? { label: "หมายเหตุ", value: b.approver_note } : undefined;
  if (b.status === "pending") {
    return bookingBubble(b, title ?? "คำขอใหม่ รอจัดรถ", [uriBtn("เปิดระบบเพื่อจัดรถ", `${appUrl}/vehicles`, "primary")], note);
  }
  if (b.status === "pending_deputy") {
    return bookingBubble(b, title ?? "คำขอใช้รถ รอคุณพิจารณา", [
      postbackBtn("เห็นชอบ ส่ง ผอ.", "primary", "forward", b, `เห็นชอบ: ${b.destination}`),
      postbackBtn("ส่งกลับ", "secondary", "return", b, `ส่งกลับ: ${b.destination}`),
      open,
    ], note);
  }
  if (b.status === "pending_director") {
    return bookingBubble(b, title ?? "คำขอใช้รถ รอคุณอนุมัติ", [
      postbackBtn("อนุมัติ", "primary", "forward", b, `อนุมัติ: ${b.destination}`),
      postbackBtn("ส่งกลับรอง ผอ.", "secondary", "return", b, `ส่งกลับ: ${b.destination}`),
      postbackBtn("ไม่อนุมัติ", "secondary", "reject", b, `ไม่อนุมัติ: ${b.destination}`),
      open,
    ], note);
  }
  return bookingBubble(b, title ?? "คำขอใช้รถ", [open], note);
}

export const STAGE_ROLE: Record<string, Role> = { pending: "vehicle_head", pending_deputy: "deputy", pending_director: "director" };

export type Plan = { to: { role: Role } | "requester"; messages: unknown[] };

/** ใครต้องได้ LINE เมื่อคำขอเปลี่ยนสถานะ (from = สถานะก่อนหน้า, null = สร้างใหม่) */
export function notifyPlan(b: Booking, from: string | null, appUrl: string): Plan[] {
  const s = b.status;
  if (s in STAGE_ROLE) {
    const back = (s === "pending" && from === "pending_deputy") || (s === "pending_deputy" && from === "pending_director");
    const title = back ? "ถูกส่งกลับมาให้พิจารณาใหม่" : undefined;
    return [{ to: { role: STAGE_ROLE[s] }, messages: [flex(`${title ?? "คำขอใช้รถรอคุณ"}: ${b.destination}`, reviewCard(b, appUrl, title))] }];
  }
  if (s === "approved") {
    return [
      { to: "requester", messages: [flex(`คำขอใช้รถได้รับอนุมัติ: ${b.destination}`,
        bookingBubble(b, "ได้รับอนุมัติแล้ว ✓", [uriBtn("พิมพ์คำสั่งไปราชการ", `${appUrl}/vehicles/print/${b.id}`, "primary")]))] },
      { to: { role: "vehicle_head" }, messages: [flex(`อนุมัติแล้ว เตรียมรถ: ${b.destination}`,
        bookingBubble(b, "ผอ. อนุมัติแล้ว เตรียมรถ", [uriBtn("เปิดบันทึกเดินทาง", `${appUrl}/vehicles`)]))] },
    ];
  }
  if (s === "returned") {
    return [{ to: "requester", messages: [flex(`คำขอใช้รถถูกส่งกลับ: ${b.destination}`,
      bookingBubble(b, "ถูกส่งกลับให้แก้ไข", [uriBtn("แก้ไขแล้วส่งใหม่", `${appUrl}/vehicles`, "primary")],
        { label: "เหตุผล", value: b.approver_note ?? "-" }))] }];
  }
  if (s === "rejected") {
    return [{ to: "requester", messages: [flex(`คำขอใช้รถไม่ได้รับอนุมัติ: ${b.destination}`,
      bookingBubble(b, "ไม่ได้รับอนุมัติ", [], { label: "เหตุผล", value: b.approver_note ?? "-" }))] }];
  }
  if (s === "cancelled" && from && from in STAGE_ROLE) {
    return [{ to: { role: STAGE_ROLE[from] }, messages: [{ type: "text", text: `ผู้ขอยกเลิกคำขอใช้รถไป "${b.destination}" แล้ว ไม่ต้องพิจารณาต่อ` }] }];
  }
  return [];
}

/** คำสั่ง "งาน": การ์ดงานที่รออยู่ (คำขอใช้รถ + เรื่องแจ้งซ่อมที่เสนอผู้บริหาร; สูงสุด 10 ใบ ตามขีดจำกัด carousel) */
export function queueMessage(rows: Booking[], appUrl: string, repairs: Repair[] = []) {
  const bubbles = [...rows.map((b) => reviewCard(b, appUrl)), ...repairs.map((r) => repairCard(r, appUrl))].slice(0, 10);
  if (!bubbles.length) return { type: "text", text: "ตอนนี้ไม่มีเรื่องรอคุณพิจารณา ✓" };
  return flex(`เรื่องรอคุณพิจารณา ${bubbles.length} รายการ`, { type: "carousel", contents: bubbles });
}

// ---------------------------------------------------------------- แจ้งซ่อมงานอาคารสถานที่
export type RepairDecision = "agree" | "urgent" | "defer";
export type Repair = {
  id: number;
  title: string;
  detail: string | null;
  location: string;
  category: string;
  priority: string;
  status: string;
  plan_start: string | null;
  plan_end: string | null;
  proposal: string | null;
  exec_decision: string | null;
  exec_note: string | null;
  done_note: string | null;
  reporter: { full_name: string | null; email?: string | null; line_user_id?: string | null } | null;
};
const DECISIONS: RepairDecision[] = ["agree", "urgent", "defer"];

export const PRIORITY_TH: Record<string, string> = { urgent: "ด่วนมาก", high: "ด่วน", normal: "ปกติ", low: "ไม่เร่งด่วน" };
export const CATEGORY_TH: Record<string, string> = {
  electric: "ไฟฟ้า", water: "ประปา/สุขา", building: "อาคาร/โครงสร้าง", furniture: "เครื่องเรือน", aircon: "เครื่องปรับอากาศ", other: "อื่นๆ",
};

/** postback ของปุ่มผู้บริหารในการ์ดแจ้งซ่อม (k=r แยกจากปุ่มคำขอใช้รถ) */
export function repairPostbackData(d: RepairDecision, id: number, expected: string): string {
  return new URLSearchParams({ v: "1", k: "r", a: d, id: String(id), s: expected }).toString();
}
export function parseRepairPostback(data: string): { a: RepairDecision; id: number; s: string } | null {
  const p = new URLSearchParams(data);
  const a = p.get("a") as RepairDecision;
  const id = Number(p.get("id"));
  const s = p.get("s") ?? "";
  if (p.get("v") !== "1" || p.get("k") !== "r" || !DECISIONS.includes(a) || !Number.isInteger(id) || id <= 0 || !s) return null;
  return { a, id, s };
}

const dateFmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "numeric", month: "short", year: "2-digit" });
/** "27 พ.ย. 69" หรือ "27 พ.ย. 69 – 28 พ.ย. 69" (รับวันที่ YYYY-MM-DD) */
export function planRange(start: string | null, end: string | null): string {
  if (!start) return "-";
  const f = (d: string) => dateFmt.format(new Date(`${d}T12:00:00+07:00`));
  return end && end !== start ? `${f(start)} – ${f(end)}` : f(start);
}

export function repairBubble(r: Repair, title: string, buttons: Btn[], extra?: { label: string; value: string }) {
  const rows = [
    row("เร่งด่วน", PRIORITY_TH[r.priority] ?? r.priority),
    row("สถานที่", r.location),
    row("ประเภท", CATEGORY_TH[r.category] ?? r.category),
    ...(r.detail ? [row("รายละเอียด", r.detail.length > 120 ? `${r.detail.slice(0, 117)}…` : r.detail)] : []),
    row("ผู้แจ้ง", r.reporter?.full_name || r.reporter?.email || "-"),
    ...(r.plan_start ? [row("กำหนดซ่อม", planRange(r.plan_start, r.plan_end))] : []),
    ...(r.proposal ? [row("หมายเหตุ", r.proposal)] : []),
    ...(extra ? [row(extra.label, extra.value)] : []),
  ];
  return {
    type: "bubble", size: "mega",
    header: {
      type: "box", layout: "vertical", backgroundColor: BURGUNDY, paddingAll: "16px", spacing: "xs",
      contents: [
        { type: "text", text: title, color: GOLD, size: "sm", weight: "bold", wrap: true },
        { type: "text", text: r.title, color: "#ffffff", size: "lg", weight: "bold", wrap: true },
      ],
    },
    body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px", contents: rows },
    ...(buttons.length ? {
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px",
        contents: buttons.map((x) => ({
          type: "button", style: x.style, height: "sm", action: x.action,
          ...(x.style === "primary" ? { color: BURGUNDY } : {}),
        })),
      },
    } : {}),
  };
}

const repairBtn = (label: string, style: Btn["style"], d: RepairDecision, r: Repair, displayText: string): Btn =>
  ({ label, style, action: { type: "postback", label, data: repairPostbackData(d, r.id, r.status), displayText } });

/** การ์ดแจ้งซ่อมตามขั้น: รอผู้บริหาร = 3 ปุ่มตัดสิน, อื่นๆ = ลิงก์เปิดระบบ */
export function repairCard(r: Repair, appUrl: string, title?: string) {
  const open = (style: Btn["style"] = "link") => uriBtn(style === "primary" ? "เปิดระบบเพื่อลงวันที่" : "ดูรายละเอียดในระบบ", `${appUrl}/facilities`, style);
  if (r.status === "proposed") {
    return repairBubble(r, title ?? "เรื่องแจ้งซ่อม รอคุณพิจารณา", [
      repairBtn("เห็นควรตามที่เสนอ", "primary", "agree", r, `เห็นควรตามที่เสนอ: ${r.title}`),
      repairBtn("ให้ด่วน", "secondary", "urgent", r, `ให้ด่วน: ${r.title}`),
      repairBtn("ให้ทำงานอื่นก่อน", "secondary", "defer", r, `ให้ทำงานอื่นก่อน: ${r.title}`),
      open(),
    ]);
  }
  if (r.status === "new") return repairBubble(r, title ?? "แจ้งซ่อมใหม่ รอลงวันที่", [open("primary")]);
  return repairBubble(r, title ?? "เรื่องแจ้งซ่อม", [open()]);
}

/** ใครต้องได้ LINE เมื่อเรื่องแจ้งซ่อมเปลี่ยนสถานะ (from = สถานะก่อนหน้า, null = สร้างใหม่) */
export function repairNotifyPlan(r: Repair, from: string | null, appUrl: string): Plan[] {
  const s = r.status;
  const msg = (alt: string, bubble: unknown) => [flex(alt.slice(0, 400), bubble)];
  if (s === "new" && from === null) {
    const t = `แจ้งซ่อมใหม่ · ${PRIORITY_TH[r.priority] ?? r.priority}`;
    return [{ to: { role: "facilities_head" }, messages: msg(`${t}: ${r.title}`, repairCard(r, appUrl, t)) }];
  }
  if (s === "new" && from === "proposed") {
    const t = r.exec_decision === "urgent" ? "ผู้บริหารให้ด่วน เสนอวันใหม่" : "ผู้บริหารให้ทำงานอื่นก่อน เสนอวันใหม่";
    const bubble = repairBubble(r, t, [uriBtn("เปิดระบบเพื่อลงวันที่", `${appUrl}/facilities`, "primary")],
      r.exec_note ? { label: "ผู้บริหาร", value: r.exec_note } : undefined);
    return [{ to: { role: "facilities_head" }, messages: msg(`${t}: ${r.title}`, bubble) }];
  }
  if (s === "proposed") {
    return [{ to: { role: "deputy" }, messages: msg(`เรื่องแจ้งซ่อมรอคุณพิจารณา: ${r.title}`, repairCard(r, appUrl)) }];
  }
  if (s === "scheduled") {
    return [{ to: "requester", messages: msg(`กำหนดซ่อมแล้ว: ${r.title}`,
      repairBubble(r, "กำหนดวันซ่อมแล้ว ✓", [uriBtn("ดูในระบบ", `${appUrl}/facilities`)])) }];
  }
  if (s === "done") {
    return [{ to: "requester", messages: msg(`ซ่อมเสร็จแล้ว: ${r.title}`,
      repairBubble(r, "ซ่อมเสร็จแล้ว ✓", [], r.done_note ? { label: "ผลการซ่อม", value: r.done_note } : undefined)) }];
  }
  if (s === "cancelled" && from === "proposed") {
    return [{ to: { role: "deputy" }, messages: [{ type: "text", text: `เรื่องแจ้งซ่อม "${r.title}" ถูกยกเลิกแล้ว ไม่ต้องพิจารณาต่อ` }] }];
  }
  return [];
}

export function repairDoneText(d: RepairDecision, title: string): string {
  if (d === "agree") return `✓ เห็นควรตามที่เสนอแล้ว: ${title}\nลงปฏิทินและแจ้งผู้แจ้งแล้ว`;
  if (d === "urgent") return `⚡ สั่งให้ด่วนแล้ว: ${title}\nส่งกลับหัวหน้างานอาคารสถานที่เสนอวันใหม่`;
  return `↩ ให้ทำงานอื่นก่อนแล้ว: ${title}\nส่งกลับหัวหน้างานอาคารสถานที่เสนอวันใหม่`;
}

// ---------------------------------------------------------------- ข้อความตอบกลับ
export function doneText(a: Action, status: string, destination: string): string {
  if (a === "reject") return `✕ ไม่อนุมัติแล้ว: ${destination}\nแจ้งผู้ขอทาง LINE แล้ว`;
  if (a === "return") return `↩ ส่งกลับแล้ว: ${destination}`;
  if (status === "approved") return `✓ อนุมัติแล้ว: ${destination}\nแจ้งผู้ขอและงานยานพาหนะแล้ว`;
  if (status === "pending_director") return `✓ เห็นชอบแล้ว ส่งต่อ ผอ.: ${destination}`;
  return `✓ บันทึกแล้ว: ${destination}`;
}

export function askReasonText(a: Action, destination: string): string {
  return `${a === "reject" ? "ไม่อนุมัติ" : "ส่งกลับ"}: ${destination}\nพิมพ์เหตุผลส่งมาในข้อความถัดไป (หรือกด ยกเลิก)`;
}

export const LINKED_TEXT = (name: string, role: string) =>
  `เชื่อมบัญชีแล้ว ✓\n${name || "(ยังไม่ได้ตั้งชื่อ)"} · ${ROLE_TH[role as Role] ?? role}\nต่อไปคำขอใช้รถที่รอคุณจะส่งมาที่แชทนี้ กดอนุมัติได้เลย`;

export const ROLE_TH: Record<Role, string> = {
  staff: "บุคลากร", inspector: "ผู้ตรวจห้องน้ำ", vehicle_head: "หัวหน้างานยานพาหนะ",
  facilities_head: "หัวหน้างานอาคารสถานที่", ga_head: "หัวหน้าฝ่ายบริหารทั่วไป",
  deputy: "รอง ผอ. ฝ่ายบริหารทั่วไป", director: "ผู้อำนวยการ", admin: "ผู้ดูแลระบบ",
};

export const WELCOME_TEXT =
  "ระบบจัดการงานบริหารทั่วไป โรงเรียนวังหลวงพิทยาสรรพ์\n\n" +
  "เชื่อมบัญชีเพื่อรับแจ้งเตือนและอนุมัติผ่าน LINE:\n1. เข้าระบบ → ข้อมูลของฉัน → เชื่อม LINE\n2. ส่งรหัส 6 หลักที่ได้มาที่แชทนี้";

export const HELP_TEXT =
  "คำสั่งที่ใช้ได้\n• งาน — ดูคำขอใช้รถและเรื่องแจ้งซ่อมที่รอคุณพิจารณา\n• รหัส 6 หลัก — เชื่อมบัญชีกับระบบ\n\nคำขอใหม่จะส่งมาให้เองพร้อมปุ่มอนุมัติ";
