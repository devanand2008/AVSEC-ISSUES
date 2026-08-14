import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import QRCode from "qrcode";
import type { AuthPrincipal } from "../src/common/http/request-context";
import { AdminFeedbackController } from "../src/modules/feedback/admin-feedback.controller";
import { FeedbackService } from "../src/modules/feedback/feedback.service";

const ids = {
  admin: "00000000-0000-0000-0000-000000000001",
  adminPublic: "00000000-0000-0000-0000-000000000002",
  college: "00000000-0000-0000-0000-000000000003",
  session: "00000000-0000-0000-0000-000000000004",
  staff: "00000000-0000-0000-0000-000000000005",
  staffPublic: "00000000-0000-0000-0000-000000000006",
  department: "00000000-0000-0000-0000-000000000007",
  target: "00000000-0000-0000-0000-000000000008",
  targetUuid: "00000000-0000-0000-0000-000000000009",
  duplicateTarget: "00000000-0000-0000-0000-000000000010",
  qr: "00000000-0000-0000-0000-000000000011",
  qrUuid: "00000000-0000-0000-0000-000000000012",
};
const storedToken = "FB_existing-secure-token-123456789";
const storedTokenHash = createHash("sha256").update(storedToken).digest("hex");

const admin: AuthPrincipal = {
  id: ids.admin,
  publicId: ids.adminPublic,
  collegeId: ids.college,
  fullName: "Main Admin",
  email: null,
  status: "ACTIVE",
  mustChangePassword: false,
  sessionId: ids.session,
  roles: ["MAIN_ADMIN"],
  permissions: [
    "feedback.qr.manage",
    "feedback.qr.download",
    "feedback.targets.manage",
  ],
  scopes: [{ type: "COLLEGE", id: ids.college, issueCategoryId: null }],
};

function eligibleStaff(roleCodes = ["FACULTY"]) {
  return {
    id: ids.staff,
    publicId: ids.staffPublic,
    collegeIdentityId: "FAC-001",
    fullName: "Dr. Faculty One",
    staffProfile: {
      employeeId: "EMP-001",
      designation: "Assistant Professor",
      departmentId: ids.department,
      department: {
        id: ids.department,
        code: "CSE",
        name: "Computer Science and Engineering",
      },
    },
    roles: roleCodes.map((code) => ({ role: { code } })),
  };
}

function targetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.target,
    targetUuid: ids.targetUuid,
    targetType: "STAFF",
    targetName: "Dr. Faculty One",
    description: "Assistant Professor",
    isActive: true,
    departmentId: ids.department,
    updatedAt: new Date("2026-08-14T00:00:00.000Z"),
    ...overrides,
  };
}

function qrRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.qr,
    qrUuid: ids.qrUuid,
    qrUrl: `https://college.example/feedback/scan/${storedToken}`,
    secureTokenHash: storedTokenHash,
    status: "ACTIVE",
    expiryDate: null,
    createdAt: new Date("2026-08-14T00:00:00.000Z"),
    ...overrides,
  };
}

function publicStaffTarget(status = "ACTIVE", roleCodes = ["FACULTY"]) {
  return {
    ...targetRow(),
    collegeId: ids.college,
    serviceCode: null,
    staff: {
      publicId: ids.staffPublic,
      collegeIdentityId: "FAC-001",
      fullName: "Dr. Faculty One",
      profilePhotoKey: null,
      status,
      staffProfile: {
        employeeId: "EMP-001",
        designation: "Assistant Professor",
        department: {
          id: ids.department,
          code: "CSE",
          name: "Computer Science and Engineering",
        },
      },
      roles: roleCodes.map((code) => ({ role: { code } })),
    },
    department: {
      id: ids.department,
      code: "CSE",
      name: "Computer Science and Engineering",
    },
    campus: null,
    block: null,
    floor: null,
    room: null,
  };
}

function setup() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    user: { findFirst: jest.fn() },
    feedbackTarget: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    feedbackQrCode: {
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = {
    user: { findFirst: jest.fn(), findMany: jest.fn() },
    feedbackTarget: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    feedbackQrCode: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    feedbackScanLog: {
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
    },
    feedbackQuestion: { findMany: jest.fn() },
    department: { findMany: jest.fn().mockResolvedValue([]) },
    block: { findMany: jest.fn().mockResolvedValue([]) },
    floor: { findMany: jest.fn().mockResolvedValue([]) },
    room: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (operation: unknown) => {
      if (typeof operation === "function")
        return (operation as (client: typeof tx) => Promise<unknown>)(tx);
      return Promise.all(operation as Promise<unknown>[]);
    }),
  };
  const config = {
    get: jest.fn((key: string, fallback?: string) =>
      key === "PUBLIC_APP_URL" ? "https://college.example" : fallback,
    ),
  };
  const access = { isCollegeWide: jest.fn(() => true) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new FeedbackService(
    prisma as never,
    config as never,
    access as never,
    audit as never,
  );
  return { service, prisma, tx, audit };
}

describe("FeedbackService staff QR ensure", () => {
  it("requires both QR management and target management permissions for ensure", async () => {
    const { service, prisma } = setup();
    const qrOnly = { ...admin, permissions: ["feedback.qr.manage"] };

    await expect(
      service.ensureStaffQr(qrOnly, ids.staffPublic, "request-permission"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(
      Reflect.getMetadata(
        "permissions",
        AdminFeedbackController.prototype.ensureStaffQr,
      ),
    ).toEqual(["feedback.qr.manage", "feedback.targets.manage"]);
  });

  it("atomically creates a college-scoped Faculty target and an opaque hashed QR token", async () => {
    const { service, prisma, tx, audit } = setup();
    tx.user.findFirst.mockResolvedValue(eligibleStaff());
    tx.feedbackTarget.findMany.mockResolvedValue([]);
    tx.feedbackTarget.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) =>
        targetRow({
          targetType: data.targetType,
          targetName: data.targetName,
          description: data.description,
          departmentId: data.departmentId,
        }),
    );
    tx.feedbackQrCode.findMany.mockResolvedValue([]);
    tx.feedbackQrCode.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) =>
        qrRow({
          qrUrl: data.qrUrl,
          secureTokenHash: data.secureTokenHash,
        }),
    );

    const result = await service.ensureStaffQr(
      admin,
      ids.staffPublic,
      "request-staff-create",
    );

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          publicId: ids.staffPublic,
          collegeId: ids.college,
          status: "ACTIVE",
          staffProfile: { isNot: null },
        }),
      }),
    );
    expect(tx.feedbackTarget.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          collegeId: ids.college,
          staffUserId: ids.staff,
          targetType: "STAFF",
          departmentId: ids.department,
          isActive: true,
        }),
      }),
    );
    const qrCreate = tx.feedbackQrCode.create.mock.calls[0]?.[0] as {
      data: { secureTokenHash: string; qrUrl: string };
    };
    const token = qrCreate.data.qrUrl.split("/").pop() ?? "";
    expect(token).toMatch(/^FB_[A-Za-z0-9_-]{16,160}$/);
    expect(qrCreate.data.secureTokenHash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    expect(qrCreate.data.secureTokenHash).not.toContain(token);
    expect(result).toMatchObject({
      staff: {
        publicId: ids.staffPublic,
        staffId: "EMP-001",
        targetType: "STAFF",
      },
      target: { id: ids.targetUuid, isActive: true },
      qr: { id: ids.qrUuid, status: "ACTIVE" },
      created: { target: true, qr: true },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "feedback.staff_qr_ensured",
        entityId: ids.qr,
      }),
    );
  });

  it("is idempotent and reuses the same usable active QR on repeated calls", async () => {
    const { service, tx } = setup();
    tx.user.findFirst.mockResolvedValue(eligibleStaff());
    tx.feedbackTarget.findMany.mockResolvedValue([targetRow()]);
    tx.feedbackQrCode.findMany.mockResolvedValue([qrRow()]);

    const first = await service.ensureStaffQr(
      admin,
      ids.staffPublic,
      "request-repeat-1",
    );
    const second = await service.ensureStaffQr(
      admin,
      ids.staffPublic,
      "request-repeat-2",
    );

    expect(first.qr?.id).toBe(ids.qrUuid);
    expect(second.qr?.id).toBe(ids.qrUuid);
    expect(first.created).toEqual({ target: false, qr: false });
    expect(second.created).toEqual({ target: false, qr: false });
    expect(tx.feedbackTarget.create).not.toHaveBeenCalled();
    expect(tx.feedbackQrCode.create).not.toHaveBeenCalled();
    expect(tx.feedbackQrCode.updateMany).not.toHaveBeenCalled();
  });

  it("treats an active Maintenance Staff profile as a generic STAFF feedback subject", async () => {
    const { service, tx } = setup();
    tx.user.findFirst.mockResolvedValue(eligibleStaff(["MAINTENANCE_STAFF"]));
    tx.feedbackTarget.findMany.mockResolvedValue([targetRow()]);
    tx.feedbackQrCode.findMany.mockResolvedValue([qrRow()]);

    await expect(
      service.ensureStaffQr(admin, ids.staffPublic, "request-maintenance"),
    ).resolves.toMatchObject({
      staff: { targetType: "STAFF" },
      target: { targetType: "STAFF" },
    });
  });

  it("derives HOD precedence, reactivates and synchronizes the canonical target, and disables legacy duplicates", async () => {
    const { service, tx } = setup();
    tx.user.findFirst.mockResolvedValue(eligibleStaff(["FACULTY", "HOD"]));
    const stale = targetRow({
      targetName: "Old Name",
      targetType: "STAFF",
      description: null,
      isActive: false,
      departmentId: null,
    });
    tx.feedbackTarget.findMany.mockResolvedValue([
      stale,
      targetRow({
        id: ids.duplicateTarget,
        targetUuid: "00000000-0000-0000-0000-000000000013",
      }),
    ]);
    tx.feedbackTarget.update.mockResolvedValue(
      targetRow({ targetType: "HOD" }),
    );
    tx.feedbackQrCode.findMany.mockResolvedValue([qrRow()]);

    const result = await service.ensureStaffQr(
      admin,
      ids.staffPublic,
      "request-sync",
    );

    expect(tx.feedbackTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ids.target },
        data: expect.objectContaining({
          targetType: "HOD",
          targetName: "Dr. Faculty One",
          isActive: true,
        }),
      }),
    );
    expect(tx.feedbackTarget.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [ids.duplicateTarget] }, isActive: true },
      data: { isActive: false },
    });
    expect(tx.feedbackQrCode.updateMany).toHaveBeenCalledWith({
      where: { targetId: { in: [ids.duplicateTarget] }, status: "ACTIVE" },
      data: { status: "DISABLED" },
    });
    expect(result.staff.targetType).toBe("HOD");
    expect(result.target?.targetType).toBe("HOD");
  });

  it("expires stale active codes and creates a fresh token instead of reactivating a revoked token", async () => {
    const { service, tx } = setup();
    tx.user.findFirst.mockResolvedValue(eligibleStaff());
    tx.feedbackTarget.findMany.mockResolvedValue([targetRow()]);
    tx.feedbackQrCode.findMany.mockResolvedValue([
      qrRow({ expiryDate: new Date("2020-01-01T00:00:00.000Z") }),
      qrRow({
        id: "00000000-0000-0000-0000-000000000014",
        qrUuid: "00000000-0000-0000-0000-000000000015",
        status: "DISABLED",
      }),
    ]);
    tx.feedbackQrCode.create.mockResolvedValue(
      qrRow({
        id: "00000000-0000-0000-0000-000000000016",
        qrUuid: "00000000-0000-0000-0000-000000000017",
      }),
    );

    const result = await service.ensureStaffQr(
      admin,
      ids.staffPublic,
      "request-expired",
    );

    expect(tx.feedbackQrCode.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [ids.qr] } },
      data: { status: "EXPIRED" },
    });
    expect(tx.feedbackQrCode.create).toHaveBeenCalledTimes(1);
    expect(result.created).toEqual({ target: false, qr: true });
    expect(result.qr?.id).toBe("00000000-0000-0000-0000-000000000017");
  });

  it("does not reveal or create QR data for cross-college, inactive, profile-less, or ineligible users", async () => {
    const { service, tx } = setup();
    tx.user.findFirst.mockResolvedValue(null);

    await expect(
      service.ensureStaffQr(admin, ids.staffPublic, "request-denied"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.feedbackTarget.findMany).not.toHaveBeenCalled();
    expect(tx.feedbackQrCode.create).not.toHaveBeenCalled();
  });

  it("returns staff metadata with null target and QR before generation", async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(eligibleStaff());
    prisma.feedbackTarget.findFirst.mockResolvedValue(null);

    await expect(
      service.staffQr(admin, ids.staffPublic),
    ).resolves.toMatchObject({
      staff: {
        publicId: ids.staffPublic,
        staffId: "EMP-001",
        targetType: "STAFF",
      },
      target: null,
      qr: null,
    });
  });

  it("canonicalizes an existing stored localhost URL without changing its secure token", async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(eligibleStaff());
    prisma.feedbackTarget.findFirst.mockResolvedValue(targetRow());
    prisma.feedbackQrCode.findMany.mockResolvedValue([
      qrRow({
        qrUrl: `http://localhost:3000/old-feedback-path/${storedToken}`,
      }),
    ]);

    const result = await service.staffQr(admin, ids.staffPublic);

    expect(result.qr?.secureUrl).toBe(
      `https://college.example/feedback/scan/${storedToken}`,
    );
    expect(result.qr?.secureUrl).not.toContain("localhost");
  });

  it("renders downloaded QR content with the canonical current origin while preserving the token", async () => {
    const { service, prisma } = setup();
    prisma.feedbackQrCode.findFirst.mockResolvedValue({
      ...qrRow({ qrUrl: `http://localhost:3000/feedback/${storedToken}` }),
      target: { targetName: "Dr. Faculty One", targetType: "STAFF" },
    });
    const toString = jest.spyOn(QRCode, "toString");
    (
      toString as unknown as { mockResolvedValueOnce(value: string): void }
    ).mockResolvedValueOnce("<svg />");

    await expect(
      service.downloadQr(admin, ids.qrUuid, "svg", "request-download"),
    ).resolves.toMatchObject({
      contentType: "image/svg+xml; charset=utf-8",
    });
    expect(toString).toHaveBeenCalledWith(
      `https://college.example/feedback/scan/${storedToken}`,
      { type: "svg", margin: 2, width: 960 },
    );
    toString.mockRestore();
  });

  it("rejects a stored URL whose visible token does not match the hashed security record", async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(eligibleStaff());
    prisma.feedbackTarget.findFirst.mockResolvedValue(targetRow());
    prisma.feedbackQrCode.findMany.mockResolvedValue([
      qrRow({
        qrUrl:
          "http://localhost:3000/feedback/FB_tampered-token-abcdefghijklmnopqrstuvwxyz",
      }),
    ]);

    await expect(service.staffQr(admin, ids.staffPublic)).rejects.toThrow(
      /does not match its security record/i,
    );
  });

  it("rejects an issued QR when the linked staff account is no longer active", async () => {
    const { service, prisma } = setup();
    prisma.feedbackQrCode.findUnique.mockResolvedValue({
      ...qrRow(),
      target: publicStaffTarget("SUSPENDED"),
    });
    const scanner = {
      ...admin,
      roles: ["STUDENT"],
      permissions: ["feedback.scan"],
    };

    await expect(service.scan(scanner, storedToken, {})).rejects.toThrow(
      /staff feedback target is unavailable/i,
    );
    expect(prisma.feedbackScanLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          successStatus: false,
          failureReason: "This staff feedback target is unavailable.",
        }),
      }),
    );
  });

  it("hides inactive staff targets from browse and direct ticket issuance", async () => {
    const { service, prisma } = setup();
    const suspendedTarget = publicStaffTarget("SUSPENDED");
    prisma.feedbackTarget.findMany.mockResolvedValue([suspendedTarget]);
    prisma.feedbackTarget.findFirst.mockResolvedValue(suspendedTarget);

    await expect(service.targets(admin, {})).resolves.toEqual([]);
    await expect(service.target(admin, ids.targetUuid)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("rejects a stale target type after the staff role changes until ensure synchronizes it", async () => {
    const { service, prisma } = setup();
    prisma.feedbackQrCode.findUnique.mockResolvedValue({
      ...qrRow(),
      target: {
        ...publicStaffTarget("ACTIVE", ["FACULTY"]),
        targetType: "HOD",
      },
    });
    const scanner = {
      ...admin,
      roles: ["STUDENT"],
      permissions: ["feedback.scan"],
    };

    await expect(service.scan(scanner, storedToken, {})).rejects.toThrow(
      /staff feedback target is unavailable/i,
    );
  });
});

describe("FeedbackService staff bulk generation", () => {
  it("uses the same locked idempotent ensure path and filters current active Faculty roles", async () => {
    const { service, prisma, tx } = setup();
    prisma.user.findMany.mockResolvedValue([
      { publicId: ids.staffPublic, roles: [{ role: { code: "FACULTY" } }] },
    ]);
    tx.user.findFirst.mockResolvedValue(eligibleStaff());
    tx.feedbackTarget.findMany.mockResolvedValue([]);
    tx.feedbackTarget.create.mockResolvedValue(targetRow());
    tx.feedbackQrCode.findMany.mockResolvedValue([]);
    tx.feedbackQrCode.create.mockResolvedValue(qrRow());

    await expect(
      service.bulkGenerate(admin, { targetTypes: ["STAFF"] }, "request-bulk"),
    ).resolves.toEqual({ targetsCreated: 1, qrCreated: 1 });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          collegeId: ids.college,
          status: "ACTIVE",
          staffProfile: { isNot: null },
          roles: {
            some: expect.objectContaining({
              validFrom: expect.any(Object),
              OR: expect.any(Array),
            }),
          },
        }),
      }),
    );
    const where = prisma.user.findMany.mock.calls[0]?.[0]?.where as {
      roles: { some: { OR: unknown[]; role: { code: { in: string[] } } } };
    };
    expect(where.roles.some.OR).toHaveLength(2);
    expect(where.roles.some.role.code.in).toEqual([
      "PRINCIPAL",
      "VICE_PRINCIPAL",
      "HOD",
      "CLASS_COORDINATOR",
      "FACULTY",
      "MAINTENANCE_ADMIN",
      "MAINTENANCE_SUPERVISOR",
      "MAINTENANCE_STAFF",
      "ELECTRICIAN",
      "PLUMBER",
      "IT_SUPPORT",
      "LAB_TECHNICIAN",
      "HOUSEKEEPING",
      "SECURITY",
      "OTHER_RESPONSIBLE",
    ]);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
