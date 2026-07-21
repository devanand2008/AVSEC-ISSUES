import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { addMinutes } from "date-fns";
import { createHash } from "node:crypto";
import { AccessService } from "../../common/access/access.service";
import { IdempotencyService } from "../../common/idempotency/idempotency.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { IssueStatus, Prisma } from "../../generated/prisma/client";
import type { AssignIssueDto, CreateIssueDto, IssueCommentDto, IssueStatusDto, VerifyIssueDto } from "./dto/issue.dto";
import { RoutingService } from "./routing.service";
import { SlaService } from "./sla.service";
import { DuplicateSubscriptionProofService } from "./duplicate-subscription-proof.service";

interface RequestMetadata { requestId: string; ipAddress?: string; userAgent?: string }
interface IssueRoomQrContext {
  id: string;
  qrToken: string;
  floorId: string;
  floor: {
    id: string;
    blockId: string;
    block: {
      id: string;
    };
  };
}

const ACTIVE_STATUSES: IssueStatus[] = ["NEW", "NEEDS_MANUAL_ASSIGNMENT", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "WAITING_FOR_MATERIAL", "WAITING_FOR_VENDOR", "ON_HOLD", "RESOLVED", "VERIFICATION_PENDING", "REOPENED"];
const GENERIC_ISSUE_QR_TOKEN = /^QR_[A-Za-z0-9_-]{24,160}$/;
const TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  NEW: ["ASSIGNED", "NEEDS_MANUAL_ASSIGNMENT", "CANCELLED", "REJECTED"],
  NEEDS_MANUAL_ASSIGNMENT: ["ASSIGNED", "CANCELLED", "REJECTED"],
  ASSIGNED: ["ACKNOWLEDGED", "CANCELLED", "REJECTED"],
  ACKNOWLEDGED: ["IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_MATERIAL", "WAITING_FOR_VENDOR", "ON_HOLD", "RESOLVED"],
  WAITING_FOR_MATERIAL: ["IN_PROGRESS", "RESOLVED", "ON_HOLD"],
  WAITING_FOR_VENDOR: ["IN_PROGRESS", "RESOLVED", "ON_HOLD"],
  ON_HOLD: ["IN_PROGRESS", "CANCELLED"],
  RESOLVED: ["VERIFICATION_PENDING", "VERIFIED", "REOPENED"],
  VERIFICATION_PENDING: ["VERIFIED", "REOPENED"],
  VERIFIED: ["CLOSED", "REOPENED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "CANCELLED"],
  REJECTED: [],
  CANCELLED: [],
};

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly idempotency: IdempotencyService,
    private readonly routing: RoutingService,
    private readonly slaService: SlaService,
    private readonly duplicateProofs: DuplicateSubscriptionProofService,
  ) {}

  async create(user: AuthPrincipal, input: CreateIssueDto, idempotencyKey: string, metadata: RequestMetadata) {
    if (!idempotencyKey || idempotencyKey.length > 120) throw new BadRequestException("A valid Idempotency-Key header is required.");
    const requestHash = this.idempotency.hash(input);
    const replay = await this.idempotency.replay(user.id, "/issues", idempotencyKey, requestHash);
    if (replay) return replay;

    const room = await this.prisma.room.findFirst({
      where: { id: input.roomId, isActive: true, floor: { isActive: true, block: { isActive: true, campus: { collegeId: user.collegeId, isActive: true } } } },
      include: { floor: { include: { block: { include: { campus: true } } } } },
    });
    if (!room) throw new BadRequestException("The selected location is not active.");
    const category = await this.prisma.issueCategory.findFirst({ where: { id: input.categoryId, collegeId: user.collegeId, isActive: true } });
    if (!category) throw new BadRequestException("The selected issue category is not active.");
    const issueType = input.issueTypeId ? await this.prisma.issueType.findFirst({ where: { id: input.issueTypeId, categoryId: category.id, isActive: true } }) : null;
    if (input.issueTypeId && !issueType) throw new BadRequestException("The selected common problem is not active for this category.");
    if (input.assetId) {
      const asset = await this.prisma.asset.findFirst({ where: { id: input.assetId, roomId: room.id, isActive: true } });
      if (!asset) throw new BadRequestException("The selected asset is not active in this room.");
    }
    const submissionSource = input.submissionSource === "QR_SCAN" ? "QR_SCAN" : "MANUAL";
    const qrToken = input.qrToken?.trim();
    if (submissionSource === "QR_SCAN") {
      if (!qrToken) throw new BadRequestException("A scanned QR token is required for QR issue submissions.");
      await this.validateIssueQrToken(user, qrToken, room);
    }
    const duplicate = await this.prisma.issue.findFirst({
      where: { collegeId: user.collegeId, roomId: room.id, categoryId: category.id, issueTypeId: input.issueTypeId ?? null, assetId: input.assetId ?? null, status: { in: ACTIVE_STATUSES } },
      select: { id: true, issueNumber: true, title: true, status: true, affectedUserCount: true },
      orderBy: { createdAt: "desc" },
    });
    if (duplicate && !input.createDespiteDuplicate) {
      throw new ConflictException({
        code: "PROBABLE_DUPLICATE",
        message: "A probable active duplicate exists.",
        duplicate: { ...duplicate, ...this.duplicateProofs.issue(user.id, duplicate.id) },
      });
    }
    const priority = input.prioritySuggestion ?? issueType?.defaultPriority ?? "MEDIUM";
    const decision = await this.routing.route({
      collegeId: user.collegeId, campusId: room.floor.block.campusId, blockId: room.floor.blockId, floorId: room.floorId,
      roomId: room.id, roomType: room.roomType, departmentId: room.departmentId, categoryId: category.id,
      issueTypeId: issueType?.id ?? null, assetId: input.assetId ?? null, priority,
    });
    const sla = await this.prisma.issueSlaPolicy.findFirst({ where: { collegeId: user.collegeId, priority, isActive: true } });
    const now = new Date();
    const deadlines = await this.slaService.deadlines(user.collegeId, sla, now);
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ value: bigint }>>(Prisma.sql`SELECT nextval('issue_number_seq') AS value`);
      const sequence = rows[0]?.value;
      if (sequence === undefined) throw new Error("Issue number sequence returned no value.");
      const issueNumber = `ISS-${now.getUTCFullYear()}-${sequence.toString().padStart(6, "0")}`;
      const issue = await tx.issue.create({
        data: {
          issueNumber, collegeId: user.collegeId, campusId: room.floor.block.campusId, blockId: room.floor.blockId,
          floorId: room.floorId, roomId: room.id, departmentId: room.departmentId, categoryId: category.id,
          issueTypeId: issueType?.id, assetId: input.assetId, reporterId: user.id, title: input.title.trim(),
          description: input.description.trim(), exactPosition: input.exactPosition?.trim(), submissionSource,
          qrToken: submissionSource === "QR_SCAN" ? qrToken : undefined,
          scannedLocationId: submissionSource === "QR_SCAN" ? room.id : undefined,
          priority,
          status: decision.fallback ? "NEEDS_MANUAL_ASSIGNMENT" : "ASSIGNED", teamId: decision.teamId,
          assignedToId: decision.assignedToId, routingRuleId: decision.routingRuleId, routingSnapshot: decision.snapshot,
          slaPolicyId: sla?.id, acknowledgementDueAt: deadlines.acknowledgementDueAt,
          resolutionDueAt: deadlines.resolutionDueAt,
        },
      });
      await tx.issueAffectedUser.create({ data: { issueId: issue.id, userId: user.id } });
      await tx.issueStatusHistory.create({ data: { issueId: issue.id, newStatus: issue.status, changedById: user.id, comment: "Issue submitted.", requestId: metadata.requestId, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent } });
      await tx.issueAssignmentHistory.create({ data: { issueId: issue.id, assignedUserId: decision.assignedToId, assignedTeamId: decision.teamId, routingRuleId: decision.routingRuleId, reason: decision.reason, snapshot: decision.snapshot } });
      const recipientIds = new Set([user.id, ...(decision.assignedToId ? [decision.assignedToId] : [])]);
      if (decision.fallback) {
        const admins = await tx.user.findMany({ where: { collegeId: user.collegeId, status: "ACTIVE", roles: { some: { role: { code: "MAIN_ADMIN" } } } }, select: { id: true } });
        admins.forEach((admin) => recipientIds.add(admin.id));
      }
      const notification = await tx.notification.create({
        data: { type: decision.fallback ? "ISSUE_MANUAL_ASSIGNMENT_REQUIRED" : "ISSUE_ASSIGNED", title: `${issueNumber}: ${input.title.trim()}`, body: decision.reason, priority, relatedEntityType: "Issue", relatedEntityId: issue.id, data: { issueNumber }, recipients: { create: [...recipientIds].map((userId) => ({ userId })) } },
      });
      await tx.outboxEvent.create({ data: { aggregateType: "Issue", aggregateId: issue.id, eventType: "issue.created", payload: { issueId: issue.id, notificationId: notification.id, assignedToId: decision.assignedToId }, idempotencyKey: `issue.created:${issue.id}` } });
      const response = { id: issue.id, issueNumber, status: issue.status, submissionSource: issue.submissionSource, assignedTeamId: issue.teamId, assignedToId: issue.assignedToId, acknowledgementDueAt: issue.acknowledgementDueAt, resolutionDueAt: issue.resolutionDueAt };
      await tx.idempotencyKey.create({ data: { actorId: user.id, endpoint: "/issues", key: idempotencyKey, requestHash, responseStatus: 201, responseBody: response, resourceId: issue.id, expiresAt: addMinutes(now, 24 * 60) } });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return result;
  }

  async list(user: AuthPrincipal, page: number, pageSize: number, filters: { status?: IssueStatus; search?: string; assigned?: boolean }) {
    const where: Prisma.IssueWhereInput = {
      AND: [this.access.issueWhere(user), filters.status ? { status: filters.status } : {}, filters.assigned ? { assignedToId: user.id } : {}, filters.search ? { OR: [{ issueNumber: { contains: filters.search, mode: "insensitive" } }, { title: { contains: filters.search, mode: "insensitive" } }] } : {}],
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.issue.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: "desc" }, select: this.issueListSelect() }),
      this.prisma.issue.count({ where }),
    ]);
    return { data, meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
  }

  async assignmentOptions(user: AuthPrincipal) {
    const teams = await this.prisma.responsibleTeam.findMany({
      where: { collegeId: user.collegeId, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        members: {
          where: { isActive: true, user: { status: "ACTIVE" } },
          select: {
            isPrimary: true,
            maxOpenIssues: true,
            user: { select: { id: true, publicId: true, fullName: true, _count: { select: { assignedIssues: { where: { status: { in: ACTIVE_STATUSES } } } } } } },
          },
        },
      },
      orderBy: { name: "asc" },
    });
    return teams.map((team) => ({
      id: team.id,
      code: team.code,
      name: team.name,
      members: team.members.map((member) => ({ id: member.user.id, publicId: member.user.publicId, fullName: member.user.fullName, isPrimary: member.isPrimary, maxOpenIssues: member.maxOpenIssues, openIssues: member.user._count.assignedIssues })),
    }));
  }

  async detail(user: AuthPrincipal, id: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { AND: [{ id }, this.access.issueWhere(user)] },
      include: { room: { include: { floor: { include: { block: { include: { campus: true } } } } } }, category: true, issueType: true, asset: true, reporter: { select: { publicId: true, fullName: true } }, assignedTo: { select: { publicId: true, fullName: true } }, team: { select: { id: true, name: true } }, comments: { where: { deletedAt: null, ...(user.permissions.includes("issues.update_work") ? {} : { isInternal: false }) }, include: { author: { select: { publicId: true, fullName: true } } }, orderBy: { createdAt: "asc" } }, statusHistory: { include: { changedBy: { select: { publicId: true, fullName: true } } }, orderBy: { createdAt: "asc" } }, attachments: { where: { deletedAt: null }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true, purpose: true, sha256: true, createdAt: true, uploadedBy: { select: { publicId: true, fullName: true } } } } },
    });
    if (!issue) throw new NotFoundException("Issue not found.");
    return issue;
  }

  async status(user: AuthPrincipal, id: string, input: IssueStatusDto, metadata: RequestMetadata, verificationAction = false) {
    const issue = await this.prisma.issue.findFirst({ where: { AND: [{ id }, this.access.issueWhere(user)] } });
    if (!issue) throw new NotFoundException("Issue not found.");
    if (!TRANSITIONS[issue.status].includes(input.status)) throw new ConflictException(`Cannot move an issue from ${issue.status} to ${input.status}.`);
    const teamMember = issue.teamId ? Boolean(await this.prisma.responsibleTeamMember.findFirst({ where: { teamId: issue.teamId, userId: user.id, isActive: true } })) : false;
    if (["VERIFIED", "CLOSED"].includes(input.status) && !verificationAction) throw new ForbiddenException("Use the resolution verification action for this transition.");
    if (verificationAction && issue.reporterId !== user.id && !user.permissions.includes("issues.verify")) throw new ForbiddenException("You are not an authorized verifier for this issue.");
    const requiredPermission: Partial<Record<IssueStatus, string>> = {
      ASSIGNED: "issues.assign", NEEDS_MANUAL_ASSIGNMENT: "issues.assign", ACKNOWLEDGED: "issues.acknowledge",
      IN_PROGRESS: "issues.start", WAITING_FOR_MATERIAL: "issues.update_work", WAITING_FOR_VENDOR: "issues.update_work",
      ON_HOLD: "issues.update_work", RESOLVED: "issues.resolve", REJECTED: "issues.reject", CANCELLED: "issues.cancel",
    };
    const required = requiredPermission[input.status];
    if (required && !user.permissions.includes(required)) throw new ForbiddenException(`The ${required} permission is required for this transition.`);
    if (input.status === "REOPENED" && issue.reporterId !== user.id && !user.permissions.includes("issues.reopen") && !(verificationAction && user.permissions.includes("issues.verify"))) throw new ForbiddenException("Only the reporter or an authorized verifier may reopen this issue.");
    if (["REOPENED", "REJECTED", "CANCELLED", "ON_HOLD"].includes(input.status) && !input.comment?.trim()) throw new BadRequestException("A reason is required for this transition.");
    const adminOnly = ["REJECTED", "CANCELLED"];
    if (adminOnly.includes(input.status) && !user.permissions.includes(input.status === "REJECTED" ? "issues.reject" : "issues.cancel")) throw new ForbiddenException("Only an authorized administrator may perform this transition.");
    if (adminOnly.includes(input.status) && !input.comment?.trim()) throw new BadRequestException("A reason is required.");
    const reporterReopen = input.status === "REOPENED" && issue.reporterId === user.id;
    if (!adminOnly.includes(input.status) && !reporterReopen && !verificationAction && !this.access.canWorkIssue(user, issue, teamMember)) {
      throw new ForbiddenException("Only assigned responsible staff may update this issue.");
    }
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.issue.updateMany({
        where: { id: issue.id, version: issue.version },
        data: { status: input.status, version: { increment: 1 }, acknowledgedAt: input.status === "ACKNOWLEDGED" ? new Date() : undefined, resolvedAt: input.status === "RESOLVED" ? new Date() : undefined, closedAt: input.status === "CLOSED" ? new Date() : undefined },
      });
      if (changed.count !== 1) throw new ConflictException("The issue changed while this action was being processed. Refresh and try again.");
      const updated = await tx.issue.findUniqueOrThrow({ where: { id: issue.id } });
      await tx.issueStatusHistory.create({ data: { issueId: issue.id, previousStatus: issue.status, newStatus: input.status, changedById: user.id, comment: input.comment?.trim(), requestId: metadata.requestId, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent } });
      const affected = await tx.issueAffectedUser.findMany({ where: { issueId: issue.id }, select: { userId: true } });
      const notifyIds = new Set([issue.reporterId, ...(issue.assignedToId ? [issue.assignedToId] : []), ...affected.map((entry) => entry.userId)]);
      const notification = await tx.notification.create({ data: { type: "ISSUE_STATUS_CHANGED", title: `${issue.issueNumber} is now ${input.status.replaceAll("_", " ")}`, body: input.comment?.trim() ?? "The issue status was updated.", priority: issue.priority, relatedEntityType: "Issue", relatedEntityId: issue.id, recipients: { create: [...notifyIds].map((userId) => ({ userId })) } } });
      await tx.outboxEvent.create({ data: { aggregateType: "Issue", aggregateId: issue.id, eventType: "issue.status_changed", payload: { issueId: issue.id, notificationId: notification.id, status: input.status }, idempotencyKey: `issue.status:${issue.id}:${updated.version}` } });
      return updated;
    });
  }

  async assign(user: AuthPrincipal, id: string, input: AssignIssueDto, metadata: RequestMetadata) {
    const issue = await this.prisma.issue.findFirst({ where: { AND: [{ id }, this.access.issueWhere(user)] } });
    if (!issue) throw new NotFoundException("Issue not found.");
    if (!input.teamId && !input.userId) throw new BadRequestException("Select a team or responsible person.");
    if (!["NEW", "NEEDS_MANUAL_ASSIGNMENT", "ASSIGNED", "REOPENED"].includes(issue.status)) throw new ConflictException(`An issue in ${issue.status} cannot be reassigned.`);
    if (input.teamId) {
      const team = await this.prisma.responsibleTeam.findFirst({ where: { id: input.teamId, collegeId: user.collegeId, isActive: true } });
      if (!team) throw new BadRequestException("Responsible team is not active in this college.");
    }
    if (input.userId) {
      const target = await this.prisma.user.findFirst({ where: { id: input.userId, collegeId: user.collegeId, status: "ACTIVE" } });
      if (!target) throw new BadRequestException("Responsible user is not active.");
      if (input.teamId && !await this.prisma.responsibleTeamMember.findFirst({ where: { teamId: input.teamId, userId: input.userId, isActive: true } })) throw new BadRequestException("Responsible user is not an active member of the selected team.");
    }
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.issue.updateMany({
        where: { id, version: issue.version, status: issue.status },
        data: { teamId: input.teamId ?? null, assignedToId: input.userId ?? null, status: "ASSIGNED", version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ConflictException("The issue changed while assignment was being processed. Refresh and try again.");
      const updated = await tx.issue.findUniqueOrThrow({ where: { id } });
      await tx.issueAssignmentHistory.create({ data: { issueId: id, previousUserId: issue.assignedToId, assignedUserId: input.userId ?? null, assignedTeamId: input.teamId ?? null, assignedById: user.id, reason: input.reason } });
      if (issue.status !== "ASSIGNED") {
        await tx.issueStatusHistory.create({ data: { issueId: id, previousStatus: issue.status, newStatus: "ASSIGNED", changedById: user.id, comment: input.reason, requestId: metadata.requestId, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent } });
      }
      const teamMembers = input.teamId
        ? await tx.responsibleTeamMember.findMany({ where: { teamId: input.teamId, isActive: true }, select: { userId: true } })
        : [];
      const recipientIds = new Set([issue.reporterId, ...(input.userId ? [input.userId] : []), ...teamMembers.map((member) => member.userId)]);
      const notification = await tx.notification.create({
        data: {
          type: "ISSUE_ASSIGNED",
          title: `${issue.issueNumber} has been assigned`,
          body: input.reason.trim(),
          priority: issue.priority,
          relatedEntityType: "Issue",
          relatedEntityId: id,
          data: { issueNumber: issue.issueNumber, teamId: input.teamId ?? null, assignedToId: input.userId ?? null },
          recipients: { create: [...recipientIds].map((userId) => ({ userId })) },
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "Issue",
          aggregateId: id,
          eventType: "issue.status_changed",
          payload: { issueId: id, notificationId: notification.id, status: "ASSIGNED", assignment: true },
          idempotencyKey: `issue.assigned:${id}:${updated.version}`,
        },
      });
      return updated;
    });
  }

  async comment(user: AuthPrincipal, id: string, input: IssueCommentDto) {
    const issue = await this.prisma.issue.findFirst({ where: { AND: [{ id }, this.access.issueWhere(user)] }, select: { id: true } });
    if (!issue) throw new NotFoundException("Issue not found.");
    if (input.isInternal && !user.permissions.includes("issues.update_work")) throw new ForbiddenException("Internal notes are restricted to responsible staff.");
    return this.prisma.issueComment.create({ data: { issueId: id, authorId: user.id, body: input.body.trim(), isInternal: input.isInternal ?? false } });
  }

  async subscribe(user: AuthPrincipal, id: string, duplicateSubscriptionProof?: string) {
    const issue = await this.prisma.issue.findFirst({ where: { id, collegeId: user.collegeId, status: { in: ACTIVE_STATUSES } } });
    if (!issue) throw new NotFoundException("Active issue not found.");
    const visible = await this.prisma.issue.findFirst({
      where: { AND: [{ id, status: { in: ACTIVE_STATUSES } }, this.access.issueWhere(user)] },
      select: { id: true },
    });
    if (!visible && !this.duplicateProofs.verify(user.id, issue.id, duplicateSubscriptionProof)) {
      throw new ForbiddenException("A valid, unexpired duplicate-subscription proof is required.");
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.issueAffectedUser.findUnique({ where: { issueId_userId: { issueId: id, userId: user.id } } });
      if (!existing) {
        await tx.issueAffectedUser.create({ data: { issueId: id, userId: user.id } });
        await tx.issue.update({ where: { id }, data: { affectedUserCount: { increment: 1 } } });
      }
      return { subscribed: true, alreadySubscribed: Boolean(existing) };
    });
  }

  async verify(user: AuthPrincipal, id: string, input: VerifyIssueDto, metadata: RequestMetadata) {
    const issue = await this.prisma.issue.findFirst({ where: { AND: [{ id }, this.access.issueWhere(user)] } });
    if (!issue) throw new NotFoundException("Issue not found.");
    if (issue.reporterId !== user.id && !user.permissions.includes("issues.verify")) throw new ForbiddenException("You cannot verify this issue.");
    if (!["RESOLVED", "VERIFICATION_PENDING"].includes(issue.status)) throw new ConflictException("This issue is not awaiting verification.");
    return this.prisma.$transaction(async (tx) => {
      await tx.resolutionVerification.create({ data: { issueId: id, verifierId: user.id, accepted: input.accepted, comment: input.comment?.trim() } });
      const finalStatus: IssueStatus = input.accepted ? "CLOSED" : "REOPENED";
      const changed = await tx.issue.updateMany({
        where: { id, version: issue.version, status: issue.status },
        data: { status: finalStatus, version: { increment: input.accepted ? 2 : 1 }, closedAt: input.accepted ? new Date() : null },
      });
      if (changed.count !== 1) throw new ConflictException("The issue changed while verification was being processed. Refresh and try again.");
      if (input.accepted) {
        await tx.issueStatusHistory.createMany({ data: [
          { issueId: id, previousStatus: issue.status, newStatus: "VERIFIED", changedById: user.id, comment: input.comment?.trim() ?? "Resolution verified.", requestId: metadata.requestId, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent },
          { issueId: id, previousStatus: "VERIFIED", newStatus: "CLOSED", changedById: user.id, comment: "Closed after successful reporter verification.", requestId: metadata.requestId, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent },
        ] });
      } else {
        await tx.issueStatusHistory.create({ data: { issueId: id, previousStatus: issue.status, newStatus: "REOPENED", changedById: user.id, comment: input.comment?.trim() ?? "Resolution rejected and issue reopened.", requestId: metadata.requestId, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent } });
      }
      const affected = await tx.issueAffectedUser.findMany({ where: { issueId: id }, select: { userId: true } });
      const notifyIds = new Set([issue.reporterId, ...(issue.assignedToId ? [issue.assignedToId] : []), ...affected.map((entry) => entry.userId)]);
      const notification = await tx.notification.create({ data: { type: "ISSUE_STATUS_CHANGED", title: `${issue.issueNumber} is now ${finalStatus.replaceAll("_", " ")}`, body: input.comment?.trim() ?? (input.accepted ? "The resolution was verified and the issue was closed." : "The resolution was rejected and the issue was reopened."), priority: issue.priority, relatedEntityType: "Issue", relatedEntityId: id, recipients: { create: [...notifyIds].map((userId) => ({ userId })) } } });
      const updated = await tx.issue.findUniqueOrThrow({ where: { id } });
      await tx.outboxEvent.create({ data: { aggregateType: "Issue", aggregateId: id, eventType: "issue.status_changed", payload: { issueId: id, notificationId: notification.id, status: finalStatus }, idempotencyKey: `issue.status:${id}:${updated.version}` } });
      return updated;
    });
  }

  categories(user: AuthPrincipal) { return this.prisma.issueCategory.findMany({ where: { collegeId: user.collegeId, isActive: true }, select: { id: true, code: true, name: true, description: true, icon: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }); }
  issueTypes(user: AuthPrincipal, categoryId: string) { return this.prisma.issueType.findMany({ where: { categoryId, category: { collegeId: user.collegeId }, isActive: true }, select: { id: true, code: true, name: true, defaultPriority: true, isOther: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }); }
  createCategory(user: AuthPrincipal, input: { code: string; name: string; description?: string }) { return this.prisma.issueCategory.create({ data: { collegeId: user.collegeId, code: input.code.trim().toUpperCase(), name: input.name.trim(), description: input.description?.trim() } }); }
  async createIssueType(user: AuthPrincipal, input: { categoryId: string; code: string; name: string; defaultPriority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "EMERGENCY"; isOther?: boolean }) {
    const category = await this.prisma.issueCategory.findFirst({ where: { id: input.categoryId, collegeId: user.collegeId, isActive: true }, select: { id: true } });
    if (!category) throw new BadRequestException("The selected issue category is not active in this college.");
    return this.prisma.issueType.create({ data: { categoryId: category.id, code: input.code.trim().toUpperCase(), name: input.name.trim(), defaultPriority: input.defaultPriority, isOther: input.isOther ?? false } });
  }

  /* ─── Admin category/type management ─── */

  adminCategories(user: AuthPrincipal) {
    return this.prisma.issueCategory.findMany({
      where: { collegeId: user.collegeId },
      include: { _count: { select: { issueTypes: true, issues: true, rules: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  adminIssueTypes(user: AuthPrincipal, categoryId?: string) {
    return this.prisma.issueType.findMany({
      where: { category: { collegeId: user.collegeId }, ...(categoryId ? { categoryId } : {}) },
      include: { category: { select: { id: true, name: true } }, _count: { select: { issues: true } } },
      orderBy: [{ category: { name: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async updateCategory(user: AuthPrincipal, id: string, input: { name?: string; description?: string; icon?: string; isActive?: boolean; sortOrder?: number }) {
    const existing = await this.prisma.issueCategory.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!existing) throw new NotFoundException("Issue category not found.");
    return this.prisma.issueCategory.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.icon !== undefined ? { icon: input.icon.trim() } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
  }

  async updateIssueType(user: AuthPrincipal, id: string, input: { name?: string; defaultPriority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "EMERGENCY"; isActive?: boolean; isOther?: boolean; sortOrder?: number }) {
    const existing = await this.prisma.issueType.findFirst({ where: { id, category: { collegeId: user.collegeId } } });
    if (!existing) throw new NotFoundException("Issue type not found.");
    return this.prisma.issueType.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.defaultPriority !== undefined ? { defaultPriority: input.defaultPriority } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.isOther !== undefined ? { isOther: input.isOther } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
  }

  private issueListSelect() {
    return { id: true, issueNumber: true, title: true, status: true, priority: true, submissionSource: true, affectedUserCount: true, createdAt: true, acknowledgementDueAt: true, resolutionDueAt: true, room: { select: { name: true, code: true } }, category: { select: { name: true } }, assignedTo: { select: { publicId: true, fullName: true } }, team: { select: { id: true, name: true } } } as const;
  }

  private async validateIssueQrToken(user: AuthPrincipal, qrToken: string, room: IssueRoomQrContext): Promise<void> {
    if (qrToken === room.qrToken) return;
    if (!GENERIC_ISSUE_QR_TOKEN.test(qrToken)) {
      throw new BadRequestException("The scanned room QR token does not match the selected room.");
    }
    const qr = await this.prisma.qrCode.findUnique({
      where: { secureTokenHash: this.hashQrToken(qrToken) },
      select: { collegeId: true, qrType: true, entityId: true, status: true, expiryDate: true },
    });
    if (!qr) throw new BadRequestException("The scanned QR token is not recognized.");
    if (qr.collegeId !== user.collegeId) throw new BadRequestException("The scanned QR token belongs to another college.");
    if (qr.status !== "ACTIVE") throw new BadRequestException(`The scanned QR token is ${qr.status.toLowerCase()}.`);
    if (qr.expiryDate && qr.expiryDate < new Date()) throw new BadRequestException("The scanned QR token has expired.");
    const matchesBlock = qr.qrType === "BLOCK" && qr.entityId === room.floor.block.id;
    const matchesFloor = qr.qrType === "FLOOR" && qr.entityId === room.floor.id;
    if (!matchesBlock && !matchesFloor) {
      throw new BadRequestException("The scanned QR token does not match the selected room.");
    }
  }

  private hashQrToken(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
