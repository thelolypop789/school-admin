// ชื่อระบบ/โรงเรียน (ใช้ทุกที่ที่แสดงชื่อ เพื่อให้สะกดตรงกัน)
export const APP_NAME = "ระบบจัดการงานบริหารทั่วไป";
export const SCHOOL_NAME = "โรงเรียนวังหลวงพิทยาสรรพ์";
export const LOGO = "/school-logo.png";

/** อักษรย่อสำหรับรูปโปรไฟล์ (ข้ามคำนำหน้า เช่น นาย/นาง/นางสาว) */
export function initials(name: string, email: string): string {
  const clean = name.replace(/^(นางสาว|นาง|นาย|ว่าที่ร้อยตรี|ดร\.|ครู)\s*/, "").trim();
  return (clean || email).slice(0, 1).toUpperCase();
}
