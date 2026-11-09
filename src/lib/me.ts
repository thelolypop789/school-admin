import { createContext, useContext } from "react";
import type { Profile } from "./supabase";

export const MeContext = createContext<Profile | null>(null);

/** ผู้ใช้ปัจจุบัน (ใช้ได้เฉพาะในหน้าที่ล็อกอินแล้ว) */
export function useMe(): Profile {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside MeContext");
  return me;
}
