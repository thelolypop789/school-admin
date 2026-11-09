/** ย่อรูปจากกล้องมือถือให้ด้านยาวไม่เกิน maxSide แล้วบีบเป็น JPEG (รูป 4–8MB → ~200KB) */
export async function compressImage(file: File, maxSide = 1280, quality = 0.7): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("บีบอัดรูปไม่สำเร็จ"))), "image/jpeg", quality),
  );
}
