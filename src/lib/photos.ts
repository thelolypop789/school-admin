import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/** signed URL (1 ชม.) ของรูปใน bucket private — คืน map path → url */
export function useSignedUrls(bucket: string, paths: (string | null | undefined)[]): Record<string, string> {
  const key = [...new Set(paths.filter((p): p is string => !!p))].sort().join("|");
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const list = key ? key.split("|") : [];
    if (!list.length) return;
    let alive = true;
    supabase.storage.from(bucket).createSignedUrls(list, 3600).then(({ data }) => {
      if (!alive || !data) return;
      const out: Record<string, string> = {};
      for (const d of data) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
      setUrls(out);
    });
    return () => { alive = false; };
  }, [bucket, key]);
  return urls;
}
