import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import type { RequestWithId } from "./request-context";

interface ValidationErrorResponse {
  message?: string | string[];
  error?: string;
  statusCode?: number;
  code?: string;
  details?: unknown;
  duplicate?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<Response>();
    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = isHttp ? (exception.getResponse() as string | ValidationErrorResponse) : undefined;
    const rawMessage = typeof raw === "string" ? raw : raw?.message;
    const messages = Array.isArray(rawMessage) ? rawMessage : rawMessage ? [rawMessage] : [];
    const responseBody = typeof raw === "object" ? raw : undefined;
    const code = responseBody?.code ?? this.codeForStatus(status);

    response.status(status).json({
      error: {
        code,
        message:
          status === HttpStatus.INTERNAL_SERVER_ERROR
            ? "An unexpected error occurred."
            : messages[0] ?? HttpStatus[status] ?? "Request failed.",
        requestId: request.id,
        ...(responseBody?.details !== undefined || responseBody?.duplicate !== undefined
          ? { details: responseBody.details ?? responseBody.duplicate }
          : messages.length > 1
          ? { details: messages.map((message) => ({ message })) }
          : {}),
      },
    });
  }

  private codeForStatus(status: number): string {
    const map: Record<number, string> = {
      400: "VALIDATION_ERROR",
      401: "UNAUTHENTICATED",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      409: "CONFLICT",
      413: "PAYLOAD_TOO_LARGE",
      429: "RATE_LIMITED",
    };
    return map[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");
  }
}
