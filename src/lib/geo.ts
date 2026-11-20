/** พิกัดปัจจุบัน (ไม่ได้/ไม่อนุญาต = null — ยังส่งรายงานได้ ครูเห็นว่าไม่มีพิกัด) */
export function currentPosition(timeoutMs = 10000): Promise<{ lat: number; lng: number; acc: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
  });
}

/** ย่อภาพจาก canvas/ไฟล์เป็น JPEG ไม่เกิน maxSide px (bucket nst-photos จำกัด 1 MB) */
export function canvasToJpeg(c: HTMLCanvasElement, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("ถ่ายรูปไม่สำเร็จ"))), "image/jpeg", quality));
}
export async function fileToJpeg(file: File, maxSide = 900): Promise<Blob> {
  const img = await createImageBitmap(file);
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return canvasToJpeg(c);
}
