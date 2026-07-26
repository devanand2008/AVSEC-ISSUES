import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import type { AuthPrincipal } from "../src/common/http/request-context";
import { QrService } from "../src/modules/qr/qr.service";

const roomToken = "11111111-1111-4111-8111-111111111111";
const feedbackToken = "FB_abcdefghijklmnopqrstuvwxyz123456";
const genericToken = "QR_abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG";

function principal(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    id: "user-1",
    publicId: "public-user-1",
    collegeId: "college-1",
    fullName: "Student User",
    email: null,
    roles: ["STUDENT"],
    permissions: ["issues.create", "feedback.scan"],
    status: "ACTIVE",
    mustChangePassword: false,
    firstLoginCompletedAt: new Date(),
    sessionId: "session-1",
    scopes: [],
    ...overrides,
  };
}

describe("QrService", () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    room: { findFirst: jest.fn(), count: jest.fn() },
    block: { findFirst: jest.fn() },
    floor: { findFirst: jest.fn() },
    section: { findFirst: jest.fn() },
    announcement: { findFirst: jest.fn() },
    qrCode: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    qrScanEvent: { create: jest.fn(), count: jest.fn() },
    feedbackQrCode: { findUnique: jest.fn(), count: jest.fn() },
    issue: { count: jest.fn() },
    auditLog: { count: jest.fn() },
    feedbackScanLog: { count: jest.fn() },
  };
  const service = new QrService(
    prisma as never,
    new ConfigService({ WEB_URL: "https://app.avs.example.edu" }),
    audit as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("validates an official room QR URL and returns a safe issue destination", async () => {
    prisma.room.findFirst.mockResolvedValue({
      id: "room-1",
      code: "CSE-201",
      name: "CSE 201",
      roomNumber: "201",
      roomType: "CLASSROOM",
      department: { id: "dept-1", code: "CSE", name: "Computer Science" },
      floor: {
        id: "floor-1",
        code: "F2",
        name: "Second Floor",
        level: 2,
        block: {
          id: "block-1",
          code: "CSE",
          name: "CSE Block",
          campus: { id: "campus-1", code: "MAIN", name: "Main Campus" },
        },
      },
    });

    const result = await service.validate(
      principal(),
      `https://app.avs.example.edu/report-issue?roomToken=${roomToken}`,
      { requestId: "request-1" },
      "CAMERA",
    );

    expect(result).toMatchObject({
      valid: true,
      qrType: "ROOM",
      destination: `/report-issue?roomToken=${roomToken}&source=qr`,
      context: { roomCode: "CSE-201", blockCode: "CSE" },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "qr.room_validated" }));
  });

  it("rejects external destinations before any database lookup", async () => {
    await expect(
      service.validate(
        principal(),
        "https://evil.example/redirect?next=/report-issue",
        { requestId: "request-2" },
        "IMAGE",
      ),
    ).rejects.toThrow("External QR destinations are not allowed");
    expect(prisma.room.findFirst).not.toHaveBeenCalled();
    expect(prisma.feedbackQrCode.findUnique).not.toHaveBeenCalled();
  });

  it("validates feedback QR tokens without returning private staff details", async () => {
    prisma.feedbackQrCode.findUnique.mockResolvedValue({
      id: "qr-1",
      qrUuid: "qr-public-1",
      status: "ACTIVE",
      expiryDate: null,
      target: {
        targetUuid: "target-public-1",
        targetName: "Faculty Feedback",
        targetType: "STAFF",
        collegeId: "college-1",
        isActive: true,
        department: { code: "CSE", name: "Computer Science" },
        room: null,
        staff: { publicId: "staff-public-1", fullName: "Asha Nair" },
      },
    });

    const result = await service.validate(principal(), feedbackToken, { requestId: "request-3" }, "MANUAL");

    expect(result).toMatchObject({
      valid: true,
      qrType: "STAFF_FEEDBACK",
      destination: `/student/feedback/target/${feedbackToken}`,
      context: {
        targetName: "Faculty Feedback",
        staff: { id: "staff-public-1", fullName: "Asha Nair" },
      },
    });
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("validates generic block QR tokens and records successful scan analytics", async () => {
    prisma.qrCode.findUnique.mockResolvedValue({
      id: "qr-1",
      publicId: "qr-public-1",
      collegeId: "college-1",
      qrType: "BLOCK",
      label: "CSE Block issue QR",
      destination: `/report-issue?qrToken=${genericToken}&source=qr`,
      entityType: "Block",
      entityId: "block-1",
      metadata: { labelSize: "A6" },
      status: "ACTIVE",
      expiryDate: null,
    });
    prisma.block.findFirst.mockResolvedValue({
      id: "block-1",
      code: "CSE",
      name: "CSE Block",
      campus: { id: "campus-1", code: "MAIN", name: "Main Campus" },
    });
    prisma.qrCode.update.mockResolvedValue({});
    prisma.qrScanEvent.create.mockResolvedValue({});

    const result = await service.validate(
      principal(),
      `https://app.avs.example.edu/qr/scan/${genericToken}`,
      { requestId: "request-4", ipAddress: "127.0.0.1", userAgent: "Jest" },
      "CAMERA",
    );

    expect(prisma.qrCode.findUnique).toHaveBeenCalledWith({
      where: { secureTokenHash: createHash("sha256").update(genericToken).digest("hex") },
      select: expect.any(Object),
    });
    expect(result).toMatchObject({
      valid: true,
      qrType: "BLOCK",
      label: "CSE Block issue QR",
      context: {
        qrId: "qr-public-1",
        blockId: "block-1",
        campusId: "campus-1",
        metadata: { labelSize: "A6" },
      },
    });
    expect(prisma.qrCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "qr-1" },
        data: expect.objectContaining({ scanCount: { increment: 1 } }),
      }),
    );
    expect(prisma.qrScanEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ successStatus: true, scanMethod: "CAMERA" }),
      }),
    );
  });

  it("accepts generated QR scan URLs from configured app origins", async () => {
    const configuredService = new QrService(
      prisma as never,
      new ConfigService({
        WEB_URL: "http://localhost:3000",
        CORS_ALLOWED_ORIGINS: "https://portal.avs.example.edu",
      }),
      audit as never,
    );
    prisma.qrCode.findUnique.mockResolvedValue({
      id: "qr-app-1",
      publicId: "qr-public-app-1",
      collegeId: "college-1",
      qrType: "APPLICATION",
      label: "AVS app entry",
      destination: "/",
      entityType: null,
      entityId: null,
      metadata: null,
      status: "ACTIVE",
      expiryDate: null,
    });
    prisma.qrCode.update.mockResolvedValue({});
    prisma.qrScanEvent.create.mockResolvedValue({});

    const result = await configuredService.validate(
      principal(),
      `https://portal.avs.example.edu/qr/scan/${genericToken}`,
      { requestId: "request-configured-origin" },
      "CAMERA",
    );

    expect(result).toMatchObject({
      valid: true,
      qrType: "APPLICATION",
      destination: "/",
    });
  });

  it("generates app QR images that point to the configured local web app", async () => {
    const configuredService = new QrService(
      prisma as never,
      new ConfigService({ WEB_URL: "http://localhost:3000" }),
      audit as never,
    );
    prisma.qrCode.create.mockResolvedValue({
      id: "qr-created-1",
      publicId: "qr-public-created-1",
      qrType: "APPLICATION",
      label: "Open AVS app",
      destination: "/",
      status: "ACTIVE",
      expiryDate: null,
      qrUrl: `http://localhost:3000/scan-qr?token=${genericToken}`,
    });

    const result = await configuredService.createCode(
      principal({ permissions: ["settings.manage"] }),
      { qrType: "APPLICATION", label: "Open AVS app" },
      { requestId: "request-create" },
    );

    expect(result.secureUrl).toBe(`http://localhost:3000/scan-qr?token=${genericToken}`);
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
  }, 20_000);

  it("rejects revoked generic QR tokens and records failed scan analytics", async () => {
    prisma.qrCode.findUnique.mockResolvedValue({
      id: "qr-2",
      publicId: "qr-public-2",
      collegeId: "college-1",
      qrType: "FLOOR",
      label: "Revoked floor QR",
      destination: `/report-issue?qrToken=${genericToken}&source=qr`,
      entityType: "Floor",
      entityId: "floor-1",
      metadata: null,
      status: "REVOKED",
      expiryDate: null,
    });
    prisma.qrScanEvent.create.mockResolvedValue({});

    await expect(
      service.validate(
        principal(),
        genericToken,
        { requestId: "request-5", ipAddress: "127.0.0.1" },
        "MANUAL",
      ),
    ).rejects.toThrow("This QR code is revoked");

    expect(prisma.qrScanEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ successStatus: false, failureReason: "This QR code is revoked." }),
      }),
    );
  });

  it("summarizes room and feedback QR analytics for QR-capable admins", async () => {
    prisma.room.count.mockResolvedValue(12);
    prisma.feedbackQrCode.count.mockResolvedValue(7);
    prisma.qrCode.count.mockResolvedValue(4);
    prisma.issue.count.mockResolvedValue(3);
    prisma.auditLog.count.mockResolvedValueOnce(4).mockResolvedValueOnce(5);
    prisma.feedbackScanLog.count.mockResolvedValueOnce(6).mockResolvedValueOnce(1);
    prisma.qrScanEvent.count.mockResolvedValueOnce(8).mockResolvedValueOnce(2);

    const result = await service.analytics(
      principal({
        roles: ["MAIN_ADMIN"],
        permissions: ["locations.qr"],
      }),
    );

    expect(result).toMatchObject({
      windowDays: 30,
      activeRoomQrCodes: 12,
      activeFeedbackQrCodes: 7,
      activeGenericQrCodes: 4,
      roomQrIssueReports: 3,
      roomQrValidations: 4,
      feedbackQrValidations: 5,
      feedbackQrScans: 6,
      feedbackQrFailures: 1,
      genericQrScans: 8,
      genericQrFailures: 2,
    });
    expect(prisma.issue.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ submissionSource: "QR_SCAN" }),
      }),
    );
  });
});
