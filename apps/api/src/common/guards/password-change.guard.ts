import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "../http/request-context";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

@Injectable()
export class PasswordChangeGuard implements CanActivate {
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
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.mustChangePassword) return true;
    const prefix = this.config
      .get<string>("API_PREFIX", "api/v1")
      .replace(/^\/+|\/+$/g, "");
    const authBase = `/${prefix}/auth`;
    const path = request.originalUrl.split("?", 1)[0] ?? "";
    const allowed = [
      `${authBase}/me`,
      `${authBase}/change-password`,
      `${authBase}/change-first-password`,
      `${authBase}/logout`,
      `${authBase}/sessions`,
    ];
    if (allowed.includes(path) || path.startsWith(`${authBase}/sessions/`))
      return true;
    throw new ForbiddenException(
      "You must change your temporary password before continuing.",
    );
  }
}
