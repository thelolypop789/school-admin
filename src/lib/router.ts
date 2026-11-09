import { useEffect, useState } from "react";

// router เล็กๆ ด้วย pushState: ทุกหน้ามี URL, ปุ่มย้อนกลับของเบราว์เซอร์ใช้ได้, QR ลิงก์ตรงเข้าหน้าตรวจได้
export function navigate(path: string) {
  if (path === window.location.pathname + window.location.search) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path;
}
