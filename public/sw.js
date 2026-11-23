// Service worker ของแอป (PWA): ให้ติดตั้งบนมือถือได้ และเปิดหน้าแอปได้แม้เน็ตไม่ดี
// - หน้าเว็บ (navigation): ดึงจากเน็ตก่อน ถ้าออฟไลน์ใช้ตัวที่ cache ไว้
// - /assets/* (ชื่อไฟล์มี hash): cache ก่อน
// - ไม่แตะ request ไป Supabase หรือโดเมนอื่น ข้อมูลจริงต้องมาจากเซิร์ฟเวอร์เสมอ
const VERSION = "v10"; // v10: หน้าแอปนักเรียน /s ใช้ s.html แยก cache จากแอปบุคลากร
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const PRECACHE = ["/", "/s.html", "/manifest.webmanifest", "/favicon.svg", "/favicon.png", "/school-logo.png", "/icon-192.png", "/icon-512.png", "/manifest-nst.webmanifest", "/nst-icon-192.png", "/nst-icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // แอปนักเรียน (/s) มีหน้า HTML ของตัวเอง (s.html) เก็บแยกจากแอปบุคลากร
    const key = /^\/s(\/|$)/.test(url.pathname) ? "/s.html" : "/";
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(key, copy)); }
          return res;
        })
        .catch(() => caches.match(key).then((r) => r || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
  }
});
