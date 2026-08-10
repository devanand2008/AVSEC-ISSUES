import type { Job } from "bullmq";
import { AnnouncementRecipientsProcessor } from "../src/modules/announcements/announcements-recipients.processor";
import type { RecipientJob } from "../src/modules/announcements/announcements.service";

function createHarness(status = "PUBLISHING") {
  const prisma = {
    announcement: {
      findUnique: jest.fn().mockResolvedValue({
        id: "announcement-1",
        status,
        audiences: [],
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    idempotencyKey: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (work: (tx: typeof prisma) => unknown) => work(prisma),
  );
  const announcementsService = {
    createRecipientsInline: jest.fn().mockResolvedValue(1),
  };
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const processor = Object.create(
    AnnouncementRecipientsProcessor.prototype,
  ) as AnnouncementRecipientsProcessor;
  Object.assign(processor, { prisma, announcementsService, logger });

  const process = (attemptsMade = 0, attempts = 3) =>
    (
      processor as unknown as {
        process(job: Job<RecipientJob>): Promise<void>;
      }
    ).process({
      data: { announcementId: "announcement-1", collegeId: "college-1" },
      attemptsMade,
      opts: { attempts },
    } as Job<RecipientJob>);

  return { announcementsService, logger, prisma, process };
}

describe("AnnouncementRecipientsProcessor", () => {
  it("skips a queued job after the announcement has left PUBLISHING", async () => {
    const { announcementsService, prisma, process } = createHarness("ARCHIVED");

    await expect(process()).resolves.toBeUndefined();

    expect(announcementsService.createRecipientsInline).not.toHaveBeenCalled();
    expect(prisma.announcement.updateMany).not.toHaveBeenCalled();
  });

  it("keeps PUBLISHING on a retryable failure so BullMQ can retry", async () => {
    const { announcementsService, prisma, process } = createHarness();
    announcementsService.createRecipientsInline.mockRejectedValue(
      new Error("temporary database failure"),
    );

    await expect(process(0, 3)).rejects.toThrow("temporary database failure");

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.announcement.updateMany).not.toHaveBeenCalled();
    expect(prisma.idempotencyKey.deleteMany).not.toHaveBeenCalled();
  });

  it("marks only a still-publishing terminal failure and clears its replay", async () => {
    const { announcementsService, prisma, process } = createHarness();
    announcementsService.createRecipientsInline.mockRejectedValue(
      new Error("persistent database failure"),
    );

    await expect(process(2, 3)).rejects.toThrow("persistent database failure");

    expect(prisma.announcement.updateMany).toHaveBeenCalledWith({
      where: { id: "announcement-1", status: "PUBLISHING" },
      data: { status: "FAILED" },
    });
    expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledWith({
      where: {
        endpoint: "/announcements/announcement-1/send-all",
        resourceId: "announcement-1",
      },
    });
  });
});
