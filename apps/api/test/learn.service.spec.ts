import { LearnService } from "../src/modules/learn/learn.service";
import type { AuthPrincipal } from "../src/common/http/request-context";

function principal(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    publicId: "00000000-0000-0000-0000-000000000002",
    collegeId: "00000000-0000-0000-0000-000000000003",
    fullName: "Student",
    email: "student@avs.edu",
    status: "ACTIVE",
    mustChangePassword: false,
    sessionId: "00000000-0000-0000-0000-000000000004",
    roles: ["STUDENT"],
    permissions: [],
    scopes: [],
    ...overrides,
  };
}

describe("LearnService", () => {
  it("reports public Learn health from database counts", async () => {
    const prisma = {
      course: { count: jest.fn().mockResolvedValue(3) },
      courseResource: { count: jest.fn().mockResolvedValue(7) },
      courseAssessment: { count: jest.fn().mockResolvedValue(2) },
    };
    const service = new LearnService(prisma as never);

    await expect(service.health()).resolves.toMatchObject({
      ok: true,
      service: "AVS Learn Portal",
      database: "connected",
      coursesAvailable: 3,
      resourcesAvailable: 7,
      assessmentsAvailable: 2,
    });
  });

  it("records lesson progress through the authenticated user only", async () => {
    const prisma = {
      studentProfile: {
        findUnique: jest.fn().mockResolvedValue({
          departmentId: "00000000-0000-0000-0000-000000000020",
          programmeId: "00000000-0000-0000-0000-000000000030",
        }),
      },
      course: {
        findFirst: jest.fn().mockResolvedValue({ id: "course-1" }),
      },
      studentProgress: {
        upsert: jest.fn().mockResolvedValue({ completedAt: new Date("2026-07-24T00:00:00.000Z") }),
      },
    };
    const service = new LearnService(prisma as never);

    const result = await service.recordProgress(principal(), {
      courseId: "00000000-0000-0000-0000-000000000010",
      lessonId: "00000000-0000-0000-0000-000000000011",
      completed: true,
    });

    expect(result).toMatchObject({ completed: true });
    expect(prisma.studentProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ studentId: "00000000-0000-0000-0000-000000000001" }),
      }),
    );
  });

  it("grades assessment answers on the server", async () => {
    const prisma = {
      studentProfile: {
        findUnique: jest.fn().mockResolvedValue({
          departmentId: "00000000-0000-0000-0000-000000000020",
          programmeId: "00000000-0000-0000-0000-000000000030",
        }),
      },
      courseAssessment: {
        findFirst: jest.fn().mockResolvedValue({
          id: "assessment-1",
          courseId: "course-1",
          maxScore: 10,
          passingScore: 5,
          type: "QUIZ",
          questionsJson: {
            questions: [
              {
                id: "q1",
                type: "mcq",
                question: "Correct option?",
                options: ["No", "Yes"],
                correct: 1,
                marks: 10,
              },
            ],
          },
          course: { id: "course-1", code: "TEST", title: "Test Course" },
        }),
      },
      assessmentResult: {
        create: jest.fn().mockResolvedValue({
          id: "result-1",
          score: 10,
          passed: true,
        }),
      },
    };
    const service = new LearnService(prisma as never);

    await expect(
      service.submitAssessment(principal(), "assessment-1", { answersJson: { q1: 1 } }),
    ).resolves.toMatchObject({ score: 10, passed: true });
    expect(prisma.assessmentResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ score: 10, passed: true }),
      }),
    );
  });
});
