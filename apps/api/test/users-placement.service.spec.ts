import { ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AccountStatus } from "../src/generated/prisma/enums";
import type { AuthPrincipal } from "../src/common/http/request-context";
import { PrismaService } from "../src/database/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { SectionPlacementService } from "../src/modules/academic/section-placement.service";
import { OfficialGroupsService } from "../src/modules/conversations/official-groups.service";
import { UsersService } from "../src/modules/users/users.service";

const actor: AuthPrincipal = {
  id: "admin-id",
  publicId: "admin-public-id",
  collegeId: "college-id",
  fullName: "Main Admin",
  email: "admin@college.edu",
  status: AccountStatus.ACTIVE,
  mustChangePassword: false,
  sessionId: "session-id",
  roles: ["MAIN_ADMIN"],
  permissions: ["users.manage"],
  scopes: [{ type: "COLLEGE", id: "college-id", issueCategoryId: null }],
};

function harness() {
  const tx = {
    user: {
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue({
        publicId: "student-public-id",
        status: AccountStatus.ACTIVE,
      }),
    },
    session: {
      updateMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    refreshToken: { updateMany: jest.fn() },
    classRepresentativeAssignment: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    userRole: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    sectionMembership: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userScope: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
  };
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        collegeIdentityId: "AVS001",
        onboardingStudyYear: 2,
      }),
    },
    studentProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    userScope: { findFirst: jest.fn().mockResolvedValue(null) },
    department: { findFirst: jest.fn() },
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const officialGroups = {
    synchronizeCollege: jest.fn().mockResolvedValue(undefined),
  };
  const placements = {
    placeStudent: jest.fn().mockResolvedValue({}),
    lockSection: jest.fn().mockResolvedValue(undefined),
  };
  const service = new UsersService(
    prisma as unknown as PrismaService,
    { get: jest.fn() } as unknown as ConfigService,
    audit as unknown as AuditService,
    officialGroups as unknown as OfficialGroupsService,
    placements as unknown as SectionPlacementService,
  );
  return { service, prisma, tx, audit, placements };
}

describe("UsersService student placement integration", () => {
  it("locks an existing student profile's complete academic placement", async () => {
    const { service, prisma } = harness();
    const student = {
      ...actor,
      id: "student-id",
      roles: ["STUDENT"],
      fullName: "Student One",
    };
    prisma.studentProfile.findFirst.mockResolvedValue({
      department: {
        id: "department-id",
        code: "CSE",
        name: "Computer Science and Engineering",
      },
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      fullName: "Student One",
      collegeIdentityId: "AVS001",
      onboardingStudyYear: null,
      studentProfile: {
        registerNumber: "999999990001",
        programmeId: "programme-id",
        sectionId: "section-id",
        studyYear: 2,
        section: {
          semesterId: "semester-id",
          semester: { academicYearId: "academic-year-id" },
        },
      },
    });

    const requirements = await service.profileRequirements(student);

    expect(requirements.lockedFields).toEqual(
      expect.arrayContaining([
        "departmentId",
        "studyYear",
        "programmeId",
        "academicYearId",
        "semesterId",
        "sectionId",
      ]),
    );
    expect(requirements.lockedValues).toMatchObject({
      department: {
        id: "department-id",
        code: "CSE",
        name: "Computer Science and Engineering",
      },
      programmeId: "programme-id",
      academicYearId: "academic-year-id",
      semesterId: "semester-id",
      sectionId: "section-id",
      studyYear: 2,
    });
    expect(prisma.studentProfile.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "student-id",
        department: { isActive: true, archivedAt: null },
      },
      select: {
        department: { select: { id: true, code: true, name: true } },
      },
    });
  });

  it("returns semester ownership data with the current profile", async () => {
    const { service, prisma } = harness();
    const student = {
      ...actor,
      id: "student-id",
      roles: ["STUDENT"],
      fullName: "Student One",
    };
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: "student-id",
      studentProfile: {
        section: {
          id: "section-id",
          semester: {
            id: "semester-id",
            academicYearId: "academic-year-id",
          },
        },
      },
    });

    await service.myProfile(student);

    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          studentProfile: {
            include: expect.objectContaining({
              section: {
                include: expect.objectContaining({ semester: true }),
              },
            }),
          },
        }),
      }),
    );
  });

  it("checks and repairs canonical placement before activating a student", async () => {
    const { service, prisma, tx, placements } = harness();
    prisma.user.findFirst.mockResolvedValue({
      id: "student-id",
      publicId: "student-public-id",
      collegeId: actor.collegeId,
      collegeIdentityId: "AVS001",
      status: AccountStatus.PENDING,
      studentProfile: { sectionId: "section-id" },
      roles: [{ role: { code: "STUDENT" } }],
    });
    tx.user.findFirst
      .mockResolvedValueOnce({
        roles: [
          {
            role: {
              code: "MAIN_ADMIN",
              permissions: [{ permission: { code: "users.suspend" } }],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        status: AccountStatus.PENDING,
        collegeIdentityId: "AVS001",
        roles: [{ role: { code: "STUDENT" } }],
        studentProfile: { sectionId: "section-id" },
      });

    await service.status(
      actor,
      "student-public-id",
      { status: AccountStatus.ACTIVE, reason: "Approved" },
      "request-id",
    );

    expect(placements.placeStudent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        collegeId: actor.collegeId,
        userId: "student-id",
        sectionId: "section-id",
        accountStatus: AccountStatus.ACTIVE,
      }),
    );
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      "SELECT id FROM users WHERE id IN ($1::uuid, $2::uuid) ORDER BY id FOR UPDATE",
      actor.id,
      "student-id",
    );
  });

  it("rejects reactivation when the row becomes a permanent-deletion tombstone while waiting for its lock", async () => {
    const { service, prisma, tx, placements } = harness();
    prisma.user.findFirst.mockResolvedValue({
      id: "student-id",
      publicId: "student-public-id",
      collegeId: actor.collegeId,
      collegeIdentityId: "AVS001",
      status: AccountStatus.ARCHIVED,
      studentProfile: { sectionId: "section-id" },
      roles: [{ role: { code: "STUDENT" } }],
    });
    tx.user.findFirst
      .mockResolvedValueOnce({
        roles: [
          {
            role: {
              code: "MAIN_ADMIN",
              permissions: [{ permission: { code: "users.suspend" } }],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        status: AccountStatus.ARCHIVED,
        collegeIdentityId: "DELETED-STUDENT-PUBLIC-ID",
        roles: [{ role: { code: "STUDENT" } }],
        studentProfile: { sectionId: "section-id" },
      });

    await expect(
      service.status(
        actor,
        "student-public-id",
        {
          status: AccountStatus.ACTIVE,
          reason: "Restore",
        },
        "request-id",
      ),
    ).rejects.toThrow("Permanently deleted accounts cannot be reactivated");

    expect(tx.$queryRawUnsafe).toHaveBeenCalled();
    expect(placements.placeStudent).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("deactivates class-representative authority and revokes sessions when archiving", async () => {
    const { service, prisma, tx, placements } = harness();
    prisma.user.findFirst.mockResolvedValue({
      id: "student-id",
      publicId: "student-public-id",
      collegeId: actor.collegeId,
      collegeIdentityId: "AVS001",
      status: AccountStatus.ACTIVE,
      studentProfile: { sectionId: "section-id" },
      roles: [{ role: { code: "CLASS_REPRESENTATIVE" } }],
    });
    tx.user.findFirst
      .mockResolvedValueOnce({
        roles: [
          {
            role: {
              code: "MAIN_ADMIN",
              permissions: [{ permission: { code: "users.suspend" } }],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        status: AccountStatus.ACTIVE,
        collegeIdentityId: "AVS001",
        roles: [{ role: { code: "CLASS_REPRESENTATIVE" } }],
        studentProfile: { sectionId: "section-id" },
        sectionMemberships: [],
      });

    await service.status(
      actor,
      "student-public-id",
      {
        status: AccountStatus.ARCHIVED,
        reason: "Student left college",
      },
      "request-id",
    );

    expect(tx.classRepresentativeAssignment.updateMany).toHaveBeenCalledWith({
      where: { representativeId: "student-id", isActive: true },
      data: { isActive: false, validUntil: expect.any(Date) },
    });
    expect(tx.userRole.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "student-id",
        validFrom: { lte: expect.any(Date) },
        OR: [{ validUntil: null }, { validUntil: { gt: expect.any(Date) } }],
        role: { code: "CLASS_REPRESENTATIVE" },
      },
      data: { validUntil: expect.any(Date) },
    });
    expect(tx.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "student-id", revokedAt: null },
      }),
    );
    expect(placements.lockSection).toHaveBeenCalledWith(tx, "section-id");
    expect(tx.sectionMembership.updateMany).toHaveBeenCalledWith({
      where: {
        studentUserId: "student-id",
        isActive: true,
        status: "ACTIVE",
      },
      data: expect.objectContaining({
        isActive: false,
        status: "ARCHIVED",
        changedById: actor.id,
        reason: "Student left college",
      }),
    });
    expect(tx.userScope.deleteMany).toHaveBeenCalledWith({
      where: { userId: "student-id", scopeType: "SECTION" },
    });
  });

  it("does not close a future-dated active membership before it starts", async () => {
    const { service, prisma, tx } = harness();
    const futureStartsOn = new Date("2027-06-01T00:00:00.000Z");
    prisma.user.findFirst.mockResolvedValue({
      id: "student-id",
      publicId: "student-public-id",
      collegeId: actor.collegeId,
      collegeIdentityId: "AVS001",
      status: AccountStatus.ACTIVE,
      studentProfile: { sectionId: "section-id" },
      roles: [{ role: { code: "STUDENT" } }],
    });
    tx.user.findFirst
      .mockResolvedValueOnce({
        roles: [
          {
            role: {
              code: "MAIN_ADMIN",
              permissions: [{ permission: { code: "users.suspend" } }],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        status: AccountStatus.ACTIVE,
        collegeIdentityId: "AVS001",
        roles: [{ role: { code: "STUDENT" } }],
        studentProfile: { sectionId: "section-id" },
        sectionMemberships: [{ startsOn: futureStartsOn }],
      });

    await service.status(
      actor,
      "student-public-id",
      {
        status: AccountStatus.ARCHIVED,
        reason: "Student left college",
      },
      "request-id",
    );

    expect(tx.sectionMembership.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ endsOn: futureStartsOn }),
      }),
    );
  });

  it("prevents a student from changing an existing academic placement", async () => {
    const { service, prisma, placements } = harness();
    prisma.studentProfile.findUnique.mockResolvedValue({
      departmentId: "department-id",
      programmeId: "programme-id",
      sectionId: "section-id",
      studyYear: 2,
      registerNumber: "999999990001",
      section: {
        semesterId: "semester-id",
        semester: { academicYearId: "academic-year-id" },
      },
    });
    const student = {
      ...actor,
      id: "student-id",
      roles: ["STUDENT"],
      fullName: "Student One",
    };

    await expect(
      service.submitMyProfile(
        student,
        {
          fullName: "Student One",
          mobileNumber: "9876543210",
          collegeId: "AVS001",
          registerNumber: "999999990001",
          departmentId: "department-id",
          programmeId: "programme-id",
          academicYearId: "academic-year-id",
          semesterId: "new-semester-id",
          sectionId: "new-section-id",
          studyYear: 3,
        },
        "request-id",
      ),
    ).rejects.toThrow("Students cannot change their academic placement");
    expect(placements.placeStudent).not.toHaveBeenCalled();
  });

  it("uses the existing authoritative placement without requiring it to be echoed", async () => {
    const { service, prisma, placements } = harness();
    prisma.studentProfile.findFirst.mockResolvedValue({
      department: {
        id: "department-id",
        code: "CSE",
        name: "Computer Science and Engineering",
      },
    });
    prisma.studentProfile.findUnique.mockResolvedValue({
      departmentId: "department-id",
      programmeId: "programme-id",
      sectionId: "section-id",
      studyYear: 2,
      registerNumber: "999999990001",
      section: {
        semesterId: "semester-id",
        semester: { academicYearId: "academic-year-id" },
      },
    });
    const student = {
      ...actor,
      id: "student-id",
      roles: ["STUDENT"],
      fullName: "Student One",
    };

    await service.submitMyProfile(
      student,
      {
        fullName: "Student One",
        mobileNumber: "9876543210",
        collegeId: "AVS001",
      },
      "request-id",
    );

    expect(placements.placeStudent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sectionId: "section-id",
        profile: expect.objectContaining({
          departmentId: "department-id",
          programmeId: "programme-id",
          academicYearId: "academic-year-id",
          semesterId: "semester-id",
          studyYear: 2,
        }),
      }),
    );
  });

  it("routes student profile submission through the canonical placement transaction", async () => {
    const { service, placements } = harness();
    const student = {
      ...actor,
      id: "student-id",
      roles: ["STUDENT"],
      fullName: "Student One",
    };

    await service.submitMyProfile(
      student,
      {
        fullName: "Student One",
        mobileNumber: "9876543210",
        collegeId: "AVS001",
        departmentId: "department-id",
        programmeId: "programme-id",
        academicYearId: "academic-year-id",
        semesterId: "semester-id",
        sectionId: "section-id",
        studyYear: 2,
        dateOfBirth: "2008-02-20",
        gender: "Female",
      },
      "request-id",
    );

    expect(placements.placeStudent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "student-id",
        sectionId: "section-id",
        profile: expect.objectContaining({
          departmentId: "department-id",
          programmeId: "programme-id",
          academicYearId: "academic-year-id",
          semesterId: "semester-id",
          registerNumber: null,
          studyYear: 2,
        }),
      }),
    );
  });

  it("rejects invalid date-of-birth calendar values before placement", async () => {
    const { service, placements } = harness();
    const student = {
      ...actor,
      id: "student-id",
      roles: ["STUDENT"],
      fullName: "Student One",
    };

    await expect(
      service.submitMyProfile(
        student,
        {
          fullName: "Student One",
          mobileNumber: "9876543210",
          collegeId: "AVS001",
          departmentId: "department-id",
          programmeId: "programme-id",
          academicYearId: "academic-year-id",
          semesterId: "semester-id",
          sectionId: "section-id",
          studyYear: 2,
          dateOfBirth: "2026-02-31",
        },
        "request-id",
      ),
    ).rejects.toThrow("Date of Birth must be a valid calendar date.");
    expect(placements.placeStudent).not.toHaveBeenCalled();
  });

  it("rejects direct student creation when the canonical placement reports seat 71", async () => {
    const tx = {
      user: {
        create: jest.fn().mockResolvedValue({
          id: "student-id",
          publicId: "student-public-id",
          collegeIdentityId: "AVS001",
          fullName: "Student One",
          status: AccountStatus.ACTIVE,
          mustChangePassword: true,
        }),
      },
      roleAssignmentHistory: { create: jest.fn() },
    };
    const prisma = {
      role: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: "student-role", code: "STUDENT", permissions: [] },
          ]),
      },
      section: {
        findFirst: jest.fn().mockResolvedValue({
          id: "section-id",
          studyYear: 2,
          semester: { number: 3 },
        }),
      },
      studentProfile: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const placements = {
      placeStudent: jest.fn().mockRejectedValue(
        new ConflictException({
          code: "SECTION_FULL",
          message:
            "Section A is full. Current capacity: 70 / 70. Please select another Section.",
        }),
      ),
    };
    const service = new UsersService(
      prisma as unknown as PrismaService,
      { get: jest.fn().mockReturnValue("") } as unknown as ConfigService,
      { record: jest.fn() } as unknown as AuditService,
      { synchronizeCollege: jest.fn() } as unknown as OfficialGroupsService,
      placements as unknown as SectionPlacementService,
    );

    await expect(
      service.create(
        actor,
        {
          collegeIdentityId: "AVS001",
          fullName: "Student One",
          email: "student1@college.edu",
          temporaryPassword: "Student@2026!",
          roleCodes: ["STUDENT"],
          scopes: [{ type: "SECTION", id: "section-id" }],
          studentProfile: {
            degreeTypeId: "degree-type-id",
            departmentId: "department-id",
            programmeId: "programme-id",
            academicYearId: "academic-year-id",
            semesterId: "semester-id",
            sectionId: "section-id",
            registerNumber: "999999990001",
            studyYear: 2,
          },
        },
        "request-id",
      ),
    ).rejects.toMatchObject({ response: { code: "SECTION_FULL" } });
    expect(tx.roleAssignmentHistory.create).not.toHaveBeenCalled();
  });
});
