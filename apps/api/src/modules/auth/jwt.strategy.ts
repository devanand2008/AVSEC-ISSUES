import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import type { Request } from "express";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../../database/prisma.service";
import type { AuthPrincipal } from "../../common/http/request-context";

interface AccessPayload {
  sub: string;
  sid: string;
  typ: string;
  nonce?: string;
}

interface CacheEntry {
  principal: AuthPrincipal;
  expiresAt: number;
}

/** In-memory principal cache — avoids a heavy DB join on every request. */
const CACHE_TTL_MS = 30_000; // 30 seconds
const CACHE_MAX_SIZE = 512;

function cookieExtractor(request: Request): string | null {
  const cookies = request.cookies as Record<string, string> | undefined;
  return cookies?.college_access ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor, ExtractJwt.fromAuthHeaderAsBearerToken()]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>("JWT_ACCESS_SECRET"),
    });
  }

  async validate(payload: AccessPayload): Promise<AuthPrincipal> {
    if (payload.typ !== "access") throw new UnauthorizedException("Invalid token type.");

    // Check cache first — avoids the heavy DB query on repeated requests
    const cacheKey = `${payload.sub}:${payload.sid}:${payload.nonce ?? "legacy"}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.principal;
    }

    const now = new Date();
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        college: { select: { isActive: true } },
        sessions: { where: { id: payload.sid }, take: 1 },
        roles: {
          where: {
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
            role: { isActive: true },
          },
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
        scopes: true,
        studentProfile: { select: { id: true } },
        staffProfile: { select: { id: true } },
      },
    });
    const session = user?.sessions[0];
    if (!user || !user.college.isActive || user.status !== "ACTIVE" || !session || session.revokedAt || session.expiresAt <= now) {
      this.cache.delete(cacheKey);
      throw new UnauthorizedException("The session is no longer valid.");
    }
    const activeRoles = user.roles.filter((mapping) => !mapping.role.collegeId || mapping.role.collegeId === user.collegeId);
    const roles = activeRoles.map((mapping) => mapping.role.code);
    const permissions = [...new Set(activeRoles.flatMap((mapping) => mapping.role.permissions.map((entry) => entry.permission.code)))];
    const profileCompletionStatus = this.profileCompletionStatus(roles, user);
    const principal: AuthPrincipal = {
      id: user.id,
      publicId: user.publicId,
      collegeId: user.collegeId,
      fullName: user.fullName,
      email: user.email,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      profileCompletionStatus,
      profileCompletionPercentage: user.profileCompletionPercentage,
      profileRejectionReason: user.profileRejectionReason,
      firstLoginCompletedAt: user.firstLoginCompletedAt,
      sessionId: session.id,
      roles,
      permissions,
      scopes: user.scopes.map((scope) => ({
        type: scope.scopeType,
        id: scope.scopeId,
        issueCategoryId: scope.issueCategoryId,
      })),
    };

    // Evict oldest entries if cache is too large
    if (this.cache.size >= CACHE_MAX_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    if (!principal.mustChangePassword && ["SUBMITTED", "VERIFIED"].includes(principal.profileCompletionStatus ?? "")) {
      this.cache.set(cacheKey, { principal, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    return principal;
  }

  private profileCompletionStatus(
    roles: string[],
    user: { profileCompletionStatus?: string; studentProfile?: { id: string } | null; staffProfile?: { id: string } | null },
  ): "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "VERIFIED" | "REJECTED" {
    if (roles.some((role) => ["SUPER_ADMIN", "MAIN_ADMIN"].includes(role))) {
      return "VERIFIED";
    }
    const needsStudentProfile = roles.includes("STUDENT") || roles.includes("CLASS_REPRESENTATIVE");
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
    const hasRequiredProfileRows = (!needsStudentProfile || Boolean(user.studentProfile)) && (!needsStaffProfile || Boolean(user.staffProfile));
    if (["IN_PROGRESS", "VERIFIED", "REJECTED"].includes(user.profileCompletionStatus ?? "")) {
      return user.profileCompletionStatus as "IN_PROGRESS" | "VERIFIED" | "REJECTED";
    }
    return hasRequiredProfileRows ? "SUBMITTED" : "NOT_STARTED";
  }
}
