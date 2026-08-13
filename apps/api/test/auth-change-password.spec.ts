import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import { createHash } from "node:crypto";
import { AuthService } from "../src/modules/auth/auth.service";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const SESSION_ID = "00000000-0000-0000-0000-000000000002";
const COLLEGE_ID = "00000000-0000-0000-0000-000000000003";
const CURRENT_PASSWORD = "Initial!Pass900";
const NEW_PASSWORD = "Orbit!River900";
const PASSWORD_PEPPER = "unit-test-password-pepper";

const metadata = {
  requestId: "request-password-change",
  ipAddress: "127.0.0.1",
  userAgent: "jest",
};

function account(overrides: Record<string, unknown> = {}) {
  return {
    collegeIdentityId: "COL-9001",
    email: "taylor@campus.invalid",
    fullName: "Taylor Jordan",
    ...overrides,
  };
}

function safeUserView(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    publicId: "00000000-0000-0000-0000-000000000004",
    collegeId: COLLEGE_ID,
    fullName: "Taylor Jordan",
    email: "taylor@campus.invalid",
    status: "ACTIVE",
    mustChangePassword: false,
    firstLoginCompletedAt: new Date("2026-08-13T00:00:00.000Z"),
    profileCompletionStatus: "VERIFIED",
    profileCompletionPercentage: 100,
    profileRejectionReason: null,
    roles: [
      {
        role: {
          collegeId: COLLEGE_ID,
          code: "MAIN_ADMIN",
          permissions: [],
        },
      },
    ],
    studentProfile: null,
    staffProfile: null,
    ...overrides,
  };
}

function serviceHarness(passwordHash: string) {
  const tx = {
    userCredential: {
      update: jest.fn().mockResolvedValue({}),
    },
    user: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    session: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: "other-session-1" },
          { id: "other-session-2" },
        ]),
      update: jest.fn().mockResolvedValue({}),
    },
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    userCredential: {
      findUnique: jest.fn().mockResolvedValue({ passwordHash }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(account()),
      findUniqueOrThrow: jest.fn().mockResolvedValue(safeUserView()),
    },
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const jwt = {
    signAsync: jest.fn((payload: { typ: string }) =>
      Promise.resolve(`${payload.typ}-token`),
    ),
  };
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  };
  const config = new ConfigService({
    JWT_ACCESS_EXPIRY: "15m",
    JWT_REFRESH_EXPIRY: "7d",
    JWT_ACCESS_SECRET: "unit-test-access-secret",
    JWT_REFRESH_SECRET: "unit-test-refresh-secret",
    PASSWORD_PEPPER,
  });
  const service = new AuthService(
    prisma as never,
    jwt as never,
    config,
    audit as never,
  );
  return { audit, jwt, prisma, service, tx };
}

describe("AuthService.changePassword", () => {
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await argon2.hash(CURRENT_PASSWORD + PASSWORD_PEPPER, {
      type: argon2.argon2id,
    });
  });

  it("rejects reuse of the current password with HTTP 409 semantics", async () => {
    const { prisma, service } = serviceHarness(passwordHash);

    await expect(
      service.changePassword(
        USER_ID,
        CURRENT_PASSWORD,
        CURRENT_PASSWORD,
        SESSION_ID,
        metadata,
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: "The new password must be different.",
    });

    expect(prisma.userCredential.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    [
      "name",
      "Taylor!Secure900",
      "The new password must not contain your name.",
    ],
    [
      "college ID",
      "Aa!COL-9001private",
      "The new password must not contain your college ID.",
    ],
    [
      "email address",
      "Aa1!taylor@campus.invalid",
      "The new password must not contain your email address.",
    ],
  ])(
    "rejects a new password containing the user's %s",
    async (_rule, candidate, message) => {
      const { prisma, service } = serviceHarness(passwordHash);

      await expect(
        service.changePassword(
          USER_ID,
          CURRENT_PASSWORD,
          candidate,
          SESSION_ID,
          metadata,
        ),
      ).rejects.toMatchObject({ status: 409, message });

      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it("rejects an incorrect current password against a peppered hash", async () => {
    const { prisma, service } = serviceHarness(passwordHash);

    await expect(
      service.changePassword(
        USER_ID,
        "Incorrect!Pass900",
        NEW_PASSWORD,
        SESSION_ID,
        metadata,
      ),
    ).rejects.toMatchObject({
      status: 401,
      message: "The current password is incorrect.",
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: { collegeIdentityId: true, email: true, fullName: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("atomically updates credentials, user state, sessions, refresh tokens and audit data", async () => {
    const { audit, jwt, prisma, service, tx } = serviceHarness(passwordHash);

    await expect(
      service.changePassword(
        USER_ID,
        CURRENT_PASSWORD,
        NEW_PASSWORD,
        SESSION_ID,
        metadata,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        tokens: expect.objectContaining({
          accessToken: "access-token",
          refreshToken: "refresh-token",
        }),
        user: expect.objectContaining({ mustChangePassword: false }),
      }),
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.userCredential.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: {
        passwordHash: expect.any(String),
        passwordChangedAt: expect.any(Date),
        failedAttemptCount: 0,
        lockedUntil: null,
      },
    });
    const credentialUpdate = tx.userCredential.update.mock.calls[0]?.[0];
    await expect(
      argon2.verify(
        credentialUpdate.data.passwordHash,
        NEW_PASSWORD + PASSWORD_PEPPER,
      ),
    ).resolves.toBe(true);
    await expect(
      argon2.verify(credentialUpdate.data.passwordHash, NEW_PASSWORD),
    ).resolves.toBe(false);

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { mustChangePassword: false, version: { increment: 1 } },
    });
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, firstLoginCompletedAt: null },
      data: { firstLoginCompletedAt: expect.any(Date) },
    });
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { not: SESSION_ID }, revokedAt: null },
      data: {
        revokedAt: expect.any(Date),
        revokeReason: "PASSWORD_CHANGED",
      },
    });
    expect(tx.refreshToken.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        sessionId: { in: ["other-session-1", "other-session-2"] },
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.refreshToken.updateMany).toHaveBeenNthCalledWith(2, {
      where: { sessionId: SESSION_ID, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.refreshToken.create).toHaveBeenCalledWith({
      data: {
        sessionId: SESSION_ID,
        tokenHash: createHash("sha256").update("refresh-token").digest("hex"),
        expiresAt: expect.any(Date),
      },
    });
    expect(tx.session.update).toHaveBeenCalledWith({
      where: { id: SESSION_ID },
      data: { lastSeenAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith(
      {
        actorId: USER_ID,
        action: "auth.password_changed",
        entityType: "User",
        entityId: USER_ID,
        ...metadata,
      },
      tx,
    );
    expect(jwt.signAsync).toHaveBeenCalledTimes(2);
    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID } }),
    );
  });
});
