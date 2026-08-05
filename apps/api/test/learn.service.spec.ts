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

  it("publishes configurable assessments with more than five questions", async () => {
    const questions = Array.from({ length: 8 }, (_, index) => ({
      id: `q${index + 1}`,
      type: "single_choice",
      question: `Question ${index + 1}`,
      options: ["No", "Yes"],
      correct: 1,
      marks: 1,
    }));
    const create = jest.fn().mockResolvedValue({ id: "assessment-many" });
    const prisma = {
      course: { findFirst: jest.fn().mockResolvedValue({ id: "course-1" }) },
      courseAssessment: { create },
    };
    const service = new LearnService(prisma as never);
    await service.createAssessment(principal({ roles: ["FACULTY"] }), "course-1", {
      title: "Eight-question lesson check",
      type: "QUIZ" as never,
      maxScore: 8,
      passPercentage: 75,
      questionCount: 8,
      maximumAttempts: 2,
      shuffleQuestions: true,
      status: "PUBLISHED",
      questionsJson: { scope: "lesson", lessonId: "lesson-1", questions },
    });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      questionCount: 8,
      maximumAttempts: 2,
      passingScore: 6,
      shuffleQuestions: true,
      status: "PUBLISHED",
    }) });
  });

  it("persists a random selected question order and enforces attempt limits", async () => {
    const questions = Array.from({ length: 10 }, (_, index) => ({ id: `q${index + 1}`, type: "single_choice", question: `Question ${index + 1}`, options: ["A", "B", "C"], correct: 1, marks: 1 }));
    const assessment = {
      id: "assessment-random",
      courseId: "course-1",
      status: "PUBLISHED",
      type: "QUIZ",
      questionCount: 6,
      maximumAttempts: 2,
      shuffleQuestions: true,
      shuffleOptions: true,
      showCorrectAnswers: false,
      showExplanations: false,
      timeLimitMinutes: 20,
      questionsJson: { questions },
      course: { id: "course-1", code: "CS", title: "Course" },
    };
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "attempt-1", startedAt: new Date(), ...data }));
    const prisma = {
      courseAssessment: { findFirst: jest.fn().mockResolvedValue(assessment) },
      assessmentAttempt: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn(), count: jest.fn().mockResolvedValue(0), create },
    };
    const service = new LearnService(prisma as never);
    const started = await service.startAssessment(principal({ roles: ["FACULTY"] }), assessment.id);
    expect(started.assessment.questionsJson.questions).toHaveLength(6);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ questionOrder: expect.objectContaining({ questionIds: expect.any(Array), optionOrders: expect.any(Object) }), attemptNumber: 1 }) });
    expect((create.mock.calls[0]![0].data.questionOrder as { questionIds: string[] }).questionIds).toHaveLength(6);

    prisma.assessmentAttempt.count.mockResolvedValue(2);
    await expect(service.startAssessment(principal({ roles: ["FACULTY"] }), assessment.id)).rejects.toThrow("Maximum attempts reached (2).");
  });

  it("grades assessment answers on the server", async () => {
    const resultCreate = jest.fn().mockResolvedValue({
      id: "result-1",
      score: 10,
      passed: true,
    });
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
          status: "PUBLISHED",
          maximumAttempts: 3,
          questionCount: 1,
          shuffleQuestions: false,
          shuffleOptions: false,
          showCorrectAnswers: false,
          showExplanations: true,
          timeLimitMinutes: null,
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
      assessmentAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          id: "attempt-1",
          studentId: "00000000-0000-0000-0000-000000000001",
          assessmentId: "assessment-1",
          status: "IN_PROGRESS",
          questionOrder: ["q1"],
          expiresAt: null,
        }),
      },
      assessmentResult: {
        create: resultCreate,
      },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback({
        assessmentAttempt: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        assessmentResult: { create: resultCreate },
      })),
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
