import type { User } from "@/lib/types";

const MANAGED_PROFILE_ROLES = new Set([
  "STUDENT",
  "CLASS_REPRESENTATIVE",
  "FACULTY",
  "HOD",
  "CLASS_COORDINATOR",
  "PRINCIPAL",
  "VICE_PRINCIPAL",
  "MAINTENANCE_ADMIN",
  "MAINTENANCE_SUPERVISOR",
  "MAINTENANCE_STAFF",
  "ELECTRICIAN",
  "PLUMBER",
  "IT_SUPPORT",
  "LAB_TECHNICIAN",
  "HOUSEKEEPING",
  "SECURITY",
  "OTHER_RESPONSIBLE",
]);

const EDITABLE_INCOMPLETE_PROFILE_STATUSES = new Set([
  "NOT_STARTED",
  "IN_PROGRESS",
  "REJECTED",
]);

export function requiresProfileSetup(user: User): boolean {
  if (user.allowedNextRoute === "/profile/setup") return true;
  if (user.allowedNextRoute) return false;

  return (
    user.roles.some((role) => MANAGED_PROFILE_ROLES.has(role)) &&
    Boolean(
      user.profileCompletionStatus &&
        EDITABLE_INCOMPLETE_PROFILE_STATUSES.has(user.profileCompletionStatus),
    )
  );
}

export function getPostAuthenticationRoute(user: User): string {
  if (user.status !== "ACTIVE") return "/suspended";
  if (user.mustChangePassword) return "/change-password";
  if (requiresProfileSetup(user)) return "/profile/setup";
  return user.allowedNextRoute ?? "/";
}
