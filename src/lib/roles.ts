import { ROLE_LABEL, type Profile, type Role } from "./supabase";

// คนหนึ่งถือได้หลายบทบาท: role = บทบาทหลัก, extra_roles = บทบาทเสริม (ตรงกับ public.has_role ใน DB)
type WithRoles = Pick<Profile, "role" | "extra_roles">;

export const rolesOf = (p: WithRoles): Role[] => [p.role, ...(p.extra_roles ?? [])];
export const hasRole = (p: WithRoles, ...rs: Role[]): boolean => rolesOf(p).some((r) => rs.includes(r));
export const rolesLabel = (p: WithRoles): string => rolesOf(p).map((r) => ROLE_LABEL[r]).join(" · ");

/** บทบาทที่ใส่เป็นบทบาทเสริมได้ (admin ต้องเป็นบทบาทหลักเท่านั้น) */
export const EXTRA_ROLES: Role[] = ["vehicle_head", "facilities_head", "ga_head", "inspector", "nst_teacher", "deputy", "director"];

/** สถานะคำขอใช้รถที่คนนี้ต้องพิจารณา */
const STAGE_OF: Partial<Record<Role, string>> = { vehicle_head: "pending", deputy: "pending_deputy", director: "pending_director" };
export const reviewStatuses = (p: WithRoles): string[] =>
  rolesOf(p).map((r) => STAGE_OF[r]).filter((s): s is string => !!s);
