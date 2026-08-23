import { BadRequestException } from "@nestjs/common";
import type { AuthPrincipal } from "../src/common/http/request-context";
import { AccessService } from "../src/common/access/access.service";
import { AiController } from "../src/modules/ai/ai.controller";
import { attendanceCredit, attendanceParts } from "../src/modules/attendance/attendance-value";
import { AttendanceService } from "../src/modules/attendance/attendance.service";
import { BroadcastService } from "../src/modules/conversations/broadcast.service";
import { RealtimeGateway } from "../src/modules/conversations/realtime.gateway";
import { LearnService } from "../src/modules/learn/learn.service";
import { LocationsService } from "../src/modules/locations/locations.service";

function principal(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    publicId: "00000000-0000-4000-8000-000000000002",
    collegeId: "00000000-0000-4000-8000-000000000003",
    fullName: "AVS User",
    email: "user@avs.edu.in",
    status: "ACTIVE",
    mustChangePassword: false,
    sessionId: "00000000-0000-4000-8000-000000000004",
    roles: ["STUDENT"],
    permissions: [],
    scopes: [],
    ...overrides,
  };
}

describe("reported production fixes", () => {
  describe("half-day attendance and analytics", () => {
    it.each([
      ["PRESENT", 1, null, null],
      ["ABSENT", 0, null, null],
      ["HALF_DAY_PRESENT", 0.5, "PRESENT", "ABSENT"],
      ["HALF_DAY_ABSENT", 0.5, "ABSENT", "PRESENT"],
    ])("maps %s to an auditable attendance value", (status, value, morning, afternoon) => {
      const parts = attendanceParts(status as never);
      expect(parts).toEqual({
        morningStatus: morning,
        afternoonStatus: afternoon,
        effectiveAttendanceValue: value,
      });
      expect(attendanceCredit({ status, effectiveAttendanceValue: value })).toBe(value);
    });

    it("rejects incomplete morning/afternoon pairs", () => {
      expect(() => attendanceParts("HALF_DAY_PRESENT" as never, "PRESENT" as never)).toThrow(
        "Morning and afternoon attendance must be supplied together.",
      );
    });

    it("counts either half-day direction as one-half attendance", () => {
      expect(attendanceParts("HALF_DAY_PRESENT" as never, "ABSENT" as never, "PRESENT" as never)).toEqual({
        morningStatus: "ABSENT",
        afternoonStatus: "PRESENT",
        effectiveAttendanceValue: 0.5,
      });
      expect(() => attendanceParts("HALF_DAY_PRESENT" as never, "PRESENT" as never, "PRESENT" as never)).toThrow(
        "Half-day attendance must contain one present part and one absent part.",
      );
    });

    it("creates a typed class session with its time window", async () => {
      const create = jest.fn().mockResolvedValue({ id: "session-1", sessionType: "LAB" });
      const prisma = {
        subject: { findFirst: jest.fn().mockResolvedValue({ id: "subject-1", semester: { programme: { college: { timezone: "Asia/Kolkata" } } } }) },
        attendanceSession: { create },
      };
      const service = new AttendanceService(prisma as never, {} as never, { isCollegeWide: jest.fn().mockReturnValue(true) } as never, {} as never);
      const result = await service.createSession(principal({ permissions: ["attendance.read_college"] }), {
        academicYearId: "00000000-0000-4000-8000-000000000010",
        sectionId: "00000000-0000-4000-8000-000000000011",
        subjectId: "00000000-0000-4000-8000-000000000012",
        sessionDate: "2026-08-03",
        periodNumber: 2,
        sessionType: "LAB" as never,
        startTime: "10:00",
        endTime: "11:40",
      });
      expect(result).toEqual({ id: "session-1", sessionType: "LAB" });
      expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
        sessionType: "LAB",
        startsAt: new Date("2026-08-03T10:00:00+05:30"),
        endsAt: new Date("2026-08-03T11:40:00+05:30"),
      }) });
    });

    it("approves a correction with half-day fields and immutable history", async () => {
      const tx = {
        attendanceCorrectionRequest: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "correction-1", status: "APPROVED" }),
        },
        attendanceRecord: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        attendanceChangeHistory: { create: jest.fn().mockResolvedValue({}) },
      };
      const prisma = {
        attendanceCorrectionRequest: { findFirst: jest.fn().mockResolvedValue({
          id: "correction-1",
          recordId: "record-1",
          requestedById: "requester-1",
          requestedStatus: "HALF_DAY_PRESENT",
          reason: "Student left after the morning class.",
          record: { id: "record-1", status: "PRESENT", version: 1, note: null },
          session: { id: "session-1" },
        }) },
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      };
      const service = new AttendanceService(prisma as never, {} as never, { isCollegeWide: jest.fn().mockReturnValue(true) } as never, {} as never);
      const reviewer = principal({ id: "reviewer-1", permissions: ["attendance.correction.approve", "attendance.read_college"] });
      await expect(service.reviewCorrection(reviewer, "correction-1", true, { comment: "Approved" }, "request-1")).resolves.toEqual({ id: "correction-1", status: "APPROVED" });
      expect(tx.attendanceRecord.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
        status: "HALF_DAY_PRESENT",
        morningStatus: "PRESENT",
        afternoonStatus: "ABSENT",
        effectiveAttendanceValue: 0.5,
        correctionReason: "Student left after the morning class.",
        correctedById: "reviewer-1",
      }) }));
      expect(tx.attendanceChangeHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        previousStatus: "PRESENT",
        newStatus: "HALF_DAY_PRESENT",
        previousMorningStatus: undefined,
        previousAfternoonStatus: undefined,
        previousEffectiveAttendanceValue: undefined,
        newEffectiveAttendanceValue: 0.5,
        reason: "Student left after the morning class.",
      }) });
    });

    it("rejecting a correction preserves the attendance record", async () => {
      const tx = {
        attendanceCorrectionRequest: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "correction-1", status: "REJECTED" }) },
        attendanceRecord: { updateMany: jest.fn() },
        attendanceChangeHistory: { create: jest.fn() },
      };
      const prisma = {
        attendanceCorrectionRequest: { findFirst: jest.fn().mockResolvedValue({ id: "correction-1", recordId: "record-1", requestedById: "requester-1", requestedStatus: "ABSENT", reason: "Request", record: { id: "record-1", status: "PRESENT", version: 1, note: null }, session: { id: "session-1" } }) },
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      };
      const service = new AttendanceService(prisma as never, {} as never, { isCollegeWide: jest.fn().mockReturnValue(true) } as never, {} as never);
      await service.reviewCorrection(principal({ id: "reviewer-1", permissions: ["attendance.correction.approve", "attendance.read_college"] }), "correction-1", false, { comment: "Not supported" }, "request-2");
      expect(tx.attendanceRecord.updateMany).not.toHaveBeenCalled();
      expect(tx.attendanceChangeHistory.create).not.toHaveBeenCalled();
    });

    it("opens a correction from the standalone record-based API contract", async () => {
      const prisma = {
        attendanceRecord: { findFirst: jest.fn().mockResolvedValue({ sessionId: "session-1" }) },
      };
      const service = new AttendanceService(prisma as never, {} as never, {} as never, {} as never);
      (service as unknown as { sessionWhere: () => Promise<object> }).sessionWhere = jest.fn().mockResolvedValue({ id: "session-1" });
      const request = jest.fn().mockResolvedValue({ id: "correction-1", status: "PENDING" });
      service.requestCorrection = request;
      const input = { recordId: "00000000-0000-4000-8000-000000000090", requestedStatus: "HALF_DAY_PRESENT" as never, reason: "Approved half-day leave." };
      await expect(service.requestCorrectionForRecord(principal(), input)).resolves.toEqual({ id: "correction-1", status: "PENDING" });
      expect(prisma.attendanceRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: input.recordId, session: { id: "session-1" } },
      }));
      expect(request).toHaveBeenCalledWith(expect.any(Object), "session-1", input);
    });
  });

  describe("issue assignment and area scoping", () => {
    it("treats direct and active-team assignments as assigned work", () => {
      const where = new AccessService().assignedIssueWhere(principal());
      expect(where).toEqual(expect.objectContaining({
        collegeId: "00000000-0000-4000-8000-000000000003",
        archivedAt: null,
        OR: expect.arrayContaining([
          { assignedToId: "00000000-0000-4000-8000-000000000001" },
          { team: { members: { some: { userId: "00000000-0000-4000-8000-000000000001", isActive: true } } } },
        ]),
      }));
    });

    it("includes issues matching a staff member's category and location mappings", () => {
      const where = new AccessService().assignedIssueWhere(principal({
        scopes: [
          { type: "FLOOR", id: "00000000-0000-4000-8000-000000000091", issueCategoryId: null },
          { type: "ISSUE_CATEGORY", id: null, issueCategoryId: "00000000-0000-4000-8000-000000000092" },
        ],
      }));
      expect(where.OR).toEqual(expect.arrayContaining([
        { AND: [
          { OR: [{ floorId: "00000000-0000-4000-8000-000000000091" }] },
          { OR: [{ categoryId: "00000000-0000-4000-8000-000000000092" }] },
        ] },
      ]));
    });

    it("honors an AREA permission scope", () => {
      const where = new AccessService().issueWhere(principal({
        permissions: ["issues.read_scope"],
        scopes: [{ type: "AREA", id: "00000000-0000-4000-8000-000000000099", issueCategoryId: null }],
      }));
      expect(JSON.stringify(where)).toContain('"areaId":"00000000-0000-4000-8000-000000000099"');
    });
  });

  describe("location and asset APIs", () => {
    it("loads active floors only after validating the selected block and college", async () => {
      const findMany = jest.fn().mockResolvedValue([{ id: "floor-1", name: "First Floor" }]);
      const prisma = {
        block: { findFirst: jest.fn().mockResolvedValue({ id: "block-1" }) },
        floor: { findMany },
      };
      const service = new LocationsService(prisma as never, {} as never, {} as never, {} as never);
      await expect(service.floors(principal(), "block-1")).resolves.toEqual([{ id: "floor-1", name: "First Floor" }]);
      expect(prisma.block.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: "block-1", isActive: true, archivedAt: null, campus: expect.objectContaining({ collegeId: principal().collegeId }) }),
      }));
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ blockId: "block-1", isActive: true, archivedAt: null }) }));
    });

    it("loads only active areas from the caller's college hierarchy", async () => {
      const findMany = jest.fn().mockResolvedValue([{ id: "area-1", name: "Corridor" }]);
      const floorFindFirst = jest.fn().mockResolvedValue({ id: "floor-1" });
      const service = new LocationsService({ floor: { findFirst: floorFindFirst }, area: { findMany } } as never, {} as never, {} as never, {} as never);
      await expect(service.areas(principal(), "floor-1")).resolves.toEqual([{ id: "area-1", name: "Corridor" }]);
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          floorId: "floor-1",
          isActive: true,
          archivedAt: null,
          floor: expect.objectContaining({ block: expect.objectContaining({ campus: expect.objectContaining({ collegeId: principal().collegeId }) }) }),
        }),
      }));
      expect(floorFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: "floor-1", isActive: true, archivedAt: null }),
      }));
    });

    it("requires exactly one location when querying registered assets", async () => {
      const service = new LocationsService({ asset: { findMany: jest.fn() } } as never, {} as never, {} as never, {} as never);
      await expect(service.assets(principal(), {})).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.assets(principal(), { roomId: "room-1", areaId: "area-1" })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("standard AVS Bot completion", () => {
    it("collects streamed deltas into the persisted response contract", async () => {
      const chat = {
        async *chat() {
          yield { event: "conversation", data: { id: "conversation-1" } };
          yield { event: "delta", data: { delta: "Hello " } };
          yield { event: "delta", data: { delta: "AVS" } };
          yield { event: "done", data: { messageId: "message-1", status: "COMPLETED" } };
        },
      };
      const controller = new AiController(chat as never);
      const result = await controller.complete(
        { user: principal(), id: "request-1" } as never,
        { message: "Hello", clientRequestId: "request-client-1" } as never,
      );
      expect(result).toEqual({
        conversationId: "conversation-1",
        messageId: "message-1",
        role: "ASSISTANT",
        content: "Hello AVS",
        status: "COMPLETED",
      });
    });
  });

  describe("Learn subjects and certificates", () => {
    it("returns database subjects with matched scoped courses", async () => {
      const subject = {
        id: "subject-1",
        code: "CS101",
        name: "Programming",
        semester: {
          programmeId: "programme-1",
          programme: { departmentId: "department-1" },
        },
        facultyAssignments: [],
      };
      const course = {
        id: "course-1",
        code: "CS101-LAB",
        title: "Programming Laboratory",
        departmentId: "department-1",
        programmeId: "programme-1",
        modules: [],
        _count: { modules: 0, resources: 2, assessments: 1, studentProgress: 0 },
      };
      const prisma = {
        subject: { findMany: jest.fn().mockResolvedValue([subject]) },
        course: { findMany: jest.fn().mockResolvedValue([course]) },
      };
      const service = new LearnService(prisma as never);
      const result = await service.getSubjects(principal({ roles: ["FACULTY"] }));
      expect(result[0]).toEqual(expect.objectContaining({ id: "subject-1", availableCourses: [expect.objectContaining({ id: "course-1" })] }));
      expect(prisma.subject.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ semester: expect.any(Object), facultyAssignments: expect.any(Object) }),
      }));
    });

    it("verifies a certificate by its public number", async () => {
      const issuedAt = new Date("2026-08-03T00:00:00.000Z");
      const prisma = {
        learningCertificate: { findUnique: jest.fn().mockResolvedValue({ certificateNumber: "AVSL-2026-ABC", studentId: "student-1", score: 92, issuedAt, course: { code: "CS101", title: "Programming", college: { name: "AVS Engineering College" } } }) },
        user: { findUnique: jest.fn().mockResolvedValue({ fullName: "Student Name" }) },
      };
      const service = new LearnService(prisma as never);
      await expect(service.verifyCertificate("AVSL-2026-ABC")).resolves.toEqual(expect.objectContaining({
        valid: true,
        studentName: "Student Name",
        certificateNumber: "AVSL-2026-ABC",
      }));
    });

    it("renders a landscape PDF using the official AVS campus image and verification URL", async () => {
      const issuedAt = new Date("2026-08-03T00:00:00.000Z");
      const prisma = {
        learningCertificate: { findFirst: jest.fn().mockResolvedValue({ certificateNumber: "AVSL-2026-PDF", score: 88, issuedAt, course: { code: "CS101", title: "Programming" } }) },
        college: { findUnique: jest.fn().mockResolvedValue({ name: "AVS Engineering College" }) },
      };
      const service = new LearnService(prisma as never, { get: jest.fn((_key: string, fallback: string) => fallback) } as never);
      const image = jest.fn().mockResolvedValue(null);
      (service as unknown as { certificateImage: typeof image }).certificateImage = image;
      const pdf = await service.downloadCertificate(principal({ fullName: "Student Name" }), "certificate-id");
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(2_000);
      expect(image).toHaveBeenCalledWith("https://avsenggcollege.ac.in/NewsEvents/uploads/hero/01-campus-life.jpg");
    }, 20_000);
  });

  describe("broadcast recipient discovery", () => {
    it("applies tenant-safe server search, role filters and pagination", async () => {
      const findMany = jest.fn().mockResolvedValue([{
        id: "user-1",
        publicId: "public-1",
        collegeIdentityId: "AVS001",
        fullName: "Recipient One",
        email: "recipient@college.test",
        roles: [{ role: { code: "STUDENT", name: "Student" } }],
        studentProfile: { department: { id: "department-1", name: "CSE" }, section: { id: "section-1", code: "A", name: "A" } },
        staffProfile: null,
      }]);
      const prisma = {
        user: { findMany, count: jest.fn().mockResolvedValue(1) },
        $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
      };
      const service = new BroadcastService(prisma as never, {} as never);
      const result = await service.recipients(principal(), { page: 2, pageSize: 10, search: "Recipient", role: "STUDENT", departmentId: "department-1", sectionId: "section-1" });
      expect(result).toEqual(expect.objectContaining({
        items: [expect.objectContaining({ id: "user-1", name: "Recipient One", officialEmail: "recipient@college.test", roles: [{ code: "STUDENT", name: "Student" }] })],
        meta: { page: 2, pageSize: 10, total: 1, pageCount: 1 },
      }));
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
      expect(JSON.stringify(findMany.mock.calls[0][0].where)).toContain(principal().collegeId);
      expect(JSON.stringify(findMany.mock.calls[0][0].where)).toContain("STUDENT");
      expect(JSON.stringify(findMany.mock.calls[0][0].where)).toContain("department-1");
      expect(JSON.stringify(findMany.mock.calls[0][0].where)).toContain("section-1");
      expect(JSON.stringify(findMany.mock.calls[0][0].where)).toContain('"archivedAt":null');
    });

    it("persists selected recipients separately instead of overflowing audienceValue", async () => {
      const recipientOne = "00000000-0000-4000-8000-000000000101";
      const recipientTwo = "00000000-0000-4000-8000-000000000102";
      const tx = {
        broadcast: { create: jest.fn().mockResolvedValue({ id: "broadcast-1", title: "Notice", audienceType: "INDIVIDUAL", audienceValue: null }) },
        broadcastRecipient: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      };
      const prisma = {
        user: { findMany: jest.fn().mockResolvedValue([{ id: recipientOne }, { id: recipientTwo }]) },
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      };
      const audit = { record: jest.fn().mockResolvedValue(undefined) };
      const service = new BroadcastService(prisma as never, audit as never);
      await service.create(principal({ permissions: ["broadcasts.create"] }), {
        title: "Notice",
        body: "This is a persisted test broadcast.",
        audienceType: "INDIVIDUAL",
        recipientIds: [recipientOne, recipientTwo],
      }, "request-broadcast-create");
      expect(tx.broadcast.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ audienceValue: null }) }));
      expect(tx.broadcastRecipient.createMany).toHaveBeenCalledWith(expect.objectContaining({
        data: [{ broadcastId: "broadcast-1", userId: recipientOne }, { broadcastId: "broadcast-1", userId: recipientTwo }],
      }));
    });

    it("creates an in-app notification before marking a selected broadcast delivered", async () => {
      const recipientId = "00000000-0000-4000-8000-000000000101";
      const tx = {
        broadcast: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({ id: "broadcast-1", status: "SENT", deliveredCount: 1 }),
        },
        broadcastRecipient: { createMany: jest.fn().mockResolvedValue({ count: 0 }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        notification: { create: jest.fn().mockResolvedValue({ id: "notification-1" }) },
        outboxEvent: { create: jest.fn().mockResolvedValue({ id: "outbox-1" }) },
      };
      const prisma = {
        broadcast: { findFirst: jest.fn().mockResolvedValue({ id: "broadcast-1", collegeId: principal().collegeId, title: "Notice", body: "Body", status: "DRAFT", audienceType: "INDIVIDUAL", audienceValue: null }) },
        broadcastRecipient: { findMany: jest.fn().mockResolvedValue([{ userId: recipientId }]) },
        user: { findMany: jest.fn().mockResolvedValue([{ id: recipientId }]) },
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      };
      const audit = { record: jest.fn().mockResolvedValue(undefined) };
      const service = new BroadcastService(prisma as never, audit as never);
      await expect(service.send(principal({ permissions: ["broadcasts.send"] }), "broadcast-1", "request-broadcast-send")).resolves.toEqual(expect.objectContaining({ status: "SENT" }));
      expect(tx.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        type: "BROADCAST",
        recipients: { create: [{ userId: recipientId }] },
      }) });
      expect(tx.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ eventType: "broadcast.sent", payload: expect.objectContaining({ notificationId: "notification-1" }) }) });
      expect(tx.broadcast.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT", deliveredCount: 1 }) }));
    });
  });

  describe("messenger reconnect delivery", () => {
    it("joins every active conversation and marks queued delivery after authentication", async () => {
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: "user-1" }) },
        conversationParticipant: { findMany: jest.fn().mockResolvedValue([{ conversationId: "conversation-1" }, { conversationId: "conversation-2" }]) },
        messageDelivery: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
        userPresence: { upsert: jest.fn().mockResolvedValue({}) },
      };
      const gateway = new RealtimeGateway(
        { verifyAsync: jest.fn().mockResolvedValue({ sub: "user-1", sid: "session-1", typ: "access" }) } as never,
        { getOrThrow: jest.fn().mockReturnValue("secret") } as never,
        prisma as never,
      );
      const emit = jest.fn();
      gateway.server = { to: jest.fn(() => ({ emit })) } as never;
      const client = {
        handshake: { headers: {}, auth: { token: "access-token" } },
        data: {},
        join: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn(),
      };
      await gateway.handleConnection(client as never);
      expect(client.join.mock.calls.map(([room]) => room)).toEqual(expect.arrayContaining([
        "user:user-1",
        "conversation:conversation-1",
        "conversation:conversation-2",
      ]));
      expect(prisma.messageDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ userId: "user-1", status: { in: ["PENDING", "QUEUED", "SENT", "RETRYING"] } }),
        data: { status: "DELIVERED", lastError: null },
      }));
      expect(client.disconnect).not.toHaveBeenCalled();
    });
  });
});
