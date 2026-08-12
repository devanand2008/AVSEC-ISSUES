import { BadRequestException, ConflictException } from "@nestjs/common";
import type { AuthPrincipal } from "../src/common/http/request-context";
import { PrismaService } from "../src/database/prisma.service";
import { AcademicService } from "../src/modules/academic/academic.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { OfficialGroupsService } from "../src/modules/conversations/official-groups.service";
import { SectionPlacementService } from "../src/modules/academic/section-placement.service";

const actor: AuthPrincipal = {
  id: "admin-id",
  publicId: "admin-public-id",
  collegeId: "college-id",
  fullName: "Main Admin",
  email: "admin@college.edu",
  status: "ACTIVE",
  mustChangePassword: false,
  sessionId: "session-id",
  roles: ["MAIN_ADMIN"],
  permissions: ["academic.manage"],
  scopes: [{ type: "COLLEGE", id: "college-id", issueCategoryId: null }],
};

function serviceWith(prisma: Record<string, unknown>) {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const groups = {
    archiveLinkedGroup: jest.fn().mockResolvedValue(undefined),
    synchronizeSection: jest.fn().mockResolvedValue(undefined),
    synchronizeDepartment: jest.fn().mockResolvedValue(undefined),
  };
  const placements = { lockDepartment: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new AcademicService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      groups as unknown as OfficialGroupsService,
      placements as unknown as SectionPlacementService,
    ),
    audit,
    groups,
    placements,
  };
}

describe("Academic lifecycle and normalized duplicates", () => {
  it("does not allow an already-active department to be disconnected from its campus", async () => {
    const existing = {
      id: "department-id",
      collegeId: actor.collegeId,
      campusId: "campus-id",
      hodId: null,
      code: "CSE",
      name: "Computer Science and Engineering",
      isActive: true,
      archivedAt: null,
    };
    const tx = {
      department: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
    };
    const prisma = {
      department: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.updateDepartment(
        actor,
        existing.id,
        { campusId: null },
        "request-id",
      ),
    ).rejects.toThrow("Assign an active campus first");
    expect(tx.department.update).not.toHaveBeenCalled();
  });

  it("blocks a case-insensitive department duplicate in the same college", async () => {
    const prisma = {
      campus: { findFirst: jest.fn().mockResolvedValue({ id: "campus-id" }) },
      department: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            code: "CSE",
            name: "Computer Science and Engineering",
          }),
        create: jest.fn(),
      },
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.createDepartment(
        actor,
        {
          code: " cse ",
          name: "A different display name",
        },
        "request-id",
      ),
    ).rejects.toThrow("Department code already exists.");
    expect(prisma.department.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ collegeId: actor.collegeId }),
      }),
    );
    expect(prisma.department.create).not.toHaveBeenCalled();
  });

  it("blocks a case-insensitive programme-code collision in the same department", async () => {
    const programmeFindFirst = jest
      .fn()
      .mockResolvedValueOnce({
        id: "programme-id",
        departmentId: "department-id",
        code: "AIML",
        name: "Artificial Intelligence and Machine Learning",
        isActive: true,
      })
      .mockResolvedValueOnce({ code: "AI&ML", name: "Another programme" });
    const prisma = {
      programme: { findFirst: programmeFindFirst, update: jest.fn() },
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.updateProgramme(
        actor,
        "programme-id",
        { code: " ai&ml " },
        "request-id",
      ),
    ).rejects.toThrow(ConflictException);
    expect(prisma.programme.update).not.toHaveBeenCalled();
  });

  it("blocks a section duplicate after trimming and case normalization", async () => {
    const prisma = {
      semester: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: "semester-id",
            academicYear: {
              startsOn: new Date("2026-06-01"),
              endsOn: new Date("2027-05-31"),
            },
          }),
      },
      section: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ code: "A", name: "Section A" }),
      },
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.createSection(
        actor,
        {
          semesterId: "00000000-0000-0000-0000-000000000001",
          code: " a ",
          name: "section a",
        },
        "request-id",
      ),
    ).rejects.toThrow(ConflictException);
  });

  it("allows the same section name in a different department by scoping uniqueness to its semester", async () => {
    const semester = {
      id: "semester-cse",
      academicYear: {
        startsOn: new Date("2026-06-01"),
        endsOn: new Date("2027-05-31"),
      },
      programme: { departmentId: "department-cse" },
    };
    const created = {
      id: "section-cse-a",
      semesterId: semester.id,
      code: "A",
      name: "Section A",
      isActive: true,
      officialGroupEnabled: false,
    };
    const tx = {
      semester: { findFirst: jest.fn().mockResolvedValue({ id: semester.id }) },
      section: { create: jest.fn().mockResolvedValue(created) },
    };
    const prisma = {
      semester: { findFirst: jest.fn().mockResolvedValue(semester) },
      section: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.createSection(
        actor,
        {
          semesterId: semester.id,
          code: "A",
          name: "Section A",
        },
        "request-id",
      ),
    ).resolves.toEqual(created);

    expect(prisma.section.findFirst).toHaveBeenCalledWith({
      where: {
        semesterId: semester.id,
        OR: [
          { code: { equals: "A", mode: "insensitive" } },
          { name: { equals: "Section A", mode: "insensitive" } },
        ],
      },
      select: { code: true, name: true },
    });
    expect(tx.section.create).toHaveBeenCalled();
  });

  it("archives a department and closes active section assignments under the hierarchy lock", async () => {
    const existing = {
      id: "department-id",
      collegeId: actor.collegeId,
      code: "CSE",
      name: "Computer Science and Engineering",
      isActive: true,
      archivedAt: null,
    };
    const archived = { ...existing, isActive: false, archivedAt: new Date() };
    const tx = {
      section: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "section-a" }, { id: "section-b" }]),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      department: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(archived),
      },
      facultySubjectAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      classCoordinatorAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      classStaffAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      classRepresentativeAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      department: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const { service, audit, groups, placements } = serviceWith(prisma);

    await expect(
      service.archiveDepartment(
        actor,
        existing.id,
        "End of programme",
        "request-id",
      ),
    ).resolves.toEqual(archived);

    expect(placements.lockDepartment).toHaveBeenCalledWith(tx, existing.id);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.facultySubjectAssignment.updateMany).toHaveBeenCalled();
    expect(tx.classCoordinatorAssignment.updateMany).toHaveBeenCalled();
    expect(tx.classStaffAssignment.updateMany).toHaveBeenCalled();
    expect(tx.classRepresentativeAssignment.updateMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "department.archived" }),
      tx,
    );
    expect(groups.archiveLinkedGroup).toHaveBeenCalledWith(
      actor.collegeId,
      "department",
      existing.id,
    );
  });

  it("requires archive before permanent section deletion", async () => {
    const zeroCounts = {
      studentProfiles: 0,
      memberships: 0,
      coordinatorAssignments: 0,
      staffAssignments: 0,
      representativeAssignments: 0,
      attendanceSessions: 0,
      attendanceSummaries: 0,
      facultyAssignments: 0,
      subjectResourceTargets: 0,
      modelPaperTargets: 0,
    };
    const prisma = {
      section: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: "section-id",
            code: "A",
            name: "Section A",
            isActive: false,
            archivedAt: null,
            semester: { programme: { departmentId: "department-id" } },
            _count: zeroCounts,
          }),
      },
      attendanceImportBatch: { count: jest.fn().mockResolvedValue(0) },
      userScope: { count: jest.fn().mockResolvedValue(0) },
      announcementAudience: { count: jest.fn().mockResolvedValue(0) },
      conversation: { count: jest.fn().mockResolvedValue(0) },
      archivedRecord: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    prisma.$transaction.mockImplementation(
      (work: (client: Record<string, unknown>) => unknown) => work(prisma),
    );
    const { service } = serviceWith(prisma);

    await expect(
      service.deleteSection(actor, "section-id", "request-id"),
    ).rejects.toThrow(
      "Archive the section before requesting permanent deletion.",
    );
  });

  it("counts inactive and historical assignment rows as deletion dependencies", async () => {
    const prisma = {
      section: {
        findFirst: jest.fn().mockResolvedValue({
          id: "section-id",
          code: "A",
          name: "Section A",
          isActive: false,
          archivedAt: new Date(),
          _count: {
            studentProfiles: 0,
            memberships: 4,
            coordinatorAssignments: 2,
            staffAssignments: 3,
            representativeAssignments: 1,
            attendanceSessions: 0,
            attendanceSummaries: 0,
            facultyAssignments: 5,
            subjectResourceTargets: 0,
            modelPaperTargets: 0,
          },
        }),
      },
      attendanceImportBatch: { count: jest.fn().mockResolvedValue(0) },
      userScope: { count: jest.fn().mockResolvedValue(0) },
      announcementAudience: { count: jest.fn().mockResolvedValue(0) },
      conversation: { count: jest.fn().mockResolvedValue(0) },
      archivedRecord: { count: jest.fn().mockResolvedValue(0) },
    };
    const { service } = serviceWith(prisma);

    const report = await service.sectionDependencies(actor, "section-id");

    expect(report.dependencies).toMatchObject({
      memberships: 4,
      coordinatorAssignments: 2,
      staffAssignments: 3,
      representativeAssignments: 1,
      facultyAssignments: 5,
    });
    expect(report.dependencyCount).toBe(15);
    expect(report.canDelete).toBe(false);
  });

  it("archives a section and closes all active teaching assignments atomically", async () => {
    const existing = {
      id: "section-id",
      code: "A",
      name: "Section A",
      isActive: true,
      archivedAt: null,
      semester: { programme: { departmentId: "department-id" } },
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      section: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest
          .fn()
          .mockResolvedValue({
            ...existing,
            isActive: false,
            archivedAt: new Date(),
          }),
      },
      facultySubjectAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      classCoordinatorAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      classStaffAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      classRepresentativeAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      section: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const { service, audit, groups } = serviceWith(prisma);

    await service.archiveSection(
      actor,
      "section-id",
      "No longer used",
      "request-id",
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.classCoordinatorAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sectionId: "section-id", isActive: true },
      }),
    );
    expect(tx.classStaffAssignment.updateMany).toHaveBeenCalled();
    expect(tx.classRepresentativeAssignment.updateMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "section.archived" }),
      tx,
    );
    expect(groups.archiveLinkedGroup).toHaveBeenCalledWith(
      actor.collegeId,
      "section",
      "section-id",
    );
  });

  it("replaces a section coordinator in the same transaction as the section edit", async () => {
    const existing = {
      id: "section-id",
      semesterId: "semester-id",
      code: "A",
      name: "Section A",
      capacity: 70,
      isActive: true,
      archivedAt: null,
      semester: {
        academicYear: {
          startsOn: new Date("2026-06-01"),
          endsOn: new Date("2027-05-31"),
        },
        programme: { departmentId: "department-id" },
      },
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      semester: {
        findFirst: jest.fn().mockResolvedValue({ id: "semester-id" }),
      },
      section: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest
          .fn()
          .mockResolvedValue({ ...existing, displayName: "CSE - A" }),
      },
      classCoordinatorAssignment: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: "old-assignment",
            coordinatorId: "old-coordinator",
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: "new-assignment" }),
      },
      classRepresentativeAssignment: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      classStaffAssignment: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: "old-staff-assignment", staffId: "old-staff" },
          ]),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: "new-staff-assignment" }),
      },
      facultySubjectAssignment: { updateMany: jest.fn() },
      studentProfile: { count: jest.fn() },
    };
    const prisma = {
      section: { findFirst: jest.fn().mockResolvedValue(existing) },
      semester: {
        findFirst: jest.fn().mockResolvedValue({ id: "semester-id" }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: "new-coordinator" }),
        findMany: jest
          .fn()
          .mockResolvedValue([
            {
              id: "new-staff",
              publicId: "00000000-0000-0000-0000-000000000098",
            },
          ]),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const { service } = serviceWith(prisma);

    await service.updateSection(
      actor,
      "section-id",
      {
        displayName: "CSE - A",
        coordinatorPublicId: "00000000-0000-0000-0000-000000000099",
        prospectiveClassStaffPublicIds: [
          "00000000-0000-0000-0000-000000000098",
        ],
      },
      "request-id",
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.section.update).toHaveBeenCalled();
    expect(tx.classCoordinatorAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sectionId: "section-id", isActive: true },
      }),
    );
    expect(tx.classCoordinatorAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sectionId: "section-id",
        coordinatorId: "new-coordinator",
      }),
    });
    expect(tx.classStaffAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["old-staff-assignment"] } },
      }),
    );
    expect(tx.classStaffAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sectionId: "section-id",
        staffId: "new-staff",
        assignmentType: "PROSPECTIVE_CLASS_STAFF",
      }),
    });
  });

  it("attaches a legacy NULL-campus department to an active campus atomically", async () => {
    const existing = {
      id: "department-id",
      collegeId: actor.collegeId,
      campusId: null,
      code: "CSE",
      name: "Computer Science and Engineering",
      isActive: true,
      archivedAt: null,
    };
    const updated = { ...existing, campusId: "campus-id" };
    const tx = {
      campus: { findFirst: jest.fn().mockResolvedValue({ id: "campus-id" }) },
      department: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(updated),
      },
    };
    const prisma = {
      department: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const { service, audit } = serviceWith(prisma);

    await expect(
      service.updateDepartment(
        actor,
        "department-id",
        { campusId: "00000000-0000-0000-0000-000000000077" },
        "request-id",
      ),
    ).resolves.toEqual(updated);

    expect(tx.campus.findFirst).toHaveBeenCalledWith({
      where: {
        id: "00000000-0000-0000-0000-000000000077",
        collegeId: actor.collegeId,
        isActive: true,
        archivedAt: null,
      },
      select: { id: true },
    });
    expect(tx.department.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campus: { connect: { id: "00000000-0000-0000-0000-000000000077" } },
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "department.updated" }),
      tx,
    );
  });

  it("restores a section only when every academic ancestor is active", async () => {
    const existing = {
      id: "section-id",
      semesterId: "semester-id",
      code: "A",
      name: "Section A",
      isActive: false,
      archivedAt: new Date(),
      semester: { programme: { departmentId: "department-id" } },
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      section: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
      semester: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      section: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.restoreSection(actor, "section-id", "request-id"),
    ).rejects.toThrow(
      "Activate the section's department, programme, academic year and semester first.",
    );
    expect(tx.section.update).not.toHaveBeenCalled();
  });

  it("re-reads an archived department under its lock and validates campus and HOD before restore", async () => {
    const existing = {
      id: "department-id",
      collegeId: actor.collegeId,
      campusId: "campus-id",
      hodId: "hod-id",
      code: "CSE",
      name: "Computer Science and Engineering",
      isActive: false,
      archivedAt: new Date(),
    };
    const tx = {
      department: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
      campus: { findFirst: jest.fn().mockResolvedValue({ id: "campus-id" }) },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      department: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const { service, placements } = serviceWith(prisma);

    await expect(
      service.restoreDepartment(actor, existing.id, "request-id"),
    ).rejects.toThrow(
      "Cannot activate department: Assigned HOD is not an active user.",
    );

    expect(placements.lockDepartment).toHaveBeenCalledWith(tx, existing.id);
    expect(tx.department.findFirst).toHaveBeenCalled();
    expect(tx.department.update).not.toHaveBeenCalled();
  });

  it("locks a programme hierarchy and closes assignments when deactivating it", async () => {
    const existing = {
      id: "programme-id",
      collegeId: actor.collegeId,
      departmentId: "department-id",
      code: "CSE",
      name: "Computer Science and Engineering",
      isActive: true,
      department: { isActive: true, archivedAt: null },
    };
    const updated = { ...existing, isActive: false };
    const tx = {
      section: {
        findMany: jest.fn().mockResolvedValue([{ id: "section-id" }]),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      programme: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(updated),
      },
      facultySubjectAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      classCoordinatorAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      classStaffAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      classRepresentativeAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      programme: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const { service, placements } = serviceWith(prisma);

    await expect(
      service.updateEntityStatus(
        actor,
        "programme",
        existing.id,
        { isActive: false },
        "request-id",
      ),
    ).resolves.toEqual(updated);

    expect(placements.lockDepartment).toHaveBeenCalledWith(
      tx,
      existing.departmentId,
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.classCoordinatorAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          section: { semester: { programmeId: existing.id } },
        }),
      }),
    );
  });

  it("revalidates semester ancestors after locking before activation", async () => {
    const existing = {
      id: "semester-id",
      programmeId: "programme-id",
      academicYearId: "year-id",
      isActive: false,
      programme: {
        departmentId: "department-id",
        isActive: true,
        department: { isActive: true, archivedAt: null },
      },
      academicYear: { isActive: true },
    };
    const tx = {
      section: { findMany: jest.fn().mockResolvedValue([]) },
      semester: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(existing)
          .mockResolvedValueOnce(null),
        update: jest.fn(),
      },
    };
    const prisma = {
      semester: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const { service, placements } = serviceWith(prisma);

    await expect(
      service.updateEntityStatus(
        actor,
        "semester",
        existing.id,
        { isActive: true },
        "request-id",
      ),
    ).rejects.toThrow(BadRequestException);

    expect(placements.lockDepartment).toHaveBeenCalledWith(
      tx,
      existing.programme.departmentId,
    );
    expect(tx.semester.update).not.toHaveBeenCalled();
  });

  it("locks all academic-year sections before deactivation", async () => {
    const existing = {
      id: "year-id",
      collegeId: actor.collegeId,
      name: "2026-2027",
      isActive: true,
    };
    const updated = { ...existing, isActive: false };
    const tx = {
      department: { findMany: jest.fn().mockResolvedValue([]) },
      section: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "section-a" }, { id: "section-b" }]),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      academicYear: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(updated),
      },
      facultySubjectAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      classCoordinatorAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      classStaffAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      classRepresentativeAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      academicYear: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const { service, placements } = serviceWith(prisma);

    await expect(
      service.updateEntityStatus(
        actor,
        "academicYear",
        existing.id,
        { isActive: false },
        "request-id",
      ),
    ).resolves.toEqual(updated);

    expect(placements.lockDepartment).toHaveBeenCalledWith(
      tx,
      `academic-year:${existing.id}`,
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.facultySubjectAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          section: { semester: { academicYearId: existing.id } },
        }),
      }),
    );
  });

  it("rechecks section dependencies under locks before permanent deletion", async () => {
    const existing = {
      id: "section-id",
      code: "A",
      name: "Section A",
      isActive: false,
      archivedAt: new Date(),
      semester: { programme: { departmentId: "department-id" } },
      _count: {
        studentProfiles: 0,
        memberships: 1,
        coordinatorAssignments: 0,
        staffAssignments: 0,
        representativeAssignments: 0,
        attendanceSessions: 0,
        attendanceSummaries: 0,
        facultyAssignments: 0,
        subjectResourceTargets: 0,
        modelPaperTargets: 0,
      },
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      section: {
        findFirst: jest.fn().mockResolvedValue(existing),
        delete: jest.fn(),
      },
      attendanceImportBatch: { count: jest.fn().mockResolvedValue(0) },
      userScope: { count: jest.fn().mockResolvedValue(0) },
      announcementAudience: { count: jest.fn().mockResolvedValue(0) },
      conversation: { count: jest.fn().mockResolvedValue(0) },
      archivedRecord: { count: jest.fn().mockResolvedValue(0) },
    };
    const prisma = {
      section: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const { service, placements } = serviceWith(prisma);

    await expect(
      service.deleteSection(actor, existing.id, "request-id"),
    ).rejects.toThrow(ConflictException);

    expect(placements.lockDepartment).toHaveBeenCalledWith(
      tx,
      "department-id",
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.section.delete).not.toHaveBeenCalled();
  });
});
