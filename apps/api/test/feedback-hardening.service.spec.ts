import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "../src/common/http/request-context";
import {
  FeedbackService,
  type FeedbackSubmissionTicketClaims,
  signFeedbackSubmissionTicket,
  verifyFeedbackSubmissionTicket,
} from "../src/modules/feedback/feedback.service";

const ids = {
  user: "00000000-0000-0000-0000-000000000001",
  publicUser: "00000000-0000-0000-0000-000000000002",
  college: "00000000-0000-0000-0000-000000000003",
  session: "00000000-0000-0000-0000-000000000004",
  target: "00000000-0000-0000-0000-000000000005",
  targetUuid: "00000000-0000-0000-0000-000000000006",
  otherTargetUuid: "00000000-0000-0000-0000-000000000007",
  qr: "00000000-0000-0000-0000-000000000008",
  department: "00000000-0000-0000-0000-000000000009",
  otherDepartment: "00000000-0000-0000-0000-000000000010",
  semester: "00000000-0000-0000-0000-000000000011",
  academicYear: "00000000-0000-0000-0000-000000000012",
  cycle: "00000000-0000-0000-0000-000000000013",
  questionOne: "00000000-0000-0000-0000-000000000014",
  questionTwo: "00000000-0000-0000-0000-000000000015",
  submission: "00000000-0000-0000-0000-000000000016",
  assignee: "00000000-0000-0000-0000-000000000017",
};

const secret = "feedback-test-secret-with-at-least-32-characters";

const student: AuthPrincipal = {
  id: ids.user,
  publicId: ids.publicUser,
  collegeId: ids.college,
  fullName: "Student",
  email: null,
  status: "ACTIVE",
  mustChangePassword: false,
  sessionId: ids.session,
  roles: ["STUDENT"],
  permissions: ["feedback.scan", "feedback.submit", "feedback.read_own"],
  scopes: [],
};

function ticketClaims(overrides: Partial<FeedbackSubmissionTicketClaims> = {}): FeedbackSubmissionTicketClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    version: 1,
    purpose: "feedback-submit",
    userId: ids.user,
    collegeId: ids.college,
    targetId: ids.target,
    targetUuid: ids.targetUuid,
    qrCodeId: null,
    issuedAt: now,
    expiresAt: now + 600,
    nonce: "test-nonce-1234567890",
    ...overrides,
  };
}

function feedbackTarget(staffStatus = "ACTIVE") {
  return {
    id: ids.target,
    targetUuid: ids.targetUuid,
    collegeId: ids.college,
    targetType: "STAFF" as const,
    targetName: "Dr. Feedback",
    description: null,
    serviceCode: null,
    isActive: true,
    departmentId: ids.department,
    staff: {
      publicId: "00000000-0000-0000-0000-000000000019",
      collegeIdentityId: "FAC-001",
      fullName: "Dr. Feedback",
      profilePhotoKey: null,
      status: staffStatus,
      staffProfile: { employeeId: "EMP-001", designation: "Faculty", department: { id: ids.department, code: "CSE", name: "Computer Science" } },
      roles: [{ role: { code: "FACULTY" } }],
    },
    department: { id: ids.department, code: "CSE", name: "Computer Science" },
    campus: null,
    block: null,
    floor: null,
    room: null,
  };
}

function setup() {
  const tx = {
    feedbackSubmission: { create: jest.fn(), update: jest.fn() },
    feedbackQrCode: { update: jest.fn() },
    feedbackAction: { create: jest.fn() },
    notification: { create: jest.fn() },
    outboxEvent: { create: jest.fn() },
  };
  const prisma = {
    studentProfile: { findUnique: jest.fn() },
    staffProfile: { findUnique: jest.fn() },
    feedbackTarget: { findFirst: jest.fn(), findMany: jest.fn() },
    feedbackQrCode: { findFirst: jest.fn() },
    feedbackQuestion: { findMany: jest.fn() },
    feedbackCycle: { findMany: jest.fn() },
    feedbackSubmission: { findFirst: jest.fn(), findMany: jest.fn() },
    appSetting: { findUnique: jest.fn() },
    college: { findUnique: jest.fn() },
    user: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    department: { findFirst: jest.fn() },
    academicYear: { findFirst: jest.fn() },
    semester: { findFirst: jest.fn() },
    $transaction: jest.fn(async (operation: unknown) => {
      if (typeof operation === "function") {
        return (operation as (client: typeof tx) => Promise<unknown>)(tx);
      }
      return Promise.all(operation as Promise<unknown>[]);
    }),
  };
  const config = {
    get: jest.fn((key: string, fallback?: string) => key === "CSRF_SECRET" ? secret : fallback),
  };
  const access = { isCollegeWide: jest.fn(() => false) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new FeedbackService(prisma as never, config as never, access as never, audit as never);
  return { service, prisma, tx, access, audit };
}

function prepareSubmission(setupResult: ReturnType<typeof setup>) {
  const { prisma, tx } = setupResult;
  prisma.studentProfile.findUnique.mockResolvedValue({
    id: ids.user,
    section: { semesterId: ids.semester, semester: { academicYearId: ids.academicYear } },
  });
  prisma.feedbackTarget.findFirst.mockResolvedValue(feedbackTarget());
  prisma.feedbackQuestion.findMany.mockResolvedValue([
    { id: ids.questionOne, category: "Teaching", questionText: "Teaching quality", questionType: "RATING", displayOrder: 1, isRequired: true },
    { id: ids.questionTwo, category: "Support", questionText: "Student support", questionType: "RATING", displayOrder: 2, isRequired: true },
  ]);
  prisma.appSetting.findUnique.mockResolvedValue({
    value: {
      defaultSubmissionRule: "ONCE_PER_DAY",
      anonymousMode: true,
      commentsRequired: true,
      staffCanViewComments: false,
      studentIdentityVisibleToManagement: false,
      negativeFeedbackRequiresInvestigation: true,
    },
  });
  prisma.feedbackCycle.findMany.mockResolvedValue([{
    id: ids.cycle,
    semesterId: ids.semester,
    academicYearId: ids.academicYear,
    startDate: new Date("2026-07-01T00:00:00.000Z"),
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    submissionRule: "ONCE_PER_CYCLE",
    anonymousMode: false,
    commentsRequired: false,
    staffCanViewComments: true,
    studentIdentityVisibleToManagement: true,
    negativeFeedbackRequiresInvestigation: false,
  }]);
  tx.feedbackSubmission.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: ids.submission,
    referenceNumber: data.referenceNumber as string,
    status: data.status as string,
    priority: data.priority as string,
    submittedAt: new Date("2026-07-19T10:00:00.000Z"),
  }));
}

describe("feedback submission tickets", () => {
  it("verifies a valid user, college and target-bound signed ticket", () => {
    const claims = ticketClaims();
    const ticket = signFeedbackSubmissionTicket(claims, secret);
    expect(verifyFeedbackSubmissionTicket(ticket, secret, claims.issuedAt + 1)).toEqual(claims);
  });

  it("rejects expired and tampered tickets", () => {
    const claims = ticketClaims({ issuedAt: 100, expiresAt: 200 });
    const ticket = signFeedbackSubmissionTicket(claims, secret);
    const parts = ticket.split(".");
    const signature = parts[2] ?? "";
    const tampered = `${parts[0]}.${parts[1]}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
    expect(() => verifyFeedbackSubmissionTicket(ticket, secret, 200)).toThrow(/expired/i);
    expect(() => verifyFeedbackSubmissionTicket(tampered, secret, 150)).toThrow(/invalid/i);
  });

  it("rejects a ticket replayed against a different public target", async () => {
    const { service, prisma } = setup();
    prisma.studentProfile.findUnique.mockResolvedValue({
      id: ids.user,
      section: { semesterId: ids.semester, semester: { academicYearId: ids.academicYear } },
    });
    const submissionTicket = signFeedbackSubmissionTicket(ticketClaims(), secret);
    await expect(service.submit(student, {
      submissionTicket,
      targetId: ids.otherTargetUuid,
      ratings: [{ questionId: ids.questionOne, rating: 5 }],
    }, "request-1", {})).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.feedbackTarget.findFirst).not.toHaveBeenCalled();
  });
});
describe("FeedbackService submission hardening", () => {
  it("rejects a valid ticket when the linked staff account became inactive", async () => {
    const { service, prisma } = setup();
    prisma.studentProfile.findUnique.mockResolvedValue({
      id: ids.user,
      section: {
        semesterId: ids.semester,
        semester: { academicYearId: ids.academicYear },
      },
    });
    prisma.feedbackTarget.findFirst.mockResolvedValue(
      feedbackTarget("ARCHIVED"),
    );
    const submissionTicket = signFeedbackSubmissionTicket(
      ticketClaims(),
      secret,
    );

    await expect(
      service.submit(
        student,
        {
          submissionTicket,
          targetId: ids.targetUuid,
          ratings: [{ questionId: ids.questionOne, rating: 5 }],
        },
        "request-inactive-staff",
        {},
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.feedbackQuestion.findMany).not.toHaveBeenCalled();
  });

  it("rechecks QR status on submit so a disabled QR ticket cannot bypass revocation", async () => {
    const { service, prisma } = setup();
    prisma.studentProfile.findUnique.mockResolvedValue({
      id: ids.user,
      section: { semesterId: ids.semester, semester: { academicYearId: ids.academicYear } },
    });
    prisma.feedbackTarget.findFirst.mockResolvedValue(feedbackTarget());
    prisma.feedbackQrCode.findFirst.mockResolvedValue({ id: ids.qr, status: "DISABLED", expiryDate: null, target: { isActive: true } });
    const submissionTicket = signFeedbackSubmissionTicket(ticketClaims({ qrCodeId: ids.qr }), secret);

    await expect(service.submit(student, {
      submissionTicket,
      targetId: ids.targetUuid,
      ratings: [{ questionId: ids.questionOne, rating: 5 }],
    }, "request-2", {})).rejects.toThrow(/disabled/i);
    expect(prisma.feedbackQuestion.findMany).not.toHaveBeenCalled();
  });

  it("calculates overall rating server-side and applies the active cycle policy over global settings", async () => {
    const setupResult = setup();
    prepareSubmission(setupResult);
    const { service, tx } = setupResult;
    const submissionTicket = signFeedbackSubmissionTicket(ticketClaims(), secret);

    await expect(service.submit(student, {
      submissionTicket,
      targetId: ids.targetUuid,
      overallRating: 1,
      isAnonymous: true,
      ratings: [
        { questionId: ids.questionOne, rating: 5 },
        { questionId: ids.questionTwo, rating: 3 },
      ],
    }, "request-3", {})).resolves.toMatchObject({ status: "NEW", priority: "LOW" });

    expect(tx.feedbackSubmission.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        overallRating: 4,
        isAnonymous: false,
        feedbackCycleId: ids.cycle,
        submissionWindowKey: `CYCLE:${ids.cycle}`,
      }),
    }));
  });

  it("maps the atomic database uniqueness conflict to a useful duplicate response", async () => {
    const setupResult = setup();
    prepareSubmission(setupResult);
    const { service, prisma } = setupResult;
    prisma.$transaction.mockRejectedValueOnce({ code: "P2002" });
    prisma.feedbackSubmission.findFirst.mockResolvedValue({
      referenceNumber: "AVS-FB-20260719-ABC12345",
      submittedAt: new Date("2026-07-19T08:00:00.000Z"),
    });
    const submissionTicket = signFeedbackSubmissionTicket(ticketClaims(), secret);

    let caught: unknown;
    try {
      await service.submit(student, {
        submissionTicket,
        targetId: ids.targetUuid,
        ratings: [
          { questionId: ids.questionOne, rating: 5 },
          { questionId: ids.questionTwo, rating: 3 },
        ],
      }, "request-4", {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getResponse()).toMatchObject({
      referenceNumber: "AVS-FB-20260719-ABC12345",
      message: expect.stringMatching(/already submitted/i),
    });
  });

  it("creates a link-safe management alert payload without student identity", async () => {
    const setupResult = setup();
    prepareSubmission(setupResult);
    const { service, prisma, tx } = setupResult;
    prisma.feedbackCycle.findMany.mockResolvedValue([{
      id: ids.cycle,
      semesterId: ids.semester,
      academicYearId: ids.academicYear,
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      submissionRule: "ONCE_PER_CYCLE",
      anonymousMode: true,
      commentsRequired: false,
      staffCanViewComments: false,
      studentIdentityVisibleToManagement: false,
      negativeFeedbackRequiresInvestigation: true,
    }]);
    prisma.user.findMany.mockResolvedValue([{ id: ids.assignee }]);
    tx.notification.create.mockResolvedValue({ id: "00000000-0000-0000-0000-000000000018" });
    const submissionTicket = signFeedbackSubmissionTicket(ticketClaims(), secret);

    await service.submit(student, {
      submissionTicket,
      targetId: ids.targetUuid,
      ratings: [
        { questionId: ids.questionOne, rating: 1 },
        { questionId: ids.questionTwo, rating: 3 },
      ],
    }, "request-alert", {});

    expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        body: expect.stringContaining("Rating 2/5"),
        data: expect.objectContaining({
          submissionId: ids.submission,
          targetName: "Dr. Feedback",
          targetType: "STAFF",
          rating: 2,
          department: "Computer Science",
          dashboardPath: `/admin/feedback/submissions/${ids.submission}`,
        }),
      }),
    }));
    const notificationData = tx.notification.create.mock.calls[0]?.[0]?.data?.data;
    expect(JSON.stringify(notificationData)).not.toContain(ids.user);
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "feedback.submitted",
        payload: expect.objectContaining({ dashboardPath: `/admin/feedback/submissions/${ids.submission}` }),
      }),
    }));
  });
});

describe("FeedbackService management scope and export safety", () => {
  const hod: AuthPrincipal = {
    ...student,
    roles: ["HOD"],
    permissions: ["feedback.read_department", "feedback.actions.manage", "feedback.export"],
    scopes: [{ type: "DEPARTMENT", id: ids.department, issueCategoryId: null }],
  };

  it("scopes HOD target discovery to the assigned department", async () => {
    const { service, prisma } = setup();
    prisma.staffProfile.findUnique.mockResolvedValue({ departmentId: ids.department });
    prisma.feedbackTarget.findMany.mockResolvedValue([]);

    await service.targets(hod, {});

    const where = prisma.feedbackTarget.findMany.mock.calls[0]?.[0]?.where;
    expect(JSON.stringify(where)).toContain(ids.department);
    expect(JSON.stringify(where)).toContain("departmentId");
  });

  it("prevents an HOD from assigning feedback to a user in another department", async () => {
    const { service, prisma } = setup();
    prisma.staffProfile.findUnique.mockResolvedValue({ departmentId: ids.department });
    prisma.feedbackSubmission.findFirst.mockResolvedValue({
      id: ids.submission,
      status: "NEW",
      priority: "HIGH",
      target: { departmentId: ids.department },
    });
    prisma.user.findFirst.mockResolvedValue({ id: ids.assignee, staffProfile: { departmentId: ids.otherDepartment } });

    await expect(service.assignSubmission(hod, ids.submission, {
      assignedToPublicId: ids.assignee,
      actionNote: "Please investigate this report.",
    }, "request-5")).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("neutralizes spreadsheet formulas in every free-text CSV field", async () => {
    const { service, prisma, access } = setup();
    access.isCollegeWide.mockReturnValue(true);
    const admin: AuthPrincipal = {
      ...hod,
      roles: ["PRINCIPAL"],
      permissions: ["feedback.read_college", "feedback.export"],
      scopes: [{ type: "COLLEGE", id: ids.college, issueCategoryId: null }],
    };
    prisma.feedbackSubmission.findMany.mockResolvedValue([{
      referenceNumber: "=REFERENCE()",
      submittedAt: new Date("2026-07-19T10:00:00.000Z"),
      overallRating: 5,
      sentiment: "POSITIVE",
      status: "NEW",
      priority: "LOW",
      positiveComment: "+SUM(1,1)",
      improvementComment: "-2+3",
      generalComment: "@malicious",
      complaintText: "\tDDE payload",
      target: { ...feedbackTarget(), targetName: "=HYPERLINK(\"https://evil.example\")" },
      ratings: [{ rating: 5, question: { category: "@Category" } }],
    }]);

    const csv = (await service.exportCsv(admin, "request-6", {
      page: 1,
      pageSize: 20,
      sortBy: "submittedAt",
      sortOrder: "desc",
    })).toString("utf8");

    expect(csv).toContain("'=REFERENCE()");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+SUM(1,1)");
    expect(csv).toContain("'@malicious");
    expect(csv).toContain("'@Category:5");
  });

  it("applies HOD scope and filters identically to XLSX reports and audits the format", async () => {
    const { service, prisma, audit } = setup();
    prisma.staffProfile.findUnique.mockResolvedValue({ departmentId: ids.department });
    prisma.feedbackSubmission.findMany.mockResolvedValue([]);
    prisma.college.findUnique.mockResolvedValue({ name: "AVS Engineering College" });

    const output = await service.exportXlsx(hod, "request-xlsx", {
      page: 1,
      pageSize: 20,
      status: "ACTION_REQUIRED",
      rating: 2,
      sortBy: "overallRating",
      sortOrder: "asc",
    });

    expect(output.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4B, 0x03, 0x04]));
    const exportQuery = prisma.feedbackSubmission.findMany.mock.calls[0]?.[0];
    expect(JSON.stringify(exportQuery?.where)).toContain(ids.department);
    expect(exportQuery?.where).toMatchObject({ status: "ACTION_REQUIRED", overallRating: 2 });
    expect(exportQuery?.orderBy).toEqual({ overallRating: "asc" });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "feedback.exported",
      afterValue: expect.objectContaining({ format: "xlsx", rows: 0 }),
    }));
  });

  it("rejects non-rating question types before persistence", async () => {
    const { service, prisma } = setup();
    const questionAdmin: AuthPrincipal = { ...hod, permissions: ["feedback.questions.manage"] };
    await expect(service.createQuestion(questionAdmin, {
      targetType: "STAFF",
      category: "Written response",
      questionText: "Describe your experience",
      questionType: "TEXT",
    }, "request-7")).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.feedbackQuestion.findMany).not.toHaveBeenCalled();
  });
});
