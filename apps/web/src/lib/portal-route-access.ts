interface PortalRouteRule {
  prefix: string;
  roles: readonly string[];
  any?: readonly string[];
  all?: readonly string[];
}

const adminRoles = ["SUPER_ADMIN", "MAIN_ADMIN"] as const;
const studentRoles = ["STUDENT", "CLASS_REPRESENTATIVE"] as const;

const portalRouteRules: readonly PortalRouteRule[] = [
  {
    prefix: "/admin/feedback/dashboard",
    roles: adminRoles,
    any: ["feedback.read_college"],
  },
  {
    prefix: "/admin/feedback/targets",
    roles: adminRoles,
    any: ["feedback.targets.manage"],
  },
  {
    prefix: "/admin/feedback/questions",
    roles: adminRoles,
    any: ["feedback.questions.manage"],
  },
  {
    prefix: "/admin/feedback/cycles",
    roles: adminRoles,
    any: ["feedback.cycles.manage"],
  },
  {
    prefix: "/admin/feedback/submissions",
    roles: adminRoles,
    any: ["feedback.actions.manage"],
  },
  {
    prefix: "/admin/feedback/qr-management",
    roles: adminRoles,
    any: ["feedback.qr.manage"],
  },
  {
    prefix: "/admin/qr-management",
    roles: adminRoles,
    any: ["locations.qr", "feedback.qr.manage", "audit.read"],
  },
  {
    prefix: "/admin/feedback/reports",
    roles: adminRoles,
    any: ["feedback.export"],
  },
  {
    prefix: "/admin/feedback/settings",
    roles: adminRoles,
    any: ["feedback.settings.manage"],
  },
  {
    prefix: "/admin/attendance/analytics",
    roles: adminRoles,
    any: ["attendance.read_college"],
  },
  {
    prefix: "/principal/feedback-dashboard",
    roles: ["PRINCIPAL"],
    any: ["feedback.read_college"],
  },
  {
    prefix: "/principal/staff-ratings",
    roles: ["PRINCIPAL"],
    any: ["feedback.read_college"],
  },
  {
    prefix: "/principal/attendance",
    roles: ["PRINCIPAL"],
    any: ["attendance.read_college"],
  },
  {
    prefix: "/principal/low-attendance",
    roles: ["PRINCIPAL"],
    any: ["attendance.read_college"],
  },
  {
    prefix: "/principal/management-insights",
    roles: ["PRINCIPAL"],
    all: ["feedback.read_college", "attendance.read_college"],
  },
  {
    prefix: "/vice-principal/feedback-dashboard",
    roles: ["VICE_PRINCIPAL"],
    any: ["feedback.read_college"],
  },
  {
    prefix: "/vice-principal/staff-ratings",
    roles: ["VICE_PRINCIPAL"],
    any: ["feedback.read_college"],
  },
  {
    prefix: "/vice-principal/attendance",
    roles: ["VICE_PRINCIPAL"],
    any: ["attendance.read_college"],
  },
  {
    prefix: "/vice-principal/low-attendance",
    roles: ["VICE_PRINCIPAL"],
    any: ["attendance.read_college"],
  },
  {
    prefix: "/vice-principal/management-insights",
    roles: ["VICE_PRINCIPAL"],
    all: ["feedback.read_college", "attendance.read_college"],
  },
  {
    prefix: "/hod/feedback-dashboard",
    roles: ["HOD"],
    any: ["feedback.read_department"],
  },
  {
    prefix: "/hod/staff-ratings",
    roles: ["HOD"],
    any: ["feedback.read_department"],
  },
  {
    prefix: "/hod/attendance",
    roles: ["HOD"],
    any: ["attendance.read_department"],
  },
  {
    prefix: "/hod/low-attendance",
    roles: ["HOD"],
    any: ["attendance.read_department"],
  },
  {
    prefix: "/faculty/my-feedback",
    roles: ["FACULTY"],
    any: ["feedback.read_staff"],
  },
  {
    prefix: "/faculty/my-attendance",
    roles: ["FACULTY"],
    any: ["attendance.read_class"],
  },
  {
    prefix: "/student/feedback/history",
    roles: studentRoles,
    any: ["feedback.read_own"],
  },
  {
    prefix: "/student/feedback/success",
    roles: studentRoles,
    any: ["feedback.submit"],
  },
  {
    prefix: "/student/feedback/target",
    roles: studentRoles,
    all: ["feedback.scan", "feedback.submit"],
  },
  {
    prefix: "/student/feedback/form",
    roles: studentRoles,
    all: ["feedback.scan", "feedback.submit"],
  },
  { prefix: "/student/feedback", roles: studentRoles, any: ["feedback.scan"] },
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function canAccessPortalPath(
  pathname: string,
  permissions: readonly string[],
  roles: readonly string[],
): boolean {
  const rule = portalRouteRules.find((candidate) =>
    matchesPrefix(pathname, candidate.prefix),
  );
  if (!rule) return true;
  const assignedRoles = new Set(roles);
  if (!rule.roles.some((role) => assignedRoles.has(role))) return false;
  const granted = new Set(permissions);
  if (rule.all && !rule.all.every((permission) => granted.has(permission)))
    return false;
  return !rule.any || rule.any.some((permission) => granted.has(permission));
}
