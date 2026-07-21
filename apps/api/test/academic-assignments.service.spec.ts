import { ConflictException } from "@nestjs/common";
import type { AuthPrincipal } from "../src/common/http/request-context";
import { PrismaService } from "../src/database/prisma.service";
import { AcademicService } from "../src/modules/academic/academic.service";
import { AuditService } from "../src/modules/audit/audit.service";

const actor: AuthPrincipal = {
  id: "00000000-0000-0000-0000-000000000001",
  publicId: "00000000-0000-0000-0000-000000000002",
  collegeId: "00000000-0000-0000-0000-000000000003",
  fullName: "Academic Admin",
  email: null,
  status: "ACTIVE",
  mustChangePassword: false,
  sessionId: "00000000-0000-0000-0000-000000000004",
  roles: ["MAIN_ADMIN"],
  permissions: ["academic.manage"],
  scopes: [{ type: "COLLEGE", id: "00000000-0000-0000-0000-000000000003", issueCategoryId: null }],
};

function harness(overrides: Record<string, unknown> = {}) {
  const tx = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: "faculty-id", publicId: "00000000-0000-0000-0000-000000000010", fullName: "Faculty One" }) },
    section: { findFirst: jest.fn().mockResolvedValue({ id: "section-id", semesterId: "semester-id", semester: { academicYear: { startsOn: new Date("2026-01-01"), endsOn: new Date("2026-12-31") } } }) },
    subject: { findFirst: jest.fn().mockResolvedValue({ id: "subject-id", semesterId: "semester-id" }) },
    facultySubjectAssignment: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "assignment-id", isActive: true }),
      update: jest.fn(),
    },
    classCoordinatorAssignment: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "coordinator-assignment-id", isActive: true }),
      update: jest.fn(),
    },
    classRepresentativeAssignment: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    ...overrides,
  };
  const prisma = { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const officialGroups = { synchronizeSection: jest.fn().mockResolvedValue(undefined) };
  const service = new AcademicService(prisma as unknown as PrismaService, audit as unknown as AuditService, officialGroups as never);
  return { service, tx, prisma, audit, officialGroups };
}

describe("AcademicService assignments", () => {
  it("creates a college-scoped faculty assignment and audits it atomically", async () => {
    const { service, tx, prisma, audit } = harness();
    await expect(service.createFacultyAssignment(actor, {
      facultyPublicId: "00000000-0000-0000-0000-000000000010",
      subjectId: "00000000-0000-0000-0000-000000000011",
      sectionId: "00000000-0000-0000-0000-000000000012",
      validFrom: "2026-07-01",
      validUntil: "2026-10-31",
    }, "request-1")).resolves.toMatchObject({ id: "assignment-id" });

    expect(tx.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ collegeId: actor.collegeId, status: "ACTIVE" }),
    }));
    expect(tx.facultySubjectAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ facultyId: "faculty-id", subjectId: "subject-id", sectionId: "section-id" }),
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "faculty_subject_assignment.created",
      entityId: "assignment-id",
      requestId: "request-1",
    }), tx);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects an overlapping coordinator assignment before writing or auditing", async () => {
    const coordinatorAssignments = {
      findFirst: jest.fn().mockResolvedValue({ id: "existing-assignment" }),
      create: jest.fn(),
      update: jest.fn(),
    };
    const { service, audit } = harness({ classCoordinatorAssignment: coordinatorAssignments });
    await expect(service.createCoordinatorAssignment(actor, {
      coordinatorPublicId: "00000000-0000-0000-0000-000000000020",
      sectionId: "00000000-0000-0000-0000-000000000012",
      validFrom: "2026-07-01",
    }, "request-2")).rejects.toBeInstanceOf(ConflictException);

    expect(coordinatorAssignments.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
