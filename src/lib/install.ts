import { useSyncExternalStore } from "react";

/**
 * ติดตั้งแอป (PWA) ลงมือถือ/คอมพิวเตอร์
 * - Chrome/Edge/Android: เบราว์เซอร์ส่ง beforeinstallprompt → เก็บไว้ แล้วเรียก prompt() ตอนผู้ใช้กดปุ่ม
 * - iPhone/iPad (Safari): ไม่มี API ให้เรียก → แสดงวิธีกด แชร์ → เพิ่มไปยังหน้าจอโฮม
 * - เบราว์เซอร์ในแอป LINE/Facebook: ติดตั้งไม่ได้ (และ Google ไม่ให้ล็อกอิน) → พาไปเปิดในเบราว์เซอร์จริง
 * ต้อง import ไฟล์นี้ใน main.tsx ก่อน render เพื่อไม่พลาด event ที่มาเร็ว
 */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallEvent; emit(); });
  window.addEventListener("appinstalled", () => { deferred = null; justInstalled = true; emit(); });
}

export type Platform = "ios" | "android" | "line" | "inapp" | "desktop";

export function detectPlatform(ua = navigator.userAgent): Platform {
  if (/\bLine\//i.test(ua)) return "line";
  if (/FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|TikTok/i.test(ua)) return "inapp";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** เปิดหน้าเดิมในเบราว์เซอร์ภายนอก (LINE รองรับพารามิเตอร์ openExternalBrowser=1) */
export function externalBrowserUrl(href = window.location.href): string {
  const u = new URL(href);
  u.searchParams.set("openExternalBrowser", "1");
  return u.toString();
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const snapshot = () => (deferred ? "p" : "-") + (justInstalled ? "i" : "-");

export function useInstall() {
  const s = useSyncExternalStore(subscribe, snapshot, () => "--");
  return {
    canPrompt: s[0] === "p",
    installed: s[1] === "i" || isStandalone(),
    platform: detectPlatform(),
    /** เรียกหน้าติดตั้งของเบราว์เซอร์ คืนผลว่าผู้ใช้กดติดตั้งหรือไม่ */
    async prompt(): Promise<"accepted" | "dismissed" | "unavailable"> {
      if (!deferred) return "unavailable";
      const ev = deferred;
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      deferred = null;
      emit();
      return outcome;
    },
  };
}
