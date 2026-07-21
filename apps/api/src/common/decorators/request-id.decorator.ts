import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { RequestWithId } from "../http/request-context";

export const CurrentRequestId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => context.switchToHttp().getRequest<RequestWithId>().id,
);
