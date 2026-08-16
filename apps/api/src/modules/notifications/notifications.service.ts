import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { AccessService } from "../../common/access/access.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import type { NotificationFilter, NotificationQueryDto, NotificationSort } from "./dto/notification-query.dto";
import { activeBannerDismissal, normalizeNotificationPreferences } from "./notification-preferences";

const URGENT_PRIORITIES = ["HIGH", "CRITICAL", "EMERGENCY"] as const;
const COMPLETED_STATUSES = ["RESOLVED", "VERIFICATION_PENDING", "VERIFIED", "CLOSED"] as const;
const NON_PENDING_STATUSES = ["RESOLVED", "VERIFICATION_PENDING", "VERIFIED", "CLOSED", "CANCELLED", "REJECTED"] as const;
const TIMELINE_STATUSES = ["IN_PROGRESS", "WAITING_FOR_MATERIAL", "WAITING_FOR_PARTS", "WAITING_FOR_APPROVAL", "WAITING_FOR_VENDOR", "ON_HOLD", "OVERDUE"];

export interface NotificationAction {
  id: string;
  label: string;
  method: "GET" | "POST";
  href: string;
  requiresConfirmation: boolean;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly config: ConfigService,
  ) {}

  async list(user: AuthPrincipal, query: NotificationQueryDto) {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const filter: NotificationFilter = query.unreadOnly === "true" ? "unread" : query.filter;
    const search = query.search?.trim();
    const relatedIssueIds = await this.relatedIssueIds(user, filter, search);
    const searchWhere: Prisma.NotificationRecipientWhereInput = search ? {
      notification: { OR: [
        { title: { contains: search, mode: "insensitive" } },
        ...(relatedIssueIds?.length ? [{ relatedEntityType: "Issue", relatedEntityId: { in: relatedIssueIds } }] : []),
      ] },
    } : {};
    const where: Prisma.NotificationRecipientWhereInput = {
      AND: [
        { userId: user.id },
        this.notificationFilterWhere(filter, relatedIssueIds),
        searchWhere,
      ],
    };
    const [recipients, total, unread] = await this.prisma.$transaction([
      this.prisma.notificationRecipient.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: this.notificationOrder(query.sort),
        select: {
          id: true,
          readAt: true,
          createdAt: true,
          notification: {
            select: {
              type: true,
              title: true,
              body: true,
              priority: true,
              relatedEntityType: true,
              relatedEntityId: true,
              data: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.notificationRecipient.count({ where }),
      this.prisma.notificationRecipient.count({ where: { userId: user.id, readAt: null } }),
    ]);

    const pageIssueIds = [...new Set(recipients.flatMap((recipient) =>
      recipient.notification.relatedEntityType === "Issue" && recipient.notification.relatedEntityId
        ? [recipient.notification.relatedEntityId]
        : [],
    ))];
    const issues = pageIssueIds.length
      ? await this.prisma.issue.findMany({
          where: { AND: [this.access.issueWhere(user), { id: { in: pageIssueIds } }] },
          select: {
            id: true,
            issueNumber: true,
            title: true,
            status: true,
            priority: true,
            acknowledgedAt: true,
            resolutionDueAt: true,
            escalationLevel: true,
            assignedToId: true,
            assignedTo: { select: { fullName: true } },
            team: {
              select: {
                name: true,
                members: { where: { userId: user.id, isActive: true }, take: 1, select: { id: true } },
              },
            },
            category: { select: { name: true } },
            campus: { select: { name: true } },
            block: { select: { name: true } },
            floor: { select: { name: true } },
            room: { select: { name: true } },
            area: { select: { name: true } },
            customAreaName: true,
          },
        })
      : [];
    const issueById = new Map(issues.map((issue) => [issue.id, issue]));
    const now = new Date();
    const data = recipients.map((recipient) => {
      const issue = recipient.notification.relatedEntityId
        ? issueById.get(recipient.notification.relatedEntityId)
        : undefined;
      const isEscalation = recipient.notification.type === "ISSUE_ESCALATED" || Boolean(issue?.escalationLevel);
      const context = issue ? {
        issueId: issue.id,
        issueNumber: issue.issueNumber,
        title: issue.title,
        category: issue.category.name,
        status: issue.status,
        priority: issue.priority,
        location: [issue.campus.name, issue.block.name, issue.floor.name, issue.room?.name ?? issue.area?.name ?? issue.customAreaName].filter(Boolean).join(" / "),
        assignedTo: issue.assignedTo?.fullName ?? issue.team?.name ?? null,
        acknowledgedAt: issue.acknowledgedAt,
        resolutionDueAt: issue.resolutionDueAt,
        isOverdue: this.isIssueOverdue(issue, now),
        isEscalation,
        escalationLevel: issue.escalationLevel,
      } : null;
      return {
        ...recipient,
        notification: { ...recipient.notification, context },
        actions: this.availableActions(user, recipient.id, recipient.readAt, recipient.notification.type, issue),
      };
    });

    return { data, unread, meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
  }

  async summary(user: AuthPrincipal) {
    const now = new Date();
    const college = await this.prisma.college.findUniqueOrThrow({ where: { id: user.collegeId }, select: { timezone: true } });
    const localNow = toZonedTime(now, college.timezone);
    const localDate = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, "0")}-${String(localNow.getDate()).padStart(2, "0")}`;
    const today = fromZonedTime(`${localDate}T00:00:00`, college.timezone);
    const issueScope: Prisma.IssueWhereInput = {
      AND: [this.access.issueWhere(user), { campus: { isTestData: false } }],
    };
    const pendingWhere: Prisma.IssueWhereInput = { status: { notIn: [...NON_PENDING_STATUSES] } };
    const overdueWhere: Prisma.IssueWhereInput = {
      status: { notIn: [...NON_PENDING_STATUSES] },
      OR: [{ status: "OVERDUE" }, { resolutionDueAt: { lt: now } }],
    };
    const [escalatedIssueIds, assignedIssueIds, completedIssueIds] = await this.prisma.$transaction([
      this.prisma.issue.findMany({ where: { AND: [issueScope, { escalationLevel: { gt: 0 } }] }, select: { id: true } }),
      this.prisma.issue.findMany({ where: { AND: [issueScope, this.access.assignedIssueWhere(user)] }, select: { id: true } }),
      this.prisma.issue.findMany({ where: { AND: [issueScope, { status: { in: [...COMPLETED_STATUSES] } }] }, select: { id: true } }),
    ]);
    const escalationIds = escalatedIssueIds.map(({ id }) => id);
    const assignedIds = assignedIssueIds.map(({ id }) => id);
    const completedIds = completedIssueIds.map(({ id }) => id);
    const [all, unread, urgent, escalations, assigned, completed, pendingIssues, overdueIssues, unacknowledgedIssues, escalatedIssues, assignedIssues, resolvedToday, criticalOverdueIssues, resolvedIssues, account] = await this.prisma.$transaction([
      this.prisma.notificationRecipient.count({ where: { userId: user.id } }),
      this.prisma.notificationRecipient.count({ where: { userId: user.id, readAt: null } }),
      this.prisma.notificationRecipient.count({ where: { userId: user.id, notification: { priority: { in: [...URGENT_PRIORITIES] } } } }),
      this.prisma.notificationRecipient.count({ where: { userId: user.id, ...this.notificationFilterWhere("escalations", escalationIds) } }),
      this.prisma.notificationRecipient.count({ where: { userId: user.id, ...this.notificationFilterWhere("assigned", assignedIds) } }),
      this.prisma.notificationRecipient.count({ where: { userId: user.id, ...this.notificationFilterWhere("completed", completedIds) } }),
      this.prisma.issue.count({ where: { AND: [issueScope, pendingWhere] } }),
      this.prisma.issue.count({ where: { AND: [issueScope, overdueWhere] } }),
      this.prisma.issue.count({ where: { AND: [issueScope, pendingWhere, { acknowledgedAt: null, acknowledgementDueAt: { not: null } }] } }),
      this.prisma.issue.count({ where: { AND: [issueScope, pendingWhere, { escalationLevel: { gt: 0 } }] } }),
      this.prisma.issue.count({ where: { AND: [issueScope, this.access.assignedIssueWhere(user), pendingWhere] } }),
      this.prisma.issue.count({ where: { AND: [issueScope, { resolvedAt: { gte: today }, status: { in: [...COMPLETED_STATUSES] } }] } }),
      this.prisma.issue.count({ where: { AND: [issueScope, overdueWhere, { priority: { in: ["CRITICAL", "EMERGENCY"] } }] } }),
      this.prisma.issue.findMany({ where: { AND: [issueScope, { resolvedAt: { not: null }, status: { in: [...COMPLETED_STATUSES] } }] }, select: { createdAt: true, resolvedAt: true } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { notificationPreferences: true } }),
    ]);
    const eligibleDurations = resolvedIssues.flatMap((issue) => {
      if (!issue.resolvedAt || issue.resolvedAt < issue.createdAt) return [];
      return [issue.resolvedAt.getTime() - issue.createdAt.getTime()];
    });
    const averageResolutionMinutes = eligibleDurations.length
      ? Math.round(eligibleDurations.reduce((sum, duration) => sum + duration, 0) / eligibleDurations.length / 60_000)
      : null;
    const preferences = normalizeNotificationPreferences(account.notificationPreferences);
    const channels = this.channelCapabilities();
    const alerts = this.alerts({ criticalOverdueIssues, overdueIssues, pushConfigured: channels.push.configured, dismissedBanners: preferences.dismissed_banners });
    return { all, unread, urgent, escalations, assigned, completed, pendingIssues, overdueIssues, unacknowledgedIssues, escalatedIssues, assignedIssues, resolvedToday, averageResolutionMinutes, alerts };
  }

  async preferences(user: AuthPrincipal) {
    const account = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { notificationPreferences: true } });
    return { preferences: normalizeNotificationPreferences(account.notificationPreferences), channels: this.channelCapabilities() };
  }

  async markRead(user: AuthPrincipal, id: string) {
    const recipient = await this.prisma.notificationRecipient.findFirst({ where: { id, userId: user.id } });
    if (!recipient) throw new NotFoundException("Notification not found.");
    await this.prisma.notificationRecipient.update({ where: { id }, data: { readAt: recipient.readAt ?? new Date() } });
    return { read: true };
  }

  async markAllRead(user: AuthPrincipal) {
    const result = await this.prisma.notificationRecipient.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: result.count };
  }

  private async relatedIssueIds(user: AuthPrincipal, filter: NotificationFilter, search?: string): Promise<string[] | undefined> {
    const requiresIssueFilter = ["escalations", "assigned", "overdue", "completed"].includes(filter);
    if (!requiresIssueFilter && !search) return undefined;
    const filters: Prisma.IssueWhereInput[] = [this.access.issueWhere(user)];
    if (filter === "escalations") filters.push({ escalationLevel: { gt: 0 } });
    if (filter === "assigned") filters.push(this.access.assignedIssueWhere(user));
    if (filter === "overdue") filters.push({ status: { notIn: [...NON_PENDING_STATUSES] }, OR: [{ status: "OVERDUE" }, { resolutionDueAt: { lt: new Date() } }] });
    if (filter === "completed") filters.push({ status: { in: [...COMPLETED_STATUSES] } });
    if (search) filters.push({ OR: [
      { issueNumber: { contains: search, mode: "insensitive" } },
      { title: { contains: search, mode: "insensitive" } },
      { customAreaName: { contains: search, mode: "insensitive" } },
      { category: { name: { contains: search, mode: "insensitive" } } },
      { campus: { name: { contains: search, mode: "insensitive" } } },
      { block: { name: { contains: search, mode: "insensitive" } } },
      { floor: { name: { contains: search, mode: "insensitive" } } },
      { room: { name: { contains: search, mode: "insensitive" } } },
      { area: { name: { contains: search, mode: "insensitive" } } },
    ] });
    const issues = await this.prisma.issue.findMany({ where: { AND: filters }, select: { id: true } });
    return issues.map(({ id }) => id);
  }

  private notificationFilterWhere(filter: NotificationFilter, issueIds?: string[]): Prisma.NotificationRecipientWhereInput {
    if (filter === "urgent") return { notification: { priority: { in: [...URGENT_PRIORITIES] } } };
    if (filter === "unread") return { readAt: null };
    if (filter === "escalations") return { notification: { OR: [
      { type: "ISSUE_ESCALATED" },
      ...(issueIds?.length ? [{ relatedEntityType: "Issue", relatedEntityId: { in: issueIds } }] : []),
    ] } };
    if (["assigned", "overdue", "completed"].includes(filter)) return { notification: { relatedEntityType: "Issue", relatedEntityId: { in: issueIds ?? [] } } };
    return {};
  }

  private notificationOrder(sort: NotificationSort): Prisma.NotificationRecipientOrderByWithRelationInput[] {
    if (sort === "oldest") return [{ createdAt: "asc" }];
    if (sort === "priority") return [{ notification: { priority: "desc" } }, { createdAt: "desc" }];
    if (sort === "unread") return [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }];
    return [{ createdAt: "desc" }];
  }

  private availableActions(user: AuthPrincipal, recipientId: string, readAt: Date | null, notificationType: string, issue?: { id: string; status: string; assignedToId: string | null; team: { name: string; members: Array<{ id: string }> } | null }): NotificationAction[] {
    const actions: NotificationAction[] = [];
    if (!readAt) actions.push(this.action("mark_read", "Mark as read", "POST", `/notifications/${recipientId}/read`));
    if (!issue) return actions;
    const canWork = user.permissions.includes("issues.assign") || issue.assignedToId === user.id || Boolean(issue.team?.members.length);
    const canReviewEscalation = notificationType === "ISSUE_ESCALATED" && user.roles.some((role) => ["PRINCIPAL", "VICE_PRINCIPAL", "MAIN_ADMIN", "SUPER_ADMIN"].includes(role));
    actions.push(canReviewEscalation
      ? this.action("review_escalation", "Review escalation", "GET", `/issues/${issue.id}`)
      : this.action("view_ticket", "View ticket", "GET", `/issues/${issue.id}`));
    if (user.permissions.includes("issues.assign") && ["NEW", "NEEDS_MANUAL_ASSIGNMENT", "REOPENED"].includes(issue.status)) actions.push(this.action("assign", "Assign", "POST", `/issues/${issue.id}/assign`, true));
    if (user.permissions.includes("issues.assign") && issue.status === "ASSIGNED") actions.push(this.action("reassign", "Reassign", "POST", `/issues/${issue.id}/assign`, true));
    if (user.permissions.includes("issues.acknowledge") && issue.status === "ASSIGNED" && canWork) actions.push(this.action("acknowledge", "Acknowledge", "POST", `/issues/${issue.id}/acknowledge`));
    if (user.permissions.includes("issues.start") && issue.status === "ACKNOWLEDGED" && canWork) actions.push(this.action("start_work", "Start work", "POST", `/issues/${issue.id}/start`));
    if (user.permissions.includes("issues.update_work") && TIMELINE_STATUSES.includes(issue.status) && canWork) actions.push(this.action("add_timeline", "Add timeline", "GET", `/issues/${issue.id}#timeline`));
    return actions;
  }

  private action(id: string, label: string, method: "GET" | "POST", href: string, requiresConfirmation = false): NotificationAction {
    return { id, label, method, href, requiresConfirmation };
  }

  private isIssueOverdue(issue: { status: string; resolutionDueAt: Date | null }, now: Date): boolean {
    return issue.status === "OVERDUE" || Boolean(issue.resolutionDueAt && issue.resolutionDueAt < now && !NON_PENDING_STATUSES.includes(issue.status as typeof NON_PENDING_STATUSES[number]));
  }

  private channelCapabilities() {
    const pushConfigured = Boolean(this.config.get<string>("FIREBASE_PROJECT_ID") && this.config.get<string>("FIREBASE_CLIENT_EMAIL") && this.config.get<string>("FIREBASE_PRIVATE_KEY") && this.config.get<string>("DEVICE_TOKEN_ENCRYPTION_KEY"));
    const emailConfigured = Boolean(this.config.get<boolean>("EMAIL_ENABLED", false) && this.config.get<string>("SMTP_HOST") && this.config.get<string>("EMAIL_FROM_ADDRESS"));
    const whatsappConfigured = Boolean(this.config.get<boolean>("WHATSAPP_ENABLED", false) && this.config.get<string>("WHATSAPP_PHONE_NUMBER_ID") && this.config.get<string>("WHATSAPP_ACCESS_TOKEN"));
    return {
      in_app: { supported: true, configured: true, reason: null },
      push: { supported: true, configured: pushConfigured, reason: pushConfigured ? null : "Push provider is not configured." },
      email: { supported: true, configured: emailConfigured, reason: emailConfigured ? null : "Email provider is not configured." },
      whatsapp: { supported: true, configured: whatsappConfigured, reason: whatsappConfigured ? null : "WhatsApp provider is not configured." },
      sms: { supported: false, configured: false, reason: "SMS delivery is not supported." },
    };
  }

  private alerts(input: { criticalOverdueIssues: number; overdueIssues: number; pushConfigured: boolean; dismissedBanners: Record<string, string> }) {
    const alerts: Array<{ id: string; level: "CRITICAL" | "WARNING" | "INFO" | "SUCCESS"; title: string; message: string; dismissible: boolean; action: { label: string; href: string } | null; dismissedAt: string | null }> = [];
    if (input.criticalOverdueIssues > 0) alerts.push({ id: "critical-overdue-issues", level: "CRITICAL", title: "Critical issues are overdue", message: `${input.criticalOverdueIssues} critical issue${input.criticalOverdueIssues === 1 ? " is" : "s are"} beyond the resolution deadline.`, dismissible: false, action: { label: "View issues", href: "/issues" }, dismissedAt: null });
    else if (input.overdueIssues > 0) alerts.push({ id: "overdue-issues", level: "WARNING", title: "Issue resolution is overdue", message: `${input.overdueIssues} issue${input.overdueIssues === 1 ? " requires" : "s require"} attention.`, dismissible: true, action: { label: "View issues", href: "/issues" }, dismissedAt: activeBannerDismissal(input.dismissedBanners["overdue-issues"], 24) });
    if (!input.pushConfigured) alerts.push({ id: "push-not-configured", level: "WARNING", title: "Push notifications are not configured", message: "Critical alerts may not reach this device outside the portal.", dismissible: true, action: { label: "Open notification settings", href: "/settings/notifications" }, dismissedAt: activeBannerDismissal(input.dismissedBanners["push-not-configured"], 7 * 24) });
    return alerts;
  }
}
