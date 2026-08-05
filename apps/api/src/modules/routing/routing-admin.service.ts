import { BadRequestException, Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import type { CreateRoutingRuleDto, CreateTeamDto, UpsertSlaDto } from "./dto/routing.dto";

@Injectable()
export class RoutingAdminService {
  constructor(private readonly prisma: PrismaService) {}
  teams(user: AuthPrincipal) { return this.prisma.responsibleTeam.findMany({ where: { collegeId: user.collegeId }, include: { members: { include: { user: { select: { publicId: true, fullName: true } } } } }, orderBy: { name: "asc" } }); }
  async createTeam(user: AuthPrincipal, input: CreateTeamDto) {
    if (input.isDefaultMaintenance) await this.prisma.responsibleTeam.updateMany({ where: { collegeId: user.collegeId, isDefaultMaintenance: true }, data: { isDefaultMaintenance: false } });
    return this.prisma.responsibleTeam.create({ data: { collegeId: user.collegeId, code: input.code.trim().toUpperCase(), name: input.name.trim(), isDefaultMaintenance: input.isDefaultMaintenance ?? false } });
  }
  rules(user: AuthPrincipal) { return this.prisma.issueAssignmentRule.findMany({ where: { collegeId: user.collegeId }, include: { team: { select: { id: true, name: true } }, category: { select: { name: true } }, issueType: { select: { name: true } } }, orderBy: [{ rulePriority: "desc" }, { createdAt: "desc" }] }); }
  async createRule(user: AuthPrincipal, input: CreateRoutingRuleDto) {
    const team = await this.prisma.responsibleTeam.findFirst({ where: { id: input.teamId, collegeId: user.collegeId, isActive: true } });
    if (!team) throw new BadRequestException("Responsible team is not active in this college.");
    await this.validateRuleTargets(user.collegeId, input);
    return this.prisma.issueAssignmentRule.create({ data: { collegeId: user.collegeId, teamId: input.teamId, campusId: input.campusId, blockId: input.blockId, floorId: input.floorId, roomId: input.roomId, roomType: input.roomType, departmentId: input.departmentId, categoryId: input.categoryId, issueTypeId: input.issueTypeId, assetId: input.assetId, priorityFilter: input.priorityFilter, primaryUserId: input.primaryUserId, backupUserId: input.backupUserId, escalationUserId: input.escalationUserId, rulePriority: input.rulePriority ?? 0, workloadBalancing: input.workloadBalancing ?? false } });
  }
  slas(user: AuthPrincipal) { return this.prisma.issueSlaPolicy.findMany({ where: { collegeId: user.collegeId }, orderBy: { priority: "asc" } }); }
  upsertSla(user: AuthPrincipal, input: UpsertSlaDto) { return this.prisma.issueSlaPolicy.upsert({ where: { collegeId_priority: { collegeId: user.collegeId, priority: input.priority } }, create: { collegeId: user.collegeId, priority: input.priority, acknowledgementMinutes: input.acknowledgementMinutes, resolutionMinutes: input.resolutionMinutes, workingHoursOnly: input.workingHoursOnly ?? false }, update: { acknowledgementMinutes: input.acknowledgementMinutes, resolutionMinutes: input.resolutionMinutes, workingHoursOnly: input.workingHoursOnly ?? false, isActive: true } }); }

  private async validateRuleTargets(collegeId: string, input: CreateRoutingRuleDto): Promise<void> {
    const [campus, block, floor, room, department, category, issueType, asset] = await Promise.all([
      input.campusId ? this.prisma.campus.findFirst({ where: { id: input.campusId, collegeId, isActive: true }, select: { id: true } }) : null,
      input.blockId ? this.prisma.block.findFirst({ where: { id: input.blockId, isActive: true, campus: { collegeId } }, select: { id: true, campusId: true } }) : null,
      input.floorId ? this.prisma.floor.findFirst({ where: { id: input.floorId, isActive: true, block: { campus: { collegeId } } }, select: { id: true, blockId: true, block: { select: { campusId: true } } } }) : null,
      input.roomId ? this.prisma.room.findFirst({ where: { id: input.roomId, isActive: true, floor: { block: { campus: { collegeId } } } }, select: { id: true, floorId: true, departmentId: true, roomType: true, floor: { select: { blockId: true, block: { select: { campusId: true } } } } } }) : null,
      input.departmentId ? this.prisma.department.findFirst({ where: { id: input.departmentId, collegeId, isActive: true }, select: { id: true } }) : null,
      input.categoryId ? this.prisma.issueCategory.findFirst({ where: { id: input.categoryId, collegeId, isActive: true }, select: { id: true } }) : null,
      input.issueTypeId ? this.prisma.issueType.findFirst({ where: { id: input.issueTypeId, isActive: true, category: { collegeId } }, select: { id: true, categoryId: true } }) : null,
      input.assetId ? this.prisma.asset.findFirst({ where: { id: input.assetId, isActive: true, OR: [{ room: { floor: { block: { campus: { collegeId } } } } }, { area: { floor: { block: { campus: { collegeId } } } } }] }, select: { id: true, roomId: true, areaId: true, room: { select: { floorId: true, departmentId: true, floor: { select: { id: true, blockId: true, block: { select: { campusId: true } } } } } }, area: { select: { floorId: true, floor: { select: { id: true, blockId: true, block: { select: { campusId: true } } } } } } } }) : null,
    ]);

    if (input.campusId && !campus) throw new BadRequestException("Routing campus is not active in this college.");
    if (input.blockId && !block) throw new BadRequestException("Routing block is not active in this college.");
    if (input.floorId && !floor) throw new BadRequestException("Routing floor is not active in this college.");
    if (input.roomId && !room) throw new BadRequestException("Routing room is not active in this college.");
    if (input.departmentId && !department) throw new BadRequestException("Routing department is not active in this college.");
    if (input.categoryId && !category) throw new BadRequestException("Routing category is not active in this college.");
    if (input.issueTypeId && !issueType) throw new BadRequestException("Routing issue type is not active in this college.");
    if (input.assetId && !asset) throw new BadRequestException("Routing asset is not active in this college.");

    if (input.campusId && block && block.campusId !== input.campusId) throw new BadRequestException("Routing block does not belong to the selected campus.");
    if (input.blockId && floor && floor.blockId !== input.blockId) throw new BadRequestException("Routing floor does not belong to the selected block.");
    if (input.campusId && floor && floor.block.campusId !== input.campusId) throw new BadRequestException("Routing floor does not belong to the selected campus.");
    if (room) {
      if (input.floorId && room.floorId !== input.floorId) throw new BadRequestException("Routing room does not belong to the selected floor.");
      if (input.blockId && room.floor.blockId !== input.blockId) throw new BadRequestException("Routing room does not belong to the selected block.");
      if (input.campusId && room.floor.block.campusId !== input.campusId) throw new BadRequestException("Routing room does not belong to the selected campus.");
      if (input.departmentId && room.departmentId !== input.departmentId) throw new BadRequestException("Routing room does not belong to the selected department.");
      if (input.roomType && room.roomType !== input.roomType) throw new BadRequestException("Routing room type does not match the selected room.");
    }
    if (issueType && input.categoryId && issueType.categoryId !== input.categoryId) throw new BadRequestException("Routing issue type does not belong to the selected category.");
    if (asset) {
      if (input.roomId && asset.roomId !== input.roomId) throw new BadRequestException("Routing asset does not belong to the selected room.");
      const assetFloor = asset.room?.floor ?? asset.area?.floor;
      if (!assetFloor) throw new BadRequestException("Routing asset has no active location.");
      if (input.floorId && assetFloor.id !== input.floorId) throw new BadRequestException("Routing asset does not belong to the selected floor.");
      if (input.blockId && assetFloor.blockId !== input.blockId) throw new BadRequestException("Routing asset does not belong to the selected block.");
      if (input.campusId && assetFloor.block.campusId !== input.campusId) throw new BadRequestException("Routing asset does not belong to the selected campus.");
      if (input.departmentId && asset.room?.departmentId !== input.departmentId) throw new BadRequestException("Routing asset does not belong to the selected department.");
    }

    if (input.primaryUserId) {
      const primaryMember = await this.prisma.responsibleTeamMember.findFirst({
        where: { teamId: input.teamId, userId: input.primaryUserId, isActive: true, user: { collegeId, status: "ACTIVE" } },
        select: { id: true },
      });
      if (!primaryMember) throw new BadRequestException("Primary responsible person must be an active member of this college team.");
    }
    const escalationUserIds = [...new Set([input.backupUserId, input.escalationUserId].filter((id): id is string => Boolean(id)))];
    if (escalationUserIds.length) {
      const validUsers = await this.prisma.user.count({ where: { id: { in: escalationUserIds }, collegeId, status: "ACTIVE" } });
      if (validUsers !== escalationUserIds.length) throw new BadRequestException("Backup and escalation users must be active users in this college.");
    }
  }
}
