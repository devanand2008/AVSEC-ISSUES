import {
  Activity,
  AlertTriangle,
  BarChart2,
  Bell,
  Bot,
  BookOpen,
  Box,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileText,
  FileUp,
  FileWarning,
  Gauge,
  GraduationCap,
  HardDrive,
  History,
  HeartPulse,
  Megaphone,
  MessageCircle,
  QrCode,
  Settings,
  ShieldCheck,
  Star,
  Tags,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface NavigationItem {
  href: string;
  label: string;
  icon: LucideIcon;
  any?: string[];
  all?: string[];
  roles?: string[];
}

export const navigation: NavigationItem[] = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/avs-bot", label: "AVS Bot", icon: Bot, any: ["ai.use"] },
  { href: "/scan-qr", label: "Scan QR", icon: QrCode },
  {
    href: "/analytics",
    label: "Analytics",
    icon: BarChart2,
    any: [
      "issues.read",
      "attendance.read_own",
      "attendance.read_class",
      "attendance.read_department",
      "attendance.read_college",
    ],
  },
  {
    href: "/attendance",
    label: "Attendance",
    icon: ClipboardCheck,
    any: [
      "attendance.read_own",
      "attendance.read_class",
      "attendance.read_department",
      "attendance.read_college",
      "attendance.session.create",
    ],
  },
  {
    href: "/learn",
    label: "AVS Skill",
    icon: GraduationCap,
    any: ["academic.read", "academic.manage"],
  },
  {
    href: "/academic-learn",
    label: "AVS Learn",
    icon: BookOpen,
    any: ["academic.read", "academic.manage"],
  },
  {
    href: "/feedback/scanner",
    label: "Feedback QR",
    icon: QrCode,
    any: ["feedback.scan"],
    roles: ["STUDENT", "CLASS_REPRESENTATIVE"],
  },
  {
    href: "/student/feedback/history",
    label: "Feedback history",
    icon: History,
    any: ["feedback.read_own"],
    roles: ["STUDENT", "CLASS_REPRESENTATIVE"],
  },
  {
    href: "/faculty/my-feedback",
    label: "My feedback",
    icon: Star,
    any: ["feedback.read_staff"],
    roles: ["FACULTY"],
  },
  {
    href: "/faculty/my-attendance",
    label: "My attendance",
    icon: ClipboardCheck,
    any: ["attendance.read_class"],
    roles: ["FACULTY"],
  },
  {
    href: "/hod/feedback-dashboard",
    label: "Dept feedback",
    icon: Star,
    any: ["feedback.read_department"],
    roles: ["HOD"],
  },
  {
    href: "/hod/staff-ratings",
    label: "Dept staff ratings",
    icon: Users,
    any: ["feedback.read_department"],
    roles: ["HOD"],
  },
  {
    href: "/hod/attendance",
    label: "Dept attendance",
    icon: ClipboardCheck,
    any: ["attendance.read_department"],
    roles: ["HOD"],
  },
  {
    href: "/hod/low-attendance",
    label: "Low attendance",
    icon: AlertTriangle,
    any: ["attendance.read_department"],
    roles: ["HOD"],
  },
  {
    href: "/vice-principal/feedback-dashboard",
    label: "VP feedback",
    icon: Star,
    any: ["feedback.read_college"],
    roles: ["VICE_PRINCIPAL"],
  },
  {
    href: "/vice-principal/staff-ratings",
    label: "VP staff ratings",
    icon: Users,
    any: ["feedback.read_college"],
    roles: ["VICE_PRINCIPAL"],
  },
  {
    href: "/vice-principal/attendance",
    label: "VP attendance",
    icon: ClipboardCheck,
    any: ["attendance.read_college"],
    roles: ["VICE_PRINCIPAL"],
  },
  {
    href: "/vice-principal/low-attendance",
    label: "VP low attendance",
    icon: AlertTriangle,
    any: ["attendance.read_college"],
    roles: ["VICE_PRINCIPAL"],
  },
  {
    href: "/vice-principal/management-insights",
    label: "VP insights",
    icon: BarChart2,
    all: ["feedback.read_college", "attendance.read_college"],
    roles: ["VICE_PRINCIPAL"],
  },
  {
    href: "/principal/feedback-dashboard",
    label: "Principal feedback",
    icon: Star,
    any: ["feedback.read_college"],
    roles: ["PRINCIPAL"],
  },
  {
    href: "/principal/staff-ratings",
    label: "Staff ratings",
    icon: Users,
    any: ["feedback.read_college"],
    roles: ["PRINCIPAL"],
  },
  {
    href: "/principal/attendance",
    label: "Principal attendance",
    icon: ClipboardCheck,
    any: ["attendance.read_college"],
    roles: ["PRINCIPAL"],
  },
  {
    href: "/principal/low-attendance",
    label: "Low attendance",
    icon: AlertTriangle,
    any: ["attendance.read_college"],
    roles: ["PRINCIPAL"],
  },
  {
    href: "/principal/management-insights",
    label: "Insights",
    icon: BarChart2,
    all: ["feedback.read_college", "attendance.read_college"],
    roles: ["PRINCIPAL"],
  },
  {
    href: "/attendance/corrections",
    label: "Attendance corrections",
    icon: ShieldCheck,
    any: ["attendance.correction.request", "attendance.correction.approve"],
  },
  { href: "/issues", label: "Issues", icon: FileWarning },
  {
    href: "/assigned",
    label: "Assigned work",
    icon: ClipboardList,
    any: ["issues.read_assigned"],
  },
  {
    href: "/messages",
    label: "Messages",
    icon: MessageCircle,
    any: ["conversations.read"],
  },
  {
    href: "/admin/broadcasts",
    label: "Chat broadcasts",
    icon: MessageCircle,
    any: ["broadcasts.create", "broadcasts.send"],
  },
  {
    href: "/announcements",
    label: "Announcements",
    icon: Bell,
    any: ["announcements.read"],
  },
  {
    href: "/admin/announcements",
    label: "Broadcast messages",
    icon: Megaphone,
    any: ["announcements.publish_college"],
  },
  { href: "/admin/users", label: "People", icon: Users, any: ["users.read"] },
  {
    href: "/admin/maintenance-staff",
    label: "Maintenance staff",
    icon: Wrench,
    any: ["users.create"],
  },
  {
    href: "/admin/roles",
    label: "Roles & permissions",
    icon: ShieldCheck,
    any: ["roles.manage"],
  },
  {
    href: "/admin/academic",
    label: "Academic structure",
    icon: BookOpen,
    any: ["academic.manage"],
  },
  {
    href: "/admin/categories",
    label: "Issue categories",
    icon: Tags,
    any: ["issue_config.manage"],
  },
  {
    href: "/admin/escalation",
    label: "Escalation events",
    icon: AlertTriangle,
    any: ["routing.manage"],
  },
  {
    href: "/admin/assets",
    label: "Assets",
    icon: Box,
    any: ["locations.manage"],
  },
  {
    href: "/admin/imports",
    label: "Bulk imports",
    icon: FileUp,
    any: [
      "users.import",
      "locations.import",
      "assets.import",
      "academic.manage",
      "routing.manage",
    ],
  },
  {
    href: "/admin/locations",
    label: "Campus setup",
    icon: Building2,
    any: ["locations.manage"],
  },
  {
    href: "/admin/qr-management",
    label: "QR management",
    icon: QrCode,
    any: ["locations.qr", "feedback.qr.manage", "audit.read"],
    roles: ["SUPER_ADMIN", "MAIN_ADMIN"],
  },
  {
    href: "/admin/feedback/dashboard",
    label: "Feedback admin",
    icon: Star,
    any: ["feedback.read_college"],
    roles: ["SUPER_ADMIN", "MAIN_ADMIN"],
  },
  {
    href: "/admin/feedback/targets",
    label: "Feedback targets",
    icon: Users,
    any: ["feedback.targets.manage"],
    roles: ["SUPER_ADMIN", "MAIN_ADMIN"],
  },
  {
    href: "/admin/feedback/questions",
    label: "Rating questions",
    icon: ClipboardList,
    any: ["feedback.questions.manage"],
    roles: ["SUPER_ADMIN", "MAIN_ADMIN"],
  },
  {
    href: "/admin/feedback/cycles",
    label: "Feedback cycles",
    icon: History,
    any: ["feedback.cycles.manage"],
    roles: ["SUPER_ADMIN", "MAIN_ADMIN"],
  },
  {
    href: "/admin/feedback/submissions",
    label: "Feedback queue",
    icon: FileText,
    any: ["feedback.actions.manage"],
    roles: ["SUPER_ADMIN", "MAIN_ADMIN"],
  },
  {
    href: "/admin/feedback/qr-management",
    label: "Feedback QR",
    icon: QrCode,
    any: ["feedback.qr.manage"],
    roles: ["SUPER_ADMIN", "MAIN_ADMIN"],
  },
  {
    href: "/admin/feedback/reports",
    label: "Feedback reports",
    icon: Download,
    any: ["feedback.export"],
    roles: ["SUPER_ADMIN", "MAIN_ADMIN"],
  },
  {
    href: "/admin/feedback/settings",
    label: "Feedback settings",
    icon: Settings,
    any: ["feedback.settings.manage"],
    roles: ["SUPER_ADMIN", "MAIN_ADMIN"],
  },
  {
    href: "/admin/attendance/analytics",
    label: "Attendance analytics",
    icon: ClipboardCheck,
    any: ["attendance.read_college"],
    roles: ["SUPER_ADMIN", "MAIN_ADMIN"],
  },
  {
    href: "/admin/routing",
    label: "Service routing",
    icon: Wrench,
    any: ["routing.manage"],
  },
  {
    href: "/admin/templates",
    label: "Notification templates",
    icon: FileText,
    any: ["settings.manage"],
  },
  {
    href: "/admin/exports",
    label: "Data exports",
    icon: Download,
    any: ["attendance.export", "issues.export", "users.export"],
  },
  {
    href: "/admin/operations",
    label: "Audit & operations",
    icon: Activity,
    any: [
      "audit.read",
      "system.health",
      "notifications.retry",
      "messages.moderate_reported",
    ],
  },
  {
    href: "/admin/backup",
    label: "System health",
    icon: HeartPulse,
    any: ["system.health"],
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: Settings,
    any: ["settings.read", "settings.manage", "integrations.manage"],
  },
  {
    href: "/settings/storage",
    label: "Storage & backups",
    icon: HardDrive,
    any: ["settings.read", "integrations.manage", "backups.manage"],
  },
];

export function visibleNavigation(
  permissions: readonly string[],
  roles: readonly string[] = [],
) {
  const allowed = new Set(permissions);
  const assignedRoles = new Set(roles);
  return navigation.filter((item) => {
    const permissionAllowed =
      (!item.any || item.any.some((permission) => allowed.has(permission))) &&
      (!item.all || item.all.every((permission) => allowed.has(permission)));
    const roleAllowed =
      !item.roles || item.roles.some((role) => assignedRoles.has(role));
    return permissionAllowed && roleAllowed;
  });
}

/* ════════════════════════════════════════════════════════════
   Mobile Bottom Navigation Presets
   ════════════════════════════════════════════════════════════ */

export interface BottomNavItem {
  href: string;
  label: string;
  iconName: "home" | "attendance" | "learn" | "messages" | "people" | "issues" | "reports" | "profile" | "assigned" | "more";
}

export function getMobileBottomNav(roles: readonly string[] = []): BottomNavItem[] {
  const isAdmin = roles.some((r) => ["SUPER_ADMIN", "MAIN_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"].includes(r));
  const isMaintenance = roles.some((r) => r.startsWith("MAINTENANCE_") || ["ELECTRICIAN", "PLUMBER", "IT_SUPPORT", "HOUSEKEEPING"].includes(r));

  if (isAdmin) {
    return [
      { href: "/", label: "Dashboard", iconName: "home" },
      { href: "/admin/people", label: "People", iconName: "people" },
      { href: "/issues", label: "Issues", iconName: "issues" },
      { href: "/admin/exports", label: "Reports", iconName: "reports" },
      { href: "/profile/me", label: "Profile", iconName: "profile" },
    ];
  }

  if (isMaintenance) {
    return [
      { href: "/assigned", label: "Assigned", iconName: "assigned" },
      { href: "/issues?status=IN_PROGRESS", label: "Progress", iconName: "issues" },
      { href: "/issues?status=OVERDUE", label: "Overdue", iconName: "reports" },
      { href: "/messages", label: "Messages", iconName: "messages" },
      { href: "/profile/me", label: "Profile", iconName: "profile" },
    ];
  }

  // Student / Faculty / General
  return [
    { href: "/", label: "Home", iconName: "home" },
    { href: "/attendance", label: "Attendance", iconName: "attendance" },
    { href: "/academic-learn", label: "Learn", iconName: "learn" },
    { href: "/messages", label: "Messages", iconName: "messages" },
    { href: "/profile/me", label: "Profile", iconName: "profile" },
  ];
}
