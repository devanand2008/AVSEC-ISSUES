import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { isAllowedOriginFromConfig } from "../http/allowed-origins";

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    if (/^Bearer\s+\S+$/i.test(request.header("authorization") ?? ""))
      return true;
    const origin = request.header("origin");
    if (origin && !isAllowedOriginFromConfig(this.config, origin))
      throw new ForbiddenException("Request origin is not allowed.");
    const cookies = request.cookies as Record<string, string> | undefined;
    const header = request.header("x-csrf-token");
    const cookie = cookies?.college_csrf;
    if (!header || !cookie)
      throw new ForbiddenException("CSRF validation failed.");
    const left = Buffer.from(header);
    const right = Buffer.from(cookie);
    if (left.length !== right.length || !timingSafeEqual(left, right))
      throw new ForbiddenException("CSRF validation failed.");
    return true;
  }
}
