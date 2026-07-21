import { Injectable } from "@nestjs/common";
import type { ConversationType, ParticipantRole } from "../../generated/prisma/enums";
import { PrismaService } from "../../database/prisma.service";

@Injectable()
export class OfficialGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async synchronizeCollege(collegeId: string): Promise<{ synchronized: number }> {
    let synchronized = 0;
    const departments = await this.prisma.department.findMany({
      where: { collegeId, isActive: true, archivedAt: null },
      select: { id: true, name: true },
    });
    for (const department of departments) {
      await this.synchronizeDepartment(collegeId, department.id);
      synchronized += 1;
    }

    const sections = await this.prisma.section.findMany({
      where: { isActive: true, officialGroupEnabled: true, semester: { programme: { collegeId } } },
      select: { id: true },
    });
    for (const section of sections) {
      await this.synchronizeSection(collegeId, section.id);
      synchronized += 1;
    }

    const roleGroups: Array<{ type: ConversationType; title: string; key: string; roles: string[] }> = [
      { type: "FACULTY_GROUP", title: "AVS Faculty", key: "role:faculty", roles: ["FACULTY"] },
      { type: "HOD_GROUP", title: "AVS Heads of Department", key: "role:hod", roles: ["HOD"] },
      { type: "CLASS_COORDINATOR_GROUP", title: "AVS Class Coordinators", key: "role:cc", roles: ["CLASS_COORDINATOR"] },
      { type: "CLASS_REPRESENTATIVE_GROUP", title: "AVS Class Representatives", key: "role:cr", roles: ["CLASS_REPRESENTATIVE"] },
      { type: "LEADERSHIP_GROUP", title: "AVS College Leadership", key: "role:leadership", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
      { type: "ADMINISTRATIVE_GROUP", title: "AVS Administration", key: "role:administration", roles: ["SUPER_ADMIN", "MAIN_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"] },
      { type: "MAINTENANCE_TEAM_GROUP", title: "AVS Maintenance Team", key: "role:maintenance", roles: ["MAINTENANCE_ADMIN", "MAINTENANCE_SUPERVISOR", "MAINTENANCE_STAFF", "ELECTRICIAN", "PLUMBER", "IT_SUPPORT", "LAB_TECHNICIAN", "HOUSEKEEPING", "SECURITY", "OTHER_RESPONSIBLE"] },
    ];
    for (const group of roleGroups) {
      const members = await this.activeRoleMembers(collegeId, group.roles);
      const owners = members.filter((member) => member.roles.some((role) => ["SUPER_ADMIN", "MAIN_ADMIN", "PRINCIPAL", "MAINTENANCE_ADMIN"].includes(role)));
      await this.syncGroup(collegeId, group.type, group.title, `${group.key}:${collegeId}`, group.key, collegeId, members.map((member) => member.id), owners.map((member) => member.id));
      synchronized += 1;
    }

    const teams = await this.prisma.responsibleTeam.findMany({
      where: { collegeId, isActive: true },
      include: { members: { where: { isActive: true }, select: { userId: true } } },
    });
    for (const team of teams) {
      await this.syncGroup(collegeId, "MAINTENANCE_TEAM_GROUP", team.name, `team:${team.id}`, "maintenance_team", team.id, team.members.map((member) => member.userId));
      synchronized += 1;
    }
    return { synchronized };
  }

  async synchronizeDepartment(collegeId: string, departmentId: string): Promise<void> {
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, collegeId, isActive: true, archivedAt: null },
      select: { id: true, name: true, hodId: true },
    });
    if (!department) return;
    const members = await this.prisma.user.findMany({
      where: {
        collegeId,
        status: "ACTIVE",
        archivedAt: null,
        OR: [
          { studentProfile: { departmentId } },
          { staffProfile: { departmentId } },
          ...(department.hodId ? [{ id: department.hodId }] : []),
        ],
      },
      select: { id: true },
    });
    await this.syncGroup(collegeId, "DEPARTMENT_GROUP", `${department.name} - Official Group`, `department:${department.id}`, "department", department.id, members.map((member) => member.id), department.hodId ? [department.hodId] : []);
  }

  async synchronizeSection(collegeId: string, sectionId: string): Promise<void> {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, isActive: true, officialGroupEnabled: true, semester: { programme: { collegeId } } },
      select: {
        id: true,
        code: true,
        name: true,
        displayName: true,
        semester: { select: { name: true, programme: { select: { name: true } } } },
      },
    });
    if (!section) return;
    const members = await this.prisma.user.findMany({
      where: {
        collegeId,
        status: "ACTIVE",
        archivedAt: null,
        OR: [
          { studentProfile: { sectionId } },
          { coordinatorAssignments: { some: { sectionId, isActive: true } } },
          { representativeAssignments: { some: { sectionId, isActive: true } } },
          { facultyAssignments: { some: { sectionId, isActive: true } } },
        ],
      },
      select: {
        id: true,
        coordinatorAssignments: { where: { sectionId, isActive: true }, select: { id: true } },
      },
    });
    const title = `${section.displayName ?? `${section.semester.programme.name} ${section.name}`} - Official Group`;
    await this.syncGroup(collegeId, "CLASS_GROUP", title, `section:${section.id}`, "section", section.id, members.map((member) => member.id), members.filter((member) => member.coordinatorAssignments.length > 0).map((member) => member.id));
  }

  async archiveLinkedGroup(collegeId: string, officialGroupType: string, linkedEntityId: string): Promise<void> {
    await this.prisma.conversation.updateMany({
      where: { collegeId, isOfficial: true, officialGroupType, linkedEntityId },
      data: { archivedAt: new Date() },
    });
  }

  private activeRoleMembers(collegeId: string, roleCodes: string[]) {
    const now = new Date();
    return this.prisma.user.findMany({
      where: {
        collegeId,
        status: "ACTIVE",
        archivedAt: null,
        roles: { some: { validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }], role: { code: { in: roleCodes }, isActive: true } } },
      },
      select: { id: true, roles: { where: { role: { code: { in: roleCodes } } }, select: { role: { select: { code: true } } } } },
    }).then((members) => members.map((member) => ({ id: member.id, roles: member.roles.map((entry) => entry.role.code) })));
  }

  private async syncGroup(
    collegeId: string,
    type: ConversationType,
    title: string,
    officialKey: string,
    officialGroupType: string,
    linkedEntityId: string,
    userIds: string[],
    ownerIds: string[] = [],
  ): Promise<void> {
    const conversation = await this.prisma.conversation.upsert({
      where: { officialKey },
      create: { collegeId, type, title, officialKey, officialGroupType, linkedEntityId, isOfficial: true },
      update: { type, title, officialGroupType, linkedEntityId, isOfficial: true, archivedAt: null },
    });
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length) {
      await this.prisma.conversationParticipant.createMany({ data: uniqueIds.map((userId) => ({ conversationId: conversation.id, userId })), skipDuplicates: true });
      await this.prisma.conversationParticipant.updateMany({ where: { conversationId: conversation.id, userId: { in: uniqueIds } }, data: { leftAt: null, role: "MEMBER" } });
    }
    const uniqueOwners = [...new Set(ownerIds.filter((id) => uniqueIds.includes(id)))];
    if (uniqueOwners.length) {
      await this.prisma.conversationParticipant.updateMany({ where: { conversationId: conversation.id, userId: { in: uniqueOwners } }, data: { role: "OWNER" as ParticipantRole } });
    }
    await this.prisma.conversationParticipant.updateMany({ where: { conversationId: conversation.id, ...(uniqueIds.length ? { userId: { notIn: uniqueIds } } : {}) }, data: { leftAt: new Date() } });
  }
}
