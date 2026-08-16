export type NotificationAlertLevel = "CRITICAL" | "WARNING" | "INFO" | "SUCCESS";

export interface NotificationSummaryAlert {
  id: string;
  level: NotificationAlertLevel;
  title: string;
  message: string;
  dismissible: boolean;
  action: { label: string; href: string } | null;
  dismissedAt: string | null;
}

export interface NotificationSummary {
  all: number;
  unread: number;
  urgent: number;
  assigned: number;
  completed: number;
  escalations: number;
  escalatedIssues: number;
  pendingIssues: number;
  overdueIssues: number;
  unacknowledgedIssues: number;
  assignedIssues: number;
  resolvedToday: number;
  averageResolutionMinutes: number | null;
  alerts: NotificationSummaryAlert[];
}

export function navigationBadgeCount(
  href: string,
  summary: NotificationSummary | undefined,
): number | null {
  if (!summary) return null;
  const count =
    href === "/notifications"
      ? summary.unread
      : href === "/issues"
        ? summary.pendingIssues
        : href === "/assigned"
          ? summary.assignedIssues
          : href === "/admin/escalation"
            ? summary.escalatedIssues
            : 0;
  return count > 0 ? count : null;
}

export function compactBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(Math.max(0, count));
}
