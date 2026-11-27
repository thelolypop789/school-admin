import { free, type Kind, type RoomUse } from "../lib/lodging";

/** สติ๊กเกอร์รูปคน (หัว + ลำตัว) — ทึบ = มีคน, เส้นขอบ = ที่ว่าง */
function Person({ cls }: { cls: string }) {
  return (
    <svg viewBox="0 0 12 16" className={`pp ${cls}`} aria-hidden>
      <circle cx="6" cy="4" r="3.1" />
      <path d="M1.2 15.2c0-3.6 2-6.4 4.8-6.4s4.8 2.8 4.8 6.4z" />
    </svg>
  );
}

const ORDER: Kind[] = ["male", "female", "teacher", "mixed"];
const PEOPLE_LABEL: Record<Kind, string> = { male: "นักเรียนชาย", female: "นักเรียนหญิง", teacher: "ครู", mixed: "รวม" };

/** คนในห้อง: รูปคน 1 ตัว = 1 ที่ (ชาย/หญิง/ครู คนละสี) + "มี n/จุ คน" · ห้องที่ถูกเหมา ที่เหลือเป็นรูปจาง */
/** plain = หน้าโรงเรียน: ไม่ใช้คำภายใน "เหมาห้อง" (ห้องที่ถูกเหมาแสดงเป็นเต็มอยู่แล้ว) */
export function RoomPeople({ room, plain = false }: { room: RoomUse; plain?: boolean }) {
  const p = room.people ?? {};
  const counts = ORDER.map((k) => [k, Math.max(0, p[k] ?? 0)] as const).filter(([, n]) => n > 0);
  const here = counts.reduce((n, [, c]) => n + c, 0);
  const locked = room.locked ? room.lock_extra ?? 0 : 0;
  const empty = room.locked ? 0 : free(room);
  const glyphs: string[] = [
    ...counts.flatMap(([k, n]) => Array<string>(n).fill(k)),
    ...Array<string>(locked).fill("lock"),
    ...Array<string>(empty).fill("free"),
  ].slice(0, Math.max(room.capacity, here));
  const said = counts.map(([k, n]) => `${PEOPLE_LABEL[k]} ${n}`).join(" ");
  return (
    <div className="room-people" role="img"
      aria-label={`ห้อง ${room.name} มี ${here} คน จาก ${room.capacity}${said ? ` (${said})` : ""}${room.locked ? (plain ? " เต็ม" : " เหมาห้องแล้ว") : ""}`}>
      <div className="pp-grid">{glyphs.map((c, i) => <Person key={i} cls={c} />)}</div>
      <small className="pp-count"><b>{here}</b>/{room.capacity} คน{room.locked && !plain ? " · เหมาห้อง" : ""}</small>
    </div>
  );
}

export function PeopleLegend({ plain = false }: { plain?: boolean }) {
  return (
    <p className="muted small pp-legend">
      {(["male", "female", "teacher"] as Kind[]).map((k) => <span key={k}><Person cls={k} />{PEOPLE_LABEL[k]}</span>)}
      <span><Person cls="free" />ที่ว่าง</span>
      <span><Person cls="lock" />{plain ? "จองแล้ว (โรงเรียนเดียวใช้ทั้งห้อง)" : "เหมาห้อง (นักเรียนเกิน 10 คน โรงเรียนอื่นเข้าไม่ได้)"}</span>
    </p>
  );
}
