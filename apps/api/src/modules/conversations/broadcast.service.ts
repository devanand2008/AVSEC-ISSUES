import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { CreateBroadcastDto } from "./dto/broadcast.dto";
import type { Prisma } from "../../generated/prisma/client";

@Injectable()
export class BroadcastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthPrincipal, page = 1, pageSize = 20) {
    const where = { collegeId: user.collegeId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.broadcast.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: { author: { select: { publicId: true, fullName: true } } },
      }),
      this.prisma.broadcast.count({ where }),
    ]);
    return { data, meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
  }

  async getOne(user: AuthPrincipal, id: string) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id, collegeId: user.collegeId },
      include: {
        author: { select: { publicId: true, fullName: true } },
        _count: { select: { recipients: true } },
      },
    });
    if (!broadcast) throw new NotFoundException("Broadcast not found.");
    return broadcast;
  }

  async recipients(user: AuthPrincipal, filters: { page: number; pageSize: number; search?: string; role?: string; departmentId?: string; sectionId?: string; programmeId?: string; academicYearId?: string; semesterId?: string }) {
    const page = Math.max(1, Number.isFinite(filters.page) ? filters.page : 1);
    const pageSize = Math.min(100, Math.max(1, Number.isFinite(filters.pageSize) ? filters.pageSize : 20));
    const search = filters.search?.trim().slice(0, 120);
    const where: Prisma.UserWhereInput = { AND: [
      { collegeId: user.collegeId, status: "ACTIVE", archivedAt: null },
      ...(search ? [{ OR: [{ fullName: { contains: search, mode: "insensitive" as const } }, { collegeIdentityId: { contains: search, mode: "insensitive" as const } }, { email: { contains: search, mode: "insensitive" as const } }] }] : []),
      ...(filters.role ? [{ roles: { some: { role: { code: filters.role, isActive: true } } } }] : []),
      ...(filters.departmentId ? [{ OR: [{ studentProfile: { departmentId: filters.departmentId } }, { staffProfile: { departmentId: filters.departmentId } }] }] : []),
      ...(filters.sectionId ? [{ studentProfile: { sectionId: filters.sectionId } }] : []),
      ...(filters.programmeId ? [{ studentProfile: { programmeId: filters.programmeId } }] : []),
      ...(filters.academicYearId ? [{ studentProfile: { section: { semester: { academicYearId: filters.academicYearId } } } }] : []),
      ...(filters.semesterId ? [{ studentProfile: { section: { semesterId: filters.semesterId } } }] : []),
    ] };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ fullName: "asc" }, { collegeIdentityId: "asc" }], select: { id: true, publicId: true, collegeIdentityId: true, fullName: true, email: true, roles: { where: { role: { isActive: true } }, select: { role: { select: { code: true, name: true } } } }, studentProfile: { select: { department: { select: { id: true, name: true } }, section: { select: { id: true, code: true, name: true } } } }, staffProfile: { select: { department: { select: { id: true, name: true } } } } } }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map((item) => ({ id: item.id, publicId: item.publicId, collegeIdentityId: item.collegeIdentityId, name: item.fullName, fullName: item.fullName, officialEmail: item.email, roles: item.roles.map(({ role }) => role), department: item.studentProfile?.department ?? item.staffProfile?.department ?? null, section: item.studentProfile?.section ?? null })), meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
  }

  async create(actor: AuthPrincipal, input: CreateBroadcastDto, requestId: string) {
    if (!actor.permissions.includes("broadcasts.create")) {
      throw new ForbiddenException("You do not have permission to create broadcasts.");
    }
    if (!input.title?.trim()) throw new BadRequestException("Title is required.");
    if (!input.body?.trim()) throw new BadRequestException("Message body is required.");
    if (!["ALL", "ROLE", "DEPARTMENT", "PROGRAMME", "ACADEMIC_YEAR", "SEMESTER", "SECTION", "INDIVIDUAL"].includes(input.audienceType)) {
      throw new BadRequestException("Invalid audience type.");
    }
    if (["ROLE", "DEPARTMENT", "PROGRAMME", "ACADEMIC_YEAR", "SEMESTER", "SECTION"].includes(input.audienceType) && !input.audienceValue?.trim()) {
      throw new BadRequestException(`audienceValue is required for audienceType '${input.audienceType}'.`);
    }
    const individualValues = input.audienceType === "INDIVIDUAL"
      ? [...new Set(input.recipientIds?.length
        ? input.recipientIds
        : input.audienceValue?.split(",").map((value) => value.trim()).filter(Boolean) ?? [])]
      : [];
    if (input.audienceType === "INDIVIDUAL" && !individualValues.length) {
      throw new BadRequestException("Select at least one active recipient.");
    }
    if (individualValues.length > 500) {
      throw new BadRequestException("Select no more than 500 individual recipients per broadcast.");
    }
    const individualUserIds = input.audienceType === "INDIVIDUAL"
      ? await this.resolveRecipients(actor.collegeId, "INDIVIDUAL", individualValues.join(","))
      : [];
    if (input.audienceType === "INDIVIDUAL" && individualUserIds.length !== individualValues.length) {
      throw new BadRequestException("One or more selected recipients are inactive or outside your college.");
    }

    const broadcast = await this.prisma.$transaction(async (tx) => {
      const created = await tx.broadcast.create({
        data: {
          collegeId: actor.collegeId,
          authorId: actor.id,
          title: input.title.trim(),
          body: input.body.trim(),
          audienceType: input.audienceType,
          audienceValue: input.audienceType === "INDIVIDUAL" ? null : input.audienceValue?.trim(),
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
          status: input.scheduledAt ? "SCHEDULED" : "DRAFT",
        },
      });
      if (individualUserIds.length) {
        await tx.broadcastRecipient.createMany({
          data: individualUserIds.map((userId) => ({ broadcastId: created.id, userId })),
          skipDuplicates: true,
        });
      }
      await this.audit.record({
        actorId: actor.id,
        action: "broadcast.created",
        entityType: "Broadcast",
        entityId: created.id,
        afterValue: { title: created.title, audienceType: created.audienceType, audienceValue: created.audienceValue, selectedRecipientCount: individualUserIds.length },
        requestId,
      }, tx);
      return created;
    });
    return broadcast;
  }

  async send(actor: AuthPrincipal, id: string, requestId: string) {
    if (!actor.permissions.includes("broadcasts.send")) {
      throw new ForbiddenException("You do not have permission to send broadcasts.");
    }
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id, collegeId: actor.collegeId },
    });
    if (!broadcast) throw new NotFoundException("Broadcast not found.");
    if (!["DRAFT", "SCHEDULED"].includes(broadcast.status)) {
      throw new BadRequestException(`Cannot send a broadcast with status '${broadcast.status}'.`);
    }

    // Resolve recipients based on audienceType
    const userIds = broadcast.audienceType === "INDIVIDUAL"
      ? await this.activeSelectedRecipients(actor.collegeId, broadcast.id, broadcast.audienceValue ?? undefined)
      : await this.resolveRecipients(actor.collegeId, broadcast.audienceType, broadcast.audienceValue ?? undefined);
    if (!userIds.length) throw new BadRequestException("No eligible recipients found for this broadcast.");

    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.broadcast.updateMany({
        where: { id, collegeId: actor.collegeId, status: { in: ["DRAFT", "SCHEDULED"] } },
        data: { status: "SENDING", totalRecipients: userIds.length, sentAt: new Date(), errorMessage: null },
      });
      if (claimed.count !== 1) {
        throw new ConflictException("This broadcast has already been sent or changed. Refresh and try again.");
      }
      await tx.broadcastRecipient.createMany({
        data: userIds.map((userId) => ({ broadcastId: id, userId })),
        skipDuplicates: true,
      });
      const notification = await tx.notification.create({
        data: {
          type: "BROADCAST",
          title: broadcast.title,
          body: broadcast.body,
          relatedEntityType: "Broadcast",
          relatedEntityId: broadcast.id,
          data: { broadcastId: broadcast.id, audienceType: broadcast.audienceType },
          recipients: { create: userIds.map((userId) => ({ userId })) },
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "Broadcast",
          aggregateId: broadcast.id,
          eventType: "broadcast.sent",
          payload: { broadcastId: broadcast.id, notificationId: notification.id },
          idempotencyKey: `broadcast.sent:${broadcast.id}`,
        },
      });
      const deliveredAt = new Date();
      await tx.broadcastRecipient.updateMany({
        where: { broadcastId: id, userId: { in: userIds } },
        data: { status: "DELIVERED", deliveredAt },
      });
      const updated = await tx.broadcast.update({
        where: { id },
        data: { status: "SENT", deliveredCount: userIds.length, failedCount: 0 },
      });
      await this.audit.record({
        actorId: actor.id,
        action: "broadcast.sent",
        entityType: "Broadcast",
        entityId: id,
        afterValue: { totalRecipients: userIds.length, sentAt: new Date() },
        requestId,
      }, tx);
      return updated;
    });
    return result;
  }

  private async activeSelectedRecipients(collegeId: string, broadcastId: string, legacyAudienceValue?: string): Promise<string[]> {
    const selected = await this.prisma.broadcastRecipient.findMany({ where: { broadcastId }, select: { userId: true } });
    if (!selected.length && legacyAudienceValue) {
      return this.resolveRecipients(collegeId, "INDIVIDUAL", legacyAudienceValue);
    }
    if (!selected.length) return [];
    const users = await this.prisma.user.findMany({
      where: { collegeId, status: "ACTIVE", archivedAt: null, id: { in: selected.map(({ userId }) => userId) } },
      select: { id: true },
    });
    return users.map(({ id }) => id);
  }

  async cancel(actor: AuthPrincipal, id: string, requestId: string) {
    if (!actor.permissions.includes("broadcasts.create")) {
      throw new ForbiddenException("You do not have permission to cancel broadcasts.");
    }
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id, collegeId: actor.collegeId, authorId: actor.id },
    });
    if (!broadcast) throw new NotFoundException("Broadcast not found or you are not the author.");
    if (!["DRAFT", "SCHEDULED"].includes(broadcast.status)) {
      throw new BadRequestException("Only DRAFT or SCHEDULED broadcasts can be cancelled.");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const b = await tx.broadcast.update({
        where: { id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await this.audit.record({
        actorId: actor.id,
        action: "broadcast.cancelled",
        entityType: "Broadcast",
        entityId: id,
        beforeValue: { status: broadcast.status },
        afterValue: { status: "CANCELLED" },
        requestId,
      }, tx);
      return b;
    });
    return updated;
  }

  private async resolveRecipients(collegeId: string, audienceType: string, audienceValue?: string): Promise<string[]> {
    const now = new Date();
    const baseWhere = { collegeId, status: "ACTIVE" as const, archivedAt: null };

    if (audienceType === "ALL") {
      const users = await this.prisma.user.findMany({ where: baseWhere, select: { id: true } });
      return users.map((u) => u.id);
    }
    if (audienceType === "ROLE") {
      if (!audienceValue) return [];
      const users = await this.prisma.user.findMany({
        where: {
          ...baseWhere,
          roles: { some: { validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }], role: { code: audienceValue, isActive: true } } },
        },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }
    if (audienceType === "DEPARTMENT") {
      if (!audienceValue) return [];
      const users = await this.prisma.user.findMany({
        where: {
          ...baseWhere,
          OR: [
            { studentProfile: { departmentId: audienceValue } },
            { staffProfile: { departmentId: audienceValue } },
          ],
        },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }
    if (audienceType === "PROGRAMME") {
      if (!audienceValue) return [];
      const users = await this.prisma.user.findMany({
        where: { ...baseWhere, studentProfile: { programmeId: audienceValue } },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }
    if (audienceType === "ACADEMIC_YEAR") {
      if (!audienceValue) return [];
      const users = await this.prisma.user.findMany({
        where: { ...baseWhere, studentProfile: { section: { semester: { academicYearId: audienceValue } } } },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }
    if (audienceType === "SEMESTER") {
      if (!audienceValue) return [];
      const users = await this.prisma.user.findMany({
        where: { ...baseWhere, studentProfile: { section: { semesterId: audienceValue } } },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }
    if (audienceType === "SECTION") {
      if (!audienceValue) return [];
      const users = await this.prisma.user.findMany({
        where: {
          ...baseWhere,
          studentProfile: { sectionId: audienceValue },
        },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }
    if (audienceType === "INDIVIDUAL") {
      if (!audienceValue) return [];
      const values = audienceValue.split(",").map((value) => value.trim()).filter(Boolean);
      const users = await this.prisma.user.findMany({
        where: { ...baseWhere, OR: [{ id: { in: values } }, { publicId: { in: values } }, { collegeIdentityId: { in: values } }] },
        select: { id: true },
      });
      return users.map((recipient) => recipient.id);
    }
    return [];
  }
}
