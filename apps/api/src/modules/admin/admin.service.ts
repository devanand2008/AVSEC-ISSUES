import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AccessService } from "../../common/access/access.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { AuditService } from "../audit/audit.service";
import { DeliveryService } from "../delivery/delivery.service";
import type { AuditLogQueryDto, BackgroundJobQueryDto, CreateAssetDto, CreateNotificationTemplateDto, UpdateAssetStatusDto, UpdateNotificationTemplateDto } from "./dto/admin.dto";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly access: AccessService, private readonly auditTrail: AuditService, private readonly delivery: DeliveryService) {}
  async audit(user: AuthPrincipal, query: AuditLogQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      collegeId: user.collegeId,
      ...(query.action ? { action: { contains: query.action, mode: "insensitive" } } : {}),
      ...(query.entityType ? { entityType: { equals: query.entityType, mode: "insensitive" } } : {}),
      ...(query.actor ? { actor: { fullName: { contains: query.actor, mode: "insensitive" } } } : {}),
      ...((query.from || query.to) ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: { createdAt: "desc" }, include: { actor: { select: { publicId: true, fullName: true } } } }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, meta: { page: query.page, pageSize: query.pageSize, total, pageCount: Math.ceil(total / query.pageSize) } };
  }
  async backgroundJobs(user: AuthPrincipal, query: BackgroundJobQueryDto) {
    const where: Prisma.BackgroundJobFailureWhereInput = { collegeId: user.collegeId, ...(query.queue ? { queueName: query.queue } : {}), ...(query.resolved === "true" ? { resolvedAt: { not: null } } : query.resolved === "false" ? { resolvedAt: null } : {}) };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.backgroundJobFailure.findMany({ where, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: { failedAt: "desc" }, select: { id: true, queueName: true, jobId: true, jobName: true, errorCode: true, errorMessage: true, failedAt: true, resolvedAt: true, retryCount: true } }),
      this.prisma.backgroundJobFailure.count({ where }),
    ]);
    return { data, meta: { page: query.page, pageSize: query.pageSize, total, pageCount: Math.ceil(total / query.pageSize) } };
  }
  async retryJob(user: AuthPrincipal, id: string, requestId: string) {
    const failure = await this.prisma.backgroundJobFailure.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!failure) throw new NotFoundException("Failed background job not found.");
    if (failure.queueName !== "notification-delivery") throw new BadRequestException("This job must be retried from its owning workflow.");
    const queued = await this.delivery.retryFailure(failure);
    await this.prisma.$transaction(async (tx) => {
      await tx.backgroundJobFailure.update({ where: { id }, data: { resolvedAt: new Date(), retryCount: { increment: 1 } } });
      await this.auditTrail.record({ actorId: user.id, action: "background_job.retried", entityType: "BackgroundJobFailure", entityId: id, afterValue: { queueName: failure.queueName, queueJobId: queued.queueJobId }, requestId }, tx);
    });
    return { id, status: "REQUEUED", ...queued };
  }
  async resolveJob(user: AuthPrincipal, id: string, requestId: string) {
    const failure = await this.prisma.backgroundJobFailure.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!failure) throw new NotFoundException("Failed background job not found.");
    await this.prisma.$transaction(async (tx) => {
      await tx.backgroundJobFailure.update({ where: { id }, data: { resolvedAt: new Date() } });
      await this.auditTrail.record({ actorId: user.id, action: "background_job.resolved", entityType: "BackgroundJobFailure", entityId: id, beforeValue: { resolvedAt: failure.resolvedAt }, afterValue: { resolvedAt: new Date() }, requestId }, tx);
    });
    return { id, status: "RESOLVED" };
  }
  settings(user: AuthPrincipal) { return this.prisma.appSetting.findMany({ where: { OR: [{ collegeId: user.collegeId }, { collegeId: null }], isSecret: false }, select: { key: true, value: true, version: true, updatedAt: true }, orderBy: { key: "asc" } }); }
  async updateSetting(user: AuthPrincipal, key: string, value: unknown, requestId: string) {
    const normalizedValue = key === "security.official_email_domains" ? this.officialEmailDomains(value) : value;
    const json = JSON.parse(JSON.stringify(normalizedValue)) as Prisma.InputJsonValue;
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.appSetting.findUnique({ where: { collegeId_key: { collegeId: user.collegeId, key } } });
      const setting = await tx.appSetting.upsert({ where: { collegeId_key: { collegeId: user.collegeId, key } }, create: { collegeId: user.collegeId, key, value: json, updatedById: user.id }, update: { value: json, updatedById: user.id, version: { increment: 1 } } });
      await this.auditTrail.record({ actorId: user.id, action: "setting.updated", entityType: "AppSetting", entityId: setting.id, beforeValue: previous ? { key, value: previous.value, version: previous.version } : undefined, afterValue: { key, value: setting.value, version: setting.version }, requestId }, tx);
      return setting;
    });
  }

  private officialEmailDomains(value: unknown) {
    const source = Array.isArray(value)
      ? value
      : value && typeof value === "object" && "domains" in value
        ? (value as { domains?: unknown }).domains
        : undefined;
    if (!Array.isArray(source)) throw new BadRequestException("Official email domains must be an array of domain names.");
    const domains = [...new Set(source.map((domain) => typeof domain === "string" ? domain.trim().toLowerCase().replace(/^@/, "") : ""))].filter(Boolean);
    if (!domains.length || domains.length > 20 || domains.some((domain) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain))) {
      throw new BadRequestException("Provide between 1 and 20 valid official email domains.");
    }
    return { domains };
  }
  integrations() { return { whatsapp: { enabled: this.config.get<boolean>("WHATSAPP_ENABLED", false), configured: Boolean(this.config.get<string>("WHATSAPP_PHONE_NUMBER_ID") && this.config.get<string>("WHATSAPP_ACCESS_TOKEN")) }, firebase: { configured: Boolean(this.config.get<string>("FIREBASE_PROJECT_ID") && this.config.get<string>("FIREBASE_CLIENT_EMAIL") && this.config.get<string>("FIREBASE_PRIVATE_KEY") && this.config.get<string>("DEVICE_TOKEN_ENCRYPTION_KEY")) }, objectStorage: { endpoint: this.config.get<string>("S3_ENDPOINT"), bucketConfigured: Boolean(this.config.get<string>("S3_BUCKET")) }, automaticDelivery: "Background jobs retry failed provider deliveries with exponential backoff and retain permanently failed jobs for operator review." }; }
  async search(user: AuthPrincipal, query: string) {
    const locationScopeIds = user.scopes.filter((scope) => ["CAMPUS", "BLOCK", "FLOOR", "ROOM"].includes(scope.type) && scope.id).map((scope) => ({ type: scope.type, id: scope.id as string }));
    const roomScope: Prisma.RoomWhereInput = this.access.isCollegeWide(user)
      ? { floor: { block: { campus: { collegeId: user.collegeId } } } }
      : { OR: locationScopeIds.map((scope) => scope.type === "CAMPUS" ? { floor: { block: { campusId: scope.id } } } : scope.type === "BLOCK" ? { floor: { blockId: scope.id } } : scope.type === "FLOOR" ? { floorId: scope.id } : { id: scope.id }) };
    const maySearchRooms = user.permissions.includes("locations.read") && (this.access.isCollegeWide(user) || locationScopeIds.length > 0);
    const maySearchUsers = user.permissions.includes("users.read") && this.access.isCollegeWide(user);
    const [rooms, issues, users] = await this.prisma.$transaction([
      this.prisma.room.findMany({ where: maySearchRooms ? { AND: [roomScope, { OR: [{ name: { contains: query, mode: "insensitive" } }, { code: { contains: query, mode: "insensitive" } }] }] } : { id: "00000000-0000-0000-0000-000000000000" }, take: 10, select: { id: true, code: true, name: true, floor: { select: { id: true, block: { select: { id: true, campusId: true } } } } } }),
      this.prisma.issue.findMany({ where: { AND: [this.access.issueWhere(user), { OR: [{ issueNumber: { contains: query, mode: "insensitive" } }, { title: { contains: query, mode: "insensitive" } }] }] }, take: 10, select: { id: true, issueNumber: true, title: true, status: true } }),
      this.prisma.user.findMany({ where: maySearchUsers ? { collegeId: user.collegeId, OR: [{ fullName: { contains: query, mode: "insensitive" } }, { collegeIdentityId: { contains: query, mode: "insensitive" } }] } : { id: "00000000-0000-0000-0000-000000000000" }, take: 10, select: { publicId: true, collegeIdentityId: true, fullName: true, status: true } }),
    ]);
    return { rooms, issues, users };
  }

  /* ─── Escalation events ─── */
  escalationEvents(user: AuthPrincipal) {
    return this.prisma.issueEscalation.findMany({
      where: { issue: { collegeId: user.collegeId } },
      include: {
        issue: { select: { id: true, issueNumber: true, title: true, status: true, priority: true, customAreaName: true, room: { select: { name: true } }, area: { select: { name: true } } } },
      },
      orderBy: { escalatedAt: "desc" },
      take: 200,
    });
  }

  /* ─── Notification templates ─── */
  notificationTemplates() {
    return this.prisma.notificationTemplate.findMany({ orderBy: [{ code: "asc" }, { channel: "asc" }] });
  }

  async createNotificationTemplate(user: AuthPrincipal, input: CreateNotificationTemplateDto, requestId: string) {
    const template = await this.prisma.notificationTemplate.create({
      data: {
        code: input.code.trim().toUpperCase(),
        channel: input.channel as "IN_APP" | "PUSH" | "WHATSAPP" | "EMAIL" | "SMS",
        language: input.language.trim().toLowerCase(),
        subjectTemplate: input.subjectTemplate?.trim() || null,
        bodyTemplate: input.bodyTemplate.trim(),
      },
    });
    await this.auditTrail.record({ actorId: user.id, action: "notification_template.created", entityType: "NotificationTemplate", entityId: template.id, afterValue: { code: template.code, channel: template.channel }, requestId });
    return template;
  }

  async updateNotificationTemplate(user: AuthPrincipal, id: string, input: UpdateNotificationTemplateDto, requestId: string) {
    const existing = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Notification template not found.");
    const isActive = input.isActive === "true" || input.isActive === true ? true : input.isActive === "false" || input.isActive === false ? false : undefined;
    const template = await this.prisma.notificationTemplate.update({
      where: { id },
      data: {
        ...(input.subjectTemplate !== undefined ? { subjectTemplate: input.subjectTemplate?.trim() || null } : {}),
        ...(input.bodyTemplate !== undefined ? { bodyTemplate: input.bodyTemplate.trim() } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
        version: { increment: 1 },
      },
    });
    await this.auditTrail.record({ actorId: user.id, action: "notification_template.updated", entityType: "NotificationTemplate", entityId: id, beforeValue: { isActive: existing.isActive, version: existing.version }, afterValue: { isActive: template.isActive, version: template.version }, requestId });
    return template;
  }

  async deleteNotificationTemplate(user: AuthPrincipal, id: string, requestId: string) {
    const existing = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Notification template not found.");
    await this.prisma.notificationTemplate.delete({ where: { id } });
    await this.auditTrail.record({ actorId: user.id, action: "notification_template.deleted", entityType: "NotificationTemplate", entityId: id, beforeValue: { code: existing.code, channel: existing.channel }, requestId });
    return { deleted: true };
  }

  /* ─── Asset management ─── */
  adminAssets(user: AuthPrincipal) {
    return this.prisma.asset.findMany({
      where: { OR: [{ room: { floor: { block: { campus: { collegeId: user.collegeId } } } } }, { area: { floor: { block: { campus: { collegeId: user.collegeId } } } } }] },
      include: {
        room: { select: { id: true, name: true, code: true, floor: { select: { name: true, block: { select: { name: true, campus: { select: { name: true } } } } } } } },
        area: { select: { id: true, name: true, code: true, floor: { select: { name: true, block: { select: { name: true, campus: { select: { name: true } } } } } } } },
        category: { select: { id: true, name: true } },
        _count: { select: { issues: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  assetCategories() {
    return this.prisma.assetCategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  }

  async createAsset(user: AuthPrincipal, input: CreateAssetDto, requestId: string) {
    if (Boolean(input.roomId) === Boolean(input.areaId)) throw new BadRequestException("Select exactly one room or area for the asset.");
    const activeCampus = { collegeId: user.collegeId, isActive: true, archivedAt: null };
    const room = input.roomId ? await this.prisma.room.findFirst({ where: { id: input.roomId, isActive: true, archivedAt: null, floor: { isActive: true, archivedAt: null, block: { isActive: true, archivedAt: null, campus: activeCampus } } } }) : null;
    const area = input.areaId ? await this.prisma.area.findFirst({ where: { id: input.areaId, isActive: true, archivedAt: null, floor: { isActive: true, archivedAt: null, block: { isActive: true, archivedAt: null, campus: activeCampus } } } }) : null;
    if (input.roomId && !room) throw new BadRequestException("Room is not active in this college.");
    if (input.areaId && !area) throw new BadRequestException("Area is not active in this college.");
    const category = await this.prisma.assetCategory.findFirst({ where: { id: input.categoryId, isActive: true } });
    if (!category) throw new BadRequestException("Asset category is not active.");
    const asset = await this.prisma.asset.create({
      data: {
        roomId: input.roomId ?? null,
        areaId: input.areaId ?? null,
        categoryId: input.categoryId,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        serialNumber: input.serialNumber?.trim() || null,
      },
    });
    await this.auditTrail.record({ actorId: user.id, action: "asset.created", entityType: "Asset", entityId: asset.id, afterValue: { code: asset.code, name: asset.name, roomId: asset.roomId, areaId: asset.areaId }, requestId });
    return asset;
  }

  async updateAssetStatus(user: AuthPrincipal, id: string, input: UpdateAssetStatusDto, requestId: string) {
    const existing = await this.prisma.asset.findFirst({ where: { id, OR: [{ room: { floor: { block: { campus: { collegeId: user.collegeId } } } } }, { area: { floor: { block: { campus: { collegeId: user.collegeId } } } } }] } });
    if (!existing) throw new NotFoundException("Asset not found.");
    const asset = await this.prisma.asset.update({ where: { id }, data: { isActive: input.isActive } });
    await this.auditTrail.record({ actorId: user.id, action: "asset.status_updated", entityType: "Asset", entityId: id, beforeValue: { isActive: existing.isActive }, afterValue: { isActive: asset.isActive }, requestId });
    return asset;
  }

  /* ─── System health ─── */
  async systemHealth(user: AuthPrincipal) {
    const [userCount, issueCount, activeSessionCount, pendingJobCount, recentEscalations, storageIntegration] = await Promise.all([
      this.prisma.user.count({ where: { collegeId: user.collegeId, status: "ACTIVE" } }),
      this.prisma.issue.count({ where: { collegeId: user.collegeId } }),
      this.prisma.session.count({ where: { user: { collegeId: user.collegeId }, expiresAt: { gt: new Date() } } }),
      this.prisma.backgroundJobFailure.count({ where: { collegeId: user.collegeId, resolvedAt: null } }),
      this.prisma.issueEscalation.count({ where: { issue: { collegeId: user.collegeId }, escalatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
      Promise.resolve({ endpoint: this.config.get<string>("S3_ENDPOINT"), configured: Boolean(this.config.get<string>("S3_BUCKET")) }),
    ]);
    return {
      database: { status: "connected", activeUsers: userCount, totalIssues: issueCount, activeSessions: activeSessionCount },
      jobs: { pendingFailures: pendingJobCount },
      escalations: { last24h: recentEscalations },
      storage: storageIntegration,
      server: { nodeVersion: process.version, uptime: Math.floor(process.uptime()), memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024) },
    };
  }
}
