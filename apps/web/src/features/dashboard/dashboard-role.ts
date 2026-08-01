export type DashboardKind =
  | "admin"
  | "principal"
  | "vice-principal"
  | "hod"
  | "faculty"
  | "maintenance"
  | "student"
  | "staff";

const ADMIN_ROLES = new Set(["SUPER_ADMIN", "MAIN_ADMIN", "ACADEMIC_ADMIN", "ADMIN"]);
const FACULTY_ROLES = new Set(["FACULTY", "CLASS_COORDINATOR"]);
const STUDENT_ROLES = new Set(["STUDENT", "CLASS_REPRESENTATIVE"]);
const MAINTENANCE_ROLES = new Set([
  "MAINTENANCE_ADMIN",
  "MAINTENANCE_SUPERVISOR",
  "MAINTENANCE_STAFF",
  "ELECTRICIAN",
  "PLUMBER",
  "IT_SUPPORT",
  "LAB_TECHNICIAN",
  "LABORATORY_TECHNICIAN",
  "HOUSEKEEPING",
  "SECURITY",
  "SECURITY_STAFF",
  "OTHER_RESPONSIBLE",
]);

export function dashboardKindForRoles(roles: readonly string[]): DashboardKind {
  const normalized = new Set(roles.map((role) => role.toUpperCase()));
  if ([...ADMIN_ROLES].some((role) => normalized.has(role))) return "admin";
  if (normalized.has("PRINCIPAL")) return "principal";
  if (normalized.has("VICE_PRINCIPAL")) return "vice-principal";
  if (normalized.has("HOD")) return "hod";
  if ([...FACULTY_ROLES].some((role) => normalized.has(role))) return "faculty";
  if ([...MAINTENANCE_ROLES].some((role) => normalized.has(role))) return "maintenance";
  if ([...STUDENT_ROLES].some((role) => normalized.has(role))) return "student";
  return "staff";
}
