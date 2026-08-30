import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import type { AuthenticatedRequest } from "../http/request-context";

const MANAGED_PROFILE_ROLES = new Set([
  "STUDENT",
  "CLASS_REPRESENTATIVE",
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

const INCOMPLETE_PROFILE_STATUSES = new Set([
  "NOT_STARTED",
  "IN_PROGRESS",
  "REJECTED",
]);

@Injectable()
export class ProfileCompletionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (
      !user ||
      user.mustChangePassword ||
      !INCOMPLETE_PROFILE_STATUSES.has(user.profileCompletionStatus ?? "") ||
      !user.roles?.some((role) => MANAGED_PROFILE_ROLES.has(role))
    ) {
      return true;
    }

    const prefix = this.config
      .get<string>("API_PREFIX", "api/v1")
      .replace(/^\/+|\/+$/g, "");
    const base = `/${prefix}`;
    const path = request.originalUrl.split("?", 1)[0] ?? "";
    const method = request.method?.toUpperCase() ?? "GET";

    const alwaysAllowed = new Set([
      `${base}/auth/me`,
      `${base}/auth/logout`,
      `${base}/auth/sessions`,
      `${base}/users/me/profile-requirements`,
      `${base}/students/me/profile-requirements`,
      `${base}/profile/me`,
      `${base}/profile/me/status`,
      `${base}/users/me/profile`,
      `${base}/students/me/profile`,
      `${base}/users/me/profile/submit`,
      `${base}/students/me/profile/submit`,
    ]);
    if (
      alwaysAllowed.has(path) ||
      path.startsWith(`${base}/auth/sessions/`) ||
      path === `${base}/profile/me/photo` ||
      path === `${base}/profile/me/photo/complete`
    ) {
      return true;
    }

    const academicReads = [
      `${base}/academic/departments`,
      `${base}/academic/programmes`,
      `${base}/academic/years`,
      `${base}/academic/semesters`,
      `${base}/academic/sections`,
    ];
    if (method === "GET" && academicReads.includes(path)) return true;

    throw new ForbiddenException(
      "Complete and submit your profile before using the portal.",
    );
  }
}
