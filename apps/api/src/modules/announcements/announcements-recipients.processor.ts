import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job, Queue, Worker } from "bullmq";
import { PrismaService } from "../../database/prisma.service";
import { AnnouncementsService, type RecipientJob } from "./announcements.service";

const QUEUE_NAME = "announcement-recipients";

@Injectable()
export class AnnouncementRecipientsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnnouncementRecipientsProcessor.name);
  private readonly connection: { host: string; port: number; username?: string; password?: string; tls?: Record<string, never> };
  private readonly queue: Queue<RecipientJob, void, string>;
  private worker?: Worker<RecipientJob, void, string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => AnnouncementsService))
    private readonly announcementsService: AnnouncementsService,
  ) {
    const redisUrl = new URL(config.getOrThrow<string>("REDIS_URL"));
    this.connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      ...(redisUrl.username ? { username: redisUrl.username } : {}),
      ...(redisUrl.password ? { password: redisUrl.password } : {}),
      ...(redisUrl.protocol === "rediss:" ? { tls: {} } : {}),
    };
    this.queue = new Queue<RecipientJob, void, string>(QUEUE_NAME, { connection: this.connection });
  }

  onModuleInit(): void {
    this.worker = new Worker<RecipientJob, void, string>(
      QUEUE_NAME,
      (job) => this.process(job),
      { connection: this.connection, concurrency: 2 },
    );
    this.worker.on("failed", (job, error) => {
      this.logger.error({ jobId: job?.id, error: error.message }, "Announcement recipient job failed");
    });
    this.worker.on("error", (error) => {
      this.logger.error({ error: error.message }, "Recipient worker connection error");
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }

  private async process(job: Job<RecipientJob>): Promise<void> {
    const { announcementId, collegeId } = job.data;
    this.logger.log({ announcementId }, "Processing announcement recipients");

    try {
      const announcement = await this.prisma.announcement.findUnique({
        where: { id: announcementId },
        include: { audiences: true },
      });
      if (!announcement) {
        this.logger.warn({ announcementId }, "Announcement not found — skipping");
        return;
      }

      if (announcement.status !== "PUBLISHING") {
        this.logger.log(
          { announcementId, status: announcement.status },
          "Announcement is no longer publishing; skipping recipient job",
        );
        return;
      }

      const created = await this.announcementsService.createRecipientsInline(
        announcementId,
        collegeId,
        announcement.audiences,
      );

      this.logger.log({ announcementId, created }, "Recipient records created successfully");
    } catch (error) {
      this.logger.error({ announcementId, error: error instanceof Error ? error.message : error }, "Failed to create recipients");
      const maxAttempts = job.opts.attempts ?? 1;
      const isTerminalAttempt = job.attemptsMade + 1 >= maxAttempts;
      if (isTerminalAttempt) {
        await this.prisma.$transaction(async (tx) => {
          const failed = await tx.announcement.updateMany({
            where: { id: announcementId, status: "PUBLISHING" },
            data: { status: "FAILED" },
          });
          if (failed.count === 1) {
            await tx.idempotencyKey.deleteMany({
              where: {
                endpoint: `/announcements/${announcementId}/send-all`,
                resourceId: announcementId,
              },
            });
          }
        }).catch(() => undefined);
      }
      throw error;
    }
  }
}
