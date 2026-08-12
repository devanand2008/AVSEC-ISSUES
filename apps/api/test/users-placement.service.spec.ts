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
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    user: { findFirst: jest.fn() },
    userScope: { findFirst: jest.fn().mockResolvedValue(null) },
    department: { findFirst: jest.fn() },
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const officialGroups = {
    synchronizeCollege: jest.fn().mockResolvedValue(undefined),
  };
  const placements = { placeStudent: jest.fn().mockResolvedValue({}) };
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
    tx.user.findFirst.mockResolvedValue({
      status: AccountStatus.PENDING,
      collegeIdentityId: "AVS001",
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
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT id FROM users WHERE id = $1 FOR UPDATE",
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
    tx.user.findFirst.mockResolvedValue({
      status: AccountStatus.ARCHIVED,
      collegeIdentityId: "DELETED-STUDENT-PUBLIC-ID",
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

    expect(tx.$executeRawUnsafe).toHaveBeenCalled();
    expect(placements.placeStudent).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("deactivates class-representative authority and revokes sessions when archiving", async () => {
    const { service, prisma, tx } = harness();
    prisma.user.findFirst.mockResolvedValue({
      id: "student-id",
      publicId: "student-public-id",
      collegeId: actor.collegeId,
      collegeIdentityId: "AVS001",
      status: AccountStatus.ACTIVE,
      studentProfile: { sectionId: "section-id" },
      roles: [{ role: { code: "CLASS_REPRESENTATIVE" } }],
    });
    tx.user.findFirst.mockResolvedValue({
      status: AccountStatus.ACTIVE,
      collegeIdentityId: "AVS001",
      studentProfile: { sectionId: "section-id" },
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
        registerNumber: "620124104001",
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
          registerNumber: "620124104001",
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
          registerNumber: "620124104001",
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
      section: { findFirst: jest.fn().mockResolvedValue({ id: "section-id" }) },
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
            departmentId: "department-id",
            programmeId: "programme-id",
            academicYearId: "academic-year-id",
            semesterId: "semester-id",
            sectionId: "section-id",
            registerNumber: "620124104001",
            studyYear: 2,
          },
        },
        "request-id",
      ),
    ).rejects.toMatchObject({ response: { code: "SECTION_FULL" } });
    expect(tx.roleAssignmentHistory.create).not.toHaveBeenCalled();
  });
});
