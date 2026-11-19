import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// หลัง deploy ใหม่ หน้าที่เปิดค้างอยู่จะหา chunk เก่าไม่เจอ → reload ครั้งเดียว
window.addEventListener("vite:preloadError", (event) => {
  const KEY = "chunk-reload-at";
  let last = 0;
  try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* storage blocked */ }
  if (Date.now() - last < 30_000) return;
  event.preventDefault();
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ }
  window.location.reload();
});

// PWA: ลง service worker เฉพาะตอน build จริง (dev ไม่ใช้ เพื่อไม่ให้ cache ค้าง)
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* ไม่มี SW ก็ใช้งานได้ปกติ */ });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
