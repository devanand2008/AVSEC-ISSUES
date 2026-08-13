import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { AuthPrincipal } from "../src/common/http/request-context";
import { PrismaService } from "../src/database/prisma.service";
import { Prisma } from "../src/generated/prisma/client";
import {
  AcademicMembershipStatus,
  AccountStatus,
} from "../src/generated/prisma/enums";
import { AuditService } from "../src/modules/audit/audit.service";
import type { StudentPromotionDto } from "../src/modules/academic/dto/student-promotion.dto";
import { SectionPlacementService } from "../src/modules/academic/section-placement.service";
import { StudentPromotionService } from "../src/modules/academic/student-promotion.service";

const ids = {
  college: "00000000-0000-4000-8000-000000000001",
  actor: "00000000-0000-4000-8000-000000000002",
  source: "00000000-0000-4000-8000-000000000003",
  target: "00000000-0000-4000-8000-000000000004",
  sourceSemester: "00000000-0000-4000-8000-000000000005",
  targetSemester: "00000000-0000-4000-8000-000000000006",
  sourceYear: "00000000-0000-4000-8000-000000000007",
  targetYear: "00000000-0000-4000-8000-000000000008",
  programme: "00000000-0000-4000-8000-000000000009",
  department: "00000000-0000-4000-8000-000000000010",
  studentOne: "00000000-0000-4000-8000-000000000011",
  studentTwo: "00000000-0000-4000-8000-000000000012",
  userOne: "00000000-0000-4000-8000-000000000013",
  userTwo: "00000000-0000-4000-8000-000000000014",
};

const actor: AuthPrincipal = {
  id: ids.actor,
  publicId: "00000000-0000-4000-8000-000000000015",
  collegeId: ids.college,
  fullName: "Main Admin",
  email: "admin@college.edu",
  status: AccountStatus.ACTIVE,
  mustChangePassword: false,
  sessionId: "00000000-0000-4000-8000-000000000016",
  roles: ["MAIN_ADMIN"],
  permissions: ["academic.manage"],
  scopes: [{ type: "COLLEGE", id: ids.college, issueCategoryId: null }],
};

function section(
  kind: "source" | "target",
  overrides: Record<string, unknown> = {},
) {
  const source = kind === "source";
  return {
    id: source ? ids.source : ids.target,
    code: source ? "A" : "B",
    name: source ? "Section A" : "Section B",
    capacity: 70,
    studyYear: source ? 2 : 3,
    semesterId: source ? ids.sourceSemester : ids.targetSemester,
    semester: {
      number: source ? 4 : 5,
      academicYearId: source ? ids.sourceYear : ids.targetYear,
      academicYear: {
        startsOn: new Date(source ? "2025-06-01" : "2026-06-01"),
        endsOn: new Date(source ? "2026-05-31" : "2027-05-31"),
      },
      programmeId: ids.programme,
      programme: {
        id: ids.programme,
        collegeId: ids.college,
        departmentId: ids.department,
        totalSemesters: 8,
      },
    },
    ...overrides,
  };
}

function dataClient(
  sourceSection = section("source"),
  targetSection = section("target"),
) {
  return {
    section: {
      findFirst: jest.fn(async (query: { where?: { id?: string } }) =>
        query.where?.id === ids.source
          ? sourceSection
          : query.where?.id === ids.target
            ? targetSection
            : null,
      ),
    },
    studentProfile: {
      findMany: jest.fn().mockResolvedValue([
        { userId: ids.userOne, user: { publicId: ids.studentOne } },
        { userId: ids.userTwo, user: { publicId: ids.studentTwo } },
      ]),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    sectionMembership: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { studentUserId: ids.userOne },
          { studentUserId: ids.userTwo },
        ]),
      count: jest.fn().mockResolvedValue(60),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    userScope: {
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    user: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    classRepresentativeAssignment: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    userRole: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    session: {
      findMany: jest.fn().mockResolvedValue([
        { id: "session-1" },
        { id: "session-2" },
      ]),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
}

function promotionInput(
  overrides: Partial<StudentPromotionDto> = {},
): StudentPromotionDto {
  return {
    sourceSectionId: ids.source,
    targetSectionId: ids.target,
    targetAcademicYearId: ids.targetYear,
    targetStudyYear: 3,
    targetSemesterId: ids.targetSemester,
    studentPublicIds: [ids.studentOne, ids.studentTwo],
    ...overrides,
  };
}

function harness(
  sourceSection = section("source"),
  targetSection = section("target"),
) {
  const root = dataClient(sourceSection, targetSection);
  const tx = dataClient(sourceSection, targetSection);
  const prisma = {
    ...root,
    $transaction: jest.fn(
      async (
        work: (client: typeof tx) => Promise<unknown>,
        _options: unknown,
      ) => work(tx),
    ),
  };
  const capacity = new SectionPlacementService({} as PrismaService);
  const placements = {
    lockDepartment: jest.fn().mockResolvedValue(undefined),
    lockSection: jest.fn().mockResolvedValue(undefined),
    assertCapacity: jest.fn(
      (
        target: { id: string; code: string; name: string; capacity: number },
        count: number,
        additional: number,
      ) => capacity.assertCapacity(target, count, additional),
    ),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const officialGroups = {
    synchronizeCollege: jest.fn().mockResolvedValue({ synchronized: 1 }),
  };
  const service = new StudentPromotionService(
    prisma as unknown as PrismaService,
    placements as unknown as SectionPlacementService,
    audit as unknown as AuditService,
    officialGroups as never,
  );
  return { service, prisma, root, tx, placements, audit, officialGroups };
}

describe("StudentPromotionService", () => {
  it("previews only the exact selected active memberships and counts membership capacity", async () => {
    const { service, prisma, root, placements } = harness();

    await expect(service.preview(actor, promotionInput())).resolves.toEqual(
      expect.objectContaining({
        mode: "PROMOTION",
        selectedCount: 2,
        selectedStudentPublicIds: [ids.studentOne, ids.studentTwo],
        sourceStudyYear: 2,
        targetStudyYear: 3,
        targetCurrentStudents: 60,
        targetAvailableAfterMove: 8,
      }),
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(root.sectionMembership.findMany).toHaveBeenCalledWith({
      where: {
        sectionId: ids.source,
        studentUserId: { in: [ids.userOne, ids.userTwo] },
        isActive: true,
        endsOn: null,
        status: AcademicMembershipStatus.ACTIVE,
      },
      select: { studentUserId: true },
    });
    expect(root.sectionMembership.count).toHaveBeenCalledWith({
      where: {
        sectionId: ids.target,
        isActive: true,
        endsOn: null,
        status: AcademicMembershipStatus.ACTIVE,
        studentUserId: { notIn: [ids.userOne, ids.userTwo] },
      },
    });
    expect(
      JSON.stringify(root.sectionMembership.count.mock.calls[0]?.[0]),
    ).toContain(AcademicMembershipStatus.ACTIVE);
    expect(placements.assertCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ id: ids.target }),
      60,
      2,
    );
  });

  it("rejects a selection without an active source membership", async () => {
    const { service, root } = harness();
    root.sectionMembership.findMany.mockResolvedValue([
      { studentUserId: ids.userOne },
    ]);

    await expect(service.preview(actor, promotionInput())).rejects.toThrow(
      "Every selected student must have an active membership",
    );
    expect(root.sectionMembership.count).not.toHaveBeenCalled();
  });

  it("filters every selection to active accounts and active academic profiles", async () => {
    const { service, root } = harness();

    await service.preview(actor, promotionInput());

    expect(root.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          academicStatus: "ACTIVE",
          user: expect.objectContaining({
            status: AccountStatus.ACTIVE,
            archivedAt: null,
          }),
        }),
      }),
    );
  });

  it("rejects non-sequential study-year and semester placement without override", async () => {
    const { service, root } = harness();

    await expect(
      service.preview(actor, promotionInput({ targetStudyYear: 2 })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(root.studentProfile.findMany).not.toHaveBeenCalled();
  });

  it("rejects a cross-programme target without an authorised override", async () => {
    const otherProgramme = "00000000-0000-4000-8000-000000000017";
    const { service } = harness(
      section("source"),
      section("target", {
        semester: {
          number: 5,
          academicYearId: ids.targetYear,
          academicYear: {
            startsOn: new Date("2026-06-01"),
            endsOn: new Date("2027-05-31"),
          },
          programmeId: otherProgramme,
          programme: {
            id: otherProgramme,
            collegeId: ids.college,
            departmentId: ids.department,
            totalSemesters: 8,
          },
        },
      }),
    );

    await expect(service.preview(actor, promotionInput())).rejects.toThrow(
      "another programme",
    );
  });

  it("requires the override permission and an audited reason", async () => {
    const { service } = harness();
    const overrideInput = promotionInput({
      targetStudyYear: 2,
      academicOverride: true,
      academicOverrideReason: "Approved curriculum exception",
    });

    await expect(service.preview(actor, overrideInput)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.preview(
        {
          ...actor,
          permissions: ["academic.manage", "academic.override_placement"],
        },
        { ...overrideInput, academicOverrideReason: "short" },
      ),
    ).rejects.toThrow("at least 10 characters");
  });

  it("permits an exceptional progression only for an authorised override", async () => {
    const { service } = harness();
    const overrideActor = {
      ...actor,
      permissions: ["academic.manage", "academic.override_placement"],
    };

    await expect(
      service.preview(
        overrideActor,
        promotionInput({
          targetStudyYear: 2,
          academicOverride: true,
          academicOverrideReason: "Approved curriculum exception",
        }),
      ),
    ).resolves.toEqual(
      expect.objectContaining({ overrideApplied: true, targetStudyYear: 2 }),
    );
  });

  it("rejects a batch that would exceed 70 active academic memberships", async () => {
    const { service, root } = harness();
    root.sectionMembership.count.mockResolvedValue(69);

    await expect(
      service.preview(actor, promotionInput()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "SECTION_FULL" }),
    });
  });

  it("confirms a promotion atomically with immutable target snapshots and scopes", async () => {
    const { service, prisma, tx, placements, audit } = harness();

    await expect(
      service.confirm(actor, promotionInput(), "request-id"),
    ).resolves.toEqual(
      expect.objectContaining({
        confirmed: true,
        affectedStudents: 2,
        mode: "PROMOTION",
      }),
    );

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(placements.lockDepartment).toHaveBeenCalledWith(tx, ids.department);
    expect(placements.lockSection).toHaveBeenCalledTimes(2);
    expect(placements.lockSection).toHaveBeenNthCalledWith(1, tx, ids.source);
    expect(placements.lockSection).toHaveBeenNthCalledWith(2, tx, ids.target);
    expect(tx.sectionMembership.updateMany).toHaveBeenCalledWith({
      where: {
        sectionId: ids.source,
        studentUserId: { in: [ids.userOne, ids.userTwo] },
        isActive: true,
        endsOn: null,
      },
      data: expect.objectContaining({
        isActive: false,
        status: "PROMOTED",
        changedById: ids.actor,
        endsOn: expect.any(Date),
      }),
    });
    expect(tx.sectionMembership.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          studentUserId: ids.userOne,
          sectionId: ids.target,
          academicYearId: ids.targetYear,
          departmentId: ids.department,
          programmeId: ids.programme,
          semesterId: ids.targetSemester,
          studyYear: 3,
          status: "ACTIVE",
          changedById: ids.actor,
          isActive: true,
        }),
      ]),
    });
    expect(tx.studentProfile.updateMany).toHaveBeenCalledWith({
      where: {
        userId: { in: [ids.userOne, ids.userTwo] },
        sectionId: ids.source,
      },
      data: {
        departmentId: ids.department,
        programmeId: ids.programme,
        sectionId: ids.target,
        studyYear: 3,
        academicStatus: "ACTIVE",
      },
    });
    expect(tx.userScope.createMany).toHaveBeenCalledWith({
      data: [
        { userId: ids.userOne, scopeType: "SECTION", scopeId: ids.target },
        { userId: ids.userTwo, scopeType: "SECTION", scopeId: ids.target },
      ],
    });
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "student_promotion.batch_confirmed",
        requestId: "request-id",
      }),
      tx,
    );
  });

  it("completes fourth-year students without deleting history and maps only GRADUATED to account status", async () => {
    const fourthYear = section("source", {
      studyYear: 4,
      semester: {
        number: 8,
        academicYearId: ids.sourceYear,
        academicYear: {
          startsOn: new Date("2025-06-01"),
          endsOn: new Date("2026-05-31"),
        },
        programmeId: ids.programme,
        programme: {
          id: ids.programme,
          collegeId: ids.college,
          departmentId: ids.department,
          totalSemesters: 8,
        },
      },
    });
    const { service, tx, audit } = harness(fourthYear);
    const input = promotionInput({
      targetSectionId: undefined,
      targetAcademicYearId: undefined,
      targetStudyYear: undefined,
      targetSemesterId: undefined,
      completionStatus: "GRADUATED",
    });

    await expect(service.confirm(actor, input, "request-id")).resolves.toEqual(
      expect.objectContaining({
        mode: "COMPLETION",
        completionStatus: "GRADUATED",
        affectedStudents: 2,
      }),
    );

    expect(tx.sectionMembership.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          isActive: false,
        }),
      }),
    );
    expect(tx.sectionMembership.createMany).not.toHaveBeenCalled();
    expect(tx.studentProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { academicStatus: "GRADUATED" },
      }),
    );
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [ids.userOne, ids.userTwo] },
        collegeId: ids.college,
      },
      data: { status: AccountStatus.GRADUATED },
    });
    expect(tx.userScope.createMany).not.toHaveBeenCalled();
    expect(tx.classRepresentativeAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        representativeId: { in: [ids.userOne, ids.userTwo] },
        sectionId: ids.source,
        isActive: true,
      },
      data: { isActive: false, validUntil: expect.any(Date) },
    });
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: {
        userId: { in: [ids.userOne, ids.userTwo] },
        revokedAt: null,
      },
      data: {
        revokedAt: expect.any(Date),
        revokeReason: "ACADEMIC_COMPLETION",
      },
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "student_completion.batch_confirmed",
      }),
      tx,
    );
  });

  it("rejects normal completion before Semester 8", async () => {
    const semesterSeven = section("source", {
      studyYear: 4,
      semester: {
        number: 7,
        academicYearId: ids.sourceYear,
        academicYear: {
          startsOn: new Date("2025-06-01"),
          endsOn: new Date("2026-05-31"),
        },
        programmeId: ids.programme,
        programme: {
          id: ids.programme,
          collegeId: ids.college,
          departmentId: ids.department,
          totalSemesters: 8,
        },
      },
    });
    const { service } = harness(semesterSeven);

    await expect(
      service.preview(
        actor,
        promotionInput({
          targetSectionId: undefined,
          targetAcademicYearId: undefined,
          targetStudyYear: undefined,
          targetSemesterId: undefined,
          completionStatus: "COMPLETED",
        }),
      ),
    ).rejects.toThrow("Semester 8");
  });

  it("rejects a target Academic Year that does not follow the source year", async () => {
    const sameYearTarget = section("target", {
      semester: {
        number: 5,
        academicYearId: ids.targetYear,
        academicYear: {
          startsOn: new Date("2025-06-01"),
          endsOn: new Date("2026-05-31"),
        },
        programmeId: ids.programme,
        programme: {
          id: ids.programme,
          collegeId: ids.college,
          departmentId: ids.department,
          totalSemesters: 8,
        },
      },
    });
    const { service } = harness(section("source"), sameYearTarget);

    await expect(service.preview(actor, promotionInput())).rejects.toThrow(
      "must start after",
    );
  });

  it("maps transferred students to DISABLED and revokes their sessions", async () => {
    const fourthYear = section("source", {
      studyYear: 4,
      semester: {
        number: 8,
        academicYearId: ids.sourceYear,
        academicYear: {
          startsOn: new Date("2025-06-01"),
          endsOn: new Date("2026-05-31"),
        },
        programmeId: ids.programme,
        programme: {
          id: ids.programme,
          collegeId: ids.college,
          departmentId: ids.department,
          totalSemesters: 8,
        },
      },
    });
    const { service, tx } = harness(fourthYear);

    await service.confirm(
      actor,
      promotionInput({
        targetSectionId: undefined,
        targetAcademicYearId: undefined,
        targetStudyYear: undefined,
        targetSemesterId: undefined,
        completionStatus: "TRANSFERRED",
      }),
      "request-id",
    );

    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: AccountStatus.DISABLED } }),
    );
    expect(tx.session.updateMany).toHaveBeenCalled();
  });

  it("keeps the login account status unchanged for an ALUMNI academic status", async () => {
    const fourthYear = section("source", {
      studyYear: 4,
      semester: {
        number: 8,
        academicYearId: ids.sourceYear,
        academicYear: {
          startsOn: new Date("2025-06-01"),
          endsOn: new Date("2026-05-31"),
        },
        programmeId: ids.programme,
        programme: {
          id: ids.programme,
          collegeId: ids.college,
          departmentId: ids.department,
          totalSemesters: 8,
        },
      },
    });
    const { service, tx } = harness(fourthYear);

    await service.confirm(
      actor,
      promotionInput({
        targetSectionId: undefined,
        targetAcademicYearId: undefined,
        targetStudyYear: undefined,
        targetSemesterId: undefined,
        completionStatus: "ALUMNI",
      }),
      "request-id",
    );

    expect(tx.studentProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { academicStatus: "ALUMNI" } }),
    );
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [ids.userOne, ids.userTwo] },
        collegeId: ids.college,
      },
      data: { status: AccountStatus.GRADUATED },
    });
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: {
        userId: { in: [ids.userOne, ids.userTwo] },
        revokedAt: null,
      },
      data: {
        revokedAt: expect.any(Date),
        revokeReason: "ACADEMIC_COMPLETION",
      },
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalled();
  });

  it("rolls back graduation when every selected account is not updated", async () => {
    const fourthYear = section("source", {
      studyYear: 4,
      semester: {
        number: 8,
        academicYearId: ids.sourceYear,
        academicYear: {
          startsOn: new Date("2025-06-01"),
          endsOn: new Date("2026-05-31"),
        },
        programmeId: ids.programme,
        programme: {
          id: ids.programme,
          collegeId: ids.college,
          departmentId: ids.department,
          totalSemesters: 8,
        },
      },
    });
    const { service, tx } = harness(fourthYear);
    tx.user.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.confirm(
        actor,
        promotionInput({
          targetSectionId: undefined,
          targetAcademicYearId: undefined,
          targetStudyYear: undefined,
          targetSemesterId: undefined,
          completionStatus: "GRADUATED",
        }),
        "request-id",
      ),
    ).rejects.toThrow("student accounts changed");
  });
});
