export type NotificationFilter =
  | "all"
  | "urgent"
  | "escalations"
  | "unread"
  | "assigned"
  | "overdue"
  | "completed";

export type NotificationSort = "newest" | "oldest" | "priority" | "unread";

export interface NotificationAction {
  id: string;
  label: string;
  method: "GET" | "POST";
  href: string;
  requiresConfirmation: boolean;
}

export interface NotificationIssueContext {
  issueId: string;
  issueNumber: string;
  title: string;
  category: string;
  status: string;
  priority: string;
  location: string | null;
  assignedTo: string | null;
  acknowledgedAt: string | null;
  resolutionDueAt: string | null;
  isOverdue: boolean;
  isEscalation: boolean;
  escalationLevel: number;
}

export interface NotificationItem {
  id: string;
  readAt: string | null;
  createdAt: string;
  actions?: NotificationAction[];
  notification: {
    type: string;
    title: string;
    body: string;
    priority: string | null;
    relatedEntityType: string | null;
    relatedEntityId: string | null;
    data: Record<string, unknown> | null;
    context?: NotificationIssueContext | null;
    createdAt: string;
  };
}

export interface NotificationResult {
  unread: number;
  data: NotificationItem[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

export interface NotificationSummary {
  all: number;
  unread: number;
  urgent: number;
  escalations: number;
  assigned: number;
  completed: number;
  pendingIssues: number;
  overdueIssues: number;
  unacknowledgedIssues: number;
  assignedIssues: number;
  escalatedIssues?: number;
  resolvedToday: number;
  averageResolutionMinutes: number | null;
  alerts: NotificationAlert[];
}

export interface NotificationAlert {
  id: string;
  level: "CRITICAL" | "WARNING" | "INFO" | "SUCCESS";
  title: string;
  message: string;
  dismissible: boolean;
  action: { label: string; href: string } | null;
  dismissedAt: string | null;
}

export const REQUIRED_FILTERS: ReadonlyArray<{
  id: NotificationFilter;
  label: string;
  countKey: keyof Pick<NotificationSummary, "all" | "urgent" | "escalations" | "unread">;
}> = [
  { id: "all", label: "All", countKey: "all" },
  { id: "urgent", label: "Urgent", countKey: "urgent" },
  { id: "escalations", label: "Escalations", countKey: "escalations" },
  { id: "unread", label: "Unread", countKey: "unread" },
];

export const EXTRA_FILTERS: ReadonlyArray<{ id: NotificationFilter; label: string }> = [
  { id: "assigned", label: "Assigned" },
  { id: "overdue", label: "Overdue" },
  { id: "completed", label: "Completed" },
];

const ACTION_PERMISSIONS: Record<string, string | undefined> = {
  acknowledge: "issues.acknowledge",
  start_work: "issues.start",
  assign: "issues.assign",
  reassign: "issues.assign",
  add_timeline: "issues.update_work",
};

const DIRECT_ACTIONS = new Set(["acknowledge", "start_work"]);
const ASSIGNMENT_ACTIONS = new Set(["assign", "reassign"]);
const SUPPORTED_ACTIONS = new Set([
  "mark_read",
  "view_ticket",
  "review_escalation",
  "assign",
  "reassign",
  "acknowledge",
  "start_work",
  "add_timeline",
]);

export function normalizeActionId(id: string): string {
  return id.trim().toLowerCase().replaceAll("-", "_");
}

export function actionIsAllowed(action: NotificationAction, permissions: readonly string[]): boolean {
  const id = normalizeActionId(action.id);
  if (!SUPPORTED_ACTIONS.has(id)) return false;
  const permission = ACTION_PERMISSIONS[id];
  return !permission || permissions.includes(permission);
}

export function isDirectAction(action: NotificationAction): boolean {
  return action.method === "POST" && DIRECT_ACTIONS.has(normalizeActionId(action.id));
}

export function isAssignmentAction(action: NotificationAction): boolean {
  return action.method === "POST" && ASSIGNMENT_ACTIONS.has(normalizeActionId(action.id));
}

export function isMarkReadAction(action: NotificationAction): boolean {
  return normalizeActionId(action.id) === "mark_read";
}

export function notificationHref(item: NotificationItem): string {
  const context = item.notification.context;
  if (context?.issueId) return `/issues/${context.issueId}`;
  if (item.notification.relatedEntityType === "Issue" && item.notification.relatedEntityId) {
    return `/issues/${item.notification.relatedEntityId}`;
  }
  if (item.notification.relatedEntityType === "Conversation") return "/messages";
  if (item.notification.relatedEntityType === "Announcement") return "/announcements";
  return "/notifications";
}

export function buildNotificationQuery(input: {
  page: number;
  pageSize: number;
  filter: NotificationFilter;
  search: string;
  sort: NotificationSort;
}): string {
  const params = new URLSearchParams({
    page: String(input.page),
    pageSize: String(input.pageSize),
    filter: input.filter,
    sort: input.sort,
  });
  if (input.search.trim()) params.set("search", input.search.trim());
  return `/notifications?${params.toString()}`;
}

export function formatNotificationType(value: string): string {
  return value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export function formatRelativeTime(value: string, now = Date.now()): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Unknown time";
  const seconds = Math.round((timestamp - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, "month");
  return formatter.format(Math.round(months / 12), "year");
}

export function notificationPriority(item: NotificationItem): string | null {
  return item.notification.context?.priority ?? item.notification.priority;
}

export function notificationCategory(item: NotificationItem): string {
  return item.notification.context?.category || formatNotificationType(item.notification.type);
}

export function notificationStatus(item: NotificationItem): string | null {
  return item.notification.context?.status ?? null;
}

export function visibleActions(item: NotificationItem, permissions: readonly string[]): NotificationAction[] {
  const supplied = item.actions ?? [];
  const allowed = supplied.filter((action) => actionIsAllowed(action, permissions));
  if (item.readAt || allowed.some(isMarkReadAction)) return allowed;
  return [
    ...allowed,
    {
      id: "mark_read",
      label: "Mark as read",
      method: "POST",
      href: `/notifications/${item.id}/read`,
      requiresConfirmation: false,
    },
  ];
}

export function updateNotificationItem(
  result: NotificationResult | undefined,
  recipientId: string,
  update: (item: NotificationItem) => NotificationItem,
): NotificationResult | undefined {
  if (!result) return result;
  let changed = false;
  const data = result.data.map((item) => {
    if (item.id !== recipientId) return item;
    changed = true;
    return update(item);
  });
  return changed ? { ...result, data } : result;
}
