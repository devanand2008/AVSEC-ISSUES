import { ConfigService } from "@nestjs/config";
import { ServiceUnavailableException } from "@nestjs/common";
import { AuthService } from "../src/modules/auth/auth.service";

const metadata = {
  requestId: "request-1",
  ipAddress: "127.0.0.1",
  userAgent: "jest",
};

function serviceHarness() {
  const jwt = {
    verifyAsync: jest.fn(),
  };
  const tx = {
    session: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AuthService(
    prisma as never,
    jwt as never,
    new ConfigService({ JWT_REFRESH_SECRET: "refresh-secret" }),
    audit as never,
  );
  return { audit, jwt, prisma, service, tx };
}

describe("AuthService logout", () => {
  it("revokes the session identified by a refresh token", async () => {
    const { audit, jwt, service, tx } = serviceHarness();
    jwt.verifyAsync.mockResolvedValue({
      sub: "user-id",
      sid: "session-id",
      typ: "refresh",
    });

    await service.revokeSessionFromRefreshToken(
      "refresh-token",
      "USER_LOGOUT",
      metadata,
    );

    expect(jwt.verifyAsync).toHaveBeenCalledWith("refresh-token", {
      secret: "refresh-secret",
    });
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { id: "session-id", revokedAt: null },
      data: { revokedAt: expect.any(Date), revokeReason: "USER_LOGOUT" },
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { sessionId: "session-id", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.logout",
        actorId: "user-id",
        entityId: "session-id",
      }),
      tx,
    );
  });

  it("does not throw when the refresh token is missing or invalid", async () => {
    const { jwt, prisma, service } = serviceHarness();
    jwt.verifyAsync.mockRejectedValue(new Error("expired"));

    await expect(
      service.revokeSessionFromRefreshToken(undefined, "USER_LOGOUT", metadata),
    ).resolves.toBeUndefined();
    await expect(
      service.revokeSessionFromRefreshToken(
        "expired-token",
        "USER_LOGOUT",
        metadata,
      ),
    ).resolves.toBeUndefined();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("AuthService refresh", () => {
  it("times out stalled refresh token lookups", async () => {
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: "user-id",
        sid: "session-id",
        typ: "refresh",
      }),
    };
    const prisma = {
      refreshToken: {
        findUnique: jest.fn(() => new Promise(() => undefined)),
      },
    };
    const service = new AuthService(
      prisma as never,
      jwt as never,
      new ConfigService({
        AUTH_REFRESH_DATABASE_TIMEOUT_MS: 5,
        JWT_REFRESH_SECRET: "refresh-secret",
      }),
      { record: jest.fn() } as never,
    );

    await expect(
      service.refresh("refresh-token", metadata),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.refreshToken.findUnique).toHaveBeenCalled();
  });
});
