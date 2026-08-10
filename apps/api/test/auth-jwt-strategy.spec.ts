import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtStrategy } from "../src/modules/auth/jwt.strategy";

const payload = {
  sub: "user-id",
  sid: "session-id",
  typ: "access",
  nonce: "access-token-nonce",
};

const activeSession = {
  userId: payload.sub,
  revokedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
};

const activeUser = {
  id: payload.sub,
  publicId: "public-user-id",
  collegeId: "college-id",
  fullName: "Main Admin",
  email: "admin@example.test",
  status: "ACTIVE",
  mustChangePassword: false,
  profileCompletionStatus: "VERIFIED",
  profileCompletionPercentage: 100,
  profileRejectionReason: null,
  firstLoginCompletedAt: new Date(),
  college: { isActive: true },
  roles: [
    {
      role: {
        collegeId: null,
        code: "MAIN_ADMIN",
        permissions: [
          { permission: { code: "users.read" } },
          { permission: { code: "users.manage" } },
        ],
      },
    },
  ],
  scopes: [],
  studentProfile: null,
  staffProfile: null,
};

function strategyHarness() {
  const prisma = {
    session: { findUnique: jest.fn() },
    user: { findUnique: jest.fn().mockResolvedValue(activeUser) },
  };
  const strategy = new JwtStrategy(
    new ConfigService({ JWT_ACCESS_SECRET: "access-secret" }),
    prisma as never,
  );
  return { prisma, strategy };
}

describe("JwtStrategy session revocation", () => {
  it("rejects a revoked session immediately even when authorization is cached", async () => {
    const { prisma, strategy } = strategyHarness();
    prisma.session.findUnique
      .mockResolvedValueOnce(activeSession)
      .mockResolvedValueOnce({ ...activeSession, revokedAt: new Date() });

    await expect(strategy.validate(payload)).resolves.toMatchObject({
      id: payload.sub,
      sessionId: payload.sid,
      roles: ["MAIN_ADMIN"],
    });
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(prisma.session.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing", null],
    ["revoked", { ...activeSession, revokedAt: new Date() }],
    ["expired", { ...activeSession, expiresAt: new Date(Date.now() - 1) }],
    ["another user", { ...activeSession, userId: "different-user-id" }],
  ])("rejects a %s session before loading authorization", async (_name, session) => {
    const { prisma, strategy } = strategyHarness();
    prisma.session.findUnique.mockResolvedValue(session);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("reuses cached authorization only after revalidating the session", async () => {
    const { prisma, strategy } = strategyHarness();
    prisma.session.findUnique.mockResolvedValue(activeSession);

    const first = await strategy.validate(payload);
    const second = await strategy.validate(payload);

    expect(second).toEqual(first);
    expect(prisma.session.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });
});
