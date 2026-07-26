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
    const isProfileVerificationExempt = user?.roles?.some((role) =>
      ["SUPER_ADMIN", "MAIN_ADMIN"].includes(role),
    );
    if (
      !user ||
      user.mustChangePassword ||
      isProfileVerificationExempt ||
      !["NOT_STARTED", "IN_PROGRESS", "REJECTED", "SUBMITTED"].includes(
        user.profileCompletionStatus ?? "SUBMITTED",
      )
    ) {
      return true;
    }
    if (this.isAllowedProfileSetupPath(request.originalUrl)) return true;
    throw new ForbiddenException(
      "Complete your profile to access the application.",
    );
  }

  private isAllowedProfileSetupPath(originalUrl = ""): boolean {
    const prefix = this.config
      .get<string>("API_PREFIX", "api/v1")
      .replace(/^\/+|\/+$/g, "");
    const path = originalUrl.split("?", 1)[0] ?? "";
    const authBase = `/${prefix}/auth`;
    const profileBase = `/${prefix}/users/me/profile`;
    const academicBase = `/${prefix}/academic`;
    const allowed = [
      `${authBase}/me`,
      `${authBase}/logout`,
      `${authBase}/sessions`,
      `${authBase}/sessions/revoke-others`,
      `${profileBase}`,
      `${profileBase}/submit`,
      `${profileBase}/photo`,
      `/${prefix}/users/me/profile-requirements`,
      `${academicBase}/departments`,
      `${academicBase}/programmes`,
      `${academicBase}/years`,
      `${academicBase}/semesters`,
      `${academicBase}/sections`,
    ];
    return allowed.includes(path) || path.startsWith(`${authBase}/sessions/`);
  }
}
