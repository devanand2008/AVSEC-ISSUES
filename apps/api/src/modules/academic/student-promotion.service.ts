import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { Prisma } from "../../generated/prisma/client";
import {
  AcademicMembershipStatus,
  AccountStatus,
  ScopeType,
  StudentAcademicStatus,
} from "../../generated/prisma/enums";
import { AuditService } from "../audit/audit.service";
import { OfficialGroupsService } from "../conversations/official-groups.service";
import type {
  StudentCompletionStatus,
  StudentPromotionDto,
} from "./dto/student-promotion.dto";
import { SectionPlacementService } from "./section-placement.service";

type PromotionMode = "PROMOTION" | "COMPLETION";

interface PromotionSection {
  id: string;
  code: string;
  name: string;
  capacity: number;
  studyYear: number | null;
  semesterId: string;
  semester: {
    number: number;
    academicYearId: string;
    academicYear: { startsOn: Date; endsOn: Date };
    programmeId: string;
    programme: {
      id: string;
      collegeId: string;
      departmentId: string;
      totalSemesters: number;
    };
  };
}

interface SelectedStudent {
  userId: string;
  publicId: string;
}

interface PromotionPlan {
  mode: PromotionMode;
  source: PromotionSection;
  target: PromotionSection | null;
  students: SelectedStudent[];
  targetStudyYear: number | null;
  completionStatus: StudentCompletionStatus | null;
  targetCurrentStudents: number;
  targetAvailableAfterMove: number | null;
  overrideApplied: boolean;
  overrideReason: string | null;
}

type DataClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class StudentPromotionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly placements: SectionPlacementService,
    private readonly audit: AuditService,
    private readonly officialGroups: OfficialGroupsService,
  ) {}

  async preview(user: AuthPrincipal, input: StudentPromotionDto) {
    const plan = await this.buildPlan(this.prisma, user, input);
    return this.publicPlan(plan);
  }

  async confirm(
    user: AuthPrincipal,
    input: StudentPromotionDto,
    requestId: string,
  ) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.lockSections(tx, user, input);
        const plan = await this.buildPlan(tx, user, input);
        const requestedOn = this.dateOnly(new Date());
        const effectiveOn =
          plan.mode === "PROMOTION"
            ? this.effectivePromotionDate(requestedOn, plan.target!)
            : requestedOn;
        const userIds = plan.students.map(({ userId }) => userId);
        const historyReason =
          plan.overrideReason ??
          (plan.mode === "PROMOTION"
            ? "Student promotion"
            : `Student marked ${plan.completionStatus}`);

        const memberships = this.membershipDelegate(tx);
        const profiles = this.profileDelegate(tx);
        const scopes = this.scopeDelegate(tx);

        const closed = await memberships.updateMany({
          where: {
            sectionId: plan.source.id,
            studentUserId: { in: userIds },
            isActive: true,
            endsOn: null,
          },
          data: {
            isActive: false,
            endsOn: effectiveOn,
            status:
              plan.mode === "PROMOTION"
                ? AcademicMembershipStatus.PROMOTED
                : AcademicMembershipStatus.COMPLETED,
            changedById: user.id,
            reason: historyReason,
          },
        });
        if (closed.count !== userIds.length) {
          throw new ConflictException(
            "One or more selected students changed placement. Refresh the preview and try again.",
          );
        }

        if (plan.mode === "PROMOTION") {
          const target = plan.target!;
          await memberships.createMany({
            data: userIds.map((studentUserId) => ({
              studentUserId,
              sectionId: target.id,
              academicYearId: target.semester.academicYearId,
              departmentId: target.semester.programme.departmentId,
              programmeId: target.semester.programme.id,
              semesterId: target.semesterId,
              studyYear: plan.targetStudyYear!,
              status: AcademicMembershipStatus.ACTIVE,
              changedById: user.id,
              reason: historyReason,
              startsOn: effectiveOn,
              endsOn: null,
              isActive: true,
            })),
          });
          const updatedProfiles = await profiles.updateMany({
            where: { userId: { in: userIds }, sectionId: plan.source.id },
            data: {
              departmentId: target.semester.programme.departmentId,
              programmeId: target.semester.programme.id,
              sectionId: target.id,
              studyYear: plan.targetStudyYear,
              academicStatus: StudentAcademicStatus.ACTIVE,
            },
          });
          if (updatedProfiles.count !== userIds.length) {
            throw new ConflictException(
              "One or more selected student profiles changed. Refresh the preview and try again.",
            );
          }
          await scopes.deleteMany({
            where: { userId: { in: userIds }, scopeType: ScopeType.SECTION },
          });
          await scopes.createMany({
            data: userIds.map((userId) => ({
              userId,
              scopeType: ScopeType.SECTION,
              scopeId: target.id,
            })),
          });
          await this.closeClassRepresentativeAuthority(
            tx,
            userIds,
            plan.source.id,
            effectiveOn,
          );
        } else {
          const updatedProfiles = await profiles.updateMany({
            where: { userId: { in: userIds }, sectionId: plan.source.id },
            data: { academicStatus: plan.completionStatus },
          });
          if (updatedProfiles.count !== userIds.length) {
            throw new ConflictException(
              "One or more selected student profiles changed. Refresh the preview and try again.",
            );
          }
          await scopes.deleteMany({
            where: { userId: { in: userIds }, scopeType: ScopeType.SECTION },
          });
          await this.closeClassRepresentativeAuthority(
            tx,
            userIds,
            plan.source.id,
            effectiveOn,
          );
          const terminalAccountStatus = [
            "DISCONTINUED",
            "TRANSFERRED",
          ].includes(plan.completionStatus!)
            ? AccountStatus.DISABLED
            : AccountStatus.GRADUATED;
          const updatedAccounts = await this.userDelegate(tx).updateMany({
              where: { id: { in: userIds }, collegeId: user.collegeId },
              data: { status: terminalAccountStatus },
          });
          if (updatedAccounts.count !== userIds.length) {
            throw new ConflictException(
              "One or more selected student accounts changed. Refresh the preview and try again.",
            );
          }
          await this.revokeTerminalSessions(tx, userIds, effectiveOn);
        }

        await this.audit.record(
          {
            actorId: user.id,
            action:
              plan.mode === "PROMOTION"
                ? "student_promotion.batch_confirmed"
                : "student_completion.batch_confirmed",
            entityType: "Section",
            entityId: plan.source.id,
            afterValue: {
              selectedCount: userIds.length,
              sourceSectionId: plan.source.id,
              targetSectionId: plan.target?.id ?? null,
              targetAcademicYearId:
                plan.target?.semester.academicYearId ?? null,
              targetStudyYear: plan.targetStudyYear,
              completionStatus: plan.completionStatus,
              overrideApplied: plan.overrideApplied,
            },
            reason: historyReason,
            requestId,
            collegeId: user.collegeId,
          },
          tx,
        );

        return {
          ...this.publicPlan(plan),
          confirmed: true,
          affectedStudents: userIds.length,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.officialGroups.synchronizeCollege(user.collegeId);
    return result;
  }

  private async lockSections(
    tx: Prisma.TransactionClient,
    user: AuthPrincipal,
    input: StudentPromotionDto,
  ) {
    const sectionIds = [input.sourceSectionId, input.targetSectionId]
      .filter((id): id is string => Boolean(id))
      .sort();
    const located = await Promise.all(
      sectionIds.map((id) => this.locateSection(tx, user.collegeId, id)),
    );
    const departmentIds = [
      ...new Set(located.map((section) => section.departmentId)),
    ].sort();
    for (const departmentId of departmentIds) {
      await this.placements.lockDepartment(tx, departmentId);
    }
    for (const sectionId of sectionIds) {
      await this.placements.lockSection(tx, sectionId);
    }
  }

  private async locateSection(
    client: DataClient,
    collegeId: string,
    sectionId: string,
  ): Promise<{ departmentId: string }> {
    const section = (await this.sectionDelegate(client).findFirst({
      where: { id: sectionId, semester: { programme: { collegeId } } },
      select: {
        semester: {
          select: { programme: { select: { departmentId: true } } },
        },
      },
    })) as { semester: { programme: { departmentId: string } } } | null;
    if (!section) {
      throw new NotFoundException(
        "A selected source or target section was not found in this college.",
      );
    }
    return { departmentId: section.semester.programme.departmentId };
  }

  private async buildPlan(
    client: DataClient,
    user: AuthPrincipal,
    input: StudentPromotionDto,
  ): Promise<PromotionPlan> {
    const ids = [...new Set(input.studentPublicIds)];
    if (ids.length < 1 || ids.length > 500) {
      throw new BadRequestException("Select between 1 and 500 students.");
    }
    if (ids.length !== input.studentPublicIds.length) {
      throw new BadRequestException("Student selection contains duplicates.");
    }

    const mode: PromotionMode = input.completionStatus
      ? "COMPLETION"
      : "PROMOTION";
    this.assertInputShape(mode, input);
    const override = this.override(user, input);

    const [source, target] = await Promise.all([
      this.activeSection(client, user.collegeId, input.sourceSectionId),
      mode === "PROMOTION"
        ? this.activeSection(client, user.collegeId, input.targetSectionId!)
        : Promise.resolve(null),
    ]);
    if (target?.id === source.id) {
      throw new BadRequestException(
        "Source and target sections must be different.",
      );
    }

    const sourceStudyYear = this.sectionStudyYear(source);
    const violations: string[] = [];
    let targetStudyYear: number | null = null;
    if (mode === "PROMOTION") {
      targetStudyYear = input.targetStudyYear!;
      if (input.targetAcademicYearId !== target!.semester.academicYearId) {
        throw new BadRequestException(
          "Target academic year does not match the target section.",
        );
      }
      if (input.targetSemesterId !== target!.semesterId) {
        throw new BadRequestException(
          "Target semester does not match the target section.",
        );
      }
      if (
        target!.semester.number < 1 ||
        target!.semester.number > target!.semester.programme.totalSemesters
      ) {
        throw new BadRequestException(
          "Target semester is outside the configured programme duration.",
        );
      }
      if (target!.semester.programmeId !== source.semester.programmeId) {
        violations.push("The target section belongs to another programme.");
      }
      if (
        target!.semester.academicYear.startsOn <=
        source.semester.academicYear.startsOn
      ) {
        violations.push(
          "The target Academic Year must start after the source Academic Year.",
        );
      }
      if (targetStudyYear !== sourceStudyYear + 1) {
        violations.push(
          `Normal promotion must move Study Year ${sourceStudyYear} to Study Year ${sourceStudyYear + 1}.`,
        );
      }
      const allowedSemesters = this.semestersForStudyYear(targetStudyYear);
      if (!allowedSemesters.includes(target!.semester.number)) {
        violations.push(
          `Study Year ${targetStudyYear} must use Semester ${allowedSemesters.join(" or ")}.`,
        );
      }
      if (target!.studyYear != null && target!.studyYear !== targetStudyYear) {
        violations.push(
          "Target study year does not match the target section configuration.",
        );
      }
    } else {
      if (sourceStudyYear !== 4) {
        violations.push(
          "Normal completion is available only for fourth-year students.",
        );
      }
      if (source.semester.number !== 8) {
        violations.push(
          "Normal completion is available only after Semester 8.",
        );
      }
    }
    if (violations.length && !override.applied) {
      throw new BadRequestException({
        code: "ACADEMIC_PROGRESSION_INVALID",
        message: violations[0],
        details: { violations },
      });
    }

    const students = await this.selectedStudents(
      client,
      user.collegeId,
      source.id,
      ids,
    );
    let targetCurrentStudents = 0;
    let targetAvailableAfterMove: number | null = null;
    if (target) {
      targetCurrentStudents = await this.membershipDelegate(client).count({
        where: {
          sectionId: target.id,
          isActive: true,
          endsOn: null,
          status: AcademicMembershipStatus.ACTIVE,
          studentUserId: {
            notIn: students.map(({ userId }) => userId),
          },
        },
      });
      const capacity = this.placements.assertCapacity(
        target,
        targetCurrentStudents,
        students.length,
      );
      targetAvailableAfterMove = capacity.availableSeats - students.length;
    }

    return {
      mode,
      source,
      target,
      students,
      targetStudyYear,
      completionStatus: input.completionStatus ?? null,
      targetCurrentStudents,
      targetAvailableAfterMove,
      overrideApplied: override.applied,
      overrideReason: override.reason,
    };
  }

  private assertInputShape(mode: PromotionMode, input: StudentPromotionDto) {
    const targetFields = [
      input.targetSectionId,
      input.targetAcademicYearId,
      input.targetStudyYear,
      input.targetSemesterId,
    ];
    if (mode === "PROMOTION" && targetFields.some((value) => value == null)) {
      throw new BadRequestException(
        "Target section, academic year, study year and semester are required for promotion.",
      );
    }
    if (mode === "COMPLETION" && targetFields.some((value) => value != null)) {
      throw new BadRequestException(
        "A completion action must not include a target academic placement.",
      );
    }
  }

  private override(user: AuthPrincipal, input: StudentPromotionDto) {
    const applied = input.academicOverride === true;
    const reason = input.academicOverrideReason?.trim() || null;
    if (!applied && reason) {
      throw new BadRequestException(
        "Enable Advanced Academic Override before supplying an override reason.",
      );
    }
    if (applied && !user.permissions.includes("academic.override_placement")) {
      throw new ForbiddenException(
        "You do not have permission to override academic progression.",
      );
    }
    if (applied && (!reason || reason.length < 10)) {
      throw new BadRequestException(
        "An academic override reason of at least 10 characters is required.",
      );
    }
    return { applied, reason };
  }

  private async activeSection(
    client: DataClient,
    collegeId: string,
    sectionId: string,
  ): Promise<PromotionSection> {
    const section = (await this.sectionDelegate(client).findFirst({
      where: {
        id: sectionId,
        isActive: true,
        archivedAt: null,
        semester: {
          isActive: true,
          academicYear: {
            collegeId,
            isActive: true,
            archivedAt: null,
          },
          programme: {
            collegeId,
            isActive: true,
            archivedAt: null,
            degreeTypeMaster: { isActive: true, archivedAt: null },
            department: {
              collegeId,
              isActive: true,
              archivedAt: null,
            },
          },
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
        capacity: true,
        studyYear: true,
        semesterId: true,
        semester: {
          select: {
            number: true,
            academicYearId: true,
            academicYear: { select: { startsOn: true, endsOn: true } },
            programmeId: true,
            programme: {
              select: {
                id: true,
                collegeId: true,
                departmentId: true,
                totalSemesters: true,
              },
            },
          },
        },
      },
    })) as PromotionSection | null;
    if (!section) {
      throw new NotFoundException(
        "The selected section and its academic parents must be active and unarchived.",
      );
    }
    return section;
  }

  private async selectedStudents(
    client: DataClient,
    collegeId: string,
    sourceSectionId: string,
    publicIds: string[],
  ): Promise<SelectedStudent[]> {
    const profiles = (await this.profileDelegate(client).findMany({
      where: {
        collegeId,
        sectionId: sourceSectionId,
        academicStatus: StudentAcademicStatus.ACTIVE,
        user: {
          publicId: { in: publicIds },
          collegeId,
          status: AccountStatus.ACTIVE,
          archivedAt: null,
          roles: { some: { role: { code: "STUDENT" } } },
        },
      },
      select: {
        userId: true,
        user: { select: { publicId: true } },
      },
    })) as Array<{ userId: string; user: { publicId: string } }>;
    const profileByPublicId = new Map(
      profiles.map((profile) => [profile.user.publicId, profile]),
    );
    if (publicIds.some((id) => !profileByPublicId.has(id))) {
      throw new BadRequestException(
        "Every selected student must belong to the source section and college.",
      );
    }
    const ordered = publicIds.map((publicId) => ({
      userId: profileByPublicId.get(publicId)!.userId,
      publicId,
    }));
    const memberships = (await this.membershipDelegate(client).findMany({
      where: {
        sectionId: sourceSectionId,
        studentUserId: { in: ordered.map(({ userId }) => userId) },
        isActive: true,
        endsOn: null,
        status: AcademicMembershipStatus.ACTIVE,
      },
      select: { studentUserId: true },
    })) as Array<{ studentUserId: string }>;
    const activeUserIds = new Set(
      memberships.map(({ studentUserId }) => studentUserId),
    );
    if (ordered.some(({ userId }) => !activeUserIds.has(userId))) {
      throw new BadRequestException(
        "Every selected student must have an active membership in the source section.",
      );
    }
    return ordered;
  }

  private sectionStudyYear(section: PromotionSection) {
    if (section.semester.number > section.semester.programme.totalSemesters) {
      throw new BadRequestException(
        "The source semester is outside the configured programme duration.",
      );
    }
    const derived = Math.ceil(section.semester.number / 2);
    if (derived < 1 || derived > 4) {
      throw new BadRequestException(
        "The source semester is outside the four-year Engineering curriculum.",
      );
    }
    if (section.studyYear != null && section.studyYear !== derived) {
      throw new BadRequestException(
        "The source section study year does not match its semester.",
      );
    }
    return section.studyYear ?? derived;
  }

  private semestersForStudyYear(studyYear: number) {
    if (!Number.isInteger(studyYear) || studyYear < 1 || studyYear > 4) {
      throw new BadRequestException(
        "Engineering Study Year must be between 1 and 4.",
      );
    }
    return [studyYear * 2 - 1, studyYear * 2];
  }

  private publicPlan(plan: PromotionPlan) {
    return {
      mode: plan.mode,
      selectedCount: plan.students.length,
      selectedStudentPublicIds: plan.students.map(({ publicId }) => publicId),
      sourceSectionId: plan.source.id,
      sourceStudyYear: this.sectionStudyYear(plan.source),
      targetSectionId: plan.target?.id ?? null,
      targetAcademicYearId: plan.target?.semester.academicYearId ?? null,
      targetStudyYear: plan.targetStudyYear,
      targetSemesterId: plan.target?.semesterId ?? null,
      completionStatus: plan.completionStatus,
      targetCurrentStudents: plan.targetCurrentStudents,
      targetCapacity: plan.target?.capacity ?? null,
      targetAvailableAfterMove: plan.targetAvailableAfterMove,
      overrideApplied: plan.overrideApplied,
    };
  }

  private sectionDelegate(client: DataClient) {
    return client.section as unknown as {
      findFirst(input: unknown): Promise<unknown>;
    };
  }

  private profileDelegate(client: DataClient) {
    return client.studentProfile as unknown as {
      findMany(input: unknown): Promise<unknown>;
      updateMany(input: unknown): Promise<{ count: number }>;
    };
  }

  private membershipDelegate(client: DataClient) {
    return client.sectionMembership as unknown as {
      findMany(input: unknown): Promise<unknown>;
      count(input: unknown): Promise<number>;
      updateMany(input: unknown): Promise<{ count: number }>;
      createMany(input: unknown): Promise<{ count: number }>;
    };
  }

  private scopeDelegate(client: DataClient) {
    return client.userScope as unknown as {
      deleteMany(input: unknown): Promise<{ count: number }>;
      createMany(input: unknown): Promise<{ count: number }>;
    };
  }

  private userDelegate(client: DataClient) {
    return client.user as unknown as {
      updateMany(input: unknown): Promise<{ count: number }>;
    };
  }

  private async closeClassRepresentativeAuthority(
    tx: Prisma.TransactionClient,
    userIds: string[],
    sourceSectionId: string,
    effectiveOn: Date,
  ) {
    await tx.classRepresentativeAssignment.updateMany({
      where: {
        representativeId: { in: userIds },
        sectionId: sourceSectionId,
        isActive: true,
      },
      data: { isActive: false, validUntil: effectiveOn },
    });
    await tx.userRole.updateMany({
      where: {
        userId: { in: userIds },
        validFrom: { lte: effectiveOn },
        OR: [{ validUntil: null }, { validUntil: { gt: effectiveOn } }],
        role: { code: "CLASS_REPRESENTATIVE" },
      },
      data: { validUntil: effectiveOn },
    });
  }

  private async revokeTerminalSessions(
    tx: Prisma.TransactionClient,
    userIds: string[],
    revokedAt: Date,
  ) {
    const sessions = await tx.session.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    });
    await tx.session.updateMany({
      where: { userId: { in: userIds }, revokedAt: null },
      data: {
        revokedAt,
        revokeReason: "ACADEMIC_COMPLETION",
      },
    });
    if (sessions.length) {
      await tx.refreshToken.updateMany({
        where: {
          sessionId: { in: sessions.map((session) => session.id) },
          revokedAt: null,
        },
        data: { revokedAt },
      });
    }
  }

  private dateOnly(value: Date) {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  private effectivePromotionDate(today: Date, target: PromotionSection) {
    const startsOn = this.dateOnly(target.semester.academicYear.startsOn);
    const endsOn = this.dateOnly(target.semester.academicYear.endsOn);
    const effectiveOn = today < startsOn ? startsOn : today;
    if (effectiveOn > endsOn) {
      throw new BadRequestException(
        "The target Academic Year has already ended. Select an active future placement.",
      );
    }
    return effectiveOn;
  }
}
