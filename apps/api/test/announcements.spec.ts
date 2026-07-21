import { Test, TestingModule } from "@nestjs/testing";
import { AnnouncementsService } from "../src/modules/announcements/announcements.service";
import { PrismaService } from "../src/database/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { ConfigService } from "@nestjs/config";
import { IdempotencyService } from "../src/common/idempotency/idempotency.service";

describe("AnnouncementsService", () => {
  let service: AnnouncementsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementsService,
        {
          provide: PrismaService,
          useValue: {
            announcement: {
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
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
            },
            user: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
            },
            notification: {
              create: jest.fn(),
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
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
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
