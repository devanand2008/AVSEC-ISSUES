import { Test, TestingModule } from "@nestjs/testing";
import { AnnouncementsService } from "../src/modules/announcements/announcements.service";
import { PrismaService } from "../src/database/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { ConfigService } from "@nestjs/config";
import { IdempotencyService } from "../src/common/idempotency/idempotency.service";

describe("AnnouncementsService", () => {
  let service: AnnouncementsService;
  let prisma: PrismaService;
  let audit: AuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementsService,
        {
          provide: PrismaService,
          useValue: {
            announcement: {
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findMany: jest.fn(),
            },
            announcementReadReceipt: {
              findUnique: jest.fn(),
              update: jest.fn(),
              create: jest.fn(),
              createMany: jest.fn(),
              count: jest.fn(),
              findMany: jest.fn(),
            },
            idempotencyKey: {
              findUnique: jest.fn(),
              create: jest.fn(),
              deleteMany: jest.fn(),
            },
            user: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
            },
            notification: {
              create: jest.fn(),
            },
            notificationRecipient: {
              deleteMany: jest.fn(),
            },
            $transaction: jest.fn((cb) => typeof cb === "function" ? cb(prisma) : cb),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
            getOrThrow: jest.fn().mockReturnValue("mock"),
          },
        },
        {
          provide: AuditService,
          useValue: {
            record: jest.fn(),
          },
        },
        {
          provide: IdempotencyService,
          useValue: {
            hash: jest.fn().mockReturnValue("request-hash"),
            replay: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AnnouncementsService>(AnnouncementsService);
    prisma = module.get<PrismaService>(PrismaService);
    audit = module.get<AuditService>(AuditService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("audience targeting", () => {
    const actor = {
      id: "actor-1",
      collegeId: "college-1",
      roles: ["MAIN_ADMIN"],
      scopes: [],
    } as never;

    it("counts and creates recipients for only the selected active user", async () => {
      const audiences = [
        {
          scopeType: "COLLEGE",
          scopeId: null,
          roleCode: null,
          userId: "selected-user",
        },
      ];
      jest
        .spyOn(prisma.announcement, "findFirst")
        .mockResolvedValue({ audiences } as never);
      jest
        .spyOn(prisma.user, "findMany")
        .mockResolvedValue([{ id: "selected-user" }] as never);

      await expect(
        service.countRecipients(actor, "announcement-1"),
      ).resolves.toEqual({ count: 1 });
      expect(prisma.user.findMany).toHaveBeenLastCalledWith({
        where: {
          collegeId: "college-1",
          status: "ACTIVE",
          AND: [{ OR: [{ id: { in: ["selected-user"] } }] }],
        },
        select: { id: true },
      });

      jest
        .spyOn(prisma.announcementReadReceipt, "createMany")
        .mockResolvedValue({ count: 1 } as never);
      jest
        .spyOn(prisma.announcement, "update")
        .mockResolvedValue({ id: "announcement-1" } as never);
      jest.spyOn(prisma.announcement, "findUnique").mockResolvedValue({
        id: "announcement-1",
        title: "Selected notice",
        message: "Only one user should receive this.",
        priority: "LOW",
      } as never);
      jest
        .spyOn(prisma.notification, "create")
        .mockResolvedValue({ id: "notification-1" } as never);

      await expect(
        service.createRecipientsInline(
          "announcement-1",
          "college-1",
          audiences,
        ),
      ).resolves.toBe(1);
      expect(prisma.announcementReadReceipt.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            announcementId: "announcement-1",
            userId: "selected-user",
          }),
        ],
        skipDuplicates: true,
      });
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          recipients: { create: [{ userId: "selected-user" }] },
        }),
      });
    });

    it("keeps a role audience restricted to active users with that current role", async () => {
      const audiences = [
        {
          scopeType: "COLLEGE",
          scopeId: null,
          roleCode: "STUDENT",
          userId: null,
        },
      ];
      jest
        .spyOn(prisma.announcement, "findFirst")
        .mockResolvedValue({ audiences } as never);
      jest
        .spyOn(prisma.user, "findMany")
        .mockResolvedValue([{ id: "student-1" }] as never);

      await expect(
        service.countRecipients(actor, "announcement-1"),
      ).resolves.toEqual({ count: 1 });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          collegeId: "college-1",
          status: "ACTIVE",
          AND: [
            {
              OR: [
                {
                  roles: {
                    some: {
                      validFrom: { lte: expect.any(Date) },
                      OR: [
                        { validUntil: null },
                        { validUntil: { gt: expect.any(Date) } },
                      ],
                      role: { code: { in: ["STUDENT"] }, isActive: true },
                    },
                  },
                },
              ],
            },
          ],
        },
        select: { id: true },
      });
    });

    it("does not create delivery residue after an archive wins the publishing claim", async () => {
      jest
        .spyOn(prisma.announcement, "updateMany")
        .mockResolvedValue({ count: 0 } as never);

      await expect(
        service.createRecipientsInline("announcement-1", "college-1", []),
      ).resolves.toBe(0);

      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.announcementReadReceipt.createMany).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(prisma.announcement.update).not.toHaveBeenCalled();
    });

    it("treats only an unqualified COLLEGE audience as college-wide", async () => {
      const audiences = [
        { scopeType: "COLLEGE", scopeId: null, roleCode: null, userId: null },
      ];
      jest
        .spyOn(prisma.announcement, "findFirst")
        .mockResolvedValue({ audiences } as never);
      jest
        .spyOn(prisma.user, "findMany")
        .mockResolvedValue([{ id: "user-1" }, { id: "user-2" }] as never);

      await expect(
        service.countRecipients(actor, "announcement-1"),
      ).resolves.toEqual({ count: 2 });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { collegeId: "college-1", status: "ACTIVE", AND: [{}] },
        select: { id: true },
      });
    });

    it("keeps list visibility predicates distinct for college, user, role, and scope audiences", async () => {
      jest.spyOn(prisma.announcement, "findMany").mockResolvedValue([]);
      const viewer = {
        id: "viewer-1",
        collegeId: "college-1",
        roles: ["STUDENT"],
        scopes: [{ type: "SECTION", id: "section-1", issueCategoryId: null }],
      } as never;

      await service.list(viewer);

      expect(prisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            audiences: {
              some: {
                OR: [
                  {
                    scopeType: "COLLEGE",
                    userId: null,
                    roleCode: null,
                    OR: [{ scopeId: null }, { scopeId: "college-1" }],
                  },
                  {
                    scopeType: "COLLEGE",
                    scopeId: null,
                    userId: "viewer-1",
                    roleCode: null,
                  },
                  {
                    scopeType: "COLLEGE",
                    scopeId: null,
                    userId: null,
                    roleCode: { in: ["STUDENT"] },
                  },
                  {
                    scopeType: "SECTION",
                    scopeId: "section-1",
                    userId: null,
                    roleCode: null,
                  },
                ],
              },
            },
          }),
        }),
      );
    });

    it("targets legacy publish receipts and notifications to the selected audience", async () => {
      const audiences = [
        {
          scopeType: "COLLEGE",
          scopeId: null,
          roleCode: null,
          userId: "selected-user",
        },
      ];
      jest.spyOn(prisma.announcement, "findFirst").mockResolvedValue({
        id: "announcement-1",
        status: "DRAFT",
        title: "Selected notice",
        message: "Only the selected user is notified.",
        priority: "LOW",
        publishAt: null,
        audiences,
      } as never);
      jest.spyOn(prisma.announcement, "update").mockResolvedValue({
        id: "announcement-1",
        title: "Selected notice",
        message: "Only the selected user is notified.",
        priority: "LOW",
      } as never);
      jest
        .spyOn(prisma.user, "findMany")
        .mockResolvedValue([{ id: "selected-user" }] as never);
      jest
        .spyOn(prisma.notification, "create")
        .mockResolvedValue({ id: "notification-1" } as never);

      await service.publish(actor, "announcement-1");

      expect(prisma.announcement.updateMany).toHaveBeenCalledWith({
        where: {
          id: "announcement-1",
          collegeId: "college-1",
          status: "DRAFT",
        },
        data: { status: "PUBLISHING" },
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          collegeId: "college-1",
          status: "ACTIVE",
          AND: [{ OR: [{ id: { in: ["selected-user"] } }] }],
        },
        select: { id: true },
      });
      expect(prisma.announcementReadReceipt.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            announcementId: "announcement-1",
            userId: "selected-user",
            deliveryStatus: "DELIVERED",
            firstDeliveredAt: expect.any(Date),
          }),
        ],
        skipDuplicates: true,
      });
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          recipients: { create: [{ userId: "selected-user" }] },
        }),
      });
      expect(prisma.announcement.update).toHaveBeenCalledWith({
        where: { id: "announcement-1" },
        data: expect.objectContaining({
          status: "PUBLISHED",
          totalRecipients: 1,
        }),
      });
      expect(
        (prisma.announcement.updateMany as jest.Mock).mock
          .invocationCallOrder[0]!,
      ).toBeLessThan(
        (prisma.notification.create as jest.Mock).mock.invocationCallOrder[0]!,
      );
    });

    it("rejects a legacy publish that loses its atomic claim to another publish path", async () => {
      jest.spyOn(prisma.announcement, "findFirst").mockResolvedValue({
        id: "announcement-1",
        status: "DRAFT",
        title: "Race-safe notice",
        message: "Only one publisher may proceed.",
        priority: "LOW",
        publishAt: null,
        audiences: [
          {
            scopeType: "COLLEGE",
            scopeId: null,
            roleCode: null,
            userId: "selected-user",
          },
        ],
      } as never);
      jest
        .spyOn(prisma.announcement, "updateMany")
        .mockResolvedValue({ count: 0 } as never);

      await expect(service.publish(actor, "announcement-1")).rejects.toThrow(
        "This announcement has already been published or changed. Refresh and try again.",
      );

      expect(prisma.announcement.updateMany).toHaveBeenCalledWith({
        where: {
          id: "announcement-1",
          collegeId: "college-1",
          status: "DRAFT",
        },
        data: { status: "PUBLISHING" },
      });
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.announcementReadReceipt.createMany).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it("uses the same atomic claim for send-all so it cannot race legacy publish", async () => {
      const audiences = [
        {
          scopeType: "COLLEGE",
          scopeId: null,
          roleCode: null,
          userId: "selected-user",
        },
      ];
      jest.spyOn(prisma.announcement, "findFirst").mockResolvedValue({
        id: "announcement-1",
        status: "DRAFT",
        audiences,
      } as never);
      jest
        .spyOn(prisma.user, "findMany")
        .mockResolvedValue([{ id: "selected-user" }] as never);
      jest
        .spyOn(prisma.announcement, "updateMany")
        .mockResolvedValue({ count: 0 } as never);

      await expect(
        service.sendAll(actor, "announcement-1", "request-1"),
      ).rejects.toThrow(
        "This announcement has already been sent or changed. Refresh and try again.",
      );

      expect(prisma.announcement.updateMany).toHaveBeenCalledWith({
        where: {
          id: "announcement-1",
          collegeId: "college-1",
          status: "DRAFT",
        },
        data: {
          status: "PUBLISHING",
          publishAt: expect.any(Date),
          publishedAt: expect.any(Date),
        },
      });
      expect(prisma.announcementReadReceipt.createMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("falls back to inline delivery when Redis cannot accept the claimed job", async () => {
      const audiences = [
        {
          scopeType: "COLLEGE",
          scopeId: null,
          roleCode: null,
          userId: "selected-user",
        },
      ];
      jest.spyOn(prisma.announcement, "findFirst").mockResolvedValue({
        id: "announcement-1",
        status: "DRAFT",
        audiences,
      } as never);
      jest
        .spyOn(prisma.user, "findMany")
        .mockResolvedValue([{ id: "selected-user" }] as never);
      const inline = jest
        .spyOn(service, "createRecipientsInline")
        .mockResolvedValue(1);
      const add = jest
        .fn()
        .mockRejectedValue(new Error("Redis is temporarily unavailable"));
      Object.assign(service, { recipientQueue: { add } });

      await expect(
        service.sendAll(actor, "announcement-1", "request-1"),
      ).resolves.toMatchObject({ status: "PUBLISHING" });

      expect(add).toHaveBeenCalledTimes(1);
      expect(inline).toHaveBeenCalledWith(
        "announcement-1",
        "college-1",
        audiences,
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "announcement.sent_all" }),
      );
    });

    it("marks a failed inline fallback and removes its idempotent replay", async () => {
      const audiences = [
        {
          scopeType: "COLLEGE",
          scopeId: null,
          roleCode: null,
          userId: "selected-user",
        },
      ];
      jest.spyOn(prisma.announcement, "findFirst").mockResolvedValue({
        id: "announcement-1",
        status: "DRAFT",
        audiences,
      } as never);
      jest
        .spyOn(prisma.user, "findMany")
        .mockResolvedValue([{ id: "selected-user" }] as never);
      jest
        .spyOn(service, "createRecipientsInline")
        .mockRejectedValue(new Error("inline delivery failed"));
      Object.assign(service, {
        recipientQueue: {
          add: jest
            .fn()
            .mockRejectedValue(new Error("Redis is temporarily unavailable")),
        },
      });

      await expect(
        service.sendAll(
          actor,
          "announcement-1",
          "request-1",
          "announcement-key-1",
        ),
      ).rejects.toThrow("inline delivery failed");

      expect(prisma.announcement.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: "announcement-1",
          collegeId: "college-1",
          status: "PUBLISHING",
        },
        data: { status: "FAILED" },
      });
      expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledWith({
        where: {
          actorId: "actor-1",
          endpoint: "/announcements/announcement-1/send-all",
          key: "announcement-key-1",
        },
      });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("does not republish an announcement already completed by either delivery path", async () => {
      jest.spyOn(prisma.announcement, "findFirst").mockResolvedValue({
        id: "announcement-1",
        status: "PUBLISHED",
        audiences: [],
      } as never);

      await expect(service.publish(actor, "announcement-1")).rejects.toThrow(
        "This announcement has already been published.",
      );
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.announcementReadReceipt.createMany).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe("archive", () => {
    it("archives transactionally and suppresses recipients without deleting delivery-attempt history", async () => {
      const actor = {
        id: "actor-1",
        collegeId: "college-1",
        roles: ["MAIN_ADMIN"],
        scopes: [],
      } as never;
      jest.spyOn(prisma.announcement, "findFirst").mockResolvedValue({
        id: "announcement-1",
        status: "PUBLISHED",
      } as never);
      jest
        .spyOn(prisma.notificationRecipient, "deleteMany")
        .mockResolvedValue({ count: 1 } as never);

      await expect(
        service.archive(actor, "announcement-1", "request-1"),
      ).resolves.toMatchObject({
        id: "announcement-1",
        status: "ARCHIVED",
      });

      expect(prisma.announcement.updateMany).toHaveBeenCalledWith({
        where: {
          id: "announcement-1",
          collegeId: "college-1",
          status: "PUBLISHED",
        },
        data: { status: "ARCHIVED", archivedAt: expect.any(Date) },
      });

      expect(prisma.notificationRecipient.deleteMany).toHaveBeenCalledWith({
        where: {
          notification: {
            relatedEntityType: "Announcement",
            relatedEntityId: "announcement-1",
          },
        },
      });
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorId: "actor-1",
          collegeId: "college-1",
          action: "announcement.archived",
          entityType: "Announcement",
          entityId: "announcement-1",
          requestId: "request-1",
        },
        prisma,
      );
    });

    it("requires an active delivery to settle before archiving", async () => {
      const actor = {
        id: "actor-1",
        collegeId: "college-1",
        roles: ["MAIN_ADMIN"],
        scopes: [],
      } as never;
      jest.spyOn(prisma.announcement, "findFirst").mockResolvedValue({
        id: "announcement-1",
        status: "PUBLISHING",
      } as never);

      await expect(
        service.archive(actor, "announcement-1", "request-1"),
      ).rejects.toThrow(
        "This announcement is still being delivered. Wait for delivery to finish before archiving it.",
      );
      expect(prisma.announcement.updateMany).not.toHaveBeenCalled();
      expect(prisma.notificationRecipient.deleteMany).not.toHaveBeenCalled();
    });
  });
  describe("markDisplay", () => {
    it("should mark announcement as displayed if not already displayed", async () => {
      const receipt = { announcementId: "a1", userId: "u1", firstDisplayedAt: null };
      jest.spyOn(prisma.announcementReadReceipt, "findUnique").mockResolvedValue(receipt as never);
      jest.spyOn(prisma.announcementReadReceipt, "update").mockResolvedValue({ ...receipt, firstDisplayedAt: new Date() } as never);

      await service.markDisplay({ id: "u1", collegeId: "c1", roles: [], scopes: [] } as never, "a1");
      expect(prisma.announcementReadReceipt.update).toHaveBeenCalledWith({
        where: { announcementId_userId: { announcementId: "a1", userId: "u1" } },
        data: expect.objectContaining({ deliveryStatus: "DISPLAYED" }),
      });
    });
  });

  describe("markViewed", () => {
    it("should mark announcement as viewed without incrementing manual open count", async () => {
      const receipt = { announcementId: "a1", userId: "u1", firstViewedAt: null, openCount: 0 };
      jest.spyOn(prisma.announcementReadReceipt, "findUnique").mockResolvedValue(receipt as never);
      jest.spyOn(prisma.announcementReadReceipt, "update").mockResolvedValue({ ...receipt, firstViewedAt: new Date(), openCount: 0 } as never);

      await service.markViewed({ id: "u1", collegeId: "c1", roles: [], scopes: [] } as never, "a1");
      expect(prisma.announcementReadReceipt.update).toHaveBeenCalledWith({
        where: { announcementId_userId: { announcementId: "a1", userId: "u1" } },
        data: expect.not.objectContaining({ openCount: { increment: 1 } }),
      });
    });
  });
});
