import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";
import { ulid } from "ulid";
import type { RequestWithId } from "./request-context";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,80}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const supplied = request.header("x-request-id");
    request.id = supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : ulid();
    response.setHeader("x-request-id", request.id);
    next();
  }
}
