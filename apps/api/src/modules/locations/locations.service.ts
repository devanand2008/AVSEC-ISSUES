import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { AuditService } from "../audit/audit.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import type {
  ArchiveLocationDto,
  CreateAreaDto,
  CreateBlockDto,
  CreateCampusDto,
  CreateFloorDto,
  CreateRoomDto,
  UpdateBlockDto,
  UpdateCampusDto,
  UpdateFloorDto,
  UpdateRoomDto,
} from "./dto/location.dto";

export type LocationKind = "campus" | "block" | "floor" | "room";

interface LocationFilters {
  search?: string;
  status?: string;
  parentId?: string;
}

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  campuses(user: AuthPrincipal) {
    return this.prisma.campus.findMany({
      where: { collegeId: user.collegeId, isActive: true, archivedAt: null },
      select: { id: true, code: true, name: true, address: true, contactNumber: true, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async blocks(user: AuthPrincipal, campusId: string) {
    const campus = await this.prisma.campus.findFirst({
      where: { id: campusId, collegeId: user.collegeId, isActive: true, archivedAt: null },
      select: { id: true },
    });
    if (!campus) throw new NotFoundException("Active campus not found in your college.");
    return this.prisma.block.findMany({
      where: { campusId, campus: { collegeId: user.collegeId, isActive: true, archivedAt: null }, isActive: true, archivedAt: null },
      select: { id: true, code: true, name: true, description: true, campusId: true, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async floors(user: AuthPrincipal, blockId: string) {
    const block = await this.prisma.block.findFirst({
      where: { id: blockId, isActive: true, archivedAt: null, campus: { collegeId: user.collegeId, isActive: true, archivedAt: null } },
      select: { id: true },
    });
    if (!block) throw new NotFoundException("Active block not found in your college.");
    return this.prisma.floor.findMany({
      where: { blockId, block: { campus: { collegeId: user.collegeId, archivedAt: null }, archivedAt: null }, isActive: true, archivedAt: null },
      select: { id: true, code: true, name: true, level: true, blockId: true, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { level: "asc" }],
    });
  }

  async rooms(user: AuthPrincipal, floorId: string) {
    await this.requireActiveFloor(user, floorId);
    return this.prisma.room.findMany({
      where: { floorId, floor: { block: { campus: { collegeId: user.collegeId, isActive: true, archivedAt: null }, isActive: true, archivedAt: null }, isActive: true, archivedAt: null }, isActive: true, archivedAt: null },
      select: { id: true, code: true, name: true, roomNumber: true, roomType: true, capacity: true, floorId: true, departmentId: true, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async areas(user: AuthPrincipal, floorId: string) {
    await this.requireActiveFloor(user, floorId);
    return this.prisma.area.findMany({
      where: {
        floorId,
        floor: {
          block: {
            campus: { collegeId: user.collegeId, isActive: true, archivedAt: null },
            isActive: true,
            archivedAt: null,
          },
          isActive: true,
          archivedAt: null,
        },
        isActive: true,
        archivedAt: null,
      },
      select: { id: true, code: true, name: true, description: true, floorId: true, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async adminList(user: AuthPrincipal, kind: LocationKind, filters: LocationFilters = {}) {
    const search = filters.search?.trim();
    const archived = filters.status === "ARCHIVED";
    const active = filters.status === "ACTIVE";
    const inactive = filters.status === "INACTIVE";
    const testData = filters.status === "TEST_DATA";
    const common = {
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { code: { contains: search, mode: "insensitive" as const } }] } : {}),
      ...(archived ? { archivedAt: { not: null } } : filters.status ? { archivedAt: null } : {}),
      ...(active ? { isActive: true } : inactive ? { isActive: false } : {}),
      ...(testData ? { isTestData: true } : {}),
    };
    switch (kind) {
      case "campus":
        return this.prisma.campus.findMany({
          where: { collegeId: user.collegeId, ...common },
          include: { _count: { select: { blocks: true, departments: true, issues: true } } },
          orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        });
      case "block":
        return this.prisma.block.findMany({
          where: { ...(filters.parentId ? { campusId: filters.parentId } : {}), campus: { collegeId: user.collegeId }, ...common },
          include: { campus: { select: { id: true, name: true, code: true } }, _count: { select: { floors: true, issues: true } } },
          orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        });
      case "floor":
        return this.prisma.floor.findMany({
          where: { ...(filters.parentId ? { blockId: filters.parentId } : {}), block: { campus: { collegeId: user.collegeId } }, ...common },
          include: { block: { select: { id: true, name: true, code: true, campus: { select: { id: true, name: true } } } }, _count: { select: { rooms: true, issues: true } } },
          orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }, { level: "asc" }],
        });
      case "room":
        return this.prisma.room.findMany({
          where: { ...(filters.parentId ? { floorId: filters.parentId } : {}), floor: { block: { campus: { collegeId: user.collegeId } } }, ...common },
          include: {
            department: { select: { id: true, code: true, name: true } },
            floor: { select: { id: true, name: true, block: { select: { id: true, name: true, campus: { select: { id: true, name: true } } } } } },
            _count: { select: { assignedSections: true, assets: true, issues: true, responsiblePeople: true } },
          },
          orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        });
    }
  }

  async assets(user: AuthPrincipal, location: { roomId?: string; areaId?: string }) {
    if (Boolean(location.roomId) === Boolean(location.areaId)) {
      throw new BadRequestException("Select either a room or an area to load assets.");
    }
    if (location.roomId) {
      const room = await this.prisma.room.findFirst({
        where: {
          id: location.roomId,
          isActive: true,
          archivedAt: null,
          floor: {
            isActive: true,
            archivedAt: null,
            block: {
              isActive: true,
              archivedAt: null,
              campus: { collegeId: user.collegeId, isActive: true, archivedAt: null },
            },
          },
        },
        select: { id: true },
      });
      if (!room) throw new NotFoundException("Active room not found in your college.");
    } else {
      const area = await this.prisma.area.findFirst({
        where: {
          id: location.areaId,
          isActive: true,
          archivedAt: null,
          floor: {
            isActive: true,
            archivedAt: null,
            block: {
              isActive: true,
              archivedAt: null,
              campus: { collegeId: user.collegeId, isActive: true, archivedAt: null },
            },
          },
        },
        select: { id: true },
      });
      if (!area) throw new NotFoundException("Active area not found in your college.");
    }
    return this.prisma.asset.findMany({
      where: {
        ...(location.roomId
          ? { roomId: location.roomId }
          : { areaId: location.areaId }),
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
        roomId: true,
        areaId: true,
        category: { select: { name: true } },
        room: { select: { code: true, name: true } },
        area: { select: { code: true, name: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  async roomByQr(user: AuthPrincipal, token: string) {
    const room = await this.prisma.room.findFirst({
      where: { qrToken: token, isActive: true, archivedAt: null, floor: { block: { campus: { collegeId: user.collegeId } } } },
      select: {
        id: true, code: true, name: true, roomType: true,
        floor: { select: { id: true, name: true, block: { select: { id: true, name: true, campus: { select: { id: true, name: true } } } } } },
      },
    });
    if (!room) throw new NotFoundException("Active room not found.");
    return room;
  }

  async roomQr(user: AuthPrincipal, id: string) {
    const room = await this.qrRoom(user, { id });
    return this.qrPayload(room);
  }

  async qrSheet(user: AuthPrincipal, floorId: string) {
    const floor = await this.prisma.floor.findFirst({ where: { id: floorId, archivedAt: null, block: { campus: { collegeId: user.collegeId } } }, select: { id: true, name: true, block: { select: { name: true, campus: { select: { name: true } } } } } });
    if (!floor) throw new NotFoundException("Floor not found.");
    const rooms = await this.prisma.room.findMany({ where: { floorId, isActive: true, archivedAt: null }, select: { id: true, code: true, name: true, roomNumber: true, roomType: true, qrToken: true, floor: { select: { name: true, block: { select: { name: true, campus: { select: { name: true } } } } } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 100 });
    return { floor, rooms: await Promise.all(rooms.map((room) => this.qrPayload(room))) };
  }

  async rotateQr(user: AuthPrincipal, id: string) {
    await this.qrRoom(user, { id });
    const room = await this.prisma.room.update({ where: { id }, data: { qrToken: randomUUID() }, select: { id: true, code: true, name: true, roomNumber: true, roomType: true, qrToken: true, floor: { select: { name: true, block: { select: { name: true, campus: { select: { name: true } } } } } } } });
    return this.qrPayload(room);
  }

  async createCampus(user: AuthPrincipal, input: CreateCampusDto, requestId: string) {
    const campus = await this.prisma.$transaction(async (tx) => {
      const created = await tx.campus.create({ data: { collegeId: user.collegeId, code: input.code.trim().toUpperCase(), name: input.name.trim(), address: input.address?.trim(), contactNumber: input.contactNumber?.trim(), isActive: input.isActive ?? true, sortOrder: input.sortOrder ?? 0 } });
      await this.audit.record({ actorId: user.id, action: "location.campus_created", entityType: "Campus", entityId: created.id, afterValue: created, requestId }, tx);
      return created;
    });
    return campus;
  }

  async createBlock(user: AuthPrincipal, input: CreateBlockDto, requestId: string) {
    const campus = await this.prisma.campus.findFirst({ where: { id: input.campusId, collegeId: user.collegeId, isActive: true, archivedAt: null } });
    if (!campus) throw new BadRequestException("The selected campus is not active.");
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.block.create({ data: { ...input, description: input.description?.trim(), code: input.code.trim().toUpperCase(), name: input.name.trim() } });
      await this.audit.record({ actorId: user.id, action: "location.block_created", entityType: "Block", entityId: created.id, afterValue: created, requestId }, tx);
      return created;
    });
  }

  async createFloor(user: AuthPrincipal, input: CreateFloorDto, requestId: string) {
    const block = await this.prisma.block.findFirst({ where: { id: input.blockId, archivedAt: null, campus: { collegeId: user.collegeId }, isActive: true } });
    if (!block) throw new BadRequestException("The selected block is not active.");
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.floor.create({ data: { ...input, code: input.code.trim().toUpperCase(), name: input.name.trim() } });
      await this.audit.record({ actorId: user.id, action: "location.floor_created", entityType: "Floor", entityId: created.id, afterValue: created, requestId }, tx);
      return created;
    });
  }

  async createRoom(user: AuthPrincipal, input: CreateRoomDto, requestId: string) {
    await this.validateRoomParents(user, input.floorId, input.departmentId);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.room.create({ data: { ...input, code: input.code.trim().toUpperCase(), name: input.name.trim(), roomNumber: input.roomNumber?.trim() } });
      await this.audit.record({ actorId: user.id, action: "location.room_created", entityType: "Room", entityId: created.id, afterValue: created, requestId }, tx);
      return created;
    });
  }

  async createArea(user: AuthPrincipal, input: CreateAreaDto, requestId: string) {
    await this.validateRoomParents(user, input.floorId);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.area.create({
        data: {
          floorId: input.floorId,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          description: input.description?.trim(),
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true,
        },
      });
      await this.audit.record({ actorId: user.id, action: "location.area_created", entityType: "Area", entityId: created.id, afterValue: created, requestId }, tx);
      return created;
    });
  }

  private async requireActiveFloor(user: AuthPrincipal, floorId: string): Promise<void> {
    const floor = await this.prisma.floor.findFirst({
      where: {
        id: floorId,
        isActive: true,
        archivedAt: null,
        block: {
          isActive: true,
          archivedAt: null,
          campus: { collegeId: user.collegeId, isActive: true, archivedAt: null },
        },
      },
      select: { id: true },
    });
    if (!floor) throw new NotFoundException("Active floor not found in your college.");
  }

  async updateCampus(user: AuthPrincipal, id: string, input: UpdateCampusDto, requestId: string) {
    const existing = await this.requireLocation(user, "campus", id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.campus.update({ where: { id }, data: {
        ...(input.code !== undefined ? { code: input.code.trim().toUpperCase() } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.address !== undefined ? { address: input.address?.trim() || null } : {}),
        ...(input.contactNumber !== undefined ? { contactNumber: input.contactNumber?.trim() || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.isTestData !== undefined ? { isTestData: input.isTestData } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      } });
      await this.audit.record({ actorId: user.id, action: "location.campus_updated", entityType: "Campus", entityId: id, beforeValue: existing, afterValue: updated, requestId }, tx);
      return updated;
    });
  }

  async updateBlock(user: AuthPrincipal, id: string, input: UpdateBlockDto, requestId: string) {
    const existing = await this.requireLocation(user, "block", id);
    if (input.campusId) await this.requireLocation(user, "campus", input.campusId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.block.update({ where: { id }, data: {
        ...(input.campusId !== undefined ? { campusId: input.campusId } : {}),
        ...(input.code !== undefined ? { code: input.code.trim().toUpperCase() } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.isTestData !== undefined ? { isTestData: input.isTestData } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      } });
      await this.audit.record({ actorId: user.id, action: "location.block_updated", entityType: "Block", entityId: id, beforeValue: existing, afterValue: updated, requestId }, tx);
      return updated;
    });
  }

  async updateFloor(user: AuthPrincipal, id: string, input: UpdateFloorDto, requestId: string) {
    const existing = await this.requireLocation(user, "floor", id);
    if (input.blockId) await this.requireLocation(user, "block", input.blockId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.floor.update({ where: { id }, data: {
        ...(input.blockId !== undefined ? { blockId: input.blockId } : {}),
        ...(input.code !== undefined ? { code: input.code.trim().toUpperCase() } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.level !== undefined ? { level: input.level } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.isTestData !== undefined ? { isTestData: input.isTestData } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      } });
      await this.audit.record({ actorId: user.id, action: "location.floor_updated", entityType: "Floor", entityId: id, beforeValue: existing, afterValue: updated, requestId }, tx);
      return updated;
    });
  }

  async updateRoom(user: AuthPrincipal, id: string, input: UpdateRoomDto, requestId: string) {
    const existing = await this.requireLocation(user, "room", id);
    const floorId = input.floorId ?? existing.floorId;
    if (!floorId) throw new BadRequestException("The room does not have a valid parent floor.");
    if (input.floorId || input.departmentId) await this.validateRoomParents(user, floorId, input.departmentId ?? undefined);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.room.update({ where: { id }, data: {
        ...(input.floorId !== undefined ? { floorId: input.floorId } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.code !== undefined ? { code: input.code.trim().toUpperCase() } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.roomNumber !== undefined ? { roomNumber: input.roomNumber?.trim() || null } : {}),
        ...(input.roomType !== undefined ? { roomType: input.roomType } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.isTestData !== undefined ? { isTestData: input.isTestData } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      } });
      await this.audit.record({ actorId: user.id, action: "location.room_updated", entityType: "Room", entityId: id, beforeValue: existing, afterValue: updated, requestId }, tx);
      return updated;
    });
  }

  async dependencyReport(user: AuthPrincipal, kind: LocationKind, id: string) {
    await this.requireLocation(user, kind, id);
    const scopeType = kind.toUpperCase() as "CAMPUS" | "BLOCK" | "FLOOR" | "ROOM";
    const common = await Promise.all([
      this.prisma.userScope.count({ where: { scopeType, scopeId: id } }),
      this.prisma.announcementAudience.count({ where: { scopeType, scopeId: id } }),
      this.prisma.qrCode.count({ where: { entityType: { equals: kind, mode: "insensitive" }, entityId: id } }),
      this.prisma.conversation.count({ where: { collegeId: user.collegeId, linkedEntityId: id } }),
    ]);
    let specific: Record<string, number>;
    if (kind === "campus") {
      const values = await Promise.all([
        this.prisma.block.count({ where: { campusId: id } }),
        this.prisma.department.count({ where: { campusId: id } }),
        this.prisma.issue.count({ where: { campusId: id } }),
        this.prisma.feedbackTarget.count({ where: { campusId: id } }),
        this.prisma.issueAssignmentRule.count({ where: { collegeId: user.collegeId, campusId: id } }),
      ]);
      specific = { blocks: values[0], departments: values[1], issues: values[2], feedbackQrTargets: values[3], routingRules: values[4] };
    } else if (kind === "block") {
      const values = await Promise.all([
        this.prisma.floor.count({ where: { blockId: id } }),
        this.prisma.issue.count({ where: { blockId: id } }),
        this.prisma.feedbackTarget.count({ where: { blockId: id } }),
        this.prisma.issueAssignmentRule.count({ where: { collegeId: user.collegeId, blockId: id } }),
      ]);
      specific = { floors: values[0], issues: values[1], feedbackQrTargets: values[2], routingRules: values[3] };
    } else if (kind === "floor") {
      const values = await Promise.all([
        this.prisma.room.count({ where: { floorId: id } }),
        this.prisma.issue.count({ where: { floorId: id } }),
        this.prisma.feedbackTarget.count({ where: { floorId: id } }),
        this.prisma.issueAssignmentRule.count({ where: { collegeId: user.collegeId, floorId: id } }),
      ]);
      specific = { rooms: values[0], issues: values[1], feedbackQrTargets: values[2], routingRules: values[3] };
    } else {
      const values = await Promise.all([
        this.prisma.section.count({ where: { assignedRoomId: id } }),
        this.prisma.attendanceSession.count({ where: { section: { assignedRoomId: id } } }),
        this.prisma.asset.count({ where: { roomId: id } }),
        this.prisma.issue.count({ where: { roomId: id } }),
        this.prisma.roomResponsiblePerson.count({ where: { roomId: id } }),
        this.prisma.feedbackTarget.count({ where: { roomId: id } }),
        this.prisma.issueAssignmentRule.count({ where: { collegeId: user.collegeId, roomId: id } }),
      ]);
      specific = { sections: values[0], attendanceSessions: values[1], assets: values[2], issues: values[3], responsibleStaff: values[4], feedbackQrTargets: values[5], routingRules: values[6] };
    }
    const counts = { ...specific, assignedUsers: common[0], announcements: common[1], qrCodes: common[2], messengerGroups: common[3] };
    const totalDependencies = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return {
      kind,
      id,
      canDelete: totalDependencies === 0,
      totalDependencies,
      counts,
      message: totalDependencies === 0
        ? "No dependencies were found. Permanent deletion is available to Main Admin."
        : "This location cannot be permanently deleted because it is in use. Move or archive the related records first.",
    };
  }

  async archive(user: AuthPrincipal, kind: LocationKind, id: string, input: ArchiveLocationDto, requestId: string) {
    const existing = await this.requireLocation(user, kind, id);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      let updated: unknown;
      if (kind === "campus") updated = await tx.campus.update({ where: { id }, data: { archivedAt: now, isActive: false } });
      else if (kind === "block") updated = await tx.block.update({ where: { id }, data: { archivedAt: now, isActive: false } });
      else if (kind === "floor") updated = await tx.floor.update({ where: { id }, data: { archivedAt: now, isActive: false } });
      else updated = await tx.room.update({ where: { id }, data: { archivedAt: now, isActive: false } });
      await tx.archivedRecord.create({ data: { collegeId: user.collegeId, entityType: this.entityName(kind), entityId: id, reason: input.reason.trim(), archivedById: user.id, metadata: { code: existing.code, name: existing.name } } });
      await this.audit.record({ actorId: user.id, action: `location.${kind}_archived`, entityType: this.entityName(kind), entityId: id, beforeValue: existing, afterValue: updated, reason: input.reason, requestId }, tx);
      return updated;
    });
  }

  async restore(user: AuthPrincipal, kind: LocationKind, id: string, requestId: string) {
    const existing = await this.requireLocation(user, kind, id);
    if (!existing.archivedAt) throw new BadRequestException("This location is not archived.");
    await this.requireActiveParent(user, kind, existing);
    return this.prisma.$transaction(async (tx) => {
      let updated: unknown;
      if (kind === "campus") updated = await tx.campus.update({ where: { id }, data: { archivedAt: null, isActive: true } });
      else if (kind === "block") updated = await tx.block.update({ where: { id }, data: { archivedAt: null, isActive: true } });
      else if (kind === "floor") updated = await tx.floor.update({ where: { id }, data: { archivedAt: null, isActive: true } });
      else updated = await tx.room.update({ where: { id }, data: { archivedAt: null, isActive: true } });
      await tx.archivedRecord.updateMany({ where: { entityType: this.entityName(kind), entityId: id, restoredAt: null }, data: { restoredAt: new Date() } });
      await this.audit.record({ actorId: user.id, action: `location.${kind}_restored`, entityType: this.entityName(kind), entityId: id, beforeValue: existing, afterValue: updated, requestId }, tx);
      return updated;
    });
  }

  async removePermanently(user: AuthPrincipal, kind: LocationKind, id: string, reason: string, confirmationPhrase: string, requestId: string) {
    if (!user.roles.some((role) => ["SUPER_ADMIN", "MAIN_ADMIN"].includes(role))) {
      throw new ForbiddenException("Only Main Admin can permanently delete a location.");
    }
    if (confirmationPhrase !== "PERMANENTLY DELETE LOCATION") throw new BadRequestException("The confirmation phrase is incorrect.");
    const existing = await this.requireLocation(user, kind, id);
    const report = await this.dependencyReport(user, kind, id);
    if (!report.canDelete) throw new BadRequestException({ message: report.message, dependencyReport: report });
    await this.prisma.$transaction(async (tx) => {
      await this.audit.record({ actorId: user.id, action: `location.${kind}_deleted`, entityType: this.entityName(kind), entityId: id, beforeValue: existing, afterValue: { deleted: true, dependencyReport: report }, reason, requestId }, tx);
      if (kind === "campus") await tx.campus.delete({ where: { id } });
      else if (kind === "block") await tx.block.delete({ where: { id } });
      else if (kind === "floor") await tx.floor.delete({ where: { id } });
      else await tx.room.delete({ where: { id } });
    });
    return { id, kind, deleted: true, dependencyReport: report };
  }

  async bulkArchive(user: AuthPrincipal, kind: LocationKind, ids: string[], reason: string, requestId: string) {
    const results = [];
    for (const id of [...new Set(ids)]) results.push(await this.archive(user, kind, id, { reason }, requestId));
    return { archived: results.length, results };
  }

  async bulkRestore(user: AuthPrincipal, kind: LocationKind, ids: string[], requestId: string) {
    const results = [];
    for (const id of [...new Set(ids)]) results.push(await this.restore(user, kind, id, requestId));
    return { restored: results.length, results };
  }

  private async requireLocation(user: AuthPrincipal, kind: LocationKind, id: string) {
    const select = { id: true, code: true, name: true, archivedAt: true, isActive: true };
    let record: Record<string, unknown> | null;
    if (kind === "campus") record = await this.prisma.campus.findFirst({ where: { id, collegeId: user.collegeId }, select });
    else if (kind === "block") record = await this.prisma.block.findFirst({ where: { id, campus: { collegeId: user.collegeId } }, select: { ...select, campusId: true } });
    else if (kind === "floor") record = await this.prisma.floor.findFirst({ where: { id, block: { campus: { collegeId: user.collegeId } } }, select: { ...select, blockId: true } });
    else record = await this.prisma.room.findFirst({ where: { id, floor: { block: { campus: { collegeId: user.collegeId } } } }, select: { ...select, floorId: true, departmentId: true } });
    if (!record) throw new NotFoundException(`${this.entityName(kind)} not found.`);
    return record as { id: string; code: string; name: string; isActive: boolean; archivedAt: Date | null; campusId?: string; blockId?: string; floorId?: string; departmentId?: string | null };
  }

  private async requireActiveParent(user: AuthPrincipal, kind: LocationKind, record: { campusId?: string; blockId?: string; floorId?: string }) {
    if (kind === "block" && record.campusId) {
      const parent = await this.prisma.campus.findFirst({ where: { id: record.campusId, collegeId: user.collegeId, archivedAt: null, isActive: true } });
      if (!parent) throw new BadRequestException("Restore the parent campus first.");
    } else if (kind === "floor" && record.blockId) {
      const parent = await this.prisma.block.findFirst({ where: { id: record.blockId, archivedAt: null, isActive: true, campus: { collegeId: user.collegeId, archivedAt: null } } });
      if (!parent) throw new BadRequestException("Restore the parent block first.");
    } else if (kind === "room" && record.floorId) {
      const parent = await this.prisma.floor.findFirst({ where: { id: record.floorId, archivedAt: null, isActive: true, block: { archivedAt: null, campus: { collegeId: user.collegeId, archivedAt: null } } } });
      if (!parent) throw new BadRequestException("Restore the parent floor first.");
    }
  }

  private async validateRoomParents(user: AuthPrincipal, floorId: string, departmentId?: string | null) {
    const floor = await this.prisma.floor.findFirst({ where: { id: floorId, archivedAt: null, block: { archivedAt: null, campus: { collegeId: user.collegeId, archivedAt: null } }, isActive: true } });
    if (!floor) throw new BadRequestException("The selected floor is not active.");
    if (departmentId) {
      const department = await this.prisma.department.findFirst({ where: { id: departmentId, collegeId: user.collegeId, isActive: true, archivedAt: null } });
      if (!department) throw new BadRequestException("The selected department is not active.");
    }
  }

  private async qrRoom(user: AuthPrincipal, where: { id: string }) {
    const room = await this.prisma.room.findFirst({ where: { ...where, isActive: true, archivedAt: null, floor: { block: { campus: { collegeId: user.collegeId } } } }, select: { id: true, code: true, name: true, roomNumber: true, roomType: true, qrToken: true, floor: { select: { name: true, block: { select: { name: true, campus: { select: { name: true } } } } } } } });
    if (!room) throw new NotFoundException("Active room not found.");
    return room;
  }

  private async qrPayload(room: { id: string; code: string; name: string; roomNumber: string | null; roomType: string; qrToken: string; floor: { name: string; block: { name: string; campus: { name: string } } } }) {
    const webUrl = this.config.get<string>("WEB_URL", "http://localhost:3000").replace(/\/$/, "");
    const reportUrl = `${webUrl}/report-issue?roomToken=${room.qrToken}`;
    const dataUrl = await QRCode.toDataURL(reportUrl, { errorCorrectionLevel: "M", margin: 1, width: 512 });
    return { ...room, reportUrl, dataUrl };
  }

  private entityName(kind: LocationKind) {
    return kind.charAt(0).toUpperCase() + kind.slice(1);
  }

  confirmationHash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
}
