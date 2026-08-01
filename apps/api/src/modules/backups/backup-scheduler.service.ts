import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job, Queue, Worker } from "bullmq";
import { PrismaService } from "../../database/prisma.service";
import {
  BackupsService,
  type BackupCreationType,
} from "./backups.service";

const QUEUE_NAME = "database-backups";
const SCHEDULE_TIME_ZONE = "Asia/Kolkata";
const POLL_INTERVAL_MS = 15 * 60 * 1000;

type ScheduledBackupType = Extract<
  BackupCreationType,
  "DAILY" | "WEEKLY" | "MONTHLY"
>;

type BackupScheduleJob = {
  actorId: string;
  collegeId: string;
  dayKey: string;
  backupType: ScheduledBackupType;
};

export type BackupScheduleSlot = {
  dayKey: string;
  dueTypes: ScheduledBackupType[];
};

export function backupScheduleDayRange(dayKey: string): {
  start: Date;
  end: Date;
} {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(dayKey)) {
    throw new Error("The backup schedule date is invalid.");
  }
  const start = new Date(`${dayKey}T00:00:00+05:30`);
  if (Number.isNaN(start.getTime())) {
    throw new Error("The backup schedule date is invalid.");
  }
  const canonical = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(start);
  if (canonical !== dayKey) {
    throw new Error("The backup schedule date is invalid.");
  }
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function localParts(now: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: SCHEDULE_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function backupScheduleSlot(
  now: Date,
  scheduledHour: number,
): BackupScheduleSlot | null {
  if (
    !Number.isInteger(scheduledHour) ||
    scheduledHour < 0 ||
    scheduledHour > 23
  ) {
    throw new Error("The backup schedule hour is invalid.");
  }
  const parts = localParts(now);
  if (Number(parts.hour) !== scheduledHour) return null;
  const dayKey = `${parts.year}-${parts.month}-${parts.day}`;
  const dueTypes: ScheduledBackupType[] = ["DAILY"];
  if (parts.weekday === "Sun") dueTypes.push("WEEKLY");
  if (parts.day === "01") dueTypes.push("MONTHLY");
  return { dayKey, dueTypes };
}

@Injectable()
export class BackupSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BackupSchedulerService.name);
  private queue?: Queue<BackupScheduleJob, void, string>;
  private worker?: Worker<BackupScheduleJob, void, string>;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly backups: BackupsService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>("BACKUP_SCHEDULE_ENABLED", false)) return;
    const connection = this.redisConnection();
    this.queue = new Queue<BackupScheduleJob, void, string>(QUEUE_NAME, {
      connection,
    });
    this.worker = new Worker<BackupScheduleJob, void, string>(
      QUEUE_NAME,
      (job) => this.process(job),
      { connection, concurrency: 1 },
    );
    this.queue.on("error", (error) => {
      this.logger.error(
        { error: error.message },
        "Backup queue connection error",
      );
    });
    this.worker.on("error", (error) => {
      this.logger.error(
        { error: error.message },
        "Backup worker connection error",
      );
    });
    this.worker.on("failed", (job, error) => {
      this.logger.error(
        {
          jobId: job?.id,
          backupType: job?.data.backupType,
          error: error.message,
        },
        "Scheduled database backup failed",
      );
    });
    void this.enqueueDueBackups();
    this.timer = setInterval(() => {
      void this.enqueueDueBackups();
    }, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    await this.queue?.close();
  }

  async enqueueDueBackups(now = new Date()): Promise<number> {
    if (!this.queue) return 0;
    const hour = this.config.get<number>("BACKUP_SCHEDULE_HOUR", 2);
    const slot = backupScheduleSlot(now, hour);
    if (!slot) return 0;
    const connections = await this.prisma.storageConnection.findMany({
      where: {
        provider: "GOOGLE_DRIVE",
        status: "CONNECTED",
        revokedAt: null,
        createdById: { not: null },
      },
      select: {
        collegeId: true,
        createdById: true,
        createdBy: {
          select: { status: true, archivedAt: true },
        },
      },
    });
    let queued = 0;
    for (const connection of connections) {
      if (
        !connection.createdById ||
        connection.createdBy?.status !== "ACTIVE" ||
        connection.createdBy.archivedAt
      ) {
        continue;
      }
      for (const backupType of slot.dueTypes) {
        const jobId = [
          "backup",
          connection.collegeId,
          slot.dayKey,
          backupType.toLowerCase(),
        ].join("-");
        await this.queue.add(
          "scheduled-backup",
          {
            actorId: connection.createdById,
            collegeId: connection.collegeId,
            dayKey: slot.dayKey,
            backupType,
          },
          {
            jobId,
            attempts: 1,
            removeOnComplete: 500,
            removeOnFail: 500,
          },
        );
        queued += 1;
      }
    }
    return queued;
  }

  private async process(job: Job<BackupScheduleJob, void, string>): Promise<void> {
    const scheduleDay = backupScheduleDayRange(job.data.dayKey);
    const connection = await this.prisma.storageConnection.findFirst({
      where: {
        collegeId: job.data.collegeId,
        provider: "GOOGLE_DRIVE",
        status: "CONNECTED",
        revokedAt: null,
        createdById: job.data.actorId,
        createdBy: {
          status: "ACTIVE",
          archivedAt: null,
        },
      },
      select: { id: true },
    });
    if (!connection) {
      throw new Error(
        "The scheduled backup owner or Drive connection is no longer active.",
      );
    }
    const existing = await this.prisma.databaseBackup.findFirst({
      where: {
        collegeId: job.data.collegeId,
        backupType: job.data.backupType,
        createdAt: {
          gte: scheduleDay.start,
          lt: scheduleDay.end,
        },
      },
      select: { id: true },
    });
    if (existing) return;
    await this.backups.createScheduled(
      { id: job.data.actorId, collegeId: job.data.collegeId },
      job.id ?? `scheduled-${job.data.dayKey}`,
      job.data.backupType,
    );
  }

  private redisConnection(): {
    host: string;
    port: number;
    username?: string;
    password?: string;
    tls?: Record<string, never>;
  } {
    const redisUrl = new URL(this.config.getOrThrow<string>("REDIS_URL"));
    return {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      ...(redisUrl.username ? { username: redisUrl.username } : {}),
      ...(redisUrl.password ? { password: redisUrl.password } : {}),
      ...(redisUrl.protocol === "rediss:" ? { tls: {} } : {}),
    };
  }
}
