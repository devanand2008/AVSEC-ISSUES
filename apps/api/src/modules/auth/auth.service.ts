import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { LoginDto } from "./dto/login.dto";
import { verifyStoredPassword } from "./password-verification";
import { durationSeconds } from "./token-time";

interface RequestMetadata {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  accessExpiresInSeconds: number;
  refreshExpiresInSeconds: number;
}

@Injectable()
export class AuthService {
  private readonly accessSeconds: number;
  private readonly refreshSeconds: number;
  private readonly refreshDatabaseTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {
    this.accessSeconds = durationSeconds(
      config.get<string>("JWT_ACCESS_EXPIRY", "15m"),
    );
    this.refreshSeconds = durationSeconds(
      config.get<string>("JWT_REFRESH_EXPIRY", "7d"),
    );
    this.refreshDatabaseTimeoutMs = config.get<number>(
      "AUTH_REFRESH_DATABASE_TIMEOUT_MS",
      5000,
    );
  }

  async login(
    input: LoginDto,
    metadata: RequestMetadata,
  ): Promise<{ tokens: TokenPair; user: object }> {
    const normalized = input.identifier.trim().toLowerCase();
    const identifierHash = this.hash(normalized);
    const candidates = await this.prisma.user.findMany({
      where: {
        ...(input.collegeCode
          ? { college: { code: input.collegeCode.trim().toUpperCase() } }
          : {}),
        OR: [
          { normalizedEmail: normalized },
          { collegeIdentityId: input.identifier.trim() },
          { studentProfile: { is: { studentId: input.identifier.trim() } } },
          { staffProfile: { is: { employeeId: input.identifier.trim() } } },
        ],
      },
      include: {
        credential: true,
        college: { select: { isActive: true } },
        roles: {
          where: {
            validFrom: { lte: new Date() },
            OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
            role: { isActive: true },
          },
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        },
        studentProfile: { select: { id: true } },
        staffProfile: { select: { id: true } },
      },
      take: 2,
    });
    const user = candidates.length === 1 ? candidates[0] : undefined;
    const currentlyLocked = Boolean(
      user?.credential?.lockedUntil && user.credential.lockedUntil > new Date(),
    );
    const pepper = this.config.get<string>("PASSWORD_PEPPER", "");
    const passwordVerification =
      user?.credential && !currentlyLocked
        ? await verifyStoredPassword(
            user.credential.passwordHash,
            input.password,
            pepper,
            this.config.get<boolean>(
              "LEGACY_UNPEPPERED_PASSWORD_MIGRATION_ENABLED",
              false,
            ),
          )
        : { valid: false, needsPepperUpgrade: false };
    const valid = passwordVerification.valid;

    if (!user || !valid) {
      const nextAttemptCount = (user?.credential?.failedAttemptCount ?? 0) + 1;
      await this.prisma.$transaction([
        this.prisma.loginAttempt.create({
          data: {
            userId: user?.id,
            identifierHash,
            successful: false,
            reason: currentlyLocked
              ? "ACCOUNT_LOCKED"
              : candidates.length > 1
                ? "AMBIGUOUS_IDENTIFIER"
                : "INVALID_CREDENTIALS",
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
        }),
        ...(user?.credential
          ? [
              this.prisma.userCredential.update({
                where: { userId: user.id },
                data: {
                  failedAttemptCount: nextAttemptCount,
                  lockedUntil:
                    nextAttemptCount >= 5
                      ? new Date(Date.now() + 15 * 60_000)
                      : user.credential.lockedUntil,
                },
              }),
            ]
          : []),
      ]);
      throw new UnauthorizedException(
        "The identifier or password is incorrect.",
      );
    }
    if (!user.college.isActive)
      throw new ForbiddenException("This college is not active.");
    if (user.status !== "ACTIVE")
      throw new ForbiddenException(
        `This account is ${user.status.toLowerCase()}.`,
      );

    const upgradedPasswordHash = passwordVerification.needsPepperUpgrade
      ? await argon2.hash(input.password + pepper, { type: argon2.argon2id })
      : undefined;

    // Create session and generate tokens in parallel
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        familyId: randomUUID(),
        userAgent: metadata.userAgent,
        ipAddress: metadata.ipAddress,
        expiresAt: new Date(Date.now() + this.refreshSeconds * 1000),
      },
    });
    const tokens = await this.createTokens(user.id, session.id);

    // Single transaction for all post-login writes (saves a DB round-trip)
    await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash: this.hash(tokens.refreshToken),
          expiresAt: new Date(Date.now() + this.refreshSeconds * 1000),
        },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
      this.prisma.userCredential.update({
        where: { userId: user.id },
        data: {
          failedAttemptCount: 0,
          lockedUntil: null,
          ...(upgradedPasswordHash
            ? {
                passwordHash: upgradedPasswordHash,
                passwordChangedAt: new Date(),
              }
            : {}),
        },
      }),
      this.prisma.loginAttempt.create({
        data: {
          userId: user.id,
          identifierHash,
          successful: true,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          collegeId: user.collegeId,
          actorId: user.id,
          action: "auth.login",
          entityType: "Session",
          entityId: session.id,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        },
      }),
    ]);

    // Build full user profile so frontend can skip the /auth/me round-trip
    const activeRoles = user.roles.filter(
      (mapping) =>
        !mapping.role.collegeId || mapping.role.collegeId === user.collegeId,
    );
    return {
      tokens,
      user: {
        ...this.safeUser(user),
        ...this.profileRouting(
          user.roles.map((mapping) => mapping.role.code),
          {
            studentProfile: user.studentProfile,
            staffProfile: user.staffProfile,
            mustChangePassword: user.mustChangePassword,
            status: user.status,
          },
        ),
        roles: activeRoles.map((mapping) => mapping.role.code),
        permissions: [
          ...new Set(
            activeRoles.flatMap((mapping) =>
              mapping.role.permissions.map((entry) => entry.permission.code),
            ),
          ),
        ],
      },
    };
  }

  async refresh(
    rawToken: string | undefined,
    metadata: RequestMetadata,
  ): Promise<TokenPair> {
    if (!rawToken) throw new UnauthorizedException("Refresh token is missing.");
    let payload: { sub: string; sid: string; typ: string };
    try {
      payload = await this.jwt.verifyAsync(rawToken, {
        secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
      });
    } catch {
      throw new UnauthorizedException("Refresh token is invalid or expired.");
    }
    if (payload.typ !== "refresh")
      throw new UnauthorizedException("Invalid token type.");
    const tokenHash = this.hash(rawToken);
    const stored = await this.withRefreshDatabaseTimeout(
      this.prisma.refreshToken.findUnique({
        where: { tokenHash },
        include: {
          session: {
            include: {
              user: { include: { college: { select: { isActive: true } } } },
            },
          },
        },
      }),
    );
    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt <= new Date() ||
      stored.session.revokedAt
    ) {
      throw new UnauthorizedException("The session is no longer valid.");
    }
    if (stored.usedAt) {
      await this.withRefreshDatabaseTimeout(
        this.prisma.session.updateMany({
          where: { familyId: stored.session.familyId, revokedAt: null },
          data: { revokedAt: new Date(), revokeReason: "REFRESH_TOKEN_REUSE" },
        }),
      );
      throw new UnauthorizedException(
        "Refresh token reuse was detected; the session family was revoked.",
      );
    }
    if (
      stored.session.user.status !== "ACTIVE" ||
      !stored.session.user.college.isActive
    ) {
      await this.withRefreshDatabaseTimeout(
        this.revokeSession(stored.sessionId, "ACCOUNT_NOT_ACTIVE", metadata),
      );
      throw new ForbiddenException("The account is not active.");
    }

    const now = new Date();
    const tokens = await this.createTokens(
      stored.session.userId,
      stored.sessionId,
    );
    const replacementId = randomUUID();
    const rotated = await this.withRefreshDatabaseTimeout(
      this.prisma.$transaction(async (tx) => {
        const claimed = await tx.refreshToken.updateMany({
          where: {
            id: stored.id,
            usedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now, replacedById: replacementId },
        });
        if (claimed.count !== 1) return false;
        await tx.refreshToken.create({
          data: {
            id: replacementId,
            sessionId: stored.sessionId,
            tokenHash: this.hash(tokens.refreshToken),
            expiresAt: new Date(now.getTime() + this.refreshSeconds * 1000),
          },
        });
        await tx.session.update({
          where: { id: stored.sessionId },
          data: { lastSeenAt: now },
        });
        return true;
      }),
    );
    if (!rotated) {
      await this.withRefreshDatabaseTimeout(
        this.prisma.session.updateMany({
          where: { familyId: stored.session.familyId, revokedAt: null },
          data: { revokedAt: new Date(), revokeReason: "REFRESH_TOKEN_REUSE" },
        }),
      );
      throw new UnauthorizedException(
        "Refresh token reuse was detected; the session family was revoked.",
      );
    }
    return tokens;
  }

  async revokeSession(
    sessionId: string,
    reason: string,
    metadata: RequestMetadata,
    actorId?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: reason },
      });
      await tx.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          actorId,
          action: "auth.logout",
          entityType: "Session",
          entityId: sessionId,
          reason,
          ...metadata,
        },
        tx,
      );
    });
  }

  async revokeSessionFromRefreshToken(
    rawToken: string | undefined,
    reason: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    if (!rawToken) return;
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        sid: string;
        typ: string;
      }>(rawToken, {
        secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
      });
      if (payload.typ !== "refresh") return;
      await this.revokeSession(payload.sid, reason, metadata, payload.sub);
    } catch {
      // Logout must still clear browser cookies when the server-side session is already invalid.
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionId: string,
    metadata: RequestMetadata,
  ): Promise<{ tokens: TokenPair; user: object }> {
    if (currentPassword === newPassword)
      throw new ConflictException("The new password must be different.");
    const [credential, account] = await Promise.all([
      this.prisma.userCredential.findUnique({ where: { userId } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { collegeIdentityId: true, email: true, fullName: true },
      }),
    ]);
    if (!credential) throw new UnauthorizedException();
    const pepper = this.config.get<string>("PASSWORD_PEPPER", "");
    if (
      !(await argon2.verify(credential.passwordHash, currentPassword + pepper))
    ) {
      throw new UnauthorizedException("The current password is incorrect.");
    }
    const loweredNewPassword = newPassword.toLowerCase();
    const collegeId = account?.collegeIdentityId?.toLowerCase();
    const email = account?.email?.toLowerCase();
    if (collegeId && loweredNewPassword.includes(collegeId)) {
      throw new ConflictException(
        "The new password must not contain your college ID.",
      );
    }
    if (email && loweredNewPassword.includes(email)) {
      throw new ConflictException(
        "The new password must not contain your email address.",
      );
    }
    const fullNameTokens = (account?.fullName ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter((part) => part.length >= 3);
    if (fullNameTokens.some((part) => loweredNewPassword.includes(part))) {
      throw new ConflictException(
        "The new password must not contain your name.",
      );
    }
    const passwordHash = await argon2.hash(newPassword + pepper, {
      type: argon2.argon2id,
    });
    const tokens = await this.createTokens(userId, currentSessionId);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.userCredential.update({
        where: { userId },
        data: {
          passwordHash,
          passwordChangedAt: now,
          failedAttemptCount: 0,
          lockedUntil: null,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { mustChangePassword: false, version: { increment: 1 } },
      });
      await tx.user.updateMany({
        where: { id: userId, firstLoginCompletedAt: null },
        data: { firstLoginCompletedAt: now },
      });
      await tx.session.updateMany({
        where: { userId, id: { not: currentSessionId }, revokedAt: null },
        data: { revokedAt: now, revokeReason: "PASSWORD_CHANGED" },
      });
      const oldSessions = await tx.session.findMany({
        where: { userId, id: { not: currentSessionId } },
        select: { id: true },
      });
      if (oldSessions.length) {
        await tx.refreshToken.updateMany({
          where: {
            sessionId: { in: oldSessions.map((session) => session.id) },
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
      }
      await tx.refreshToken.updateMany({
        where: { sessionId: currentSessionId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.refreshToken.create({
        data: {
          sessionId: currentSessionId,
          tokenHash: this.hash(tokens.refreshToken),
          expiresAt: new Date(now.getTime() + this.refreshSeconds * 1000),
        },
      });
      await tx.session.update({
        where: { id: currentSessionId },
        data: { lastSeenAt: now },
      });
      await this.audit.record(
        {
          actorId: userId,
          action: "auth.password_changed",
          entityType: "User",
          entityId: userId,
          ...metadata,
        },
        tx,
      );
    });
    return { tokens, user: await this.userView(userId) };
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
      },
      orderBy: { lastSeenAt: "desc" },
    });
    return sessions.map((session) => ({
      ...session,
      current: session.id === currentSessionId,
    }));
  }

  async revokeOwnSession(
    userId: string,
    sessionId: string,
    currentSessionId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    if (sessionId === currentSessionId) {
      throw new ConflictException("Use sign out to end the current session.");
    }
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!session) throw new NotFoundException("Active session not found.");
    await this.revokeSession(
      session.id,
      "USER_REVOKED_DEVICE",
      metadata,
      userId,
    );
  }

  async revokeOtherSessions(
    userId: string,
    currentSessionId: string,
    metadata: RequestMetadata,
  ): Promise<{ revoked: number }> {
    const sessions = await this.prisma.session.findMany({
      where: {
        userId,
        id: { not: currentSessionId },
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    for (const session of sessions) {
      await this.revokeSession(
        session.id,
        "USER_REVOKED_ALL_OTHERS",
        metadata,
        userId,
      );
    }
    return { revoked: sessions.length };
  }

  async forgotPassword(
    identifier: string,
    metadata: RequestMetadata,
  ): Promise<{ accepted: true; developmentToken?: string }> {
    const normalized = identifier.trim().toLowerCase();
    const candidates = await this.prisma.user.findMany({
      where: {
        OR: [
          { normalizedEmail: normalized },
          { collegeIdentityId: identifier.trim() },
          { studentProfile: { is: { studentId: identifier.trim() } } },
          { staffProfile: { is: { employeeId: identifier.trim() } } },
        ],
        status: "ACTIVE",
        college: { isActive: true },
      },
      take: 2,
    });
    const user = candidates.length === 1 ? candidates[0] : undefined;
    let developmentToken: string | undefined;
    if (user) {
      const token = randomBytes(32).toString("base64url");
      await this.prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: this.hash(token),
            expiresAt: new Date(Date.now() + 30 * 60_000),
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "User",
            aggregateId: user.id,
            eventType: "auth.password_reset_requested",
            payload: { userId: user.id },
            idempotencyKey: `password-reset:${user.id}:${Date.now()}`,
          },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "auth.password_reset_requested",
            entityType: "User",
            entityId: user.id,
            ...metadata,
          },
          tx,
        );
      });
      if (this.config.get<string>("NODE_ENV") === "development")
        developmentToken = token;
    }
    return {
      accepted: true,
      ...(developmentToken ? { developmentToken } : {}),
    };
  }

  async resetPassword(
    token: string,
    newPassword: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hash(token) },
    });
    if (!stored || stored.usedAt || stored.expiresAt <= new Date())
      throw new UnauthorizedException(
        "The password-reset link is invalid or expired.",
      );
    const passwordHash = await argon2.hash(
      newPassword + this.config.get<string>("PASSWORD_PEPPER", ""),
      { type: argon2.argon2id },
    );
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: stored.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1)
        throw new UnauthorizedException(
          "The password-reset link is invalid or expired.",
        );
      await tx.userCredential.update({
        where: { userId: stored.userId },
        data: {
          passwordHash,
          passwordChangedAt: now,
          failedAttemptCount: 0,
          lockedUntil: null,
        },
      });
      await tx.user.update({
        where: { id: stored.userId },
        data: { mustChangePassword: false, version: { increment: 1 } },
      });
      await tx.user.updateMany({
        where: { id: stored.userId, firstLoginCompletedAt: null },
        data: { firstLoginCompletedAt: now },
      });
      await tx.session.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: now, revokeReason: "PASSWORD_RESET" },
      });
      const sessions = await tx.session.findMany({
        where: { userId: stored.userId },
        select: { id: true },
      });
      if (sessions.length) {
        await tx.refreshToken.updateMany({
          where: {
            sessionId: { in: sessions.map((session) => session.id) },
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
      }
      await this.audit.record(
        {
          actorId: stored.userId,
          action: "auth.password_reset_completed",
          entityType: "User",
          entityId: stored.userId,
          ...metadata,
        },
        tx,
      );
    });
  }

  private async createTokens(
    userId: string,
    sessionId: string,
  ): Promise<TokenPair> {
    // Sign both tokens in parallel — saves ~50% of JWT signing time
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        {
          sub: userId,
          sid: sessionId,
          typ: "access",
          nonce: randomBytes(16).toString("hex"),
        },
        {
          secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
          expiresIn: this.accessSeconds,
        },
      ),
      this.jwt.signAsync(
        {
          sub: userId,
          sid: sessionId,
          typ: "refresh",
          nonce: randomBytes(16).toString("hex"),
        },
        {
          secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
          expiresIn: this.refreshSeconds,
        },
      ),
    ]);
    return {
      accessToken,
      refreshToken,
      csrfToken: randomBytes(24).toString("base64url"),
      accessExpiresInSeconds: this.accessSeconds,
      refreshExpiresInSeconds: this.refreshSeconds,
    };
  }

  private safeUser(user: {
    id: string;
    publicId: string;
    fullName: string;
    email: string | null;
    status: string;
    mustChangePassword: boolean;
    firstLoginCompletedAt: Date | null;
    profileCompletionStatus?: string;
    profileCompletionPercentage?: number;
    profileRejectionReason?: string | null;
  }) {
    return {
      id: user.publicId,
      fullName: user.fullName,
      email: user.email,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      firstLoginCompletedAt: user.firstLoginCompletedAt,
      profileCompletionStatus: user.profileCompletionStatus,
      profileCompletionPercentage: user.profileCompletionPercentage,
      profileRejectionReason: user.profileRejectionReason,
    };
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private async withRefreshDatabaseTimeout<T>(
    operation: Promise<T>,
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new ServiceUnavailableException(
                  "Authentication refresh timed out.",
                ),
              ),
            this.refreshDatabaseTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async userView(userId: string): Promise<object> {
    const now = new Date();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        roles: {
          where: {
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
            role: { isActive: true },
          },
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        },
        studentProfile: { select: { id: true } },
        staffProfile: { select: { id: true } },
      },
    });
    const activeRoles = user.roles.filter(
      (mapping) =>
        !mapping.role.collegeId || mapping.role.collegeId === user.collegeId,
    );
    return {
      ...this.safeUser(user),
      ...this.profileRouting(
        activeRoles.map((mapping) => mapping.role.code),
        user,
      ),
      roles: activeRoles.map((mapping) => mapping.role.code),
      permissions: [
        ...new Set(
          activeRoles.flatMap((mapping) =>
            mapping.role.permissions.map((entry) => entry.permission.code),
          ),
        ),
      ],
    };
  }

  private profileRouting(
    roles: string[],
    user: {
      status: string;
      mustChangePassword: boolean;
      profileCompletionStatus?: string;
      studentProfile?: { id: string } | null;
      staffProfile?: { id: string } | null;
    },
  ): {
    profileCompletionStatus:
      | "NOT_STARTED"
      | "IN_PROGRESS"
      | "SUBMITTED"
      | "VERIFIED"
      | "REJECTED";
    allowedNextRoute: string;
  } {
    if (roles.some((role) => ["SUPER_ADMIN", "MAIN_ADMIN"].includes(role))) {
      return {
        profileCompletionStatus: "VERIFIED",
        allowedNextRoute:
          user.status !== "ACTIVE"
            ? "/suspended"
            : user.mustChangePassword
              ? "/change-password"
              : "/",
      };
    }
    const needsStudentProfile =
      roles.includes("STUDENT") || roles.includes("CLASS_REPRESENTATIVE");
    const staffRoles = new Set([
      "FACULTY",
      "HOD",
      "CLASS_COORDINATOR",
      "PRINCIPAL",
      "VICE_PRINCIPAL",
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
    const needsStaffProfile = roles.some((role) => staffRoles.has(role));
    const hasRequiredProfileRows =
      (!needsStudentProfile || Boolean(user.studentProfile)) &&
      (!needsStaffProfile || Boolean(user.staffProfile));
    const needsManagedProfile = needsStudentProfile || needsStaffProfile;
    const storedStatus = user.profileCompletionStatus;
    let profileCompletionStatus:
      | "NOT_STARTED"
      | "IN_PROGRESS"
      | "SUBMITTED"
      | "VERIFIED"
      | "REJECTED" =
      storedStatus === "VERIFIED" ||
      storedStatus === "REJECTED" ||
      storedStatus === "IN_PROGRESS" ||
      storedStatus === "SUBMITTED" ||
      storedStatus === "NOT_STARTED"
        ? storedStatus
        : hasRequiredProfileRows
          ? "SUBMITTED"
          : "NOT_STARTED";
    if (
      needsManagedProfile &&
      !hasRequiredProfileRows &&
      (profileCompletionStatus === "SUBMITTED" ||
        profileCompletionStatus === "VERIFIED")
    ) {
      profileCompletionStatus = "NOT_STARTED";
    }
    const needsProfileSetup =
      needsManagedProfile &&
      (!hasRequiredProfileRows ||
        profileCompletionStatus === "NOT_STARTED" ||
        profileCompletionStatus === "IN_PROGRESS" ||
        profileCompletionStatus === "REJECTED");
    const allowedNextRoute =
      user.status !== "ACTIVE"
        ? "/suspended"
        : user.mustChangePassword
          ? "/change-password"
          : needsProfileSetup
            ? "/profile/setup"
            : "/";
    return { profileCompletionStatus, allowedNextRoute };
  }
}
