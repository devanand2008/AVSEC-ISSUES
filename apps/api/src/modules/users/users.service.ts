import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import { randomInt } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AccountStatus } from "../../generated/prisma/enums";
import type { Prisma } from "../../generated/prisma/client";
import type { AssignUserRoleDto, CreateMaintenanceStaffDto, CreateRoleDto, CreateUserDto, RemoveUserRoleDto, ResetUserPasswordDto, UpdateRoleDto, UpdateUserAccessDto, UpdateUserStatusDto, UserScopeDto } from "./dto/user.dto";
import { OfficialGroupsService } from "../conversations/official-groups.service";

const ROLE_RANK: Record<string, number> = {
  SUPER_ADMIN: 100,
  MAIN_ADMIN: 90,
  PRINCIPAL: 80,
  VICE_PRINCIPAL: 75,
  HOD: 70,
  MAINTENANCE_ADMIN: 70,
  MAINTENANCE_SUPERVISOR: 60,
  CLASS_COORDINATOR: 60,
  FACULTY: 50,
  CLASS_REPRESENTATIVE: 40,
  MAINTENANCE_STAFF: 40,
  ELECTRICIAN: 40,
  PLUMBER: 40,
  IT_SUPPORT: 40,
  LAB_TECHNICIAN: 40,
  HOUSEKEEPING: 40,
  SECURITY: 40,
  OTHER_RESPONSIBLE: 40,
  STUDENT: 10,
};

const COLLEGE_WIDE_ROLES = new Set(["SUPER_ADMIN", "MAIN_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"]);
const ROLES_REQUIRING_COLLEGE_SCOPE = new Set(["SUPER_ADMIN", "MAIN_ADMIN", "PRINCIPAL"]);

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly audit: AuditService, private readonly officialGroups: OfficialGroupsService) {}

  async list(user: AuthPrincipal, page: number, pageSize: number, search?: string, filters: { role?: string; status?: string; firstLogin?: string } = {}) {
    const status = filters.status && Object.values(AccountStatus).includes(filters.status as AccountStatus) ? filters.status as AccountStatus : undefined;
    const where = {
      collegeId: user.collegeId,
      archivedAt: null,
      ...(search ? { OR: [{ fullName: { contains: search, mode: "insensitive" as const } }, { collegeIdentityId: { contains: search, mode: "insensitive" as const } }, { normalizedEmail: { contains: search.toLowerCase(), mode: "insensitive" as const } }] } : {}),
      ...(status ? { status } : {}),
      ...(filters.role ? { roles: { some: { role: { code: filters.role, isActive: true } } } } : {}),
      ...(filters.firstLogin === "REQUIRED" ? { mustChangePassword: true } : {}),
      ...(filters.firstLogin === "COMPLETED" ? { mustChangePassword: false, firstLoginCompletedAt: { not: null } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { fullName: "asc" }, select: { publicId: true, collegeIdentityId: true, fullName: true, email: true, mobile: true, status: true, mustChangePassword: true, firstLoginCompletedAt: true, lastLoginAt: true, roles: { select: { role: { select: { code: true, name: true } } } }, scopes: { select: { scopeType: true, scopeId: true, issueCategoryId: true } }, studentProfile: { select: { studentId: true, department: { select: { code: true, name: true } }, section: { select: { code: true, name: true } } } }, staffProfile: { select: { employeeId: true, department: { select: { code: true, name: true } } } } } }),
      this.prisma.user.count({ where }),
    ]);
    return { data, meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
  }

  async create(actor: AuthPrincipal, input: CreateUserDto, requestId: string) {
    const roles = await this.prisma.role.findMany({
      where: { code: { in: input.roleCodes }, isActive: true, OR: [{ collegeId: actor.collegeId }, { collegeId: null }] },
      include: { permissions: { include: { permission: true } } },
    });
    if (roles.length !== new Set(input.roleCodes).size) throw new BadRequestException("One or more role codes are invalid.");
    this.assertRoleDelegation(actor, roles.map((role) => ({ code: role.code, permissions: role.permissions.map((entry) => entry.permission.code) })));
    await this.validateScopes(actor.collegeId, input.scopes);
    if (input.scopes.some((scope) => scope.type === "COLLEGE") && !input.roleCodes.some((code) => COLLEGE_WIDE_ROLES.has(code))) {
      throw new BadRequestException("College-wide scope is restricted to college-wide administrative roles.");
    }
    if (input.roleCodes.some((code) => ROLES_REQUIRING_COLLEGE_SCOPE.has(code)) && !input.scopes.some((scope) => scope.type === "COLLEGE")) {
      throw new BadRequestException("This administrative role requires an explicit college scope.");
    }
    await this.validateProfiles(actor.collegeId, input);
    const normalizedEmail = input.email?.trim().toLowerCase();
    const exists = await this.prisma.user.findFirst({ where: { collegeId: actor.collegeId, OR: [{ collegeIdentityId: input.collegeIdentityId.trim() }, ...(normalizedEmail ? [{ normalizedEmail }] : [])] } });
    if (exists) throw new ConflictException("A user with this college ID or email already exists.");
    const passwordHash = await argon2.hash(input.temporaryPassword + this.config.get<string>("PASSWORD_PEPPER", ""), { type: argon2.argon2id });
    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: {
        collegeId: actor.collegeId,
        collegeIdentityId: input.collegeIdentityId.trim(),
        fullName: input.fullName.trim(),
        email: input.email?.trim(),
        normalizedEmail,
        mobile: input.mobile?.trim(),
        whatsappNumber: input.whatsappNumber?.trim(),
        status: input.accountStatus ?? "ACTIVE",
        mustChangePassword: true,
        credential: { create: { passwordHash } },
        roles: { create: roles.map((role) => ({ roleId: role.id })) },
        scopes: { create: input.scopes.map((scope) => ({ scopeType: scope.type, scopeId: scope.id, issueCategoryId: scope.issueCategoryId })) },
        ...(input.studentProfile ? { studentProfile: { create: {
          collegeId: actor.collegeId,
          departmentId: input.studentProfile.departmentId,
          programmeId: input.studentProfile.programmeId,
          sectionId: input.studentProfile.sectionId,
          studentId: input.studentProfile.studentId.trim(),
          admissionYear: input.studentProfile.admissionYear,
          rollNumber: input.studentProfile.rollNumber?.trim(),
        } } } : {}),
        ...(input.staffProfile ? { staffProfile: { create: {
          collegeId: actor.collegeId,
          departmentId: input.staffProfile.departmentId,
          employeeId: input.staffProfile.employeeId.trim(),
          designation: input.staffProfile.designation?.trim(),
          specialization: input.staffProfile.specialization?.trim(),
          shift: input.staffProfile.shift?.trim(),
          emergencyContact: input.staffProfile.emergencyContact?.trim(),
        } } } : {}),
      } });
      await tx.roleAssignmentHistory.create({ data: { userId: created.id, changedById: actor.id, previousRoles: [], newRoles: input.roleCodes, previousScopes: [], newScopes: input.scopes as unknown as Prisma.InputJsonValue, reason: "Initial account access assignment" } });
      await this.audit.record({ actorId: actor.id, action: "user.created", entityType: "User", entityId: created.id, afterValue: { publicId: created.publicId, roles: input.roleCodes, scopes: input.scopes }, requestId }, tx);
      return { id: created.publicId, collegeIdentityId: created.collegeIdentityId, fullName: created.fullName, status: created.status, mustChangePassword: created.mustChangePassword };
    });
    await this.officialGroups.synchronizeCollege(actor.collegeId);
    return result;
  }

  async status(actor: AuthPrincipal, publicId: string, input: UpdateUserStatusDto, requestId: string) {
    const now = new Date();
    const target = await this.prisma.user.findFirst({
      where: { publicId, collegeId: actor.collegeId },
      include: {
        roles: {
          where: {
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
            role: { isActive: true },
          },
          include: { role: true },
        },
      },
    });
    if (!target) throw new NotFoundException("User not found.");
    if (target.id === actor.id && input.status !== "ACTIVE") throw new BadRequestException("You cannot deactivate your own account.");
    const actorRank = this.highestRoleRank(actor.roles);
    const targetRoleCodes = target.roles.map((mapping) => mapping.role.code);
    const targetRank = this.highestRoleRank(targetRoleCodes);
    if (targetRank > actorRank || (targetRank === actorRank && targetRank > 0 && !actor.roles.includes("SUPER_ADMIN"))) {
      throw new ForbiddenException("You cannot change the status of an account at or above your administrative level.");
    }
    if (target.status === "ACTIVE" && input.status !== "ACTIVE" && targetRoleCodes.includes("SUPER_ADMIN")) {
      const otherActiveSuperAdmins = await this.prisma.user.count({
        where: {
          id: { not: target.id },
          collegeId: actor.collegeId,
          status: "ACTIVE",
          roles: {
            some: {
              validFrom: { lte: now },
              OR: [{ validUntil: null }, { validUntil: { gt: now } }],
              role: { code: "SUPER_ADMIN", isActive: true, OR: [{ collegeId: actor.collegeId }, { collegeId: null }] },
            },
          },
        },
      });
      if (otherActiveSuperAdmins === 0) throw new BadRequestException("The last active Super Admin cannot be deactivated.");
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: target.id }, data: { status: input.status, archivedAt: input.status === "ARCHIVED" ? new Date() : null, version: { increment: 1 } } });
      if (input.status !== "ACTIVE") {
        await tx.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: `ACCOUNT_${input.status}` } });
        const sessions = await tx.session.findMany({ where: { userId: target.id }, select: { id: true } });
        await tx.refreshToken.updateMany({ where: { sessionId: { in: sessions.map((session) => session.id) }, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.record({ actorId: actor.id, action: "user.status_changed", entityType: "User", entityId: target.id, beforeValue: { status: target.status }, afterValue: { status: input.status }, reason: input.reason, requestId }, tx);
      return { id: updated.publicId, status: updated.status };
    });
    await this.officialGroups.synchronizeCollege(actor.collegeId);
    return result;
  }

  async resetPassword(actor: AuthPrincipal, publicId: string, input: ResetUserPasswordDto, requestId: string) {
    const now = new Date();
    const target = await this.prisma.user.findFirst({
      where: { publicId, collegeId: actor.collegeId, archivedAt: null },
      include: {
        roles: {
          where: {
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
            role: { isActive: true },
          },
          include: { role: true },
        },
      },
    });
    if (!target) throw new NotFoundException("User not found.");
    if (target.id === actor.id) throw new BadRequestException("Use the change-password page to update your own password.");
    const actorRank = this.highestRoleRank(actor.roles);
    const targetRoleCodes = target.roles.map((mapping) => mapping.role.code);
    const targetRank = this.highestRoleRank(targetRoleCodes);
    if (targetRank > actorRank || (targetRank === actorRank && targetRank > 0 && !actor.roles.includes("SUPER_ADMIN"))) {
      throw new ForbiddenException("You cannot reset a password for an account at or above your administrative level.");
    }

    const temporaryPassword = input.temporaryPassword?.trim() || this.generateTemporaryPassword();
    this.assertStrongTemporaryPassword(temporaryPassword);
    const passwordHash = await argon2.hash(temporaryPassword + this.config.get<string>("PASSWORD_PEPPER", ""), { type: argon2.argon2id });
    const requirePasswordChange = input.requirePasswordChange ?? true;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.userCredential.upsert({
        where: { userId: target.id },
        create: { userId: target.id, passwordHash, passwordChangedAt: now, failedAttemptCount: 0, lockedUntil: null },
        update: { passwordHash, passwordChangedAt: now, failedAttemptCount: 0, lockedUntil: null },
      });
      await tx.user.update({
        where: { id: target.id },
        data: { mustChangePassword: requirePasswordChange, version: { increment: 1 } },
      });
      const sessions = await tx.session.findMany({ where: { userId: target.id }, select: { id: true } });
      await tx.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now, revokeReason: "ADMIN_PASSWORD_RESET" } });
      await tx.refreshToken.updateMany({ where: { sessionId: { in: sessions.map((session) => session.id) }, revokedAt: null }, data: { revokedAt: now } });
      await this.audit.record({
        actorId: actor.id,
        action: "user.password_reset",
        entityType: "User",
        entityId: target.id,
        afterValue: { publicId: target.publicId, requirePasswordChange },
        reason: input.reason,
        requestId,
      }, tx);
      return {
        id: target.publicId,
        loginId: target.collegeIdentityId,
        fullName: target.fullName,
        temporaryPassword,
        mustChangePassword: requirePasswordChange,
        sessionsRevoked: true,
      };
    });
    return result;
  }

  async updateAccess(actor: AuthPrincipal, publicId: string, input: UpdateUserAccessDto, requestId: string) {
    const target = await this.prisma.user.findFirst({
      where: { publicId, collegeId: actor.collegeId, archivedAt: null },
      include: { roles: { include: { role: true } }, scopes: true },
    });
    if (!target) throw new NotFoundException("User not found.");
    if (target.id === actor.id) throw new BadRequestException("Use a separate administrator account to change your own access.");

    const roles = await this.prisma.role.findMany({
      where: { code: { in: input.roleCodes }, isActive: true, OR: [{ collegeId: actor.collegeId }, { collegeId: null }] },
      include: { permissions: { include: { permission: true } } },
    });
    if (roles.length !== new Set(input.roleCodes).size) throw new BadRequestException("One or more role codes are invalid.");
    this.assertRoleDelegation(actor, roles.map((role) => ({ code: role.code, permissions: role.permissions.map((entry) => entry.permission.code) })));
    await this.validateScopes(actor.collegeId, input.scopes);
    this.assertScopeCompatibility(input.roleCodes, input.scopes);

    const actorRank = this.highestRoleRank(actor.roles);
    const currentRoleCodes = target.roles.map((mapping) => mapping.role.code);
    if (this.highestRoleRank(currentRoleCodes) >= actorRank && !actor.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException("You cannot change access for an account at or above your administrative level.");
    }
    if (currentRoleCodes.includes("SUPER_ADMIN") && !input.roleCodes.includes("SUPER_ADMIN")) {
      const otherSuperAdmins = await this.prisma.user.count({
        where: { id: { not: target.id }, collegeId: actor.collegeId, status: "ACTIVE", roles: { some: { role: { code: "SUPER_ADMIN", isActive: true } } } },
      });
      if (otherSuperAdmins === 0) throw new BadRequestException("The last active Super Admin cannot lose that role.");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: target.id } });
      await tx.userRole.createMany({ data: roles.map((role) => ({ userId: target.id, roleId: role.id })) });
      await tx.userScope.deleteMany({ where: { userId: target.id } });
      await tx.userScope.createMany({ data: input.scopes.map((scope) => ({ userId: target.id, scopeType: scope.type, scopeId: scope.id, issueCategoryId: scope.issueCategoryId })) });
      await tx.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "ACCESS_CHANGED" } });
      const sessions = await tx.session.findMany({ where: { userId: target.id }, select: { id: true } });
      await tx.refreshToken.updateMany({ where: { sessionId: { in: sessions.map((session) => session.id) }, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.user.update({ where: { id: target.id }, data: { version: { increment: 1 } } });
      await tx.roleAssignmentHistory.create({
        data: {
          userId: target.id,
          changedById: actor.id,
          previousRoles: currentRoleCodes,
          newRoles: input.roleCodes,
          previousScopes: target.scopes.map((scope) => ({ type: scope.scopeType, id: scope.scopeId, issueCategoryId: scope.issueCategoryId })),
          newScopes: input.scopes as unknown as Prisma.InputJsonValue,
          reason: input.reason.trim(),
        },
      });
      await this.audit.record({
        actorId: actor.id,
        action: "user.access_changed",
        entityType: "User",
        entityId: target.id,
        beforeValue: { roles: currentRoleCodes, scopes: target.scopes.map((scope) => ({ type: scope.scopeType, id: scope.scopeId, issueCategoryId: scope.issueCategoryId })) },
        afterValue: { roles: input.roleCodes, scopes: input.scopes },
        reason: input.reason,
        requestId,
      }, tx);
      return { id: target.publicId, roles: input.roleCodes, scopes: input.scopes, sessionsRevoked: true };
    });
    await this.officialGroups.synchronizeCollege(actor.collegeId);
    return result;
  }

  async addRole(actor: AuthPrincipal, publicId: string, input: AssignUserRoleDto, requestId: string) {
    const target = await this.prisma.user.findFirst({ where: { OR: [{ publicId }, { id: publicId }], collegeId: actor.collegeId, archivedAt: null }, include: { roles: { include: { role: true } }, scopes: true } });
    if (!target) throw new NotFoundException("User not found.");
    if (target.id === actor.id) throw new BadRequestException("Use a separate administrator account to change your own access.");
    const code = input.roleCode.trim().toUpperCase();
    const role = await this.prisma.role.findFirst({ where: { code, isActive: true, OR: [{ collegeId: actor.collegeId }, { collegeId: null }] }, include: { permissions: { include: { permission: true } } } });
    if (!role) throw new BadRequestException("Role not found or inactive.");
    this.assertRoleDelegation(actor, [{ code: role.code, permissions: role.permissions.map((entry) => entry.permission.code) }]);
    const validFrom = input.validFrom ? new Date(input.validFrom) : new Date();
    const validUntil = input.validUntil ? new Date(input.validUntil) : null;
    if (Number.isNaN(validFrom.getTime()) || (validUntil && Number.isNaN(validUntil.getTime()))) throw new BadRequestException("Role assignment dates are invalid.");
    if (validUntil && validUntil <= validFrom) throw new BadRequestException("Role end date must be after the start date.");
    const previousRoles = target.roles.map((entry) => entry.role.code);
    const result = await this.prisma.$transaction(async (tx) => {
      if (input.isPrimary) await tx.userRole.updateMany({ where: { userId: target.id }, data: { isPrimary: false } });
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: target.id, roleId: role.id } },
        create: { userId: target.id, roleId: role.id, validFrom, validUntil, isPrimary: input.isPrimary ?? previousRoles.length === 0 },
        update: { validFrom, validUntil, ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}) },
      });
      const newRoles = [...new Set([...previousRoles, role.code])];
      const scopes = target.scopes.map((scope) => ({ type: scope.scopeType, id: scope.scopeId, issueCategoryId: scope.issueCategoryId }));
      await tx.roleAssignmentHistory.create({ data: { userId: target.id, changedById: actor.id, previousRoles, newRoles, previousScopes: scopes, newScopes: scopes, reason: input.reason.trim() } });
      await this.revokeAccessSessions(tx, target.id, "ROLE_ADDED");
      await tx.user.update({ where: { id: target.id }, data: { version: { increment: 1 } } });
      await this.audit.record({ actorId: actor.id, action: "user.role_added", entityType: "User", entityId: target.id, beforeValue: { roles: previousRoles }, afterValue: { roles: newRoles, role: role.code, validFrom, validUntil, isPrimary: input.isPrimary }, reason: input.reason, requestId }, tx);
      return { id: target.publicId, role: role.code, validFrom, validUntil, sessionsRevoked: true };
    });
    await this.officialGroups.synchronizeCollege(actor.collegeId);
    return result;
  }

  async removeRole(actor: AuthPrincipal, publicId: string, roleIdentifier: string, input: RemoveUserRoleDto, requestId: string) {
    const target = await this.prisma.user.findFirst({ where: { OR: [{ publicId }, { id: publicId }], collegeId: actor.collegeId, archivedAt: null }, include: { roles: { include: { role: true } }, scopes: true } });
    if (!target) throw new NotFoundException("User not found.");
    if (target.id === actor.id) throw new BadRequestException("Use a separate administrator account to change your own access.");
    const assignment = target.roles.find((entry) => entry.roleId === roleIdentifier || entry.role.code === roleIdentifier.trim().toUpperCase());
    if (!assignment) throw new NotFoundException("Role assignment not found.");
    if (target.roles.length === 1) throw new BadRequestException("A user must retain at least one role.");
    const previousRoles = target.roles.map((entry) => entry.role.code);
    const newRoles = previousRoles.filter((code) => code !== assignment.role.code);
    const scopes = target.scopes.map((scope) => ({ type: scope.scopeType, id: scope.scopeId, issueCategoryId: scope.issueCategoryId }));
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.userRole.delete({ where: { id: assignment.id } });
      if (assignment.isPrimary) {
        const nextPrimary = await tx.userRole.findFirst({ where: { userId: target.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
        if (nextPrimary) await tx.userRole.update({ where: { id: nextPrimary.id }, data: { isPrimary: true } });
      }
      await tx.roleAssignmentHistory.create({ data: { userId: target.id, changedById: actor.id, previousRoles, newRoles, previousScopes: scopes, newScopes: scopes, reason: input.reason.trim() } });
      await this.revokeAccessSessions(tx, target.id, "ROLE_REMOVED");
      await tx.user.update({ where: { id: target.id }, data: { version: { increment: 1 } } });
      await this.audit.record({ actorId: actor.id, action: "user.role_removed", entityType: "User", entityId: target.id, beforeValue: { roles: previousRoles }, afterValue: { roles: newRoles }, reason: input.reason, requestId }, tx);
      return { id: target.publicId, removedRole: assignment.role.code, roles: newRoles, sessionsRevoked: true };
    });
    await this.officialGroups.synchronizeCollege(actor.collegeId);
    return result;
  }

  async roleHistory(actor: AuthPrincipal, publicId: string) {
    const target = await this.prisma.user.findFirst({ where: { OR: [{ publicId }, { id: publicId }], collegeId: actor.collegeId }, select: { id: true, publicId: true, fullName: true } });
    if (!target) throw new NotFoundException("User not found.");
    const history = await this.prisma.roleAssignmentHistory.findMany({ where: { userId: target.id }, orderBy: { changedAt: "desc" }, take: 200 });
    const actorIds = [...new Set(history.map((entry) => entry.changedById))];
    const actors = actorIds.length ? await this.prisma.user.findMany({ where: { id: { in: actorIds }, collegeId: actor.collegeId }, select: { id: true, publicId: true, fullName: true } }) : [];
    const actorById = new Map(actors.map((entry) => [entry.id, entry]));
    return { user: target, history: history.map((entry) => ({ ...entry, changedBy: actorById.get(entry.changedById) ?? null })) };
  }

  async createMaintenanceStaff(actor: AuthPrincipal, input: CreateMaintenanceStaffDto, requestId: string) {
    const allowedRoles = new Set(["MAINTENANCE_ADMIN", "MAINTENANCE_SUPERVISOR", "MAINTENANCE_STAFF", "ELECTRICIAN", "PLUMBER", "IT_SUPPORT", "LAB_TECHNICIAN", "HOUSEKEEPING", "SECURITY", "OTHER_RESPONSIBLE"]);
    const roleCode = input.roleCode.trim().toUpperCase();
    if (!allowedRoles.has(roleCode)) throw new BadRequestException("Select a supported maintenance role.");
    const scopes: UserScopeDto[] = [
      { type: "CAMPUS", id: input.campusId },
      ...(input.blockId ? [{ type: "BLOCK" as const, id: input.blockId }] : []),
      ...(input.floorId ? [{ type: "FLOOR" as const, id: input.floorId }] : []),
      ...(input.roomIds ?? []).map((id) => ({ type: "ROOM" as const, id })),
      ...(input.issueCategoryIds ?? []).map((issueCategoryId) => ({ type: "ISSUE_CATEGORY" as const, issueCategoryId })),
      { type: "ASSIGNED_ISSUES" },
    ];
    return this.create(actor, {
      collegeIdentityId: input.employeeId,
      fullName: input.fullName,
      email: input.email,
      mobile: input.mobile,
      whatsappNumber: input.whatsappNumber,
      temporaryPassword: input.temporaryPassword,
      accountStatus: input.accountStatus,
      roleCodes: [roleCode],
      scopes,
      staffProfile: { employeeId: input.employeeId, designation: roleCode.replaceAll("_", " "), specialization: input.specialization, shift: input.shift, emergencyContact: input.emergencyContact },
    }, requestId);
  }

  maintenanceStaff(actor: AuthPrincipal) {
    const roles = ["MAINTENANCE_ADMIN", "MAINTENANCE_SUPERVISOR", "MAINTENANCE_STAFF", "ELECTRICIAN", "PLUMBER", "IT_SUPPORT", "LAB_TECHNICIAN", "HOUSEKEEPING", "SECURITY", "OTHER_RESPONSIBLE"];
    return this.prisma.user.findMany({
      where: { collegeId: actor.collegeId, archivedAt: null, roles: { some: { role: { code: { in: roles } } } } },
      select: { publicId: true, collegeIdentityId: true, fullName: true, email: true, mobile: true, whatsappNumber: true, status: true, mustChangePassword: true, roles: { select: { role: { select: { code: true, name: true } } } }, scopes: { select: { scopeType: true, scopeId: true, issueCategoryId: true } }, staffProfile: { select: { employeeId: true, designation: true, specialization: true, shift: true, emergencyContact: true } } },
      orderBy: { fullName: "asc" },
    });
  }

  private async revokeAccessSessions(tx: Prisma.TransactionClient, userId: string, reason: string): Promise<void> {
    const now = new Date();
    const sessions = await tx.session.findMany({ where: { userId }, select: { id: true } });
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now, revokeReason: reason } });
    await tx.refreshToken.updateMany({ where: { sessionId: { in: sessions.map((session) => session.id) }, revokedAt: null }, data: { revokedAt: now } });
  }

  async createRole(actor: AuthPrincipal, input: CreateRoleDto, requestId: string) {
    const code = input.code.trim().toUpperCase();
    if (await this.prisma.role.findFirst({ where: { code, OR: [{ collegeId: actor.collegeId }, { collegeId: null }] } })) {
      throw new ConflictException("A role with this code already exists.");
    }
    const permissions = await this.validDelegatedPermissions(actor, input.permissionCodes);
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          collegeId: actor.collegeId,
          code,
          name: input.name.trim(),
          description: input.description?.trim(),
          permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) },
        },
        select: { id: true, code: true, name: true, description: true, isSystem: true, isActive: true },
      });
      await this.audit.record({ actorId: actor.id, action: "role.created", entityType: "Role", entityId: role.id, afterValue: { code, name: role.name, permissions: input.permissionCodes }, requestId }, tx);
      return role;
    });
  }

  async updateRole(actor: AuthPrincipal, rawCode: string, input: UpdateRoleDto, requestId: string) {
    const code = rawCode.trim().toUpperCase();
    const role = await this.prisma.role.findFirst({
      where: { code, OR: [{ collegeId: actor.collegeId }, { collegeId: null }] },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException("Role not found.");
    if (role.isSystem && !actor.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException("Only a Super Admin can modify a system role.");
    }
    if (["SUPER_ADMIN", "MAIN_ADMIN"].includes(role.code) && !actor.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException("Only a Super Admin can modify this administrative role.");
    }
    const permissions = await this.validDelegatedPermissions(actor, input.permissionCodes);
    const beforePermissions = role.permissions.map((mapping) => mapping.permission.code);
    return this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })) });
      const updated = await tx.role.update({ where: { id: role.id }, data: { name: input.name.trim(), description: input.description?.trim() } });
      await this.audit.record({ actorId: actor.id, action: "role.updated", entityType: "Role", entityId: role.id, beforeValue: { name: role.name, description: role.description, permissions: beforePermissions }, afterValue: { name: updated.name, description: updated.description, permissions: input.permissionCodes }, reason: input.reason, requestId }, tx);
      return { code: updated.code, name: updated.name, description: updated.description, permissions: input.permissionCodes };
    });
  }

  roles(user: AuthPrincipal) { return this.prisma.role.findMany({ where: { isActive: true, OR: [{ collegeId: user.collegeId }, { collegeId: null }] }, select: { code: true, name: true, description: true, isSystem: true, isActive: true, permissions: { select: { permission: { select: { code: true } } } } }, orderBy: { name: "asc" } }); }
  permissions() { return this.prisma.permission.findMany({ orderBy: [{ resource: "asc" }, { action: "asc" }] }); }

  async scopeOptions(user: AuthPrincipal) {
    const [campuses, departments, programmes, academicYears, semesters, sections, blocks, floors, rooms, categories] = await this.prisma.$transaction([
      this.prisma.campus.findMany({ where: { collegeId: user.collegeId, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
      this.prisma.department.findMany({ where: { collegeId: user.collegeId, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
      this.prisma.programme.findMany({ where: { collegeId: user.collegeId, isActive: true }, select: { id: true, code: true, name: true, departmentId: true }, orderBy: { name: "asc" } }),
      this.prisma.academicYear.findMany({ where: { collegeId: user.collegeId, isActive: true }, select: { id: true, name: true }, orderBy: { startsOn: "desc" } }),
      this.prisma.semester.findMany({ where: { isActive: true, programme: { collegeId: user.collegeId } }, select: { id: true, name: true, number: true, programmeId: true, academicYearId: true }, orderBy: { number: "asc" } }),
      this.prisma.section.findMany({ where: { isActive: true, semester: { programme: { collegeId: user.collegeId } } }, select: { id: true, code: true, name: true, semesterId: true }, orderBy: { name: "asc" } }),
      this.prisma.block.findMany({ where: { isActive: true, campus: { collegeId: user.collegeId } }, select: { id: true, code: true, name: true, campusId: true }, orderBy: { name: "asc" } }),
      this.prisma.floor.findMany({ where: { isActive: true, block: { campus: { collegeId: user.collegeId } } }, select: { id: true, code: true, name: true, blockId: true }, orderBy: [{ level: "asc" }, { name: "asc" }] }),
      this.prisma.room.findMany({ where: { isActive: true, floor: { block: { campus: { collegeId: user.collegeId } } } }, select: { id: true, code: true, name: true, floorId: true }, orderBy: { name: "asc" } }),
      this.prisma.issueCategory.findMany({ where: { collegeId: user.collegeId, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { sortOrder: "asc" } }),
    ]);
    return { college: [{ id: user.collegeId, code: "COLLEGE", name: "Entire college" }], campuses, departments, programmes, academicYears, semesters, sections, blocks, floors, rooms, issueCategories: categories };
  }

  private assertRoleDelegation(actor: AuthPrincipal, roles: Array<{ code: string; permissions: string[] }>): void {
    const actorRank = this.highestRoleRank(actor.roles);
    if (roles.some((role) => {
      const requestedRank = ROLE_RANK[role.code];
      return requestedRank === undefined ? !actor.roles.includes("SUPER_ADMIN") : requestedRank > actorRank;
    })) {
      throw new ForbiddenException("You cannot assign a role above your administrative level.");
    }
    const actorPermissions = new Set(actor.permissions);
    if (roles.some((role) => role.permissions.some((permission) => !actorPermissions.has(permission)))) {
      throw new ForbiddenException("You cannot delegate permissions that you do not hold.");
    }
  }

  private highestRoleRank(roleCodes: string[]): number {
    return roleCodes.reduce((highest, code) => Math.max(highest, ROLE_RANK[code] ?? 0), 0);
  }

  private assertScopeCompatibility(roleCodes: string[], scopes: UserScopeDto[]): void {
    if (scopes.some((scope) => scope.type === "COLLEGE") && !roleCodes.some((code) => COLLEGE_WIDE_ROLES.has(code))) {
      throw new BadRequestException("College-wide scope is restricted to college-wide administrative roles.");
    }
    if (roleCodes.some((code) => ROLES_REQUIRING_COLLEGE_SCOPE.has(code)) && !scopes.some((scope) => scope.type === "COLLEGE")) {
      throw new BadRequestException("This administrative role requires an explicit college scope.");
    }
  }

  private async validDelegatedPermissions(actor: AuthPrincipal, permissionCodes: string[]) {
    const codes = [...new Set(permissionCodes.map((code) => code.trim()))];
    const permissions = await this.prisma.permission.findMany({ where: { code: { in: codes } } });
    if (permissions.length !== codes.length) throw new BadRequestException("One or more permission codes are invalid.");
    const actorPermissions = new Set(actor.permissions);
    if (permissions.some((permission) => !actorPermissions.has(permission.code))) {
      throw new ForbiddenException("You cannot delegate permissions that you do not hold.");
    }
    return permissions;
  }

  private async validateProfiles(collegeId: string, input: CreateUserDto): Promise<void> {
    const studentRole = input.roleCodes.some((code) => code === "STUDENT" || code === "CLASS_REPRESENTATIVE");
    if (studentRole && !input.studentProfile) throw new BadRequestException("Student accounts require an academic student profile.");
    if (input.studentProfile) {
      const profile = input.studentProfile;
      const section = await this.prisma.section.findFirst({
        where: {
          id: profile.sectionId,
          isActive: true,
          semester: { programmeId: profile.programmeId, programme: { id: profile.programmeId, departmentId: profile.departmentId, collegeId, isActive: true } },
        },
        select: { id: true },
      });
      if (!section) throw new BadRequestException("Student department, programme and section do not match.");
      const duplicate = await this.prisma.studentProfile.findFirst({ where: { collegeId, studentId: profile.studentId.trim() }, select: { id: true } });
      if (duplicate) throw new ConflictException("A student with this student ID already exists in the college.");
    }
    if (input.staffProfile) {
      if (input.staffProfile.departmentId) {
        const department = await this.prisma.department.findFirst({ where: { id: input.staffProfile.departmentId, collegeId, isActive: true }, select: { id: true } });
        if (!department) throw new BadRequestException("Staff department is not active in this college.");
      }
      const duplicate = await this.prisma.staffProfile.findFirst({ where: { collegeId, employeeId: input.staffProfile.employeeId.trim() }, select: { id: true } });
      if (duplicate) throw new ConflictException("A staff profile with this employee ID already exists in the college.");
    }
  }

  private assertStrongTemporaryPassword(password: string): void {
    if (password.trim().length < 6) {
      throw new BadRequestException("Temporary password must be at least 6 characters.");
    }
  }

  private generateTemporaryPassword(): string {
    const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*"];
    const all = groups.join("");
    const chars = [...groups.map((group) => this.pick(group)), ...Array.from({ length: 10 }, () => this.pick(all))];
    for (let index = chars.length - 1; index > 0; index -= 1) {
      const swapIndex = randomInt(index + 1);
      const current = chars[index] ?? "A";
      chars[index] = chars[swapIndex] ?? current;
      chars[swapIndex] = current;
    }
    return chars.join("");
  }

  private pick(chars: string): string {
    return chars[randomInt(chars.length)] ?? chars[0] ?? "A";
  }

  private async validateScopes(collegeId: string, scopes: UserScopeDto[]): Promise<void> {
    const identities = new Set<string>();
    for (const scope of scopes) {
      const identity = `${scope.type}:${scope.id ?? ""}:${scope.issueCategoryId ?? ""}`;
      if (identities.has(identity)) throw new BadRequestException("The same access scope cannot be assigned more than once.");
      identities.add(identity);

      if (scope.type === "COLLEGE") {
        if (scope.issueCategoryId || (scope.id && scope.id !== collegeId)) throw new BadRequestException("College scope does not match the account college.");
        continue;
      }
      if (scope.type === "ASSIGNED_ISSUES") {
        if (scope.id || scope.issueCategoryId) throw new BadRequestException("Assigned-issues scope cannot include a target ID.");
        continue;
      }
      if (scope.type === "ISSUE_CATEGORY") {
        if (scope.id || !scope.issueCategoryId) throw new BadRequestException("Issue-category scope requires only an issueCategoryId.");
        const category = await this.prisma.issueCategory.findFirst({ where: { id: scope.issueCategoryId, collegeId, isActive: true }, select: { id: true } });
        if (!category) throw new BadRequestException("Issue-category scope is not active in this college.");
        continue;
      }
      if (!scope.id || scope.issueCategoryId) throw new BadRequestException(`${scope.type} scope requires exactly one target ID.`);

      const found = await this.scopeTargetExists(collegeId, scope.type, scope.id);
      if (!found) throw new BadRequestException(`${scope.type} scope target is not active in this college.`);
    }
  }

  private async scopeTargetExists(collegeId: string, scopeType: UserScopeDto["type"], scopeId: string): Promise<boolean> {
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
