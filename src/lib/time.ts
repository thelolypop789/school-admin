// เวลาทั้งหมดเก็บเป็น timestamptz และแสดงผลเป็นเวลาไทยเสมอ (ไม่ขึ้นกับเขตเวลาเครื่อง)
const TZ = "Asia/Bangkok";

/** วันที่วันนี้ตามเวลาไทย รูปแบบ YYYY-MM-DD */
export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function addDays(dateISO: string, n: number): string {
  const d = new Date(`${dateISO}T12:00:00+07:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

/** วันที่ + เวลา (HH:MM) ตามเวลาไทย → ISO string */
export function toISO(dateISO: string, time: string): string {
  return new Date(`${dateISO}T${time}:00+07:00`).toISOString();
}

/** ขอบเขตวัน (00:00 – 24:00 เวลาไทย) */
export function dayRange(dateISO: string): [string, string] {
  return [toISO(dateISO, "00:00"), toISO(addDays(dateISO, 1), "00:00")];
}

export function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "2-digit" }): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00+07:00`) : new Date(iso);
  return new Intl.DateTimeFormat("th-TH", { timeZone: TZ, ...opts }).format(d);
}

export function fmtDateTime(iso: string): string {
  return `${fmtDate(iso, { day: "numeric", month: "short" })} ${fmtTime(iso)}`;
}

/** ช่วงเวลา เช่น "9 พ.ย. 09:00–12:00" หรือข้ามวัน "9 พ.ย. 08:00 – 10 พ.ย. 17:00" */
export function fmtRange(startISO: string, endISO: string): string {
  const sameDay = fmtDate(startISO) === fmtDate(endISO);
  return sameDay
    ? `${fmtDate(startISO, { day: "numeric", month: "short" })} ${fmtTime(startISO)}–${fmtTime(endISO)}`
    : `${fmtDateTime(startISO)} – ${fmtDateTime(endISO)}`;
}

/** เวลาไทย HH:MM ของ ISO */
export function hhmm(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}
