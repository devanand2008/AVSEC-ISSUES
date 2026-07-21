import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthenticatedRequest, AuthPrincipal } from "../http/request-context";

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
