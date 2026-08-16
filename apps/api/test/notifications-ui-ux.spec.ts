import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AuthPrincipal } from "../src/common/http/request-context";
import type { PrismaService } from "../src/database/prisma.service";
import { NotificationsService } from "../src/modules/notifications/notifications.service";
import { NotificationQueryDto } from "../src/modules/notifications/dto/notification-query.dto";
import {
  activeBannerDismissal,
  mergeNotificationPreferences,
  normalizeNotificationPreferences,
} from "../src/modules/notifications/notification-preferences";

const user: AuthPrincipal = {
  id: "00000000-0000-4000-8000-000000000001",
  publicId: "00000000-0000-4000-8000-000000000002",
  collegeId: "00000000-0000-4000-8000-000000000003",
  fullName: "Maintenance User",
  email: "maintenance@example.edu",
  status: "ACTIVE",
  mustChangePassword: false,
  sessionId: "00000000-0000-4000-8000-000000000004",
  roles: ["MAINTENANCE_STAFF"],
  permissions: [
    "notifications.read_own",
    "issues.read_assigned",
    "issues.acknowledge",
    "issues.start",
  ],
  scopes: [{ type: "ASSIGNED_ISSUES", id: null, issueCategoryId: null }],
};

const issue = {
  id: "00000000-0000-4000-8000-000000000010",
  issueNumber: "AVS-ISS-2026-000148",
  title: "Electrical failure",
  status: "ASSIGNED",
  priority: "CRITICAL",
  acknowledgedAt: null,
  resolutionDueAt: new Date("2026-08-15T00:00:00.000Z"),
  escalationLevel: 1,
  assignedToId: user.id,
  assignedTo: { fullName: user.fullName },
  team: { name: "Electrical", members: [{ id: "member-1" }] },
  category: { name: "Electrical" },
  campus: { name: "Main Campus" },
  block: { name: "Block B" },
  floor: { name: "Floor 2" },
  room: { name: "Room 204" },
  area: null,
  customAreaName: null,
};

describe("notification query compatibility", () => {
  it("keeps accepting legacy integer ranges before service-side clamping", async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    await expect(
      pipe.transform(
        { page: "0", pageSize: "500" },
        { type: "query", metatype: NotificationQueryDto },
      ),
    ).resolves.toEqual(expect.objectContaining({ page: 0, pageSize: 500 }));
  });
});

function setup(config: Record<string, unknown> = {}) {
  const prisma = {
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    ),
    notificationRecipient: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    issue: { findMany: jest.fn(), count: jest.fn() },
    user: { findUniqueOrThrow: jest.fn() },
    college: { findUniqueOrThrow: jest.fn() },
  };
  const access = {
    issueWhere: jest.fn(() => ({
      collegeId: user.collegeId,
      archivedAt: null,
    })),
    assignedIssueWhere: jest.fn(() => ({
      collegeId: user.collegeId,
      archivedAt: null,
      assignedToId: user.id,
    })),
  };
  const configuration = {
    get: jest.fn((key: string, fallback?: unknown) => config[key] ?? fallback),
  };
  return {
    prisma,
    access,
    service: new NotificationsService(
      prisma as unknown as PrismaService,
      access as never,
      configuration as unknown as ConfigService,
    ),
  };
}

describe("notification UI/UX backend contract", () => {
  afterEach(() => jest.useRealTimers());

  it("filters urgent notifications with structured priority and adds scoped issue context plus safe actions", async () => {
    const { service, prisma } = setup();
    prisma.notificationRecipient.findMany.mockResolvedValue([
      {
        id: "00000000-0000-4000-8000-000000000020",
        readAt: null,
        createdAt: new Date("2026-08-15T01:00:00.000Z"),
        notification: {
          type: "ISSUE_ESCALATED",
          title: "Acknowledgement overdue",
          body: "Please acknowledge this issue.",
          priority: "CRITICAL",
          relatedEntityType: "Issue",
          relatedEntityId: issue.id,
          data: null,
          createdAt: new Date("2026-08-15T01:00:00.000Z"),
        },
      },
    ]);
    prisma.notificationRecipient.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    prisma.issue.findMany.mockResolvedValue([issue]);

    const result = await service.list(user, {
      page: 1,
      pageSize: 20,
      filter: "urgent",
      sort: "priority",
    });

    expect(prisma.notificationRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              notification: {
                priority: { in: ["HIGH", "CRITICAL", "EMERGENCY"] },
              },
            },
          ]),
        }),
        take: 20,
      }),
    );
    expect(result.data[0]?.notification.context).toEqual(
      expect.objectContaining({
        issueNumber: issue.issueNumber,
        category: "Electrical",
        status: "ASSIGNED",
        location: "Main Campus / Block B / Floor 2 / Room 204",
        isEscalation: true,
      }),
    );
    expect(result.data[0]?.actions.map((action) => action.id)).toEqual([
      "mark_read",
      "view_ticket",
      "acknowledge",
    ]);
  });

  it("does not hint acknowledge/start actions for an unassigned non-team user", async () => {
    const { service, prisma } = setup();
    prisma.notificationRecipient.findMany.mockResolvedValue([
      {
        id: "00000000-0000-4000-8000-000000000021",
        readAt: new Date(),
        createdAt: new Date(),
        notification: {
          type: "ISSUE_ASSIGNED",
          title: "Assigned",
          body: "Assigned",
          priority: "HIGH",
          relatedEntityType: "Issue",
          relatedEntityId: issue.id,
          data: null,
          createdAt: new Date(),
        },
      },
    ]);
    prisma.notificationRecipient.count.mockResolvedValue(1);
    prisma.issue.findMany.mockResolvedValue([
      {
        ...issue,
        assignedToId: "00000000-0000-4000-8000-000000000099",
        team: { name: "Electrical", members: [] },
      },
    ]);

    const result = await service.list(user, {
      page: 1,
      pageSize: 20,
      filter: "all",
      sort: "newest",
    });

    expect(result.data[0]?.actions.map((action) => action.id)).toEqual([
      "view_ticket",
    ]);
  });

  it("uses structured escalation and unread filters without matching notification body text", async () => {
    const escalation = setup();
    escalation.prisma.issue.findMany.mockResolvedValue([{ id: issue.id }]);
    escalation.prisma.notificationRecipient.findMany.mockResolvedValue([]);
    escalation.prisma.notificationRecipient.count.mockResolvedValue(0);

    await escalation.service.list(user, {
      page: 1,
      pageSize: 20,
      filter: "escalations",
      sort: "newest",
    });

    expect(
      escalation.prisma.notificationRecipient.findMany.mock.calls[0]?.[0]
        ?.where,
    ).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          {
            notification: {
              OR: [
                { type: "ISSUE_ESCALATED" },
                {
                  relatedEntityType: "Issue",
                  relatedEntityId: { in: [issue.id] },
                },
              ],
            },
          },
        ]),
      }),
    );

    const unread = setup();
    unread.prisma.notificationRecipient.findMany.mockResolvedValue([]);
    unread.prisma.notificationRecipient.count.mockResolvedValue(0);
    await unread.service.list(user, {
      page: 1,
      pageSize: 20,
      filter: "unread",
      sort: "unread",
    });
    expect(
      unread.prisma.notificationRecipient.findMany.mock.calls[0]?.[0]?.where,
    ).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([{ readAt: null }]),
      }),
    );
    expect(unread.prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it("searches issue number/location/category through scoped structured issue fields", async () => {
    const { service, prisma, access } = setup();
    prisma.issue.findMany.mockResolvedValue([{ id: issue.id }]);
    prisma.notificationRecipient.findMany.mockResolvedValue([]);
    prisma.notificationRecipient.count.mockResolvedValue(0);

    await service.list(user, {
      page: 2,
      pageSize: 10,
      filter: "all",
      search: "Block B",
      sort: "oldest",
    });

    expect(access.issueWhere).toHaveBeenCalledWith(user);
    expect(prisma.issue.findMany.mock.calls[0]?.[0]?.where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { issueNumber: { contains: "Block B", mode: "insensitive" } },
              {
                category: {
                  name: { contains: "Block B", mode: "insensitive" },
                },
              },
              { block: { name: { contains: "Block B", mode: "insensitive" } } },
            ]),
          }),
        ]),
      }),
    );
    expect(prisma.notificationRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        orderBy: [{ createdAt: "asc" }],
      }),
    );
  });

  it("returns scoped real summary metrics and a non-dismissible critical alert", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-15T02:00:00.000Z"));
    const { service, prisma } = setup();
    prisma.college.findUniqueOrThrow.mockResolvedValue({
      timezone: "Asia/Kolkata",
    });
    prisma.issue.findMany
      .mockResolvedValueOnce([{ id: issue.id }])
      .mockResolvedValueOnce([{ id: issue.id }])
      .mockResolvedValueOnce([{ id: issue.id }])
      .mockResolvedValueOnce([
        {
          createdAt: new Date("2026-08-14T00:00:00.000Z"),
          resolvedAt: new Date("2026-08-14T01:00:00.000Z"),
        },
        {
          createdAt: new Date("2026-08-14T00:00:00.000Z"),
          resolvedAt: new Date("2026-08-14T02:00:00.000Z"),
        },
      ]);
    prisma.notificationRecipient.count
      .mockResolvedValueOnce(24)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(4);
    prisma.issue.count
      .mockResolvedValueOnce(18)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      notificationPreferences: {
        in_app: true,
        push: true,
        email: true,
        whatsapp: false,
        dismissed_banners: {
          "push-not-configured": "2026-08-01T00:00:00.000Z",
        },
      },
    });

    const result = await service.summary(user);

    expect(result).toEqual(
      expect.objectContaining({
        all: 24,
        unread: 12,
        urgent: 5,
        escalations: 3,
        pendingIssues: 18,
        overdueIssues: 4,
        unacknowledgedIssues: 6,
        escalatedIssues: 3,
        assignedIssues: 7,
        resolvedToday: 2,
        averageResolutionMinutes: 90,
      }),
    );
    expect(result.alerts[0]).toEqual(
      expect.objectContaining({
        id: "critical-overdue-issues",
        level: "CRITICAL",
        dismissible: false,
        dismissedAt: null,
      }),
    );
    expect(
      result.alerts.find((alert) => alert.id === "push-not-configured")
        ?.dismissedAt,
    ).toBeNull();
    expect(prisma.issue.count.mock.calls[5]?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              resolvedAt: expect.objectContaining({
                gte: new Date("2026-08-14T18:30:00.000Z"),
              }),
            }),
          ]),
        }),
      }),
    );
  });

  it("reports provider capability honestly and normalizes legacy preferences", async () => {
    const { service, prisma } = setup({
      EMAIL_ENABLED: true,
      SMTP_HOST: "smtp.example.edu",
      EMAIL_FROM_ADDRESS: "no-reply@example.edu",
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      notificationPreferences: {
        in_app: true,
        push: false,
        email: true,
        whatsapp: false,
      },
    });

    const result = await service.preferences(user);

    expect(result.channels.email).toEqual({
      supported: true,
      configured: true,
      reason: null,
    });
    expect(result.channels.push).toEqual(
      expect.objectContaining({ supported: true, configured: false }),
    );
    expect(result.channels.sms).toEqual(
      expect.objectContaining({ supported: false, configured: false }),
    );
    expect(result.preferences.quiet_hours).toEqual({
      enabled: false,
      start: "22:00",
      end: "06:00",
      allow_critical: true,
    });
    expect(result.preferences.categories.issue_assignment.in_app).toBe(true);
  });

  it("merges partial dismissals/settings without erasing channels or categories", () => {
    const current = normalizeNotificationPreferences({
      in_app: true,
      push: false,
      email: true,
      whatsapp: false,
      categories: {
        escalations: { in_app: true, push: true, email: true, whatsapp: false },
      },
    });
    const merged = mergeNotificationPreferences(current, {
      dismissed_banners: { "push-not-configured": "2026-08-15T00:00:00.000Z" },
    });

    expect(merged.push).toBe(false);
    expect(merged.categories.escalations.email).toBe(true);
    expect(merged.dismissed_banners).toEqual({
      "push-not-configured": "2026-08-15T00:00:00.000Z",
    });
  });

  it("keeps recent warning dismissals temporarily and expires old dismissals", () => {
    const now = Date.parse("2026-08-15T12:00:00.000Z");
    expect(activeBannerDismissal("2026-08-15T06:00:00.000Z", 24, now)).toBe(
      "2026-08-15T06:00:00.000Z",
    );
    expect(
      activeBannerDismissal("2026-08-13T06:00:00.000Z", 24, now),
    ).toBeNull();
  });
});
