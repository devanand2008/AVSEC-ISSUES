import type { AccessService } from "../src/common/access/access.service";
import type { AuthPrincipal } from "../src/common/http/request-context";
import type { PrismaService } from "../src/database/prisma.service";
import { AiContextService } from "../src/modules/ai/ai-context.service";

const student: AuthPrincipal = {
  id: "student-private-id",
  publicId: "student-public-id",
  collegeId: "college-id",
  fullName: "Student",
  email: null,
  status: "ACTIVE",
  mustChangePassword: false,
  sessionId: "session-id",
  roles: ["STUDENT"],
  permissions: ["ai.use", "issues.read_own"],
  scopes: [],
};

describe("AVS Bot role-scoped database context", () => {
  it("queries only the authenticated student's attendance", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new AiContextService(
      { attendanceSummary: { findMany } } as unknown as PrismaService,
      {} as AccessService,
    );

    const result = await service.build(
      student,
      "What is my attendance percentage?",
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentUserId: student.id,
          isArchived: false,
        },
      }),
    );
    expect(result.context).toMatchObject({
      data: { scope: "own_attendance_only" },
    });
    expect(JSON.stringify(result.context)).not.toContain("another student");
  });

  it("uses the existing issue access predicate instead of model-supplied IDs", async () => {
    const issueWhere = jest.fn().mockReturnValue({
      collegeId: student.collegeId,
      reporterId: student.id,
    });
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new AiContextService(
      { issue: { findMany } } as unknown as PrismaService,
      { issueWhere } as unknown as AccessService,
    );

    await service.build(student, "Show my latest issue status");

    expect(issueWhere).toHaveBeenCalledWith(student);
    expect(findMany.mock.calls[0]?.[0].where).toEqual({
      collegeId: student.collegeId,
      reporterId: student.id,
    });
  });

  it("returns aggregates without identities for HOD attendance", async () => {
    const service = new AiContextService(
      {
        staffProfile: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ departmentId: "department-id" }),
        },
        attendanceSummary: {
          aggregate: jest.fn().mockResolvedValue({
            _avg: { percentage: 81.5 },
            _count: { _all: 20 },
          }),
          count: jest.fn().mockResolvedValue(3),
        },
      } as unknown as PrismaService,
      {} as AccessService,
    );
    const result = await service.build(
      { ...student, roles: ["HOD"] },
      "Give the department attendance overview",
    );

    expect(result.context).toMatchObject({
      data: {
        scope: "department_aggregate",
        averagePercentage: 81.5,
        summaryRows: 20,
        below75SummaryRows: 3,
      },
    });
    expect(JSON.stringify(result.context)).not.toContain("student-private-id");
  });
});

