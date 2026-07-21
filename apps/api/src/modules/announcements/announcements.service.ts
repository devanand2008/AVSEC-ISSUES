import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import type { Readable } from "node:stream";
import { Queue } from "bullmq";
import { addHours } from "date-fns";
import type { AuthPrincipal } from "../../common/http/request-context";
import { IdempotencyService } from "../../common/idempotency/idempotency.service";
import { PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { AuditService } from "../audit/audit.service";
import type {
  CompleteAnnouncementImageDto,
  CreateAnnouncementDto,
  PresignAnnouncementImageDto,
  RecipientQueryDto,
  UpdateAnnouncementDto,
} from "./dto/announcement.dto";

const ALLOWED_IMAGE_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};

const PRIORITY_ORDER: Record<string, number> = {
  EMERGENCY: 0,
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
};

export interface RecipientJob {
  announcementId: string;
  collegeId: string;
}

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private recipientQueue?: Queue<RecipientJob, void, string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {
    this.bucket = config.getOrThrow<string>("S3_BUCKET");
    this.s3 = new S3Client({
      endpoint: config.getOrThrow<string>("S3_ENDPOINT"),
      region: config.get<string>("S3_REGION", "us-east-1"),
      forcePathStyle: config.get<boolean>("S3_FORCE_PATH_STYLE", true),
      credentials: {
        accessKeyId: config.getOrThrow<string>("S3_ACCESS_KEY"),
        secretAccessKey: config.getOrThrow<string>("S3_SECRET_KEY"),
      },
    });
    try {
      const redisUrl = new URL(config.getOrThrow<string>("REDIS_URL"));
      const connection = {
        host: redisUrl.hostname,
        port: Number(redisUrl.port || 6379),
        ...(redisUrl.username ? { username: redisUrl.username } : {}),
        ...(redisUrl.password ? { password: redisUrl.password } : {}),
        ...(redisUrl.protocol === "rediss:" ? { tls: {} } : {}),
      };
      this.recipientQueue = new Queue<RecipientJob, void, string>("announcement-recipients", { connection });
    } catch {
      this.logger.warn("REDIS_URL not configured — announcement recipient batching unavailable");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // READ — user-facing list (existing behaviour preserved)
  // ─────────────────────────────────────────────────────────────────────────────

  async list(user: AuthPrincipal) {
    const audience = this.audienceWhere(user);
    const announcements = await this.prisma.announcement.findMany({
      where: {
        collegeId: user.collegeId,
        status: "PUBLISHED",
        OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
        audiences: { some: { OR: audience } },
      },
      include: {
        author: { select: { publicId: true, fullName: true } },
        reads: {
          where: { userId: user.id },
          select: {
            readAt: true,
            acknowledgedAt: true,
            firstViewedAt: true,
            deliveryStatus: true,
            openCount: true,
          },
        },
      },
      orderBy: [{ pinned: "desc" }, { publishAt: "desc" }, { createdAt: "desc" }],
    });
    return Promise.all(
      announcements.map(async (announcement) => ({
        ...announcement,
        imageUrl: await this.getSignedImageUrl(announcement.imageStorageKey),
      })),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PENDING — unseen auto-display announcements for current user
  // ─────────────────────────────────────────────────────────────────────────────

  async getPending(user: AuthPrincipal) {
    const receipts = await this.prisma.announcementReadReceipt.findMany({
      where: {
        userId: user.id,
        firstViewedAt: null,
        deliveryStatus: { not: "EXPIRED" },
        announcement: {
          collegeId: user.collegeId,
          status: "PUBLISHED",
          showOnAppOpen: true,
          OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }],
          AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
        },
      },
      include: {
        announcement: {
          include: {
            author: { select: { fullName: true } },
          },
        },
      },
      orderBy: [
        { announcement: { priority: "asc" } },
        { announcement: { publishAt: "asc" } },
      ],
    });

    return Promise.all(receipts
      .sort(
        (a, b) =>
          (PRIORITY_ORDER[a.announcement.priority] ?? 99) -
            (PRIORITY_ORDER[b.announcement.priority] ?? 99) ||
          (a.announcement.publishAt?.getTime() ?? a.announcement.createdAt.getTime()) -
            (b.announcement.publishAt?.getTime() ?? b.announcement.createdAt.getTime()),
      )
      .slice(0, this.config.get<number>("ANNOUNCEMENT_MAX_AUTO_PER_SESSION", 3))
      .map(async (r) => this.formatAnnouncementWithImage(r.announcement, r)));
  }

  async getOne(user: AuthPrincipal, id: string) {
    const receipt = await this.prisma.announcementReadReceipt.findUnique({
      where: { announcementId_userId: { announcementId: id, userId: user.id } },
      include: {
        announcement: {
          include: { author: { select: { fullName: true } } },
        },
      },
    });
    if (!receipt || receipt.announcement.collegeId !== user.collegeId) {
      throw new NotFoundException("Announcement not found.");
    }
    return this.formatAnnouncementWithImage(receipt.announcement, receipt);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CREATE
  // ─────────────────────────────────────────────────────────────────────────────

  async create(user: AuthPrincipal, input: CreateAnnouncementDto) {
    // Idempotency
    if (input.idempotencyKey) {
      const existing = await this.prisma.announcement.findFirst({
        where: { idempotencyKey: input.idempotencyKey, collegeId: user.collegeId },
      });
      if (existing) return existing;
    }

    const audiences = await this.normalizeAudienceUsers(user.collegeId, input.audiences);
    await this.validateAudiences(user.collegeId, audiences);
    const publishAt = input.publishAt ? new Date(input.publishAt) : null;

    const announcement = await this.prisma.announcement.create({
      data: {
        collegeId: user.collegeId,
        authorId: user.id,
        title: input.title.trim(),
        message: input.message.trim(),
        category: input.category ?? "GENERAL",
        priority: input.priority ?? "LOW",
        status: publishAt && publishAt > new Date() ? "SCHEDULED" : "DRAFT",
        publishAt,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        pinned: input.pinned ?? false,
        requiresAcknowledgement: input.requiresAcknowledgement ?? false,
        showOnAppOpen: input.showOnAppOpen ?? true,
        showOnlyOnce: input.showOnlyOnce ?? true,
        sendPush: input.sendPush ?? false,
        sendEmail: input.sendEmail ?? false,
        idempotencyKey: input.idempotencyKey,
        audiences: {
          create: audiences.map((a) => ({
            scopeType: a.scopeType,
            scopeId: a.scopeId,
            roleCode: a.roleCode?.trim().toUpperCase(),
            userId: a.userId,
          })),
        },
      },
      include: { audiences: true },
    });

    await this.audit.record({
      actorId: user.id,
      collegeId: user.collegeId,
      action: "announcement.created",
      entityType: "Announcement",
      entityId: announcement.id,
      afterValue: { title: announcement.title, status: announcement.status },
      requestId: randomUUID(),
    });

    return announcement;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // UPDATE
  // ─────────────────────────────────────────────────────────────────────────────

  async update(user: AuthPrincipal, id: string, input: UpdateAnnouncementDto, requestId: string) {
    const announcement = await this.requireAnnouncement(user, id, ["DRAFT", "SCHEDULED"]);
    const updated = await this.prisma.announcement.update({
      where: { id },
      data: {
        ...(input.title ? { title: input.title.trim() } : {}),
        ...(input.message ? { message: input.message.trim() } : {}),
        ...(input.category ? { category: input.category } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(input.requiresAcknowledgement !== undefined ? { requiresAcknowledgement: input.requiresAcknowledgement } : {}),
        ...(input.showOnAppOpen !== undefined ? { showOnAppOpen: input.showOnAppOpen } : {}),
        ...(input.showOnlyOnce !== undefined ? { showOnlyOnce: input.showOnlyOnce } : {}),
      },
    });
    await this.audit.record({
      actorId: user.id,
      collegeId: user.collegeId,
      action: "announcement.updated",
      entityType: "Announcement",
      entityId: id,
      beforeValue: { title: announcement.title },
      afterValue: { title: updated.title },
      requestId,
    });
    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLISH (existing publish endpoint kept for single publish)
  // ─────────────────────────────────────────────────────────────────────────────

  async publish(user: AuthPrincipal, id: string) {
    const announcement = await this.prisma.announcement.findFirst({
      where: { id, collegeId: user.collegeId },
      include: { audiences: true },
    });
    if (!announcement) throw new NotFoundException("Announcement not found.");

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.announcement.update({
        where: { id },
        data: { status: "PUBLISHED", publishAt: announcement.publishAt ?? new Date(), publishedAt: new Date() },
      });
      await this.createNotification(tx, updated, user.collegeId, announcement.audiences);
      return updated;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SEND ALL — creates per-user recipient records via background queue
  // ─────────────────────────────────────────────────────────────────────────────

  async sendAll(user: AuthPrincipal, id: string, requestId: string, idempotencyKey?: string) {
    const endpoint = `/announcements/${id}/send-all`;
    if (idempotencyKey) {
      const requestHash = this.idempotency.hash({ id });
      const replay = await this.idempotency.replay(user.id, endpoint, idempotencyKey, requestHash);
      if (replay) return replay;
    }
    const announcement = await this.prisma.announcement.findFirst({
      where: { id, collegeId: user.collegeId },
      include: { audiences: true },
    });
    if (!announcement) throw new NotFoundException("Announcement not found.");
    if (announcement.status === "PUBLISHED" || announcement.status === "PUBLISHING") {
      throw new ConflictException("This announcement has already been sent to all active users.");
    }

    // Count active recipients first for confirmation info
    const recipientCount = await this.countActiveRecipients(user.collegeId, announcement.audiences);
    if (recipientCount === 0) throw new BadRequestException("No active users matched the selected audience.");

    // Mark as PUBLISHING immediately
    const response = await this.prisma.$transaction(async (tx) => {
      await tx.announcement.update({
        where: { id },
        data: { status: "PUBLISHING", publishAt: new Date(), publishedAt: new Date() },
      });
      const body = { announcementId: id, estimatedRecipients: recipientCount, status: "PUBLISHING" };
      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            actorId: user.id,
            endpoint,
            key: idempotencyKey,
            requestHash: this.idempotency.hash({ id }),
            responseStatus: 202,
            responseBody: body,
            resourceId: id,
            expiresAt: addHours(new Date(), 24),
          },
        });
      }
      return body;
    });

    // Queue background job for recipient creation
    if (this.recipientQueue) {
      await this.recipientQueue.add("create-recipients", { announcementId: id, collegeId: user.collegeId }, {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        jobId: `recipients-${id}`,
        removeOnComplete: true,
      });
    } else {
      // Fallback: create inline (for environments without Redis)
      await this.createRecipientsInline(id, user.collegeId, announcement.audiences);
    }

    await this.audit.record({
      actorId: user.id,
      collegeId: user.collegeId,
      action: "announcement.sent_all",
      entityType: "Announcement",
      entityId: id,
      afterValue: { estimatedRecipients: recipientCount },
      requestId,
    });

    return response;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RECIPIENT COUNT (used by frontend confirmation dialog)
  // ─────────────────────────────────────────────────────────────────────────────

  async countRecipients(user: AuthPrincipal, id: string) {
    const announcement = await this.prisma.announcement.findFirst({
      where: { id, collegeId: user.collegeId },
      include: { audiences: true },
    });
    if (!announcement) throw new NotFoundException("Announcement not found.");
    const count = await this.countActiveRecipients(user.collegeId, announcement.audiences);
    return { count };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MARK DISPLAY — user saw the popup (idempotent)
  // ─────────────────────────────────────────────────────────────────────────────

  async markDisplay(user: AuthPrincipal, id: string) {
    const receipt = await this.requireReceipt(user, id);
    if (receipt.firstDisplayedAt) return receipt; // idempotent

    return this.prisma.announcementReadReceipt.update({
      where: { announcementId_userId: { announcementId: id, userId: user.id } },
      data: {
        firstDisplayedAt: new Date(),
        firstDeliveredAt: receipt.firstDeliveredAt ?? new Date(),
        deliveryStatus: "DISPLAYED",
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MARK VIEWED — user read the announcement for min-duration (idempotent for unique view)
  // ─────────────────────────────────────────────────────────────────────────────

  async markViewed(user: AuthPrincipal, id: string) {
    const receipt = await this.requireReceipt(user, id);
    const now = new Date();

    return this.prisma.announcementReadReceipt.update({
      where: { announcementId_userId: { announcementId: id, userId: user.id } },
      data: {
        firstViewedAt: receipt.firstViewedAt ?? now,    // never overwrite
        readAt: receipt.readAt ?? now,
        lastOpenedAt: now,
        deliveryStatus: receipt.acknowledgedAt ? "ACKNOWLEDGED" : "VIEWED",
        firstDeliveredAt: receipt.firstDeliveredAt ?? now,
        firstDisplayedAt: receipt.firstDisplayedAt ?? now,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MARK ACKNOWLEDGED — user clicked "I Have Read This"
  // ─────────────────────────────────────────────────────────────────────────────

  async markAcknowledged(user: AuthPrincipal, id: string) {
    const receipt = await this.requireReceipt(user, id);
    if (receipt.acknowledgedAt) return receipt; // idempotent

    const now = new Date();
    return this.prisma.announcementReadReceipt.update({
      where: { announcementId_userId: { announcementId: id, userId: user.id } },
      data: {
        acknowledgedAt: now,
        firstViewedAt: receipt.firstViewedAt ?? now,
        readAt: receipt.readAt ?? now,
        deliveryStatus: "ACKNOWLEDGED",
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MARK OPEN — user manually opened announcement from history
  // ─────────────────────────────────────────────────────────────────────────────

  async markOpen(user: AuthPrincipal, id: string) {
    await this.requireReceipt(user, id);
    const now = new Date();
    return this.prisma.announcementReadReceipt.update({
      where: { announcementId_userId: { announcementId: id, userId: user.id } },
      data: { lastOpenedAt: now, openCount: { increment: 1 } },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LEGACY READ (backward compat)
  // ─────────────────────────────────────────────────────────────────────────────

  async read(user: AuthPrincipal, id: string, acknowledge: boolean) {
    const audience = this.audienceWhere(user);
    const announcement = await this.prisma.announcement.findFirst({
      where: { id, collegeId: user.collegeId, status: "PUBLISHED", audiences: { some: { OR: audience } } },
    });
    if (!announcement) throw new NotFoundException("Announcement not found.");

    const now = new Date();
    const existing = await this.prisma.announcementReadReceipt.findUnique({
      where: { announcementId_userId: { announcementId: id, userId: user.id } },
    });

    if (existing) {
      return this.prisma.announcementReadReceipt.update({
        where: { announcementId_userId: { announcementId: id, userId: user.id } },
        data: {
          readAt: existing.readAt ?? now,
          firstViewedAt: existing.firstViewedAt ?? now,
          acknowledgedAt: acknowledge ? (existing.acknowledgedAt ?? now) : existing.acknowledgedAt,
          deliveryStatus: acknowledge ? "ACKNOWLEDGED" : "VIEWED",
        },
      });
    }

    return this.prisma.announcementReadReceipt.create({
      data: {
        announcementId: id,
        userId: user.id,
        readAt: now,
        firstViewedAt: now,
        firstDeliveredAt: now,
        firstDisplayedAt: now,
        lastOpenedAt: now,
        openCount: 1,
        deliveryStatus: acknowledge ? "ACKNOWLEDGED" : "VIEWED",
        acknowledgedAt: acknowledge ? now : undefined,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ANALYTICS — admin view
  // ─────────────────────────────────────────────────────────────────────────────

  async getAnalytics(user: AuthPrincipal, id: string) {
    const announcement = await this.prisma.announcement.findFirst({
      where: { id, collegeId: user.collegeId },
      include: { author: { select: { fullName: true } } },
    });
    if (!announcement) throw new NotFoundException("Announcement not found.");

    const [total, delivered, displayed, viewed, acknowledged, failed, expired, recipientRows] =
      await this.prisma.$transaction([
        this.prisma.announcementReadReceipt.count({ where: { announcementId: id } }),
        this.prisma.announcementReadReceipt.count({ where: { announcementId: id, deliveryStatus: { not: "PENDING" } } }),
        this.prisma.announcementReadReceipt.count({ where: { announcementId: id, firstDisplayedAt: { not: null } } }),
        this.prisma.announcementReadReceipt.count({ where: { announcementId: id, firstViewedAt: { not: null } } }),
        this.prisma.announcementReadReceipt.count({ where: { announcementId: id, acknowledgedAt: { not: null } } }),
        this.prisma.announcementReadReceipt.count({ where: { announcementId: id, deliveryStatus: "FAILED" } }),
        this.prisma.announcementReadReceipt.count({ where: { announcementId: id, deliveryStatus: "EXPIRED" } }),
        this.prisma.announcementReadReceipt.findMany({
          where: { announcementId: id },
          include: {
            user: {
              select: {
                roles: {
                  where: { OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] },
                  include: { role: { select: { code: true, name: true } } },
                },
                staffProfile: { select: { department: { select: { id: true, name: true } } } },
                studentProfile: {
                  select: {
                    department: { select: { id: true, name: true } },
                    programme: { select: { id: true, name: true } },
                    section: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        }),
      ]);

    const notViewed = total - viewed;
    const viewRate = total > 0 ? Math.round((viewed / total) * 10000) / 100 : 0;
    const ackRate = total > 0 ? Math.round((acknowledged / total) * 10000) / 100 : 0;

    return {
      announcement: {
        ...announcement,
        imageUrl: await this.getSignedImageUrl(announcement.imageStorageKey),
      },
      stats: { total, delivered, displayed, viewed, acknowledged, notViewed, failed, expired, viewRate, ackRate },
      breakdowns: this.analyticsBreakdowns(recipientRows),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RECIPIENTS — paginated table for admin
  // ─────────────────────────────────────────────────────────────────────────────

  async getRecipients(user: AuthPrincipal, id: string, query: RecipientQueryDto) {
    const announcement = await this.prisma.announcement.findFirst({
      where: { id, collegeId: user.collegeId },
    });
    if (!announcement) throw new NotFoundException("Announcement not found.");

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const userFilters: Prisma.UserWhereInput[] = [];
    if (query.search) {
      userFilters.push({
        OR: [
          { fullName: { contains: query.search, mode: "insensitive" } },
          { collegeIdentityId: { contains: query.search, mode: "insensitive" } },
          { normalizedEmail: { contains: query.search.toLowerCase(), mode: "insensitive" } },
        ],
      });
    }
    if (query.roleCode) {
      userFilters.push({
        roles: {
          some: {
            role: { code: query.roleCode },
            validFrom: { lte: new Date() },
            OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
          },
        },
      });
    }
    if (query.departmentId) {
      userFilters.push({
        OR: [
          { studentProfile: { departmentId: query.departmentId } },
          { staffProfile: { departmentId: query.departmentId } },
        ],
      });
    }

    const where: Prisma.AnnouncementReadReceiptWhereInput = {
      announcementId: id,
      ...(query.deliveryStatus ? { deliveryStatus: query.deliveryStatus } : {}),
      ...(userFilters.length ? { user: { AND: userFilters } } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.announcementReadReceipt.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              collegeIdentityId: true,
              email: true,
              status: true,
              roles: {
                where: { OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] },
                include: { role: { select: { code: true, name: true } } },
                take: 1,
              },
              staffProfile: { select: { department: { select: { name: true } } } },
              studentProfile: { select: { department: { select: { name: true } }, section: { select: { name: true } } } },
            },
          },
        },
        orderBy: [{ firstViewedAt: "desc" }, { user: { fullName: "asc" } }],
      }),
      this.prisma.announcementReadReceipt.count({ where }),
    ]);

    return { data, meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
  }

  async exportRecipientsCsv(user: AuthPrincipal, id: string, query: RecipientQueryDto, requestId: string): Promise<string> {
    const rows = await this.getRecipients(user, id, { ...query, page: 1, pageSize: 5000 });
    await this.audit.record({
      actorId: user.id,
      collegeId: user.collegeId,
      action: "announcement.recipients_exported",
      entityType: "Announcement",
      entityId: id,
      afterValue: { format: "csv", rows: rows.data.length },
      requestId,
    });
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const header = [
      "User Name",
      "Login ID",
      "Email",
      "Role",
      "Department",
      "Delivery Status",
      "Displayed Time",
      "Viewed Time",
      "Acknowledged Time",
      "Open Count",
      "Last Opened Time",
    ];
    const body = rows.data.map((item) => {
      const role = item.user.roles.map((r) => r.role.name).join("; ");
      const department = item.user.studentProfile?.department.name ?? item.user.staffProfile?.department?.name ?? "";
      return [
        item.user.fullName,
        item.user.collegeIdentityId,
        item.user.email,
        role,
        department,
        item.deliveryStatus,
        item.firstDisplayedAt,
        item.firstViewedAt,
        item.acknowledgedAt,
        item.openCount,
        item.lastOpenedAt,
      ].map(escape).join(",");
    });
    return [header.map(escape).join(","), ...body].join("\n");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADMIN LIST
  // ─────────────────────────────────────────────────────────────────────────────

  async adminList(user: AuthPrincipal) {
    const announcements = await this.prisma.announcement.findMany({
      where: { collegeId: user.collegeId },
      include: {
        author: { select: { fullName: true } },
        _count: { select: { reads: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    });

    // Attach signed image URLs and read counts
    return Promise.all(
      announcements.map(async (a) => ({
        ...a,
        imageUrl: await this.getSignedImageUrl(a.imageStorageKey),
        viewedCount: await this.prisma.announcementReadReceipt.count({
          where: { announcementId: a.id, firstViewedAt: { not: null } },
        }),
      })),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // IMAGE UPLOAD — presign
  // ─────────────────────────────────────────────────────────────────────────────

  async presignImage(user: AuthPrincipal, id: string, input: PresignAnnouncementImageDto) {
    const announcement = await this.requireAnnouncement(user, id, ["DRAFT", "SCHEDULED"]);
    this.validateImageFile(input);
    const ext = extname(input.fileName).toLowerCase();
    const storageKey = `colleges/${user.collegeId}/announcements/${announcement.id}/${randomUUID()}${ext}`;
    const expiresIn = this.config.get<number>("S3_SIGNED_URL_EXPIRY_SECONDS", 300);
    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        ContentType: input.mimeType,
        ContentLength: input.sizeBytes,
        Metadata: { uploader: user.id, purpose: "ANNOUNCEMENT" },
      }),
      { expiresIn },
    );
    return { storageKey, uploadUrl, expiresIn, requiredHeaders: { "content-type": input.mimeType } };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // IMAGE UPLOAD — complete
  // ─────────────────────────────────────────────────────────────────────────────

  async completeImage(user: AuthPrincipal, id: string, input: CompleteAnnouncementImageDto, requestId: string) {
    await this.requireAnnouncement(user, id, ["DRAFT", "SCHEDULED"]);
    this.validateImageFile({ fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes });

    const prefix = `colleges/${user.collegeId}/announcements/${id}/`;
    if (!input.storageKey.startsWith(prefix)) {
      throw new ForbiddenException("Storage key is outside the authorized announcement path.");
    }

    await this.verifyImageObject(input);

    const expiresIn = this.config.get<number>("S3_SIGNED_URL_EXPIRY_SECONDS", 300);
    const imageUrl = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: input.storageKey }), { expiresIn });

    const updated = await this.prisma.announcement.update({
      where: { id },
      data: {
        imageStorageKey: input.storageKey,
        imageUrl: input.storageKey, // store key; generate signed URL on demand
        imageMimeType: input.mimeType,
        imageSizeBytes: BigInt(input.sizeBytes),
        imageWidth: input.width,
        imageHeight: input.height,
      },
    });

    await this.audit.record({
      actorId: user.id,
      collegeId: user.collegeId,
      action: "announcement.image_uploaded",
      entityType: "Announcement",
      entityId: id,
      afterValue: { storageKey: input.storageKey, mimeType: input.mimeType, sizeBytes: input.sizeBytes },
      requestId,
    });

    return { ...updated, imageUrl };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ARCHIVE
  // ─────────────────────────────────────────────────────────────────────────────

  async archive(user: AuthPrincipal, id: string, requestId: string) {
    const announcement = await this.prisma.announcement.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!announcement) throw new NotFoundException("Announcement not found.");

    const updated = await this.prisma.announcement.update({
      where: { id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });

    await this.audit.record({
      actorId: user.id,
      collegeId: user.collegeId,
      action: "announcement.archived",
      entityType: "Announcement",
      entityId: id,
      requestId,
    });

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // UNPUBLISH
  // ─────────────────────────────────────────────────────────────────────────────

  async unpublish(user: AuthPrincipal, id: string, requestId: string) {
    const announcement = await this.prisma.announcement.findFirst({
      where: { id, collegeId: user.collegeId, status: "PUBLISHED" },
    });
    if (!announcement) throw new NotFoundException("Published announcement not found.");

    const updated = await this.prisma.announcement.update({
      where: { id },
      data: { status: "UNPUBLISHED" },
    });

    await this.audit.record({
      actorId: user.id,
      collegeId: user.collegeId,
      action: "announcement.unpublished",
      entityType: "Announcement",
      entityId: id,
      requestId,
    });

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SIGNED IMAGE URL
  // ─────────────────────────────────────────────────────────────────────────────

  async getSignedImageUrl(storageKey: string | null | undefined): Promise<string | null> {
    if (!storageKey) return null;
    try {
      const expiresIn = this.config.get<number>("S3_SIGNED_URL_EXPIRY_SECONDS", 300);
      return await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }), { expiresIn });
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INTERNAL — recipient creation (for inline fallback)
  // ─────────────────────────────────────────────────────────────────────────────

  async createRecipientsInline(
    announcementId: string,
    collegeId: string,
    audiences: { scopeType: string; scopeId: string | null; roleCode: string | null; userId: string | null }[],
  ) {
    const BATCH = 200;
    const now = new Date();
    const users = await this.fetchActiveRecipients(collegeId, audiences as never);
    let created = 0;

    for (let i = 0; i < users.length; i += BATCH) {
      const batch = users.slice(i, i + BATCH);
      const result = await this.prisma.announcementReadReceipt.createMany({
        data: batch.map((u) => ({
          announcementId,
          userId: u.id,
          deliveryStatus: "DELIVERED" as const,
          firstDeliveredAt: now,
        })),
        skipDuplicates: true,
      });
      created += result.count;
    }

    await this.prisma.announcement.update({
      where: { id: announcementId },
      data: { status: "PUBLISHED", totalRecipients: created },
    });

    // Create in-app notification
    if (users.length > 0) {
      const announcement = await this.prisma.announcement.findUnique({ where: { id: announcementId } });
      if (announcement) {
        await this.prisma.notification.create({
          data: {
            type: "ANNOUNCEMENT_PUBLISHED",
            title: announcement.title,
            body: announcement.message.slice(0, 300),
            priority: announcement.priority,
            relatedEntityType: "Announcement",
            relatedEntityId: announcementId,
            recipients: { create: users.map((u) => ({ userId: u.id })) },
          },
        });
      }
    }

    return created;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  private async requireAnnouncement(user: AuthPrincipal, id: string, allowedStatuses?: string[]) {
    const announcement = await this.prisma.announcement.findFirst({
      where: { id, collegeId: user.collegeId },
    });
    if (!announcement) throw new NotFoundException("Announcement not found.");
    if (allowedStatuses && !allowedStatuses.includes(announcement.status)) {
      throw new BadRequestException(`Announcement must be in status: ${allowedStatuses.join(" or ")}.`);
    }
    return announcement;
  }

  private async requireReceipt(user: AuthPrincipal, id: string) {
    const receipt = await this.prisma.announcementReadReceipt.findUnique({
      where: { announcementId_userId: { announcementId: id, userId: user.id } },
    });
    if (!receipt) throw new NotFoundException("You are not a recipient of this announcement.");
    return receipt;
  }

  private audienceWhere(user: AuthPrincipal): Prisma.AnnouncementAudienceWhereInput[] {
    return [
      { scopeType: "COLLEGE", OR: [{ scopeId: null }, { scopeId: user.collegeId }] },
      { userId: user.id },
      { roleCode: { in: user.roles } },
      ...user.scopes.map((scope) => ({ scopeType: scope.type as never, scopeId: scope.id })),
    ];
  }

  private formatAnnouncementWithImage(
    announcement: { imageStorageKey?: string | null; [k: string]: unknown },
    receipt: unknown,
  ): Promise<Record<string, unknown>> {
    return this.getSignedImageUrl(announcement.imageStorageKey).then((imageUrl) => ({ ...announcement, imageUrl, receipt }));
  }

  private async countActiveRecipients(
    collegeId: string,
    audiences: { scopeType: string; scopeId: string | null; roleCode: string | null; userId: string | null }[],
  ) {
    const users = await this.fetchActiveRecipients(collegeId, audiences as never);
    return users.length;
  }

  private async fetchActiveRecipients(
    collegeId: string,
    audiences: Array<{ scopeType: string; scopeId: string | null; roleCode: string | null; userId: string | null }>,
  ) {
    const now = new Date();
    const broadCollegeAudience = audiences.some(
      (a) => a.scopeType === "COLLEGE" && (!a.scopeId || a.scopeId === collegeId),
    );
    const userIds = audiences.flatMap((a) => (a.userId ? [a.userId] : []));
    const roleCodes = audiences.flatMap((a) => (a.roleCode ? [a.roleCode] : []));
    const scoped = audiences.filter((a) => a.scopeId && !a.userId && !a.roleCode);

    const audienceWhere: Prisma.UserWhereInput = broadCollegeAudience
      ? {}
      : {
          OR: [
            ...(userIds.length ? [{ id: { in: userIds } }] : []),
            ...(roleCodes.length
              ? [
                  {
                    roles: {
                      some: {
                        validFrom: { lte: now },
                        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
                        role: { code: { in: roleCodes }, isActive: true },
                      },
                    },
                  },
                ]
              : []),
            ...(scoped.length
              ? [
                  {
                    scopes: {
                      some: {
                        OR: scoped.map((a) => ({ scopeType: a.scopeType as never, scopeId: a.scopeId })),
                      },
                    },
                  },
                ]
              : []),
          ],
        };

    return this.prisma.user.findMany({
      where: {
        collegeId,
        status: "ACTIVE",
        AND: [audienceWhere],
      },
      select: { id: true },
    });
  }

  private analyticsBreakdowns(
    rows: Array<{
      firstViewedAt: Date | null;
      acknowledgedAt: Date | null;
      deliveryStatus: string;
      user: {
        roles: Array<{ role: { code: string; name: string } }>;
        staffProfile: { department: { id: string; name: string } | null } | null;
        studentProfile: {
          department: { id: string; name: string };
          programme: { id: string; name: string };
          section: { id: string; name: string };
        } | null;
      };
    }>,
  ) {
    const add = (
      target: Map<string, { label: string; total: number; viewed: number; acknowledged: number }>,
      key: string,
      label: string,
      row: (typeof rows)[number],
    ) => {
      const current = target.get(key) ?? { label, total: 0, viewed: 0, acknowledged: 0 };
      current.total += 1;
      if (row.firstViewedAt) current.viewed += 1;
      if (row.acknowledgedAt) current.acknowledged += 1;
      target.set(key, current);
    };
    const byRole = new Map<string, { label: string; total: number; viewed: number; acknowledged: number }>();
    const byDepartment = new Map<string, { label: string; total: number; viewed: number; acknowledged: number }>();
    const byProgramme = new Map<string, { label: string; total: number; viewed: number; acknowledged: number }>();
    const bySection = new Map<string, { label: string; total: number; viewed: number; acknowledged: number }>();

    for (const row of rows) {
      for (const assigned of row.user.roles.length ? row.user.roles : [{ role: { code: "NO_ROLE", name: "No role" } }]) {
        const key = assigned.role.code;
        const current = byRole.get(key) ?? { label: assigned.role.name, total: 0, viewed: 0, acknowledged: 0 };
        current.total += 1;
        if (row.firstViewedAt) current.viewed += 1;
        if (row.acknowledgedAt) current.acknowledged += 1;
        byRole.set(key, current);
      }
      const department = row.user.studentProfile?.department ?? row.user.staffProfile?.department;
      if (department) {
        const current = byDepartment.get(department.id) ?? { label: department.name, total: 0, viewed: 0, acknowledged: 0 };
        current.total += 1;
        if (row.firstViewedAt) current.viewed += 1;
        if (row.acknowledgedAt) current.acknowledged += 1;
        byDepartment.set(department.id, current);
      }
      if (row.user.studentProfile?.programme) add(byProgramme, row.user.studentProfile.programme.id, row.user.studentProfile.programme.name, row);
      if (row.user.studentProfile?.section) add(bySection, row.user.studentProfile.section.id, row.user.studentProfile.section.name, row);
    }

    return {
      byRole: [...byRole.values()],
      byDepartment: [...byDepartment.values()],
      byProgramme: [...byProgramme.values()],
      bySection: [...bySection.values()],
    };
  }

  private async createNotification(
    tx: Prisma.TransactionClient,
    announcement: { id: string; title: string; message: string; priority: string },
    collegeId: string,
    _audiences: Array<{ scopeType: string; scopeId: string | null; roleCode: string | null; userId: string | null }>,
  ) {
    const users = await tx.user.findMany({
      where: { collegeId, status: "ACTIVE" },
      select: { id: true },
    });
    if (users.length > 0) {
      await tx.notification.create({
        data: {
          type: "ANNOUNCEMENT_PUBLISHED",
          title: announcement.title,
          body: announcement.message.slice(0, 300),
          priority: announcement.priority as never,
          relatedEntityType: "Announcement",
          relatedEntityId: announcement.id,
          recipients: { create: users.map((u) => ({ userId: u.id })) },
        },
      });
    }
  }

  private validateImageFile(input: { fileName: string; mimeType: string; sizeBytes: number }) {
    const ext = extname(input.fileName).toLowerCase();
    if (!ALLOWED_IMAGE_TYPES[input.mimeType]?.includes(ext)) {
      throw new BadRequestException("Announcement images must be JPG, PNG, or WebP and extension must match.");
    }
    const limitMb = this.config.get<number>("MAX_IMAGE_SIZE_MB", 10);
    if (input.sizeBytes > limitMb * 1024 * 1024) {
      throw new BadRequestException(`Image exceeds the ${limitMb} MB limit.`);
    }
  }

  private async verifyImageObject(input: { storageKey: string; mimeType: string; sizeBytes: number }): Promise<void> {
    const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: input.storageKey }));
    if (head.ContentLength !== input.sizeBytes || head.ContentType !== input.mimeType) {
      throw new BadRequestException("Uploaded image metadata does not match the upload request.");
    }
    const obj = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: input.storageKey }));
    const content = await this.streamToBuffer(obj.Body as Readable | undefined, input.sizeBytes);
    if (!this.isValidImage(input.mimeType, content)) {
      throw new BadRequestException("The uploaded file content does not match its declared image type.");
    }
  }

  private isValidImage(mimeType: string, content: Buffer): boolean {
    if (content.length < 4) return false;
    if (mimeType === "image/jpeg") return content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
    if (mimeType === "image/png")
      return content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mimeType === "image/webp")
      return (
        content.subarray(0, 4).toString("ascii") === "RIFF" &&
        content.subarray(8, 12).toString("ascii") === "WEBP"
      );
    return false;
  }

  private async streamToBuffer(stream: Readable | undefined, expectedSize: number): Promise<Buffer> {
    if (!stream) throw new BadRequestException("Uploaded object content is unavailable.");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += buffer.length;
      if (size > expectedSize + 1024) throw new BadRequestException("Uploaded object exceeds its declared size.");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // AUDIENCE VALIDATION (kept from original)
  // ─────────────────────────────────────────────────────────────────────────────

  private async normalizeAudienceUsers(
    collegeId: string,
    audiences: CreateAnnouncementDto["audiences"],
  ): Promise<CreateAnnouncementDto["audiences"]> {
    return Promise.all(
      audiences.map(async (audience) => {
        if (!audience.userId) return audience;
        const target = await this.prisma.user.findFirst({
          where: {
            collegeId,
            status: "ACTIVE",
            OR: [{ id: audience.userId }, { publicId: audience.userId }],
          },
          select: { id: true },
        });
        if (!target)
          throw new BadRequestException(
            "Announcement user audience is not active in this college.",
          );
        return { ...audience, userId: target.id };
      }),
    );
  }

  private async validateAudiences(collegeId: string, audiences: CreateAnnouncementDto["audiences"]): Promise<void> {
    const identities = new Set<string>();
    for (const audience of audiences) {
      const roleCode = audience.roleCode?.trim().toUpperCase();
      const identity = audience.userId
        ? `USER:${audience.userId}`
        : roleCode
          ? `ROLE:${roleCode}`
          : `${audience.scopeType}:${audience.scopeId ?? collegeId}`;
      if (identities.has(identity))
        throw new BadRequestException("The same announcement audience cannot be selected more than once.");
      identities.add(identity);

      if (audience.userId || roleCode) {
        if (audience.scopeType !== "COLLEGE" || audience.scopeId || (audience.userId && roleCode)) {
          throw new BadRequestException("Direct user or role audiences cannot be combined with a scoped audience.");
        }
        if (audience.userId) {
          const target = await this.prisma.user.findFirst({
            where: { id: audience.userId, collegeId, status: "ACTIVE" },
            select: { id: true },
          });
          if (!target) throw new BadRequestException("Announcement user audience is not active in this college.");
        } else if (roleCode) {
          const role = await this.prisma.role.findFirst({
            where: { code: roleCode, isActive: true, OR: [{ collegeId }, { collegeId: null }] },
            select: { id: true },
          });
          if (!role) throw new BadRequestException("Announcement role audience is not active in this college.");
        }
        continue;
      }

      if (audience.scopeType === "COLLEGE") {
        if (audience.scopeId && audience.scopeId !== collegeId)
          throw new BadRequestException("Announcement college audience does not match this college.");
        continue;
      }
      if (audience.scopeType === "ASSIGNED_ISSUES" || audience.scopeType === "ISSUE_CATEGORY") {
        throw new BadRequestException(`${audience.scopeType} is not a supported announcement audience.`);
      }
      if (!audience.scopeId) throw new BadRequestException(`${audience.scopeType} announcement audience requires a target ID.`);
      if (!(await this.audienceScopeExists(collegeId, audience.scopeType, audience.scopeId))) {
        throw new BadRequestException(`${audience.scopeType} announcement audience is not active in this college.`);
      }
    }
  }

  private async audienceScopeExists(
    collegeId: string,
    scopeType: CreateAnnouncementDto["audiences"][number]["scopeType"],
    scopeId: string,
  ): Promise<boolean> {
    switch (scopeType) {
      case "CAMPUS":
        return Boolean(await this.prisma.campus.findFirst({ where: { id: scopeId, collegeId, isActive: true }, select: { id: true } }));
      case "DEPARTMENT":
        return Boolean(await this.prisma.department.findFirst({ where: { id: scopeId, collegeId, isActive: true }, select: { id: true } }));
      case "PROGRAMME":
        return Boolean(await this.prisma.programme.findFirst({ where: { id: scopeId, collegeId, isActive: true }, select: { id: true } }));
      case "ACADEMIC_YEAR":
        return Boolean(await this.prisma.academicYear.findFirst({ where: { id: scopeId, collegeId, isActive: true }, select: { id: true } }));
      case "SEMESTER":
        return Boolean(await this.prisma.semester.findFirst({ where: { id: scopeId, isActive: true, programme: { collegeId } }, select: { id: true } }));
      case "SECTION":
        return Boolean(await this.prisma.section.findFirst({ where: { id: scopeId, isActive: true, semester: { programme: { collegeId } } }, select: { id: true } }));
      case "BLOCK":
        return Boolean(await this.prisma.block.findFirst({ where: { id: scopeId, isActive: true, campus: { collegeId } }, select: { id: true } }));
      case "FLOOR":
        return Boolean(await this.prisma.floor.findFirst({ where: { id: scopeId, isActive: true, block: { campus: { collegeId } } }, select: { id: true } }));
      case "ROOM":
        return Boolean(await this.prisma.room.findFirst({ where: { id: scopeId, isActive: true, floor: { block: { campus: { collegeId } } } }, select: { id: true } }));
      default:
        return false;
    }
  }
}
