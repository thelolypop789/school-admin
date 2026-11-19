import { errText, supabase } from "./supabase";

export type Pic = { blob: Blob; url: string };

/** อัปโหลดไป bucket private ที่โฟลเดอร์ของผู้ใช้ (<uid>/<uuid>.jpg) — คืน path; ล้มเหลวจะ throw พร้อมข้อความไทย */
export async function uploadPics(bucket: string, uid: string, photos: Pic[]): Promise<string[]> {
  const paths: string[] = [];
  for (const p of photos) {
    const path = `${uid}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from(bucket).upload(path, p.blob, { contentType: "image/jpeg" });
    if (error) throw new Error(`อัปโหลดรูปไม่สำเร็จ: ${errText(error)}`);
    paths.push(path);
  }
  return paths;
}
