import { ConflictException } from "@nestjs/common";
import { AccountStatus } from "../src/generated/prisma/enums";
import { PrismaService } from "../src/database/prisma.service";
import { SectionPlacementService } from "../src/modules/academic/section-placement.service";

const section = {
  id: "00000000-0000-0000-0000-000000000010",
  code: "A",
  name: "Section A",
  capacity: 70,
  studyYear: 2,
  semesterId: "00000000-0000-0000-0000-000000000020",
  semester: {
    number: 3,
    academicYearId: "00000000-0000-0000-0000-000000000030",
    academicYear: {
      startsOn: new Date("2026-06-01T00:00:00.000Z"),
      endsOn: new Date("2027-05-31T00:00:00.000Z"),
    },
    programmeId: "00000000-0000-0000-0000-000000000040",
    programme: {
      id: "00000000-0000-0000-0000-000000000040",
      departmentId: "00000000-0000-0000-0000-000000000050",
      degreeTypeId: "00000000-0000-0000-0000-000000000060",
      durationYears: 4,
      totalSemesters: 8,
    },
  },
};

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(0),
    section: { findFirst: jest.fn().mockResolvedValue(section) },
    studentProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(69),
      create: jest.fn().mockResolvedValue({ id: "profile-id" }),
      update: jest.fn().mockResolvedValue({ id: "profile-id" }),
    },
    sectionMembership: {
      count: jest.fn().mockResolvedValue(69),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({ id: "membership-id" }),
      create: jest.fn().mockResolvedValue({ id: "membership-id" }),
    },
    userScope: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({ id: "scope-id" }),
    },
    ...overrides,
  };
}

describe("SectionPlacementService", () => {
  const service = new SectionPlacementService({} as PrismaService);

  it("rejects an archived section before any capacity or student write", async () => {
    const tx = transaction();
    tx.section.findFirst
      .mockResolvedValueOnce({
        semester: {
          programme: { departmentId: section.semester.programme.departmentId },
        },
      })
      .mockResolvedValueOnce(null);

    await expect(
      service.placeStudent(tx as never, {
        collegeId: "college-id",
        userId: "student-id",
        sectionId: section.id,
        startsOn: new Date("2026-06-10T00:00:00.000Z"),
        accountStatus: AccountStatus.ACTIVE,
        profile: { studentId: "AVS001" },
      }),
    ).rejects.toThrow(
      "The selected section and its academic parents must be active and unarchived.",
    );

    expect(tx.studentProfile.count).not.toHaveBeenCalled();
    expect(tx.studentProfile.create).not.toHaveBeenCalled();
    expect(tx.sectionMembership.create).not.toHaveBeenCalled();
  });

  it("uses one locked, structured SECTION_FULL error at capacity", async () => {
    const tx = transaction();
    tx.sectionMembership.count.mockResolvedValue(70);

    await expect(
      service.assertActivationCapacity(
        tx as never,
        "college-id",
        "student-id",
        section.id,
      ),
    ).rejects.toMatchObject({
      response: {
        code: "SECTION_FULL",
        message:
          "Section A is full. Current capacity: 70 / 70. Please select another Section.",
        details: {
          currentCapacity: 70,
          maximumCapacity: 70,
          availableSeats: 0,
          requestedSeats: 1,
        },
      },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it("rejects profile submission when the 70 active seats are already occupied", async () => {
    const tx = transaction();
    tx.sectionMembership.count.mockResolvedValue(70);

    await expect(
      service.placeStudent(tx as never, {
        collegeId: "college-id",
        userId: "student-id",
        sectionId: section.id,
        startsOn: new Date("2026-06-10T00:00:00.000Z"),
        accountStatus: AccountStatus.ACTIVE,
        profile: {
          studentId: "AVS001",
          registerNumber: "999999990001",
          departmentId: section.semester.programme.departmentId,
          programmeId: section.semester.programme.id,
          academicYearId: section.semester.academicYearId,
          semesterId: section.semesterId,
          studyYear: 2,
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.studentProfile.create).not.toHaveBeenCalled();
    expect(tx.sectionMembership.create).not.toHaveBeenCalled();
  });

  it("writes the canonical profile, membership history and SECTION scope together", async () => {
    const tx = transaction();
    const result = await service.placeStudent(tx as never, {
      collegeId: "college-id",
      userId: "student-id",
      sectionId: section.id,
      startsOn: new Date("2026-06-10T00:00:00.000Z"),
      accountStatus: AccountStatus.ACTIVE,
      profile: {
        studentId: "AVS001",
        registerNumber: "999999990001",
        departmentId: section.semester.programme.departmentId,
        programmeId: section.semester.programme.id,
        academicYearId: section.semester.academicYearId,
        semesterId: section.semesterId,
        studyYear: 2,
        gender: "Female",
        dateOfBirth: new Date("2008-02-20T00:00:00.000Z"),
      },
    });

    expect(tx.studentProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          departmentId: section.semester.programme.departmentId,
          programmeId: section.semester.programme.id,
          sectionId: section.id,
          studyYear: 2,
          registerNumber: "999999990001",
          admissionYear: 2026,
        }),
      }),
    );
    expect(tx.sectionMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentUserId: "student-id",
        sectionId: section.id,
        academicYearId: section.semester.academicYearId,
        isActive: true,
      }),
    });
    expect(tx.userScope.deleteMany).toHaveBeenCalledWith({
      where: { userId: "student-id", scopeType: "SECTION" },
    });
    expect(tx.userScope.create).toHaveBeenCalledWith({
      data: { userId: "student-id", scopeType: "SECTION", scopeId: section.id },
    });
    expect(result).toMatchObject({
      currentStudentCount: 70,
      maximumCapacity: 70,
      availableSeats: 0,
    });
  });

  it("returns the exact count when repairing an existing same-section placement", async () => {
    const tx = transaction();
    tx.studentProfile.findUnique.mockResolvedValue({
      id: "profile-id",
      sectionId: section.id,
      studentId: "AVS001",
      admissionYear: 2026,
      academicStatus: "ACTIVE",
    });
    tx.sectionMembership.count.mockResolvedValue(69);
    tx.sectionMembership.findFirst.mockResolvedValue({
      id: "membership-id",
      sectionId: section.id,
      academicYearId: section.semester.academicYearId,
    });

    const result = await service.placeStudent(tx as never, {
      collegeId: "college-id",
      userId: "student-id",
      sectionId: section.id,
      startsOn: new Date("2026-06-10T00:00:00.000Z"),
      accountStatus: AccountStatus.ACTIVE,
      profile: {},
    });

    expect(result).toMatchObject({
      currentStudentCount: 70,
      maximumCapacity: 70,
      availableSeats: 0,
      previousSectionId: section.id,
    });
    expect(tx.sectionMembership.update).toHaveBeenCalledWith({
      where: { id: "membership-id" },
      data: expect.objectContaining({
        isActive: true,
        endsOn: null,
        status: "ACTIVE",
        studyYear: 2,
      }),
    });
    expect(tx.sectionMembership.create).not.toHaveBeenCalled();
  });

  it("returns the exact target count and closes history when moving sections", async () => {
    const tx = transaction();
    tx.studentProfile.findUnique.mockResolvedValue({
      id: "profile-id",
      sectionId: "old-section-id",
      studentId: "AVS001",
      admissionYear: 2026,
      academicStatus: "ACTIVE",
    });
    tx.sectionMembership.count.mockResolvedValue(10);
    tx.sectionMembership.findFirst.mockResolvedValue({
      id: "old-membership",
      sectionId: "old-section-id",
      academicYearId: "old-year-id",
    });

    const result = await service.placeStudent(tx as never, {
      collegeId: "college-id",
      userId: "student-id",
      sectionId: section.id,
      startsOn: new Date("2026-06-10T00:00:00.000Z"),
      accountStatus: AccountStatus.ACTIVE,
      profile: {},
    });

    expect(result).toMatchObject({
      currentStudentCount: 11,
      maximumCapacity: 70,
      availableSeats: 59,
      previousSectionId: "old-section-id",
    });
    expect(tx.sectionMembership.updateMany).toHaveBeenCalledWith({
      where: { studentUserId: "student-id", isActive: true },
      data: expect.objectContaining({
        isActive: false,
        endsOn: new Date("2026-06-10T00:00:00.000Z"),
        status: "MOVED",
      }),
    });
    expect(tx.sectionMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sectionId: section.id,
        academicYearId: section.semester.academicYearId,
      }),
    });
  });

  it("stores one consistent override study year in profile and membership", async () => {
    const tx = transaction();

    await service.placeStudent(tx as never, {
      collegeId: "college-id",
      userId: "student-id",
      sectionId: section.id,
      startsOn: new Date("2026-06-10T00:00:00.000Z"),
      accountStatus: AccountStatus.ACTIVE,
      profile: {
        studentId: "AVS001",
        studyYear: 3,
        academicOverride: true,
        academicOverrideReason: "Approved special curriculum placement",
        changedById: "admin-id",
      },
    });

    expect(tx.studentProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ studyYear: 3 }),
      }),
    );
    expect(tx.sectionMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studyYear: 3,
        reason: "Approved special curriculum placement",
        changedById: "admin-id",
      }),
    });
  });

  it.each([
    ["historical", new Date("2030-08-01T00:00:00.000Z")],
    ["future", new Date("2025-08-01T00:00:00.000Z")],
  ])(
    "anchors a %s placement outside the selected period to the Academic Year start",
    async (_label, requestedStart) => {
      const tx = transaction();

      await service.placeStudent(tx as never, {
        collegeId: "college-id",
        userId: "student-id",
        sectionId: section.id,
        startsOn: requestedStart,
        accountStatus: AccountStatus.ACTIVE,
        profile: { studentId: "AVS001" },
      });

      expect(tx.sectionMembership.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startsOn: new Date("2026-06-01T00:00:00.000Z"),
        }),
      });
    },
  );

  it("retains a placement date that falls inside the selected Academic Year", async () => {
    const tx = transaction();
    const requestedStart = new Date("2026-08-13T00:00:00.000Z");

    await service.placeStudent(tx as never, {
      collegeId: "college-id",
      userId: "student-id",
      sectionId: section.id,
      startsOn: requestedStart,
      accountStatus: AccountStatus.ACTIVE,
      profile: { studentId: "AVS001" },
    });

    expect(tx.sectionMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ startsOn: requestedStart }),
    });
  });
});
