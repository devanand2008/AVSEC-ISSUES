import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import { randomInt } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import {
  AccountStatus,
  AcademicMembershipStatus,
  ProfileCompletionStatus,
  ScopeType,
} from "../../generated/prisma/enums";
import { Prisma } from "../../generated/prisma/client";
import type {
  AssignUserRoleDto,
  CreateMaintenanceStaffDto,
  CreateRoleDto,
  CreateUserDto,
  DeleteUserDto,
  NotificationPreferencesDto,
  RemoveUserRoleDto,
  ResetUserPasswordDto,
  UpdateRoleDto,
  UpdateUserAccessDto,
  UpdateUserStatusDto,
  UserScopeDto,
} from "./dto/user.dto";
import { OfficialGroupsService } from "../conversations/official-groups.service";
import { SectionPlacementService } from "../academic/section-placement.service";
import {
  BANNER_DISMISSAL_CLOCK_SKEW_MS,
  isBannerKey,
  mergeNotificationPreferences,
  type NotificationPreferencesPatch,
} from "../notifications/notification-preferences";

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

const COLLEGE_WIDE_ROLES = new Set([
  "SUPER_ADMIN",
  "MAIN_ADMIN",
  "PRINCIPAL",
  "VICE_PRINCIPAL",
]);
const ROLES_REQUIRING_COLLEGE_SCOPE = new Set([
  "SUPER_ADMIN",
  "MAIN_ADMIN",
  "PRINCIPAL",
]);

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly officialGroups: OfficialGroupsService,
    private readonly placements: SectionPlacementService,
  ) {}

  async profileRequirements(user: AuthPrincipal) {
    const role = this.primaryProfileRole(user.roles);
    const primaryRole = user.roles[0] ?? role;
    const lockedDepartment = await this.lockedDepartment(user.id);
    const onboarding = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { fullName: true, onboardingStudyYear: true },
    });
    const schemas = {
      STUDENT: {
        requiredFields: [
          "fullName",
          "collegeId",
          "registerNumber",
          "departmentId",
          "mobileNumber",
          "programmeId",
          "academicYearId",
          "studyYear",
          "semesterId",
          "sectionId",
        ],
        optionalFields: [
          "dateOfBirth",
          "gender",
          "rollNumber",
          "parentName",
          "parentMobileNumber",
          "emergencyContact",
        ],
      },
      STAFF: {
        requiredFields: [
          "employeeId",
          "mobileNumber",
          "designation",
          "qualification",
          "specialization",
          "dateOfJoining",
        ],
        optionalFields: [
          "whatsappNumber",
          "officeLocation",
          "emergencyContact",
          "shift",
        ],
      },
      MAINTENANCE: {
        requiredFields: [
          "employeeId",
          "mobileNumber",
          "specialization",
          "shift",
          "emergencyContact",
        ],
        optionalFields: ["designation", "whatsappNumber"],
      },
    } as const;
    const maintenanceRoles = new Set([
      "MAINTENANCE_ADMIN",
      "MAINTENANCE_SUPERVISOR",
      "MAINTENANCE_STAFF",
      "ELECTRICIAN",
      "PLUMBER",
      "IT_SUPPORT",
      "LAB_TECHNICIAN",
      "HOUSEKEEPING",
      "SECURITY",
      "OTHER_RESPONSIBLE",
    ]);
    const schema =
      role === "STUDENT"
        ? schemas.STUDENT
        : user.roles.some((code) => maintenanceRoles.has(code))
          ? schemas.MAINTENANCE
          : schemas.STAFF;
    return {
      role: primaryRole,
      profileKind: role,
      ...schema,
      lockedFields: [
        "email",
        ...(lockedDepartment ? ["departmentId"] : []),
        "primaryRole",
      ],
      lockedValues: {
        email: user.email,
        fullName: onboarding.fullName,
        studyYear: onboarding.onboardingStudyYear,
        department: lockedDepartment,
        primaryRole,
      },
    };
  }

  async myProfile(user: AuthPrincipal) {
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        publicId: true,
        fullName: true,
        email: true,
        mobile: true,
        whatsappNumber: true,
        onboardingStudyYear: true,
        profileCompletionStatus: true,
        profileCompletionPercentage: true,
        profileSubmittedAt: true,
        profileVerifiedAt: true,
        profileRejectionReason: true,
        profilePhotoKey: true,
        notificationPreferences: true,
        roles: { select: { role: { select: { code: true, name: true } } } },
        scopes: { select: { scopeType: true, scopeId: true } },
        studentProfile: {
          include: { department: true, programme: true, section: true },
        },
        staffProfile: { include: { department: true } },
      },
    });
    return {
      ...account,
      lockedDepartment: await this.lockedDepartment(user.id),
    };
  }

  myProfileStatus(user: AuthPrincipal) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        profileCompletionStatus: true,
        profileCompletionPercentage: true,
        profileSubmittedAt: true,
        profileVerifiedAt: true,
        profileRejectionReason: true,
      },
    });
  }

  async updateNotificationPreferences(
    user: AuthPrincipal,
    input: NotificationPreferencesDto,
    requestId: string,
  ) {
    for (const [bannerId, dismissedAt] of Object.entries(
      input.dismissed_banners ?? {},
    )) {
      const timestamp =
        typeof dismissedAt === "string" ? Date.parse(dismissedAt) : Number.NaN;
      if (
        !isBannerKey(bannerId) ||
        bannerId.toLowerCase().startsWith("critical-") ||
        !Number.isFinite(timestamp) ||
        timestamp > Date.now() + BANNER_DISMISSAL_CLOCK_SKEW_MS
      ) {
        throw new BadRequestException(
          "Dismissed banner preferences are invalid.",
        );
      }
    }
    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { notificationPreferences: true },
      });
      const preferences = mergeNotificationPreferences(
        existing.notificationPreferences,
        input as NotificationPreferencesPatch,
      );
      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          notificationPreferences:
            preferences as unknown as Prisma.InputJsonObject,
          version: { increment: 1 },
        },
        select: { notificationPreferences: true },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: "profile.notification_preferences_updated",
          entityType: "User",
          entityId: user.id,
          beforeValue: existing.notificationPreferences,
          afterValue: preferences as unknown as Prisma.InputJsonObject,
          requestId,
        },
        tx,
      );
      return updated;
    });
    return saved.notificationPreferences;
  }

  async saveMyProfileDraft(
    user: AuthPrincipal,
    input: Record<string, unknown>,
    requestId: string,
  ) {
    const percent = this.profileDraftPercentage(
      input,
      this.primaryProfileRole(user.roles),
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.user.update({
        where: { id: user.id },
        data: {
          ...(input.fullName
            ? { fullName: this.requiredString(input.fullName, "Full Name") }
            : {}),
          ...(input.mobileNumber
            ? { mobile: this.optionalString(input.mobileNumber) }
            : {}),
          ...(input.whatsappNumber
            ? { whatsappNumber: this.optionalString(input.whatsappNumber) }
            : {}),
          profileCompletionStatus: "IN_PROGRESS",
          profileCompletionPercentage: percent,
          version: { increment: 1 },
        },
        select: {
          publicId: true,
          profileCompletionStatus: true,
          profileCompletionPercentage: true,
        },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: "profile.draft_saved",
          entityType: "User",
          entityId: user.id,
          afterValue: saved,
          requestId,
        },
        tx,
      );
      return saved;
    });
    return { ...updated, allowedNextRoute: "/profile/setup" };
  }

  async submitMyProfile(
    user: AuthPrincipal,
    input: Record<string, unknown>,
    requestId: string,
  ) {
    const role = this.primaryProfileRole(user.roles);
    const lockedDepartment = await this.lockedDepartment(user.id);
    if (role === "STUDENT") {
      const collegeId = this.requiredString(input.collegeId, "College ID");
      const registerNumber = this.requiredString(
        input.registerNumber,
        "Register Number",
      );
      const departmentId =
        lockedDepartment?.id ??
        this.requiredString(input.departmentId, "Department");
      const programmeId = this.requiredString(input.programmeId, "Programme");
      const academicYearId = this.requiredString(
        input.academicYearId,
        "Academic Year",
      );
      const semesterId = this.requiredString(input.semesterId, "Semester");
      const sectionId = this.requiredString(input.sectionId, "Section");
      const mobileNumber = this.requiredString(
        input.mobileNumber,
        "Mobile Number",
      );
      const studyYear = this.requiredInteger(
        input.studyYear,
        "Study year",
        1,
        4,
      );
      const existingPlacement = await this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
        select: {
          departmentId: true,
          programmeId: true,
          sectionId: true,
          studyYear: true,
          section: {
            select: {
              semesterId: true,
              semester: { select: { academicYearId: true } },
            },
          },
        },
      });
      if (
        existingPlacement &&
        (existingPlacement.departmentId !== departmentId ||
          existingPlacement.programmeId !== programmeId ||
          existingPlacement.sectionId !== sectionId ||
          existingPlacement.studyYear !== studyYear ||
          existingPlacement.section.semesterId !== semesterId ||
          existingPlacement.section.semester.academicYearId !== academicYearId)
      ) {
        throw new ForbiddenException(
          "Students cannot change their academic placement. Contact an authorised administrator.",
        );
      }
      await this.prisma
        .$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: {
              fullName: this.requiredString(
                input.fullName ?? user.fullName,
                "Full Name",
              ),
              mobile: mobileNumber,
              whatsappNumber: this.optionalString(input.whatsappNumber),
              onboardingStudyYear: studyYear,
              profileCompletionStatus: "SUBMITTED",
              profileCompletionPercentage: 100,
              profileSubmittedAt: new Date(),
              profileRejectionReason: null,
              version: { increment: 1 },
            },
          });
          await this.placements.placeStudent(tx, {
            collegeId: user.collegeId,
            userId: user.id,
            sectionId,
            startsOn: this.dateOnly(new Date()),
            accountStatus: AccountStatus.ACTIVE,
            profile: {
              departmentId,
              programmeId,
              academicYearId,
              semesterId,
              studentId: collegeId,
              registerNumber,
              studyYear,
              rollNumber: this.optionalString(input.rollNumber),
              admissionNumber: this.optionalString(input.admissionNumber),
              dateOfBirth: this.optionalDate(
                input.dateOfBirth,
                "Date of Birth",
              ),
              gender: this.optionalString(input.gender),
              personalEmail: this.optionalString(input.personalEmail),
              bloodGroup: this.optionalString(input.bloodGroup),
              address: this.optionalString(input.address),
              city: this.optionalString(input.city),
              district: this.optionalString(input.district),
              state: this.optionalString(input.state),
              pinCode: this.optionalString(input.pinCode),
              parentName: this.optionalString(input.parentName),
              parentMobileNumber: this.optionalString(input.parentMobileNumber),
              emergencyContact: this.optionalString(input.emergencyContact),
            },
          });
          await this.audit.record(
            {
              actorId: user.id,
              action: "profile.submitted",
              entityType: "User",
              entityId: user.id,
              afterValue: { role: "STUDENT" },
              requestId,
            },
            tx,
          );
        })
        .catch((error: unknown) => {
          if (this.isPrismaUniqueError(error))
            throw new ConflictException(
              "A student with this college ID or register number already exists.",
            );
          throw error;
        });
    } else {
      const employeeId = this.requiredString(input.employeeId, "Employee ID");
      const mobileNumber = this.requiredString(
        input.mobileNumber,
        "Mobile Number",
      );
      const departmentId = lockedDepartment?.id;
      const maintenanceRoles = new Set([
        "MAINTENANCE_ADMIN",
        "MAINTENANCE_SUPERVISOR",
        "MAINTENANCE_STAFF",
        "ELECTRICIAN",
        "PLUMBER",
        "IT_SUPPORT",
        "LAB_TECHNICIAN",
        "HOUSEKEEPING",
        "SECURITY",
        "OTHER_RESPONSIBLE",
      ]);
      const maintenance = user.roles.some((code) => maintenanceRoles.has(code));
      const designation = maintenance
        ? (this.optionalString(input.designation) ?? role.replaceAll("_", " "))
        : this.requiredString(input.designation, "Designation");
      const qualification = maintenance
        ? this.optionalString(input.qualification)
        : this.requiredString(input.qualification, "Qualification");
      const specialization = this.requiredString(
        input.specialization,
        "Specialization",
      );
      const shift = maintenance
        ? this.requiredString(input.shift, "Shift")
        : this.optionalString(input.shift);
      const emergencyContact = maintenance
        ? this.requiredString(input.emergencyContact, "Emergency Contact")
        : this.optionalString(input.emergencyContact);
      const joinedOn = maintenance
        ? this.optionalDate(input.dateOfJoining, "Date of Joining")
        : this.optionalDate(
            this.requiredString(input.dateOfJoining, "Date of Joining"),
            "Date of Joining",
          );
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            fullName: this.requiredString(
              input.fullName ?? user.fullName,
              "Full Name",
            ),
            mobile: mobileNumber,
            whatsappNumber: this.optionalString(input.whatsappNumber),
            profileCompletionStatus: "SUBMITTED",
            profileCompletionPercentage: 100,
            profileSubmittedAt: new Date(),
            profileRejectionReason: null,
            version: { increment: 1 },
          },
        });
        await tx.staffProfile.upsert({
          where: { userId: user.id },
          create: {
            collegeId: user.collegeId,
            userId: user.id,
            departmentId,
            employeeId,
            designation,
            qualification,
            specialization,
            shift,
            emergencyContact,
            joinedOn,
          },
          update: {
            departmentId,
            employeeId,
            designation,
            qualification,
            specialization,
            shift,
            emergencyContact,
            joinedOn,
          },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "profile.submitted",
            entityType: "User",
            entityId: user.id,
            afterValue: { role },
            requestId,
          },
          tx,
        );
      });
    }
    await this.officialGroups.synchronizeCollege(user.collegeId);
    return { profileCompletionStatus: "SUBMITTED", allowedNextRoute: "/" };
  }

  async list(
    user: AuthPrincipal,
    page: number,
    pageSize: number,
    search?: string,
    filters: {
      role?: string;
      status?: string;
      firstLogin?: string;
      profileStatus?: string;
      departmentId?: string;
      programmeId?: string;
      academicYearId?: string;
      studyYear?: string;
      semesterId?: string;
      sectionId?: string;
      campusId?: string;
      blockId?: string;
      floorId?: string;
      roomId?: string;
      archived?: string;
      lastLogin?: string;
      importBatchId?: string;
    } = {},
  ) {
    const status =
      filters.status &&
      Object.values(AccountStatus).includes(filters.status as AccountStatus)
        ? (filters.status as AccountStatus)
        : undefined;
    const profileStatuses = new Set(Object.values(ProfileCompletionStatus));
    const profileCompletionStatus =
      filters.profileStatus &&
      profileStatuses.has(filters.profileStatus as ProfileCompletionStatus)
        ? (filters.profileStatus as ProfileCompletionStatus)
        : undefined;
    const studyYear = filters.studyYear ? Number(filters.studyYear) : undefined;
    const lastLoginBoundary =
      filters.lastLogin === "LAST_7_DAYS"
        ? new Date(Date.now() - 7 * 86_400_000)
        : filters.lastLogin === "LAST_30_DAYS"
          ? new Date(Date.now() - 30 * 86_400_000)
          : undefined;
    const and: Prisma.UserWhereInput[] = [];
    if (search)
      and.push({
        OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { collegeIdentityId: { contains: search, mode: "insensitive" } },
          {
            normalizedEmail: {
              contains: search.toLowerCase(),
              mode: "insensitive",
            },
          },
          { mobile: { contains: search, mode: "insensitive" } },
          {
            studentProfile: {
              OR: [
                { studentId: { contains: search, mode: "insensitive" } },
                { registerNumber: { contains: search, mode: "insensitive" } },
                { rollNumber: { contains: search, mode: "insensitive" } },
              ],
            },
          },
          {
            staffProfile: {
              employeeId: { contains: search, mode: "insensitive" },
            },
          },
        ],
      });
    if (filters.departmentId)
      and.push({
        OR: [
          {
            scopes: {
              some: { scopeType: "DEPARTMENT", scopeId: filters.departmentId },
            },
          },
          { studentProfile: { departmentId: filters.departmentId } },
          { staffProfile: { departmentId: filters.departmentId } },
        ],
      });
    const placeScope = filters.roomId
      ? { scopeType: "ROOM" as const, scopeId: filters.roomId }
      : filters.floorId
        ? { scopeType: "FLOOR" as const, scopeId: filters.floorId }
        : filters.blockId
          ? { scopeType: "BLOCK" as const, scopeId: filters.blockId }
          : filters.campusId
            ? { scopeType: "CAMPUS" as const, scopeId: filters.campusId }
            : undefined;
    if (placeScope) and.push({ scopes: { some: placeScope } });
    const where: Prisma.UserWhereInput = {
      collegeId: user.collegeId,
      ...(filters.archived === "ONLY" || status === "ARCHIVED"
        ? { archivedAt: { not: null } }
        : { archivedAt: null }),
      ...(status ? { status } : {}),
      ...(profileCompletionStatus ? { profileCompletionStatus } : {}),
      ...(filters.role
        ? { roles: { some: { role: { code: filters.role, isActive: true } } } }
        : {}),
      ...(filters.programmeId
        ? { studentProfile: { programmeId: filters.programmeId } }
        : {}),
      ...(filters.sectionId
        ? { studentProfile: { sectionId: filters.sectionId } }
        : {}),
      ...(Number.isInteger(studyYear)
        ? {
            OR: [
              { onboardingStudyYear: studyYear },
              { studentProfile: { studyYear } },
              { studentProfile: { section: { studyYear } } },
            ],
          }
        : {}),
      ...(filters.semesterId
        ? { studentProfile: { section: { semesterId: filters.semesterId } } }
        : {}),
      ...(filters.academicYearId
        ? {
            studentProfile: {
              section: { semester: { academicYearId: filters.academicYearId } },
            },
          }
        : {}),
      ...(filters.firstLogin === "REQUIRED"
        ? { mustChangePassword: true }
        : {}),
      ...(filters.firstLogin === "COMPLETED"
        ? { mustChangePassword: false, firstLoginCompletedAt: { not: null } }
        : {}),
      ...(filters.importBatchId
        ? { importBatchId: filters.importBatchId }
        : {}),
      ...(lastLoginBoundary ? { lastLoginAt: { gte: lastLoginBoundary } } : {}),
      ...(filters.lastLogin === "NEVER" ? { lastLoginAt: null } : {}),
      ...(and.length ? { AND: and } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { fullName: "asc" },
        select: {
          publicId: true,
          collegeIdentityId: true,
          fullName: true,
          email: true,
          mobile: true,
          profilePhotoKey: true,
          importBatchId: true,
          onboardingStudyYear: true,
          status: true,
          mustChangePassword: true,
          profileCompletionStatus: true,
          profileCompletionPercentage: true,
          profileSubmittedAt: true,
          profileVerifiedAt: true,
          firstLoginCompletedAt: true,
          lastLoginAt: true,
          roles: {
            select: {
              isPrimary: true,
              role: { select: { code: true, name: true } },
            },
          },
          scopes: {
            select: { scopeType: true, scopeId: true, issueCategoryId: true },
          },
          studentProfile: {
            select: {
              studentId: true,
              registerNumber: true,
              studyYear: true,
              programme: { select: { code: true, name: true } },
              department: { select: { code: true, name: true } },
              section: {
                select: {
                  code: true,
                  name: true,
                  studyYear: true,
                  semester: {
                    select: {
                      number: true,
                      name: true,
                      academicYear: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
          staffProfile: {
            select: {
              employeeId: true,
              designation: true,
              department: { select: { code: true, name: true } },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      data: await this.attachAssignedPlaces(data),
      meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
    };
  }

  async detail(actor: AuthPrincipal, publicId: string) {
    const target = await this.prisma.user.findFirst({
      where: {
        OR: [{ publicId }, { id: publicId }],
        collegeId: actor.collegeId,
      },
      select: {
        id: true,
        publicId: true,
        collegeIdentityId: true,
        fullName: true,
        email: true,
        normalizedEmail: true,
        mobile: true,
        whatsappNumber: true,
        status: true,
        archivedAt: true,
        mustChangePassword: true,
        profileCompletionStatus: true,
        profileCompletionPercentage: true,
        profileSubmittedAt: true,
        profileVerifiedAt: true,
        profileRejectionReason: true,
        firstLoginCompletedAt: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        roles: {
          select: {
            roleId: true,
            validFrom: true,
            validUntil: true,
            isPrimary: true,
            role: { select: { code: true, name: true } },
          },
        },
        scopes: {
          select: { scopeType: true, scopeId: true, issueCategoryId: true },
        },
        studentProfile: {
          include: { department: true, programme: true, section: true },
        },
        staffProfile: { include: { department: true } },
        sessions: {
          where: { revokedAt: null, expiresAt: { gt: new Date() } },
          select: {
            id: true,
            userAgent: true,
            ipAddress: true,
            createdAt: true,
            lastSeenAt: true,
            expiresAt: true,
          },
        },
      },
    });
    if (!target) throw new NotFoundException("User not found.");
    const { id, ...publicTarget } = target;
    const history = await this.prisma.roleAssignmentHistory.findMany({
      where: { userId: id },
      orderBy: { changedAt: "desc" },
      take: 50,
    });
    return { ...publicTarget, roleHistory: history };
  }

  async create(actor: AuthPrincipal, input: CreateUserDto, requestId: string) {
    const isStudent = input.roleCodes.includes("STUDENT");
    const normalizedEmail = input.email?.trim().toLowerCase();
    if (isStudent && !normalizedEmail)
      throw new BadRequestException(
        "Official college email is required when creating a student account.",
      );
    if (isStudent && !input.studentProfile)
      throw new BadRequestException(
        "Academic information is required when creating a student account.",
      );
    if (!isStudent && input.studentProfile)
      throw new BadRequestException(
        "A student profile requires the STUDENT role.",
      );
    if (input.studentProfile?.academicOverride) {
      if (!actor.permissions.includes("academic.override_placement")) {
        throw new ForbiddenException(
          "You do not have permission to override academic placement.",
        );
      }
      if (!input.studentProfile.academicOverrideReason?.trim()) {
        throw new BadRequestException("Academic override reason is required.");
      }
    } else if (input.studentProfile?.academicOverrideReason?.trim()) {
      throw new BadRequestException(
        "Enable Advanced Academic Override before supplying an override reason.",
      );
    }
    const roles = await this.prisma.role.findMany({
      where: {
        code: { in: input.roleCodes },
        isActive: true,
        OR: [{ collegeId: actor.collegeId }, { collegeId: null }],
      },
      include: { permissions: { include: { permission: true } } },
    });
    if (roles.length !== new Set(input.roleCodes).size)
      throw new BadRequestException("One or more role codes are invalid.");
    this.assertRoleDelegation(
      actor,
      roles.map((role) => ({
        code: role.code,
        permissions: role.permissions.map((entry) => entry.permission.code),
      })),
    );
    await this.validateScopes(actor.collegeId, input.scopes);
    if (
      input.scopes.some((scope) => scope.type === "COLLEGE") &&
      !input.roleCodes.some((code) => COLLEGE_WIDE_ROLES.has(code))
    ) {
      throw new BadRequestException(
        "College-wide scope is restricted to college-wide administrative roles.",
      );
    }
    if (
      input.roleCodes.some((code) => ROLES_REQUIRING_COLLEGE_SCOPE.has(code)) &&
      !input.scopes.some((scope) => scope.type === "COLLEGE")
    ) {
      throw new BadRequestException(
        "This administrative role requires an explicit college scope.",
      );
    }
    await this.validateProfiles(actor.collegeId, input);
    const effectiveScopes: UserScopeDto[] = input.studentProfile
      ? [
          ...input.scopes.filter((scope) => scope.type !== ScopeType.SECTION),
          { type: ScopeType.SECTION, id: input.studentProfile.sectionId },
        ]
      : input.scopes;
    const exists = await this.prisma.user.findFirst({
      where: {
        collegeId: actor.collegeId,
        OR: [
          { collegeIdentityId: input.collegeIdentityId.trim() },
          ...(normalizedEmail ? [{ normalizedEmail }] : []),
        ],
      },
    });
    if (exists)
      throw new ConflictException(
        "A user with this college ID or email already exists.",
      );
    const passwordHash = await argon2.hash(
      input.temporaryPassword + this.config.get<string>("PASSWORD_PEPPER", ""),
      { type: argon2.argon2id },
    );
    const result = await this.prisma
      .$transaction(
        async (tx) => {
          const created = await tx.user.create({
            data: {
              collegeId: actor.collegeId,
              collegeIdentityId: input.collegeIdentityId.trim(),
              fullName: input.fullName.trim(),
              email: input.email?.trim(),
              normalizedEmail,
              mobile: input.mobile?.trim(),
              whatsappNumber: input.whatsappNumber?.trim(),
              status: input.accountStatus ?? "ACTIVE",
              mustChangePassword: input.mustChangePassword ?? true,
              profileCompletionStatus:
                input.studentProfile || input.staffProfile
                  ? "SUBMITTED"
                  : "NOT_STARTED",
              profileCompletionPercentage:
                input.studentProfile || input.staffProfile ? 100 : 0,
              ...(input.studentProfile || input.staffProfile
                ? { profileSubmittedAt: new Date() }
                : {}),
              credential: { create: { passwordHash } },
              roles: { create: roles.map((role) => ({ roleId: role.id })) },
              scopes: {
                create: effectiveScopes
                  .filter(
                    (scope) =>
                      !input.studentProfile || scope.type !== ScopeType.SECTION,
                  )
                  .map((scope) => ({
                    scopeType: scope.type,
                    scopeId: scope.id,
                    issueCategoryId: scope.issueCategoryId,
                  })),
              },
              ...(input.staffProfile
                ? {
                    staffProfile: {
                      create: {
                        collegeId: actor.collegeId,
                        departmentId: input.staffProfile.departmentId,
                        employeeId: input.staffProfile.employeeId.trim(),
                        designation: input.staffProfile.designation?.trim(),
                        specialization:
                          input.staffProfile.specialization?.trim(),
                        shift: input.staffProfile.shift?.trim(),
                        emergencyContact:
                          input.staffProfile.emergencyContact?.trim(),
                      },
                    },
                  }
                : {}),
            },
          });
          if (input.studentProfile) {
            await this.placements.placeStudent(tx, {
              collegeId: actor.collegeId,
              userId: created.id,
              sectionId: input.studentProfile.sectionId,
              startsOn: this.dateOnly(new Date()),
              accountStatus: input.accountStatus ?? AccountStatus.ACTIVE,
              profile: {
                degreeTypeId: input.studentProfile.degreeTypeId,
                departmentId: input.studentProfile.departmentId,
                programmeId: input.studentProfile.programmeId,
                academicYearId: input.studentProfile.academicYearId,
                semesterId: input.studentProfile.semesterId,
                studentId:
                  input.studentProfile.studentId?.trim() ||
                  input.collegeIdentityId.trim(),
                registerNumber: input.studentProfile.registerNumber,
                admissionYear: input.studentProfile.admissionYear,
                rollNumber: input.studentProfile.rollNumber,
                studyYear: input.studentProfile.studyYear,
                dateOfBirth: this.optionalDate(
                  input.studentProfile.dateOfBirth,
                  "Date of Birth",
                ),
                gender: input.studentProfile.gender,
                personalEmail: input.studentProfile.personalEmail,
                admissionType: input.studentProfile.admissionType,
                expectedGraduationYear:
                  input.studentProfile.expectedGraduationYear,
                academicStatus: input.studentProfile.academicStatus,
                academicOverride: input.studentProfile.academicOverride,
                academicOverrideReason:
                  input.studentProfile.academicOverrideReason,
                changedById: actor.id,
              },
            });
          }
          await tx.roleAssignmentHistory.create({
            data: {
              userId: created.id,
              changedById: actor.id,
              previousRoles: [],
              newRoles: input.roleCodes,
              previousScopes: [],
              newScopes: effectiveScopes as unknown as Prisma.InputJsonValue,
              reason: "Initial account access assignment",
            },
          });
          await this.audit.record(
            {
              actorId: actor.id,
              action: "user.created",
              entityType: "User",
              entityId: created.id,
              afterValue: {
                publicId: created.publicId,
                roles: input.roleCodes,
                scopes: effectiveScopes,
              },
              requestId,
            },
            tx,
          );
          return {
            id: created.publicId,
            collegeIdentityId: created.collegeIdentityId,
            fullName: created.fullName,
            status: created.status,
            mustChangePassword: created.mustChangePassword,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((error: unknown) => {
        if (this.isPrismaUniqueError(error))
          throw new ConflictException(
            "A user with this college ID, email, student ID or register number already exists.",
          );
        throw error;
      });
    await this.officialGroups.synchronizeCollege(actor.collegeId);
    return result;
  }

  async revokeSessions(
    actor: AuthPrincipal,
    publicId: string,
    reason: string,
    requestId: string,
  ) {
    const target = await this.prisma.user.findFirst({
      where: { publicId, collegeId: actor.collegeId },
      select: { id: true, publicId: true, fullName: true },
    });
    if (!target) throw new NotFoundException("User not found.");
    if (target.id === actor.id)
      throw new BadRequestException(
        "Use your security settings to revoke your own sessions.",
      );
    return this.prisma.$transaction(async (tx) => {
      const activeSessions = await tx.session.count({
        where: { userId: target.id, revokedAt: null },
      });
      await this.revokeAccessSessions(
        tx,
        target.id,
        "ADMIN_SESSION_REVOCATION",
      );
      await this.audit.record(
        {
          actorId: actor.id,
          action: "user.sessions_revoked",
          entityType: "User",
          entityId: target.id,
          afterValue: { revokedSessions: activeSessions },
          reason,
          requestId,
        },
        tx,
      );
      return { id: target.publicId, revokedSessions: activeSessions };
    });
  }

  async updateBasic(
    actor: AuthPrincipal,
    publicId: string,
    input: Record<string, unknown>,
    requestId: string,
  ) {
    const target = await this.prisma.user.findFirst({
      where: { publicId, collegeId: actor.collegeId, archivedAt: null },
      select: {
        id: true,
        fullName: true,
        email: true,
        normalizedEmail: true,
        status: true,
      },
    });
    if (!target) throw new NotFoundException("User not found.");
    const data: Prisma.UserUpdateInput = { version: { increment: 1 } };
    if ("fullName" in input)
      data.fullName = this.requiredString(input.fullName, "Full Name");
    if ("email" in input) {
      const email = this.optionalString(input.email);
      data.email = email ?? null;
      data.normalizedEmail = email?.toLowerCase() ?? null;
    }
    if ("mobile" in input)
      data.mobile = this.optionalString(input.mobile) ?? null;
    if ("whatsappNumber" in input)
      data.whatsappNumber = this.optionalString(input.whatsappNumber) ?? null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.user.update({
        where: { id: target.id },
        data,
        select: {
          publicId: true,
          fullName: true,
          email: true,
          mobile: true,
          whatsappNumber: true,
          updatedAt: true,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: "user.updated",
          entityType: "User",
          entityId: target.id,
          beforeValue: target,
          afterValue: saved,
          requestId,
        },
        tx,
      );
      return saved;
    });
    return updated;
  }

  async verifyProfile(
    actor: AuthPrincipal,
    publicId: string,
    requestId: string,
  ) {
    const target = await this.prisma.user.findFirst({
      where: { publicId, collegeId: actor.collegeId, archivedAt: null },
      select: { id: true, profileCompletionStatus: true },
    });
    if (!target) throw new NotFoundException("User not found.");
    if (!["SUBMITTED", "REJECTED"].includes(target.profileCompletionStatus))
      throw new BadRequestException("Only submitted profiles can be verified.");
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: target.id },
        data: {
          profileCompletionStatus: "VERIFIED",
          profileCompletionPercentage: 100,
          profileVerifiedAt: now,
          profileVerifiedById: actor.id,
          profileRejectionReason: null,
          version: { increment: 1 },
        },
        select: {
          publicId: true,
          profileCompletionStatus: true,
          profileVerifiedAt: true,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: "profile.verified",
          entityType: "User",
          entityId: target.id,
          beforeValue: {
            profileCompletionStatus: target.profileCompletionStatus,
          },
          afterValue: updated,
          requestId,
        },
        tx,
      );
      return updated;
    });
  }

  async rejectProfile(
    actor: AuthPrincipal,
    publicId: string,
    reason: string,
    requestId: string,
  ) {
    const target = await this.prisma.user.findFirst({
      where: { publicId, collegeId: actor.collegeId, archivedAt: null },
      select: { id: true, profileCompletionStatus: true },
    });
    if (!target) throw new NotFoundException("User not found.");
    const profileRejectionReason = this.requiredString(
      reason,
      "Rejection reason",
    );
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: target.id },
        data: {
          profileCompletionStatus: "REJECTED",
          profileCompletionPercentage: 75,
          profileRejectionReason,
          profileVerifiedAt: null,
          profileVerifiedById: null,
          version: { increment: 1 },
        },
        select: {
          publicId: true,
          profileCompletionStatus: true,
          profileRejectionReason: true,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: "profile.rejected",
          entityType: "User",
          entityId: target.id,
          beforeValue: {
            profileCompletionStatus: target.profileCompletionStatus,
          },
          afterValue: updated,
          reason: profileRejectionReason,
          requestId,
        },
        tx,
      );
      return updated;
    });
  }

  async status(
    actor: AuthPrincipal,
    publicId: string,
    input: UpdateUserStatusDto,
    requestId: string,
  ) {
    const now = new Date();
    const target = await this.prisma.user.findFirst({
      where: { publicId, collegeId: actor.collegeId },
      include: {
        studentProfile: { select: { sectionId: true } },
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
    if (target.id === actor.id && input.status !== "ACTIVE")
      throw new BadRequestException("You cannot deactivate your own account.");
    if (
      input.status === AccountStatus.ACTIVE &&
      target.collegeIdentityId?.startsWith("DELETED-")
    ) {
      throw new BadRequestException(
        "Permanently deleted accounts cannot be reactivated. Create a new account instead.",
      );
    }
    const actorRank = this.highestRoleRank(actor.roles);
    const targetRoleCodes = target.roles.map((mapping) => mapping.role.code);
    const targetRank = this.highestRoleRank(targetRoleCodes);
    if (
      targetRank > actorRank ||
      (targetRank === actorRank &&
        targetRank > 0 &&
        !actor.roles.includes("SUPER_ADMIN"))
    ) {
      throw new ForbiddenException(
        "You cannot change the status of an account at or above your administrative level.",
      );
    }
    if (
      target.status === "ACTIVE" &&
      input.status !== "ACTIVE" &&
      targetRoleCodes.includes("SUPER_ADMIN")
    ) {
      const otherActiveSuperAdmins = await this.prisma.user.count({
        where: {
          id: { not: target.id },
          collegeId: actor.collegeId,
          status: "ACTIVE",
          roles: {
            some: {
              validFrom: { lte: now },
              OR: [{ validUntil: null }, { validUntil: { gt: now } }],
              role: {
                code: "SUPER_ADMIN",
                isActive: true,
                OR: [{ collegeId: actor.collegeId }, { collegeId: null }],
              },
            },
          },
        },
      });
      if (otherActiveSuperAdmins === 0)
        throw new BadRequestException(
          "The last active Super Admin cannot be deactivated.",
        );
    }
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT id FROM users WHERE id = $1 FOR UPDATE`,
        target.id,
      );
      const lockedTarget = await tx.user.findFirst({
        where: { id: target.id, collegeId: actor.collegeId },
        select: {
          status: true,
          collegeIdentityId: true,
          studentProfile: { select: { sectionId: true } },
          sectionMemberships: {
            where: {
              isActive: true,
              status: AcademicMembershipStatus.ACTIVE,
            },
            select: { startsOn: true },
            take: 1,
          },
        },
      });
      if (!lockedTarget) throw new NotFoundException("User not found.");
      if (
        input.status === AccountStatus.ACTIVE &&
        lockedTarget.collegeIdentityId.startsWith("DELETED-")
      ) {
        throw new BadRequestException(
          "Permanently deleted accounts cannot be reactivated. Create a new account instead.",
        );
      }
      if (
        lockedTarget.status === AccountStatus.ACTIVE &&
        input.status !== AccountStatus.ACTIVE &&
        targetRoleCodes.includes("SUPER_ADMIN")
      ) {
        const otherActiveSuperAdmins = await tx.user.count({
          where: {
            id: { not: target.id },
            collegeId: actor.collegeId,
            status: AccountStatus.ACTIVE,
            roles: {
              some: {
                validFrom: { lte: now },
                OR: [{ validUntil: null }, { validUntil: { gt: now } }],
                role: {
                  code: "SUPER_ADMIN",
                  isActive: true,
                  OR: [{ collegeId: actor.collegeId }, { collegeId: null }],
                },
              },
            },
          },
        });
        if (otherActiveSuperAdmins === 0)
          throw new BadRequestException(
            "The last active Super Admin cannot be deactivated.",
          );
      }
      if (
        input.status === AccountStatus.ACTIVE &&
        lockedTarget.status !== AccountStatus.ACTIVE &&
        lockedTarget.studentProfile
      ) {
        await this.placements.placeStudent(tx, {
          collegeId: actor.collegeId,
          userId: target.id,
          sectionId: lockedTarget.studentProfile.sectionId,
          startsOn: this.dateOnly(new Date()),
          accountStatus: AccountStatus.ACTIVE,
          profile: {
            changedById: actor.id,
            academicOverrideReason: input.reason,
          },
        });
      }
      const terminalPlacementStatuses: AccountStatus[] = [
        AccountStatus.ARCHIVED,
        AccountStatus.GRADUATED,
        AccountStatus.RESIGNED,
        AccountStatus.DISABLED,
      ];
      const closesAcademicPlacement = terminalPlacementStatuses.includes(
        input.status,
      );
      if (closesAcademicPlacement && lockedTarget.studentProfile) {
        await this.placements.lockSection(
          tx,
          lockedTarget.studentProfile.sectionId,
        );
        const activeMembershipStartsOn =
          lockedTarget.sectionMemberships[0]?.startsOn;
        const membershipEndsOn = activeMembershipStartsOn
          ? this.latestDate(this.dateOnly(now), activeMembershipStartsOn)
          : this.dateOnly(now);
        await tx.sectionMembership.updateMany({
          where: {
            studentUserId: target.id,
            isActive: true,
            status: AcademicMembershipStatus.ACTIVE,
          },
          data: {
            isActive: false,
            endsOn: membershipEndsOn,
            status:
              input.status === AccountStatus.GRADUATED
                ? AcademicMembershipStatus.COMPLETED
                : AcademicMembershipStatus.ARCHIVED,
            changedById: actor.id,
            reason: input.reason.trim(),
          },
        });
        await tx.userScope.deleteMany({
          where: { userId: target.id, scopeType: ScopeType.SECTION },
        });
      }
      const updated = await tx.user.update({
        where: { id: target.id },
        data: {
          status: input.status,
          archivedAt: input.status === "ARCHIVED" ? new Date() : null,
          version: { increment: 1 },
        },
      });
      if (input.status !== "ACTIVE") {
        await tx.classRepresentativeAssignment.updateMany({
          where: { representativeId: target.id, isActive: true },
          data: { isActive: false, validUntil: this.dateOnly(now) },
        });
        await tx.userRole.updateMany({
          where: {
            userId: target.id,
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
            role: { code: "CLASS_REPRESENTATIVE" },
          },
          data: { validUntil: now },
        });
        await tx.session.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: {
            revokedAt: new Date(),
            revokeReason: `ACCOUNT_${input.status}`,
          },
        });
        const sessions = await tx.session.findMany({
          where: { userId: target.id },
          select: { id: true },
        });
        await tx.refreshToken.updateMany({
          where: {
            sessionId: { in: sessions.map((session) => session.id) },
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: "user.status_changed",
          entityType: "User",
          entityId: target.id,
          beforeValue: { status: lockedTarget.status },
          afterValue: { status: input.status },
          reason: input.reason,
          requestId,
        },
        tx,
      );
      return { id: updated.publicId, status: updated.status };
    });
    await this.officialGroups.synchronizeCollege(actor.collegeId);
    return result;
  }

  async bulkStatus(
    actor: AuthPrincipal,
    publicIds: string[],
    status: AccountStatus,
    reason: string,
    requestId: string,
  ) {
    const results = [];
    for (const publicId of [...new Set(publicIds)]) {
      results.push(
        await this.status(actor, publicId, { status, reason }, requestId),
      );
    }
    return { status, updated: results.length, results };
  }

  async resetPassword(
    actor: AuthPrincipal,
    publicId: string,
    input: ResetUserPasswordDto,
    requestId: string,
  ) {
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
    if (target.id === actor.id)
      throw new BadRequestException(
        "Use the change-password page to update your own password.",
      );
    const actorRank = this.highestRoleRank(actor.roles);
    const targetRoleCodes = target.roles.map((mapping) => mapping.role.code);
    const targetRank = this.highestRoleRank(targetRoleCodes);
    if (
      targetRank > actorRank ||
      (targetRank === actorRank &&
        targetRank > 0 &&
        !actor.roles.includes("SUPER_ADMIN"))
    ) {
      throw new ForbiddenException(
        "You cannot reset a password for an account at or above your administrative level.",
      );
    }

    const temporaryPassword =
      input.temporaryPassword?.trim() || this.generateTemporaryPassword();
    this.assertStrongTemporaryPassword(temporaryPassword);
    const passwordHash = await argon2.hash(
      temporaryPassword + this.config.get<string>("PASSWORD_PEPPER", ""),
      { type: argon2.argon2id },
    );
    const requirePasswordChange = input.requirePasswordChange ?? true;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.userCredential.upsert({
        where: { userId: target.id },
        create: {
          userId: target.id,
          passwordHash,
          passwordChangedAt: now,
          failedAttemptCount: 0,
          lockedUntil: null,
        },
        update: {
          passwordHash,
          passwordChangedAt: now,
          failedAttemptCount: 0,
          lockedUntil: null,
        },
      });
      await tx.user.update({
        where: { id: target.id },
        data: {
          mustChangePassword: requirePasswordChange,
          version: { increment: 1 },
        },
      });
      const sessions = await tx.session.findMany({
        where: { userId: target.id },
        select: { id: true },
      });
      await tx.session.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: now, revokeReason: "ADMIN_PASSWORD_RESET" },
      });
      await tx.refreshToken.updateMany({
        where: {
          sessionId: { in: sessions.map((session) => session.id) },
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: "user.password_reset",
          entityType: "User",
          entityId: target.id,
          afterValue: { publicId: target.publicId, requirePasswordChange },
          reason: input.reason,
          requestId,
        },
        tx,
      );
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

  async updateAccess(
    actor: AuthPrincipal,
    publicId: string,
    input: UpdateUserAccessDto,
    requestId: string,
  ) {
    const target = await this.prisma.user.findFirst({
      where: { publicId, collegeId: actor.collegeId, archivedAt: null },
      include: { roles: { include: { role: true } }, scopes: true },
    });
    if (!target) throw new NotFoundException("User not found.");
    if (target.id === actor.id)
      throw new BadRequestException(
        "Use a separate administrator account to change your own access.",
      );

    const roles = await this.prisma.role.findMany({
      where: {
        code: { in: input.roleCodes },
        isActive: true,
        OR: [{ collegeId: actor.collegeId }, { collegeId: null }],
      },
      include: { permissions: { include: { permission: true } } },
    });
    if (roles.length !== new Set(input.roleCodes).size)
      throw new BadRequestException("One or more role codes are invalid.");
    this.assertRoleDelegation(
      actor,
      roles.map((role) => ({
        code: role.code,
        permissions: role.permissions.map((entry) => entry.permission.code),
      })),
    );
    await this.validateScopes(actor.collegeId, input.scopes);
    this.assertScopeCompatibility(input.roleCodes, input.scopes);

    const actorRank = this.highestRoleRank(actor.roles);
    const currentRoleCodes = target.roles.map((mapping) => mapping.role.code);
    if (
      this.highestRoleRank(currentRoleCodes) >= actorRank &&
      !actor.roles.includes("SUPER_ADMIN")
    ) {
      throw new ForbiddenException(
        "You cannot change access for an account at or above your administrative level.",
      );
    }
    if (
      currentRoleCodes.includes("SUPER_ADMIN") &&
      !input.roleCodes.includes("SUPER_ADMIN")
    ) {
      const otherSuperAdmins = await this.prisma.user.count({
        where: {
          id: { not: target.id },
          collegeId: actor.collegeId,
          status: "ACTIVE",
          roles: { some: { role: { code: "SUPER_ADMIN", isActive: true } } },
        },
      });
      if (otherSuperAdmins === 0)
        throw new BadRequestException(
          "The last active Super Admin cannot lose that role.",
        );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: target.id } });
      await tx.userRole.createMany({
        data: roles.map((role) => ({ userId: target.id, roleId: role.id })),
      });
      await tx.userScope.deleteMany({ where: { userId: target.id } });
      await tx.userScope.createMany({
        data: input.scopes.map((scope) => ({
          userId: target.id,
          scopeType: scope.type,
          scopeId: scope.id,
          issueCategoryId: scope.issueCategoryId,
        })),
      });
      await tx.session.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "ACCESS_CHANGED" },
      });
      const sessions = await tx.session.findMany({
        where: { userId: target.id },
        select: { id: true },
      });
      await tx.refreshToken.updateMany({
        where: {
          sessionId: { in: sessions.map((session) => session.id) },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      await tx.user.update({
        where: { id: target.id },
        data: { version: { increment: 1 } },
      });
      await tx.roleAssignmentHistory.create({
        data: {
          userId: target.id,
          changedById: actor.id,
          previousRoles: currentRoleCodes,
          newRoles: input.roleCodes,
          previousScopes: target.scopes.map((scope) => ({
            type: scope.scopeType,
            id: scope.scopeId,
            issueCategoryId: scope.issueCategoryId,
          })),
          newScopes: input.scopes as unknown as Prisma.InputJsonValue,
          reason: input.reason.trim(),
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: "user.access_changed",
          entityType: "User",
          entityId: target.id,
          beforeValue: {
            roles: currentRoleCodes,
            scopes: target.scopes.map((scope) => ({
              type: scope.scopeType,
              id: scope.scopeId,
              issueCategoryId: scope.issueCategoryId,
            })),
          },
          afterValue: { roles: input.roleCodes, scopes: input.scopes },
          reason: input.reason,
          requestId,
        },
        tx,
      );
      return {
        id: target.publicId,
        roles: input.roleCodes,
        scopes: input.scopes,
        sessionsRevoked: true,
      };
    });
    await this.officialGroups.synchronizeCollege(actor.collegeId);
    return result;
  }

  async addRole(
    actor: AuthPrincipal,
    publicId: string,
    input: AssignUserRoleDto,
    requestId: string,
  ) {
    const target = await this.prisma.user.findFirst({
      where: {
        OR: [{ publicId }, { id: publicId }],
        collegeId: actor.collegeId,
        archivedAt: null,
      },
      include: { roles: { include: { role: true } }, scopes: true },
    });
    if (!target) throw new NotFoundException("User not found.");
    if (target.id === actor.id)
      throw new BadRequestException(
        "Use a separate administrator account to change your own access.",
      );
    const code = input.roleCode.trim().toUpperCase();
    const role = await this.prisma.role.findFirst({
      where: {
        code,
        isActive: true,
        OR: [{ collegeId: actor.collegeId }, { collegeId: null }],
      },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new BadRequestException("Role not found or inactive.");
    this.assertRoleDelegation(actor, [
      {
        code: role.code,
        permissions: role.permissions.map((entry) => entry.permission.code),
      },
    ]);
    const validFrom = input.validFrom ? new Date(input.validFrom) : new Date();
    const validUntil = input.validUntil ? new Date(input.validUntil) : null;
    if (
      Number.isNaN(validFrom.getTime()) ||
      (validUntil && Number.isNaN(validUntil.getTime()))
    )
      throw new BadRequestException("Role assignment dates are invalid.");
    if (validUntil && validUntil <= validFrom)
      throw new BadRequestException(
        "Role end date must be after the start date.",
      );
    const previousRoles = target.roles.map((entry) => entry.role.code);
    const result = await this.prisma.$transaction(async (tx) => {
      if (input.isPrimary)
        await tx.userRole.updateMany({
          where: { userId: target.id },
          data: { isPrimary: false },
        });
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: target.id, roleId: role.id } },
        create: {
          userId: target.id,
          roleId: role.id,
          validFrom,
          validUntil,
          isPrimary: input.isPrimary ?? previousRoles.length === 0,
        },
        update: {
          validFrom,
          validUntil,
          ...(input.isPrimary !== undefined
            ? { isPrimary: input.isPrimary }
            : {}),
        },
      });
      const newRoles = [...new Set([...previousRoles, role.code])];
      const scopes = target.scopes.map((scope) => ({
        type: scope.scopeType,
        id: scope.scopeId,
        issueCategoryId: scope.issueCategoryId,
      }));
      await tx.roleAssignmentHistory.create({
        data: {
          userId: target.id,
          changedById: actor.id,
          previousRoles,
          newRoles,
          previousScopes: scopes,
          newScopes: scopes,
          reason: input.reason.trim(),
        },
      });
      await this.revokeAccessSessions(tx, target.id, "ROLE_ADDED");
      await tx.user.update({
        where: { id: target.id },
        data: { version: { increment: 1 } },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: "user.role_added",
          entityType: "User",
          entityId: target.id,
          beforeValue: { roles: previousRoles },
          afterValue: {
            roles: newRoles,
            role: role.code,
            validFrom,
            validUntil,
            isPrimary: input.isPrimary,
          },
          reason: input.reason,
          requestId,
        },
        tx,
      );
      return {
        id: target.publicId,
        role: role.code,
        validFrom,
        validUntil,
        sessionsRevoked: true,
      };
    });
    await this.officialGroups.synchronizeCollege(actor.collegeId);
    return result;
  }

  async removeRole(
    actor: AuthPrincipal,
    publicId: string,
    roleIdentifier: string,
    input: RemoveUserRoleDto,
    requestId: string,
  ) {
    const target = await this.prisma.user.findFirst({
      where: {
        OR: [{ publicId }, { id: publicId }],
        collegeId: actor.collegeId,
        archivedAt: null,
      },
      include: { roles: { include: { role: true } }, scopes: true },
    });
    if (!target) throw new NotFoundException("User not found.");
    if (target.id === actor.id)
      throw new BadRequestException(
        "Use a separate administrator account to change your own access.",
      );
    const assignment = target.roles.find(
      (entry) =>
        entry.roleId === roleIdentifier ||
        entry.role.code === roleIdentifier.trim().toUpperCase(),
    );
    if (!assignment) throw new NotFoundException("Role assignment not found.");
    if (target.roles.length === 1)
      throw new BadRequestException("A user must retain at least one role.");
    const previousRoles = target.roles.map((entry) => entry.role.code);
    const newRoles = previousRoles.filter(
      (code) => code !== assignment.role.code,
    );
    const scopes = target.scopes.map((scope) => ({
      type: scope.scopeType,
      id: scope.scopeId,
      issueCategoryId: scope.issueCategoryId,
    }));
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.userRole.delete({ where: { id: assignment.id } });
      if (assignment.isPrimary) {
        const nextPrimary = await tx.userRole.findFirst({
          where: { userId: target.id },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (nextPrimary)
          await tx.userRole.update({
            where: { id: nextPrimary.id },
            data: { isPrimary: true },
          });
      }
      await tx.roleAssignmentHistory.create({
        data: {
          userId: target.id,
          changedById: actor.id,
          previousRoles,
          newRoles,
          previousScopes: scopes,
          newScopes: scopes,
          reason: input.reason.trim(),
        },
      });
      await this.revokeAccessSessions(tx, target.id, "ROLE_REMOVED");
      await tx.user.update({
        where: { id: target.id },
        data: { version: { increment: 1 } },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: "user.role_removed",
          entityType: "User",
          entityId: target.id,
          beforeValue: { roles: previousRoles },
          afterValue: { roles: newRoles },
          reason: input.reason,
          requestId,
        },
        tx,
      );
      return {
        id: target.publicId,
        removedRole: assignment.role.code,
        roles: newRoles,
        sessionsRevoked: true,
      };
    });
    await this.officialGroups.synchronizeCollege(actor.collegeId);
    return result;
  }

  async roleHistory(actor: AuthPrincipal, publicId: string) {
    const target = await this.prisma.user.findFirst({
      where: {
        OR: [{ publicId }, { id: publicId }],
        collegeId: actor.collegeId,
      },
      select: { id: true, publicId: true, fullName: true },
    });
    if (!target) throw new NotFoundException("User not found.");
    const history = await this.prisma.roleAssignmentHistory.findMany({
      where: { userId: target.id },
      orderBy: { changedAt: "desc" },
      take: 200,
    });
    const actorIds = [...new Set(history.map((entry) => entry.changedById))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds }, collegeId: actor.collegeId },
          select: { id: true, publicId: true, fullName: true },
        })
      : [];
    const actorById = new Map(actors.map((entry) => [entry.id, entry]));
    return {
      user: target,
      history: history.map((entry) => ({
        ...entry,
        changedBy: actorById.get(entry.changedById) ?? null,
      })),
    };
  }

  async createMaintenanceStaff(
    actor: AuthPrincipal,
    input: CreateMaintenanceStaffDto,
    requestId: string,
  ) {
    const allowedRoles = new Set([
      "MAINTENANCE_ADMIN",
      "MAINTENANCE_SUPERVISOR",
      "MAINTENANCE_STAFF",
      "ELECTRICIAN",
      "PLUMBER",
      "IT_SUPPORT",
      "LAB_TECHNICIAN",
      "HOUSEKEEPING",
      "SECURITY",
      "OTHER_RESPONSIBLE",
    ]);
    const roleCode = input.roleCode.trim().toUpperCase();
    if (!allowedRoles.has(roleCode))
      throw new BadRequestException("Select a supported maintenance role.");
    const scopes: UserScopeDto[] = [
      { type: "CAMPUS", id: input.campusId },
      ...(input.blockId ? [{ type: "BLOCK" as const, id: input.blockId }] : []),
      ...(input.floorId ? [{ type: "FLOOR" as const, id: input.floorId }] : []),
      ...(input.roomIds ?? []).map((id) => ({ type: "ROOM" as const, id })),
      ...(input.issueCategoryIds ?? []).map((issueCategoryId) => ({
        type: "ISSUE_CATEGORY" as const,
        issueCategoryId,
      })),
      { type: "ASSIGNED_ISSUES" },
    ];
    return this.create(
      actor,
      {
        collegeIdentityId: input.employeeId,
        fullName: input.fullName,
        email: input.email,
        mobile: input.mobile,
        whatsappNumber: input.whatsappNumber,
        temporaryPassword: input.temporaryPassword,
        accountStatus: input.accountStatus,
        roleCodes: [roleCode],
        scopes,
        staffProfile: {
          employeeId: input.employeeId,
          designation: roleCode.replaceAll("_", " "),
          specialization: input.specialization,
          shift: input.shift,
          emergencyContact: input.emergencyContact,
        },
      },
      requestId,
    );
  }

  maintenanceStaff(actor: AuthPrincipal) {
    const roles = [
      "MAINTENANCE_ADMIN",
      "MAINTENANCE_SUPERVISOR",
      "MAINTENANCE_STAFF",
      "ELECTRICIAN",
      "PLUMBER",
      "IT_SUPPORT",
      "LAB_TECHNICIAN",
      "HOUSEKEEPING",
      "SECURITY",
      "OTHER_RESPONSIBLE",
    ];
    return this.prisma.user.findMany({
      where: {
        collegeId: actor.collegeId,
        archivedAt: null,
        roles: { some: { role: { code: { in: roles } } } },
      },
      select: {
        publicId: true,
        collegeIdentityId: true,
        fullName: true,
        email: true,
        mobile: true,
        whatsappNumber: true,
        status: true,
        mustChangePassword: true,
        roles: { select: { role: { select: { code: true, name: true } } } },
        scopes: {
          select: { scopeType: true, scopeId: true, issueCategoryId: true },
        },
        staffProfile: {
          select: {
            employeeId: true,
            designation: true,
            specialization: true,
            shift: true,
            emergencyContact: true,
          },
        },
      },
      orderBy: { fullName: "asc" },
    });
  }

  private async revokeAccessSessions(
    tx: Prisma.TransactionClient,
    userId: string,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    const sessions = await tx.session.findMany({
      where: { userId },
      select: { id: true },
    });
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokeReason: reason },
    });
    await tx.refreshToken.updateMany({
      where: {
        sessionId: { in: sessions.map((session) => session.id) },
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
  }

  private async attachAssignedPlaces<
    T extends {
      scopes: Array<{ scopeType: ScopeType; scopeId: string | null }>;
    },
  >(users: T[]) {
    const scoped = users
      .flatMap((entry) => entry.scopes)
      .filter(
        (scope) =>
          scope.scopeId &&
          ["CAMPUS", "BLOCK", "FLOOR", "ROOM"].includes(scope.scopeType),
      );
    const ids = (type: ScopeType) => [
      ...new Set(
        scoped
          .filter((scope) => scope.scopeType === type)
          .map((scope) => scope.scopeId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const [campuses, blocks, floors, rooms] = await Promise.all([
      this.prisma.campus.findMany({
        where: { id: { in: ids("CAMPUS") } },
        select: { id: true, name: true, code: true },
      }),
      this.prisma.block.findMany({
        where: { id: { in: ids("BLOCK") } },
        select: {
          id: true,
          name: true,
          code: true,
          campus: { select: { name: true } },
        },
      }),
      this.prisma.floor.findMany({
        where: { id: { in: ids("FLOOR") } },
        select: {
          id: true,
          name: true,
          code: true,
          block: { select: { name: true, campus: { select: { name: true } } } },
        },
      }),
      this.prisma.room.findMany({
        where: { id: { in: ids("ROOM") } },
        select: {
          id: true,
          name: true,
          code: true,
          roomType: true,
          floor: {
            select: {
              name: true,
              block: {
                select: { name: true, campus: { select: { name: true } } },
              },
            },
          },
        },
      }),
    ]);
    const labels = new Map<string, { type: string; label: string }>();
    campuses.forEach((entry) =>
      labels.set(entry.id, { type: "CAMPUS", label: entry.name }),
    );
    blocks.forEach((entry) =>
      labels.set(entry.id, {
        type: "BLOCK",
        label: `${entry.campus.name} / ${entry.name}`,
      }),
    );
    floors.forEach((entry) =>
      labels.set(entry.id, {
        type: "FLOOR",
        label: `${entry.block.campus.name} / ${entry.block.name} / ${entry.name}`,
      }),
    );
    rooms.forEach((entry) =>
      labels.set(entry.id, {
        type: entry.roomType,
        label: `${entry.floor.block.campus.name} / ${entry.floor.block.name} / ${entry.floor.name} / ${entry.name}`,
      }),
    );
    return users.map((entry) => ({
      ...entry,
      assignedPlaces: entry.scopes
        .map((scope) => (scope.scopeId ? labels.get(scope.scopeId) : undefined))
        .filter((place): place is { type: string; label: string } =>
          Boolean(place),
        ),
    }));
  }

  async createRole(
    actor: AuthPrincipal,
    input: CreateRoleDto,
    requestId: string,
  ) {
    const code = input.code.trim().toUpperCase();
    if (
      await this.prisma.role.findFirst({
        where: {
          code,
          OR: [{ collegeId: actor.collegeId }, { collegeId: null }],
        },
      })
    ) {
      throw new ConflictException("A role with this code already exists.");
    }
    const permissions = await this.validDelegatedPermissions(
      actor,
      input.permissionCodes,
    );
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          collegeId: actor.collegeId,
          code,
          name: input.name.trim(),
          description: input.description?.trim(),
          permissions: {
            create: permissions.map((permission) => ({
              permissionId: permission.id,
            })),
          },
        },
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          isSystem: true,
          isActive: true,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: "role.created",
          entityType: "Role",
          entityId: role.id,
          afterValue: {
            code,
            name: role.name,
            permissions: input.permissionCodes,
          },
          requestId,
        },
        tx,
      );
      return role;
    });
  }

  async updateRole(
    actor: AuthPrincipal,
    rawCode: string,
    input: UpdateRoleDto,
    requestId: string,
  ) {
    const code = rawCode.trim().toUpperCase();
    const role = await this.prisma.role.findFirst({
      where: {
        code,
        OR: [{ collegeId: actor.collegeId }, { collegeId: null }],
      },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException("Role not found.");
    if (role.isSystem && !actor.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException(
        "Only a Super Admin can modify a system role.",
      );
    }
    if (
      ["SUPER_ADMIN", "MAIN_ADMIN"].includes(role.code) &&
      !actor.roles.includes("SUPER_ADMIN")
    ) {
      throw new ForbiddenException(
        "Only a Super Admin can modify this administrative role.",
      );
    }
    const permissions = await this.validDelegatedPermissions(
      actor,
      input.permissionCodes,
    );
    const beforePermissions = role.permissions.map(
      (mapping) => mapping.permission.code,
    );
    return this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: role.id,
          permissionId: permission.id,
        })),
      });
      const updated = await tx.role.update({
        where: { id: role.id },
        data: {
          name: input.name.trim(),
          description: input.description?.trim(),
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: "role.updated",
          entityType: "Role",
          entityId: role.id,
          beforeValue: {
            name: role.name,
            description: role.description,
            permissions: beforePermissions,
          },
          afterValue: {
            name: updated.name,
            description: updated.description,
            permissions: input.permissionCodes,
          },
          reason: input.reason,
          requestId,
        },
        tx,
      );
      return {
        code: updated.code,
        name: updated.name,
        description: updated.description,
        permissions: input.permissionCodes,
      };
    });
  }

  roles(user: AuthPrincipal) {
    return this.prisma.role.findMany({
      where: {
        isActive: true,
        OR: [{ collegeId: user.collegeId }, { collegeId: null }],
      },
      select: {
        code: true,
        name: true,
        description: true,
        isSystem: true,
        isActive: true,
        permissions: { select: { permission: { select: { code: true } } } },
      },
      orderBy: { name: "asc" },
    });
  }
  permissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ resource: "asc" }, { action: "asc" }],
    });
  }

  async scopeOptions(user: AuthPrincipal) {
    const [
      campuses,
      departments,
      programmes,
      academicYears,
      semesters,
      sections,
      blocks,
      floors,
      rooms,
      categories,
    ] = await this.prisma.$transaction([
      this.prisma.campus.findMany({
        where: { collegeId: user.collegeId, isActive: true, archivedAt: null },
        select: { id: true, code: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.department.findMany({
        where: { collegeId: user.collegeId, isActive: true, archivedAt: null },
        select: { id: true, code: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.programme.findMany({
        where: {
          collegeId: user.collegeId,
          isActive: true,
          archivedAt: null,
          department: { isActive: true, archivedAt: null },
          degreeTypeMaster: { isActive: true, archivedAt: null },
        },
        select: { id: true, code: true, name: true, departmentId: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.academicYear.findMany({
        where: {
          collegeId: user.collegeId,
          isActive: true,
          archivedAt: null,
        },
        select: { id: true, name: true },
        orderBy: { startsOn: "desc" },
      }),
      this.prisma.semester.findMany({
        where: {
          isActive: true,
          academicYear: {
            collegeId: user.collegeId,
            isActive: true,
            archivedAt: null,
          },
          programme: {
            collegeId: user.collegeId,
            isActive: true,
            archivedAt: null,
            department: { isActive: true, archivedAt: null },
            degreeTypeMaster: { isActive: true, archivedAt: null },
          },
        },
        select: {
          id: true,
          name: true,
          number: true,
          programmeId: true,
          academicYearId: true,
        },
        orderBy: { number: "asc" },
      }),
      this.prisma.section.findMany({
        where: {
          isActive: true,
          archivedAt: null,
          semester: {
            isActive: true,
            academicYear: {
              collegeId: user.collegeId,
              isActive: true,
              archivedAt: null,
            },
            programme: {
              collegeId: user.collegeId,
              isActive: true,
              archivedAt: null,
              department: { isActive: true, archivedAt: null },
              degreeTypeMaster: { isActive: true, archivedAt: null },
            },
          },
        },
        select: {
          id: true,
          code: true,
          name: true,
          semesterId: true,
          studyYear: true,
          capacity: true,
          _count: {
            select: {
              memberships: {
                where: {
                  isActive: true,
                  endsOn: null,
                  status: AcademicMembershipStatus.ACTIVE,
                },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      }),
      this.prisma.block.findMany({
        where: { isActive: true, campus: { collegeId: user.collegeId } },
        select: { id: true, code: true, name: true, campusId: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.floor.findMany({
        where: {
          isActive: true,
          block: { campus: { collegeId: user.collegeId } },
        },
        select: { id: true, code: true, name: true, blockId: true },
        orderBy: [{ level: "asc" }, { name: "asc" }],
      }),
      this.prisma.room.findMany({
        where: {
          isActive: true,
          floor: { block: { campus: { collegeId: user.collegeId } } },
        },
        select: { id: true, code: true, name: true, floorId: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.issueCategory.findMany({
        where: { collegeId: user.collegeId, isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { sortOrder: "asc" },
      }),
    ]);
    return {
      college: [
        { id: user.collegeId, code: "COLLEGE", name: "Entire college" },
      ],
      campuses,
      departments,
      programmes,
      academicYears,
      semesters,
      sections: sections.map((section) => ({
        id: section.id,
        code: section.code,
        name: section.name,
        semesterId: section.semesterId,
        studyYear: section.studyYear,
        capacity: section.capacity,
        currentStudentCount: section._count.memberships,
        availableSeats: Math.max(
          0,
          section.capacity - section._count.memberships,
        ),
      })),
      blocks,
      floors,
      rooms,
      issueCategories: categories,
    };
  }

  private assertRoleDelegation(
    actor: AuthPrincipal,
    roles: Array<{ code: string; permissions: string[] }>,
  ): void {
    const actorRank = this.highestRoleRank(actor.roles);
    if (
      roles.some((role) => {
        const requestedRank = ROLE_RANK[role.code];
        return requestedRank === undefined
          ? !actor.roles.includes("SUPER_ADMIN")
          : requestedRank > actorRank;
      })
    ) {
      throw new ForbiddenException(
        "You cannot assign a role above your administrative level.",
      );
    }
    const actorPermissions = new Set(actor.permissions);
    if (
      roles.some((role) =>
        role.permissions.some(
          (permission) => !actorPermissions.has(permission),
        ),
      )
    ) {
      throw new ForbiddenException(
        "You cannot delegate permissions that you do not hold.",
      );
    }
  }

  private highestRoleRank(roleCodes: string[]): number {
    return roleCodes.reduce(
      (highest, code) => Math.max(highest, ROLE_RANK[code] ?? 0),
      0,
    );
  }

  private assertScopeCompatibility(
    roleCodes: string[],
    scopes: UserScopeDto[],
  ): void {
    if (
      scopes.some((scope) => scope.type === "COLLEGE") &&
      !roleCodes.some((code) => COLLEGE_WIDE_ROLES.has(code))
    ) {
      throw new BadRequestException(
        "College-wide scope is restricted to college-wide administrative roles.",
      );
    }
    if (
      roleCodes.some((code) => ROLES_REQUIRING_COLLEGE_SCOPE.has(code)) &&
      !scopes.some((scope) => scope.type === "COLLEGE")
    ) {
      throw new BadRequestException(
        "This administrative role requires an explicit college scope.",
      );
    }
  }

  private async validDelegatedPermissions(
    actor: AuthPrincipal,
    permissionCodes: string[],
  ) {
    const codes = [...new Set(permissionCodes.map((code) => code.trim()))];
    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: codes } },
    });
    if (permissions.length !== codes.length)
      throw new BadRequestException(
        "One or more permission codes are invalid.",
      );
    const actorPermissions = new Set(actor.permissions);
    if (
      permissions.some((permission) => !actorPermissions.has(permission.code))
    ) {
      throw new ForbiddenException(
        "You cannot delegate permissions that you do not hold.",
      );
    }
    return permissions;
  }

  private primaryProfileRole(roles: string[]): "STUDENT" | "STAFF" {
    if (roles.includes("STUDENT") || roles.includes("CLASS_REPRESENTATIVE"))
      return "STUDENT";
    return "STAFF";
  }

  private async lockedDepartment(
    userId: string,
  ): Promise<{ id: string; code: string; name: string } | null> {
    const scope = await this.prisma.userScope.findFirst({
      where: {
        userId,
        scopeType: ScopeType.DEPARTMENT,
        scopeId: { not: null },
      },
      select: { scopeId: true },
    });
    if (!scope?.scopeId) return null;
    return this.prisma.department.findFirst({
      where: { id: scope.scopeId, isActive: true, archivedAt: null },
      select: { id: true, code: true, name: true },
    });
  }

  private requiredString(value: unknown, label: string): string {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) throw new BadRequestException(`${label} is required.`);
    if (text.length > 180)
      throw new BadRequestException(`${label} is too long.`);
    return text;
  }

  private optionalString(value: unknown): string | undefined {
    const text = typeof value === "string" ? value.trim() : "";
    return text || undefined;
  }

  private requiredInteger(
    value: unknown,
    label: string,
    min: number,
    max: number,
  ): number {
    const parsed = Number(typeof value === "string" ? value.trim() : value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max)
      throw new BadRequestException(
        `${label} must be a whole number from ${min} to ${max}.`,
      );
    return parsed;
  }

  private optionalDate(value: unknown, label = "Date"): Date | undefined {
    const text = this.optionalString(value);
    if (!text) return undefined;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) throw new BadRequestException(`${label} must use YYYY-MM-DD.`);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      throw new BadRequestException(`${label} must be a valid calendar date.`);
    }
    return parsed;
  }

  private dateOnly(value: Date) {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  private latestDate(first: Date, second: Date) {
    return first >= second ? first : second;
  }

  private isPrismaUniqueError(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002",
    );
  }

  private profileDraftPercentage(
    input: Record<string, unknown>,
    role: "STUDENT" | "STAFF",
  ): number {
    const required =
      role === "STUDENT"
        ? [
            "fullName",
            "mobileNumber",
            "collegeId",
            "registerNumber",
            "departmentId",
            "programmeId",
            "academicYearId",
            "studyYear",
            "semesterId",
            "sectionId",
          ]
        : [
            "fullName",
            "mobileNumber",
            "employeeId",
            "designation",
            "qualification",
            "specialization",
            "dateOfJoining",
          ];
    const complete = required.filter((field) => {
      const value = input[field];
      return (
        (typeof value === "string" && Boolean(value.trim())) ||
        (typeof value === "number" && Number.isFinite(value))
      );
    }).length;
    return Math.min(95, Math.round((complete / required.length) * 100));
  }

  private async validateProfiles(
    collegeId: string,
    input: CreateUserDto,
  ): Promise<void> {
    if (input.studentProfile) {
      const profile = input.studentProfile;
      const section = await this.prisma.section.findFirst({
        where: {
          id: profile.sectionId,
          isActive: true,
          archivedAt: null,
          ...(profile.academicOverride
            ? {}
            : { OR: [{ studyYear: profile.studyYear }, { studyYear: null }] }),
          semester: {
            id: profile.semesterId,
            isActive: true,
            programmeId: profile.programmeId,
            academicYearId: profile.academicYearId,
            academicYear: {
              collegeId,
              isActive: true,
              archivedAt: null,
            },
            programme: {
              id: profile.programmeId,
              departmentId: profile.departmentId,
              degreeTypeId: profile.degreeTypeId,
              collegeId,
              isActive: true,
              archivedAt: null,
              degreeTypeMaster: { isActive: true, archivedAt: null },
              department: { isActive: true, archivedAt: null },
            },
          },
        },
        select: {
          id: true,
          studyYear: true,
          semester: { select: { number: true } },
        },
      });
      if (!section)
        throw new BadRequestException(
          "Student department, programme and section do not match.",
        );
      const expectedStudyYear = Math.ceil(section.semester.number / 2);
      if (
        !profile.academicOverride &&
        (section.semester.number < 1 ||
          section.semester.number > 8 ||
          expectedStudyYear !== profile.studyYear ||
          (section.studyYear != null &&
            section.studyYear !== profile.studyYear))
      ) {
        throw new BadRequestException(
          `Study Year ${profile.studyYear} permits only Semesters ${profile.studyYear * 2 - 1} and ${profile.studyYear * 2}.`,
        );
      }
      if (
        profile.admissionYear != null &&
        profile.expectedGraduationYear != null &&
        profile.expectedGraduationYear <= profile.admissionYear
      ) {
        throw new BadRequestException(
          "Expected graduation year must be greater than admission year.",
        );
      }
      const studentId =
        profile.studentId?.trim() || input.collegeIdentityId.trim();
      const duplicate = await this.prisma.studentProfile.findFirst({
        where: {
          collegeId,
          OR: [
            { studentId },
            { registerNumber: profile.registerNumber.trim() },
          ],
        },
        select: { studentId: true, registerNumber: true },
      });
      if (duplicate)
        throw new ConflictException(
          duplicate.registerNumber === profile.registerNumber.trim()
            ? "A student with this register number already exists in the college."
            : "A student with this student ID already exists in the college.",
        );
      const sectionScopes = input.scopes.filter(
        (scope) => scope.type === ScopeType.SECTION,
      );
      if (sectionScopes.some((scope) => scope.id !== profile.sectionId))
        throw new BadRequestException(
          "Student SECTION scope must match the selected section.",
        );
    }
    if (input.staffProfile) {
      if (input.staffProfile.departmentId) {
        const department = await this.prisma.department.findFirst({
          where: {
            id: input.staffProfile.departmentId,
            collegeId,
            isActive: true,
            archivedAt: null,
          },
          select: { id: true },
        });
        if (!department)
          throw new BadRequestException(
            "Staff department is not active in this college.",
          );
      }
      const duplicate = await this.prisma.staffProfile.findFirst({
        where: { collegeId, employeeId: input.staffProfile.employeeId.trim() },
        select: { id: true },
      });
      if (duplicate)
        throw new ConflictException(
          "A staff profile with this employee ID already exists in the college.",
        );
    }
  }

  private assertStrongTemporaryPassword(password: string): void {
    if (password.trim().length < 6) {
      throw new BadRequestException(
        "Temporary password must be at least 6 characters.",
      );
    }
  }

  private generateTemporaryPassword(): string {
    const groups = [
      "ABCDEFGHJKLMNPQRSTUVWXYZ",
      "abcdefghijkmnopqrstuvwxyz",
      "23456789",
      "!@#$%^&*",
    ];
    const all = groups.join("");
    const chars = [
      ...groups.map((group) => this.pick(group)),
      ...Array.from({ length: 10 }, () => this.pick(all)),
    ];
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

  private async validateScopes(
    collegeId: string,
    scopes: UserScopeDto[],
  ): Promise<void> {
    const identities = new Set<string>();
    for (const scope of scopes) {
      const identity = `${scope.type}:${scope.id ?? ""}:${scope.issueCategoryId ?? ""}`;
      if (identities.has(identity))
        throw new BadRequestException(
          "The same access scope cannot be assigned more than once.",
        );
      identities.add(identity);

      if (scope.type === "COLLEGE") {
        if (scope.issueCategoryId || (scope.id && scope.id !== collegeId))
          throw new BadRequestException(
            "College scope does not match the account college.",
          );
        continue;
      }
      if (scope.type === "ASSIGNED_ISSUES") {
        if (scope.id || scope.issueCategoryId)
          throw new BadRequestException(
            "Assigned-issues scope cannot include a target ID.",
          );
        continue;
      }
      if (scope.type === "ISSUE_CATEGORY") {
        if (scope.id || !scope.issueCategoryId)
          throw new BadRequestException(
            "Issue-category scope requires only an issueCategoryId.",
          );
        const category = await this.prisma.issueCategory.findFirst({
          where: { id: scope.issueCategoryId, collegeId, isActive: true },
          select: { id: true },
        });
        if (!category)
          throw new BadRequestException(
            "Issue-category scope is not active in this college.",
          );
        continue;
      }
      if (!scope.id || scope.issueCategoryId)
        throw new BadRequestException(
          `${scope.type} scope requires exactly one target ID.`,
        );

      const found = await this.scopeTargetExists(
        collegeId,
        scope.type,
        scope.id,
      );
      if (!found)
        throw new BadRequestException(
          `${scope.type} scope target is not active in this college.`,
        );
    }
  }

  private async scopeTargetExists(
    collegeId: string,
    scopeType: UserScopeDto["type"],
    scopeId: string,
  ): Promise<boolean> {
    switch (scopeType) {
      case "CAMPUS":
        return Boolean(
          await this.prisma.campus.findFirst({
            where: { id: scopeId, collegeId, isActive: true },
            select: { id: true },
          }),
        );
      case "DEPARTMENT":
        return Boolean(
          await this.prisma.department.findFirst({
            where: { id: scopeId, collegeId, isActive: true, archivedAt: null },
            select: { id: true },
          }),
        );
      case "PROGRAMME":
        return Boolean(
          await this.prisma.programme.findFirst({
            where: {
              id: scopeId,
              collegeId,
              isActive: true,
              department: { isActive: true, archivedAt: null },
            },
            select: { id: true },
          }),
        );
      case "ACADEMIC_YEAR":
        return Boolean(
          await this.prisma.academicYear.findFirst({
            where: { id: scopeId, collegeId, isActive: true },
            select: { id: true },
          }),
        );
      case "SEMESTER":
        return Boolean(
          await this.prisma.semester.findFirst({
            where: {
              id: scopeId,
              isActive: true,
              academicYear: { collegeId, isActive: true },
              programme: {
                collegeId,
                isActive: true,
                department: { isActive: true, archivedAt: null },
              },
            },
            select: { id: true },
          }),
        );
      case "SECTION":
        return Boolean(
          await this.prisma.section.findFirst({
            where: {
              id: scopeId,
              isActive: true,
              archivedAt: null,
              semester: {
                isActive: true,
                academicYear: { collegeId, isActive: true },
                programme: {
                  collegeId,
                  isActive: true,
                  department: { isActive: true, archivedAt: null },
                },
              },
            },
            select: { id: true },
          }),
        );
      case "BLOCK":
        return Boolean(
          await this.prisma.block.findFirst({
            where: { id: scopeId, isActive: true, campus: { collegeId } },
            select: { id: true },
          }),
        );
      case "FLOOR":
        return Boolean(
          await this.prisma.floor.findFirst({
            where: {
              id: scopeId,
              isActive: true,
              block: { campus: { collegeId } },
            },
            select: { id: true },
          }),
        );
      case "ROOM":
        return Boolean(
          await this.prisma.room.findFirst({
            where: {
              id: scopeId,
              isActive: true,
              floor: { block: { campus: { collegeId } } },
            },
            select: { id: true },
          }),
        );
      default:
        return false;
    }
  }

  /* ════════════════════════════════════════════════════════════
     DEPENDENCY REPORT
     ════════════════════════════════════════════════════════════ */

  async dependencyReport(admin: AuthPrincipal, publicId: string) {
    const target = await this.prisma.user.findFirst({
      where: { publicId, collegeId: admin.collegeId },
      select: {
        id: true,
        publicId: true,
        collegeIdentityId: true,
        fullName: true,
        status: true,
        roles: { select: { role: { select: { code: true } } } },
        studentProfile: { select: { id: true } },
        staffProfile: { select: { id: true } },
      },
    });
    if (!target) throw new NotFoundException("User not found in this college.");

    const id = target.id;

    const [
      sessions,
      refreshTokens,
      passwordResetTokens,
      deviceRegistrations,
      studentProfile,
      sectionMemberships,
      attendanceRecords,
      attendanceSummaries,
      attendanceInterventions,
      issuesReported,
      issuesAssigned,
      issueOccurrences,
      issueComments,
      issueAttachments,
      issueAffectedUsers,
      issueStatusHistories,
      messages,
      conversationParticipants,
      feedbackSubmissions,
      notifications,
      announcementReadReceipts,
      fileRecords,
      aiConversations,
      auditLogs,
      broadcastRecipients,
    ] = await Promise.all([
      this.prisma.session.count({ where: { userId: id } }),
      this.prisma.refreshToken.count({ where: { session: { userId: id } } }),
      this.prisma.passwordResetToken.count({ where: { userId: id } }),
      this.prisma.deviceRegistration.count({ where: { userId: id } }),
      this.prisma.studentProfile.count({ where: { userId: id } }),
      this.prisma.sectionMembership.count({ where: { studentUserId: id } }),
      this.prisma.attendanceRecord.count({ where: { studentUserId: id } }),
      this.prisma.attendanceSummary.count({ where: { studentUserId: id } }),
      this.prisma.attendanceIntervention.count({
        where: { studentUserId: id },
      }),
      this.prisma.issue.count({ where: { reporterId: id } }),
      this.prisma.issue.count({ where: { assignedToId: id } }),
      this.prisma.issueOccurrence.count({ where: { reporterUserId: id } }),
      this.prisma.issueComment.count({ where: { authorId: id } }),
      this.prisma.issueAttachment.count({ where: { uploadedById: id } }),
      this.prisma.issueAffectedUser.count({ where: { userId: id } }),
      this.prisma.issueStatusHistory.count({ where: { changedById: id } }),
      this.prisma.message.count({ where: { senderId: id } }),
      this.prisma.conversationParticipant.count({ where: { userId: id } }),
      this.prisma.feedbackSubmission.count({ where: { studentUserId: id } }),
      this.prisma.notificationRecipient.count({ where: { userId: id } }),
      this.prisma.announcementReadReceipt.count({ where: { userId: id } }),
      this.prisma.fileRecord.count({ where: { uploadedById: id } }),
      this.prisma.aiConversation.count({ where: { userId: id } }),
      this.prisma.auditLog.count({ where: { actorId: id } }),
      this.prisma.broadcastRecipient.count({ where: { userId: id } }),
    ]);

    const blockingDependencies = [
      ...(attendanceRecords > 0
        ? [
            {
              type: "ATTENDANCE_RECORDS",
              count: attendanceRecords,
              reason: "Academic attendance history must be preserved",
            },
          ]
        : []),
      ...(attendanceSummaries > 0
        ? [
            {
              type: "ATTENDANCE_SUMMARIES",
              count: attendanceSummaries,
              reason: "Attendance aggregate data must be preserved",
            },
          ]
        : []),
      ...(attendanceInterventions > 0
        ? [
            {
              type: "ATTENDANCE_INTERVENTIONS",
              count: attendanceInterventions,
              reason: "Attendance intervention history must be preserved",
            },
          ]
        : []),
      ...(issuesReported > 0
        ? [
            {
              type: "ISSUES_REPORTED",
              count: issuesReported,
              reason: "Issue reports are shared records that must be preserved",
            },
          ]
        : []),
      ...(issueComments > 0
        ? [
            {
              type: "ISSUE_COMMENTS",
              count: issueComments,
              reason: "Issue comment history must be preserved",
            },
          ]
        : []),
      ...(issueStatusHistories > 0
        ? [
            {
              type: "ISSUE_STATUS_HISTORIES",
              count: issueStatusHistories,
              reason: "Issue audit trail must be preserved",
            },
          ]
        : []),
      ...(messages > 0
        ? [
            {
              type: "MESSAGES_SENT",
              count: messages,
              reason: "Shared conversation messages must be preserved",
            },
          ]
        : []),
      ...(feedbackSubmissions > 0
        ? [
            {
              type: "FEEDBACK_SUBMISSIONS",
              count: feedbackSubmissions,
              reason: "Feedback aggregate data must be preserved",
            },
          ]
        : []),
      ...(auditLogs > 0
        ? [
            {
              type: "AUDIT_LOGS",
              count: auditLogs,
              reason: "Audit trail must be preserved",
            },
          ]
        : []),
    ];

    const deletableData = [
      ...(sessions > 0 ? [{ type: "ACTIVE_SESSIONS", count: sessions }] : []),
      ...(refreshTokens > 0
        ? [{ type: "REFRESH_TOKENS", count: refreshTokens }]
        : []),
      ...(passwordResetTokens > 0
        ? [{ type: "PASSWORD_RESET_TOKENS", count: passwordResetTokens }]
        : []),
      ...(deviceRegistrations > 0
        ? [{ type: "DEVICE_REGISTRATIONS", count: deviceRegistrations }]
        : []),
      ...(notifications > 0
        ? [{ type: "NOTIFICATION_RECEIPTS", count: notifications }]
        : []),
      ...(announcementReadReceipts > 0
        ? [{ type: "ANNOUNCEMENT_RECEIPTS", count: announcementReadReceipts }]
        : []),
      ...(conversationParticipants > 0
        ? [
            {
              type: "CONVERSATION_MEMBERSHIPS",
              count: conversationParticipants,
            },
          ]
        : []),
      ...(issueAffectedUsers > 0
        ? [{ type: "ISSUE_AFFECTED_USERS", count: issueAffectedUsers }]
        : []),
      ...(broadcastRecipients > 0
        ? [{ type: "BROADCAST_RECEIPTS", count: broadcastRecipients }]
        : []),
      ...(aiConversations > 0
        ? [{ type: "AI_CONVERSATIONS", count: aiConversations }]
        : []),
    ];

    const anonymisableData = [
      ...(studentProfile > 0
        ? [{ type: "STUDENT_PROFILE", count: studentProfile }]
        : []),
      ...(sectionMemberships > 0
        ? [{ type: "SECTION_MEMBERSHIPS", count: sectionMemberships }]
        : []),
      ...(issueOccurrences > 0
        ? [{ type: "ISSUE_OCCURRENCES", count: issueOccurrences }]
        : []),
      ...(issueAttachments > 0
        ? [{ type: "ISSUE_ATTACHMENTS", count: issueAttachments }]
        : []),
      ...(issuesAssigned > 0
        ? [{ type: "ISSUES_ASSIGNED", count: issuesAssigned }]
        : []),
      ...(fileRecords > 0
        ? [{ type: "FILE_RECORDS", count: fileRecords }]
        : []),
    ];

    const totalRecords =
      blockingDependencies.reduce((s, d) => s + d.count, 0) +
      deletableData.reduce((s, d) => s + d.count, 0) +
      anonymisableData.reduce((s, d) => s + d.count, 0);

    return {
      userId: target.publicId,
      userName: target.fullName,
      collegeIdentityId: target.collegeIdentityId,
      canPermanentlyDelete:
        target.status === "ARCHIVED" &&
        Boolean(target.studentProfile) &&
        !target.staffProfile &&
        target.roles.every((mapping) =>
          ["STUDENT", "CLASS_REPRESENTATIVE"].includes(mapping.role.code),
        ),
      totalRecords,
      blockingDependencies,
      deletableData,
      anonymisableData,
    };
  }

  /* ════════════════════════════════════════════════════════════
     PERMANENT DELETION
     ════════════════════════════════════════════════════════════ */

  async deletePermanently(
    admin: AuthPrincipal,
    publicId: string,
    input: DeleteUserDto,
    requestId: string,
  ) {
    if (
      !admin.permissions.includes("users.delete_permanent") ||
      !admin.roles.some((role) => ["SUPER_ADMIN", "MAIN_ADMIN"].includes(role))
    ) {
      throw new ForbiddenException(
        "Only Main Admin with permanent-delete permission can perform this action.",
      );
    }

    // 1. Find target – MUST be in the same college
    const target = await this.prisma.user.findFirst({
      where: { publicId, collegeId: admin.collegeId },
      select: {
        id: true,
        publicId: true,
        collegeIdentityId: true,
        fullName: true,
        email: true,
        status: true,
        archivedAt: true,
        collegeId: true,
        roles: { select: { role: { select: { code: true } } } },
        studentProfile: { select: { id: true } },
        staffProfile: { select: { id: true } },
      },
    });
    if (!target) throw new NotFoundException("User not found in this college.");
    if (target.id === admin.id) {
      throw new BadRequestException(
        "You cannot permanently delete your own account.",
      );
    }

    // 2. Must be ARCHIVED
    if (target.status !== "ARCHIVED") {
      throw new BadRequestException(
        "Student must be archived before permanent deletion. Archive the account first.",
      );
    }
    if (!target.archivedAt) {
      throw new BadRequestException(
        "The archived student is missing its archive timestamp. Archive the account again before permanent deletion.",
      );
    }
    const targetRoleCodes = target.roles.map((mapping) => mapping.role.code);
    if (
      !target.studentProfile ||
      target.staffProfile ||
      targetRoleCodes.some(
        (code) => !["STUDENT", "CLASS_REPRESENTATIVE"].includes(code),
      )
    ) {
      throw new BadRequestException(
        "Permanent deletion is limited to archived student accounts. Staff accounts must be retained and archived.",
      );
    }
    if (target.collegeIdentityId.startsWith("DELETED-")) {
      throw new BadRequestException(
        "This student account has already been permanently deleted.",
      );
    }

    // 3. Verify confirmation phrase
    const expectedStudentPhrase = `DELETE STUDENT ${target.collegeIdentityId}`;
    const expectedUserPhrase = `DELETE USER ${target.publicId}`;
    const altPhrase = "PERMANENTLY DELETE USER";
    if (
      ![expectedStudentPhrase, expectedUserPhrase, altPhrase].includes(
        input.confirmationPhrase,
      )
    ) {
      throw new BadRequestException(
        `Incorrect confirmation phrase. Expected: "${expectedStudentPhrase}"`,
      );
    }

    // 4. Verify backup reference
    if (!input.backupReference) {
      throw new BadRequestException(
        "A backup reference is required for permanent deletion.",
      );
    }
    const verifiedBackup = await this.prisma.databaseBackup.findFirst({
      where: {
        id: input.backupReference,
        collegeId: admin.collegeId,
        backupType: "PRE_DELETION",
        status: "RESTORE_TESTED",
        completedAt: { gte: target.archivedAt },
        deletedAt: null,
      },
      select: {
        id: true,
        restoreTests: {
          orderBy: [
            { completedAt: "desc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
          take: 1,
          select: { status: true },
        },
      },
    });
    if (
      !verifiedBackup ||
      verifiedBackup.restoreTests[0]?.status !== "PASSED"
    ) {
      throw new BadRequestException(
        "Select a restore-tested pre-deletion backup created after this student was archived.",
      );
    }

    const anonymousRef = `Deleted User ${target.publicId.slice(0, 8).toUpperCase()}`;
    const anonymousIdentityId = `DELETED-${target.publicId.toUpperCase()}`;
    const anonymousStudentId = `DELETED-STUDENT-${target.publicId.toUpperCase()}`;
    const userId = target.id;

    // 5. Execute in a single transaction
    await this.prisma.$transaction(
      async (tx) => {
        // Lock the user row to prevent concurrent deletion
        await tx.$executeRawUnsafe(
          `SELECT id FROM users WHERE id = $1 FOR UPDATE`,
          userId,
        );

        const lockedTarget = await tx.user.findFirst({
          where: { id: userId, collegeId: admin.collegeId },
          select: {
            status: true,
            archivedAt: true,
            collegeIdentityId: true,
            roles: { select: { role: { select: { code: true } } } },
            studentProfile: { select: { id: true } },
            staffProfile: { select: { id: true } },
          },
        });
        if (!lockedTarget)
          throw new NotFoundException("User not found in this college.");
        if (lockedTarget.status !== AccountStatus.ARCHIVED) {
          throw new BadRequestException(
            "Student must remain archived during permanent deletion. Archive the account and try again.",
          );
        }
        if (!lockedTarget.archivedAt) {
          throw new BadRequestException(
            "The student must retain a valid archive timestamp during permanent deletion.",
          );
        }
        if (lockedTarget.collegeIdentityId.startsWith("DELETED-")) {
          throw new BadRequestException(
            "This student account has already been permanently deleted.",
          );
        }
        const lockedRoleCodes = lockedTarget.roles.map(
          (mapping) => mapping.role.code,
        );
        if (
          !lockedTarget.studentProfile ||
          lockedTarget.staffProfile ||
          lockedRoleCodes.some(
            (code) => !["STUDENT", "CLASS_REPRESENTATIVE"].includes(code),
          )
        ) {
          throw new BadRequestException(
            "Permanent deletion is limited to archived student accounts. Staff accounts must be retained and archived.",
          );
        }
        if (lockedTarget.collegeIdentityId !== target.collegeIdentityId) {
          throw new BadRequestException(
            "The student identity changed during deletion. Review the account and confirm again.",
          );
        }

        // ── Delete ephemeral data ──
        const lockedBackup = await tx.databaseBackup.findFirst({
          where: {
            id: input.backupReference,
            collegeId: admin.collegeId,
            backupType: "PRE_DELETION",
            status: "RESTORE_TESTED",
            completedAt: { gte: lockedTarget.archivedAt },
            deletedAt: null,
          },
          select: {
            id: true,
            restoreTests: {
              orderBy: [
                { completedAt: "desc" },
                { createdAt: "desc" },
                { id: "desc" },
              ],
              take: 1,
              select: { status: true },
            },
          },
        });
        if (
          !lockedBackup ||
          lockedBackup.restoreTests[0]?.status !== "PASSED"
        ) {
          throw new BadRequestException(
            "The restore-tested pre-deletion backup is no longer eligible.",
          );
        }

        const sessionsRemoved = await tx.session.deleteMany({
          where: { userId },
        });
        await tx.passwordResetToken.deleteMany({ where: { userId } });
        await tx.deviceRegistration.deleteMany({ where: { userId } });
        await tx.userPresence.deleteMany({ where: { userId } });
        const loginAttemptsUnlinked = await tx.loginAttempt.updateMany({
          where: { userId },
          data: { userId: null },
        });

        // Remove every authentication and authorization path. The archived user row
        // remains only as a non-identifying historical foreign-key target.
        const credentialsRemoved = await tx.userCredential.deleteMany({
          where: { userId },
        });
        const rolesRemoved = await tx.userRole.deleteMany({
          where: { userId },
        });
        const scopesRemoved = await tx.userScope.deleteMany({
          where: { userId },
        });
        const representativeAssignmentsDeactivated =
          await tx.classRepresentativeAssignment.updateMany({
            where: { representativeId: userId, isActive: true },
            data: {
              isActive: false,
              validUntil: this.dateOnly(new Date()),
            },
          });

        // ── Delete notification/announcement receipts ──
        await tx.notificationRecipient.deleteMany({ where: { userId } });
        await tx.announcementReadReceipt.deleteMany({ where: { userId } });

        // ── Delete conversation memberships (preserves conversations + messages) ──
        await tx.conversationParticipant.deleteMany({ where: { userId } });

        // ── Delete issue affected-user entries ──
        await tx.issueAffectedUser.deleteMany({ where: { userId } });

        // ── Delete AI data ──
        await tx.aiConversation.deleteMany({ where: { userId } });

        // ── Anonymise student profile (preserve structure, remove personal fields) ──
        const studentProfile = await tx.studentProfile.findFirst({
          where: { userId },
          select: { id: true },
        });
        if (studentProfile) {
          await tx.studentProfile.update({
            where: { id: studentProfile.id },
            data: {
              studentId: anonymousStudentId,
              registerNumber: null,
              legacyId: null,
              rollNumber: null,
              admissionNumber: null,
              dateOfBirth: null,
              gender: null,
              parentName: null,
              parentMobileNumber: null,
              personalEmail: null,
              bloodGroup: null,
              address: null,
              city: null,
              district: null,
              state: null,
              pinCode: null,
              emergencyContact: null,
            },
          });
        }

        // ── Deactivate section memberships (preserve historical) ──
        const membershipsDeactivated = await tx.sectionMembership.updateMany({
          where: { studentUserId: userId, isActive: true },
          data: {
            isActive: false,
            endsOn: this.dateOnly(new Date()),
            status: "ARCHIVED",
            changedById: admin.id,
            reason: "User permanently deleted after restore-tested backup",
          },
        });

        // ── Anonymise User record ──
        await tx.user.update({
          where: { id: userId },
          data: {
            collegeIdentityId: anonymousIdentityId,
            fullName: anonymousRef,
            email: null,
            normalizedEmail: null,
            mobile: null,
            whatsappNumber: null,
            profilePhotoKey: null,
            mustChangePassword: false,
            firstLoginCompletedAt: null,
            profileRejectionReason: null,
            lastLoginAt: null,
            version: { increment: 1 },
          },
        });

        // ── Audit log ──
        await this.audit.record(
          {
            collegeId: admin.collegeId,
            actorId: admin.id,
            action: "USER_PERMANENTLY_DELETED",
            entityType: "User",
            entityId: target.publicId,
            beforeValue: {
              status: target.status,
              hadOfficialEmail: Boolean(target.email),
            },
            afterValue: {
              anonymousReference: anonymousRef,
              authenticationRemoved: true,
              authorizationRemoved: true,
              removedRecords: {
                sessions: sessionsRemoved.count,
                credentials: credentialsRemoved.count,
                roles: rolesRemoved.count,
                scopes: scopesRemoved.count,
                loginAttemptsUnlinked: loginAttemptsUnlinked.count,
                membershipsDeactivated: membershipsDeactivated.count,
                representativeAssignmentsDeactivated:
                  representativeAssignmentsDeactivated.count,
              },
              backupReference: input.backupReference,
            },
            reason: input.reason,
            requestId,
          },
          tx,
        );
      },
      { timeout: 30_000 },
    );

    return {
      success: true,
      message: `Student data has been permanently deleted and anonymised. Reference: ${anonymousRef}`,
      anonymousReference: anonymousRef,
    };
  }
}
