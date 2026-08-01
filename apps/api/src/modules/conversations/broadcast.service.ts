import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { CreateBroadcastDto } from "./dto/broadcast.dto";

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

  async create(actor: AuthPrincipal, input: CreateBroadcastDto, requestId: string) {
    if (!actor.permissions.includes("broadcasts.create")) {
      throw new ForbiddenException("You do not have permission to create broadcasts.");
    }
    if (!input.title?.trim()) throw new BadRequestException("Title is required.");
    if (!input.body?.trim()) throw new BadRequestException("Message body is required.");
    if (!["ALL", "ROLE", "DEPARTMENT", "SECTION", "INDIVIDUAL"].includes(input.audienceType)) {
      throw new BadRequestException("Invalid audience type.");
    }
    if (["ROLE", "DEPARTMENT", "SECTION", "INDIVIDUAL"].includes(input.audienceType) && !input.audienceValue?.trim()) {
      throw new BadRequestException(`audienceValue is required for audienceType '${input.audienceType}'.`);
    }

    const broadcast = await this.prisma.$transaction(async (tx) => {
      const created = await tx.broadcast.create({
        data: {
          collegeId: actor.collegeId,
          authorId: actor.id,
          title: input.title.trim(),
          body: input.body.trim(),
          audienceType: input.audienceType,
          audienceValue: input.audienceValue?.trim(),
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
          status: input.scheduledAt ? "SCHEDULED" : "DRAFT",
        },
      });
      await this.audit.record({
        actorId: actor.id,
        action: "broadcast.created",
        entityType: "Broadcast",
        entityId: created.id,
        afterValue: { title: created.title, audienceType: created.audienceType, audienceValue: created.audienceValue },
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
    const userIds = await this.resolveRecipients(actor.collegeId, broadcast.audienceType, broadcast.audienceValue ?? undefined);
    if (!userIds.length) throw new BadRequestException("No eligible recipients found for this broadcast.");

    const result = await this.prisma.$transaction(async (tx) => {
      // Create recipient records
      await tx.broadcastRecipient.createMany({
        data: userIds.map((userId) => ({ broadcastId: id, userId })),
        skipDuplicates: true,
      });
      const updated = await tx.broadcast.update({
        where: { id },
        data: {
          status: "SENDING",
          totalRecipients: userIds.length,
          sentAt: new Date(),
        },
      });
      // Deliver via conversation messages (system broadcast as a direct message to each)
      // For now, mark all as delivered synchronously (no external push service configured)
      await tx.broadcastRecipient.updateMany({
        where: { broadcastId: id },
        data: { status: "DELIVERED", deliveredAt: new Date() },
      });
      await tx.broadcast.update({
        where: { id },
        data: { status: "SENT", deliveredCount: userIds.length },
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
      const user = await this.prisma.user.findFirst({
        where: { ...baseWhere, OR: [{ id: audienceValue }, { collegeIdentityId: audienceValue }] },
        select: { id: true },
      });
      return user ? [user.id] : [];
    }
    return [];
  }
}
