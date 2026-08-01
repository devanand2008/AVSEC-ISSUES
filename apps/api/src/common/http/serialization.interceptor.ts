import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";

export function serializeForTransport(value: unknown): unknown {
  if (value instanceof StreamableFile) return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.map((item) => serializeForTransport(item));
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        serializeForTransport(item),
      ]),
    );
  }
  return value;
}

@Injectable()
export class SerializationInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(serializeForTransport));
  }
}
