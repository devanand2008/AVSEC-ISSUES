const sessionPermissions = [
  "attendance.session.create",
  "attendance.read_class",
  "attendance.read_department",
  "attendance.read_college",
];

export function canViewAttendanceSessions(permissions: readonly string[]) {
  return sessionPermissions.some((permission) => permissions.includes(permission));
}
