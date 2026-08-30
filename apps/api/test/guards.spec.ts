import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Reflector } from "@nestjs/core";
import { CsrfGuard } from "../src/common/guards/csrf.guard";
import { PasswordChangeGuard } from "../src/common/guards/password-change.guard";
import { ProfileCompletionGuard } from "../src/common/guards/profile-completion.guard";
import { PermissionsGuard } from "../src/common/guards/permissions.guard";
import { PERMISSIONS_KEY } from "../src/common/decorators/permissions.decorator";
import { IS_PUBLIC_KEY } from "../src/common/decorators/public.decorator";

function reflector(permissions?: string[]): Reflector {
  return {
    getAllAndOverride: jest.fn((key: string) =>
      key === IS_PUBLIC_KEY
        ? false
        : key === PERMISSIONS_KEY
          ? permissions
          : undefined,
    ),
  } as unknown as Reflector;
}

function context(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("authorization guards", () => {
  it("requires every declared permission", () => {
    const guard = new PermissionsGuard(
      reflector(["issues.assign", "issues.read_all"]),
    );
    expect(() =>
      guard.canActivate(context({ user: { permissions: ["issues.assign"] } })),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(
        context({
          user: { permissions: ["issues.assign", "issues.read_all"] },
        }),
      ),
    ).toBe(true);
  });

  it("rejects cookie mutations without a matching CSRF token", () => {
    const guard = new CsrfGuard(
      reflector(),
      new ConfigService({ WEB_URL: "https://college.example" }),
    );
    const request = {
      method: "POST",
      cookies: { college_csrf: "expected" },
      header: (name: string) =>
        name === "origin" ? "https://college.example" : undefined,
    };
    expect(() => guard.canActivate(context(request))).toThrow(
      ForbiddenException,
    );
  });

  it("accepts a same-origin mutation with a constant-time comparable token", () => {
    const guard = new CsrfGuard(
      reflector(),
      new ConfigService({ WEB_URL: "https://college.example" }),
    );
    const request = {
      method: "POST",
      cookies: { college_csrf: "expected" },
      header: (name: string) =>
        ({ origin: "https://college.example", "x-csrf-token": "expected" })[
          name
        ],
    };
    expect(guard.canActivate(context(request))).toBe(true);
  });

  it("accepts a configured local app origin when the LAN URL is the primary web URL", () => {
    const guard = new CsrfGuard(
      reflector(),
      new ConfigService({
        WEB_URL: "http://10.181.158.176:3000",
        CORS_ALLOWED_ORIGINS: "http://localhost:3000,http://127.0.0.1:3000",
      }),
    );
    const request = {
      method: "POST",
      cookies: { college_csrf: "expected" },
      header: (name: string) =>
        ({ origin: "http://localhost:3000", "x-csrf-token": "expected" })[name],
    };
    expect(guard.canActivate(context(request))).toBe(true);
  });

  it("accepts the current private Wi-Fi address on the configured local web port", () => {
    const guard = new CsrfGuard(
      reflector(),
      new ConfigService({ WEB_URL: "http://localhost:3100" }),
    );
    const request = {
      method: "POST",
      cookies: { college_csrf: "expected" },
      header: (name: string) =>
        ({
          origin: "http://10.91.212.176:3100",
          "x-csrf-token": "expected",
        })[name],
    };
    expect(guard.canActivate(context(request))).toBe(true);
  });

  it("rejects a private Wi-Fi origin on an unexpected web port", () => {
    const guard = new CsrfGuard(
      reflector(),
      new ConfigService({ WEB_URL: "http://localhost:3100" }),
    );
    const request = {
      method: "POST",
      cookies: { college_csrf: "expected" },
      header: (name: string) =>
        ({
          origin: "http://10.91.212.176:9999",
          "x-csrf-token": "expected",
        })[name],
    };
    expect(() => guard.canActivate(context(request))).toThrow(
      ForbiddenException,
    );
  });

  it("exempts an authenticated Bearer mutation from cookie CSRF", () => {
    const guard = new CsrfGuard(
      reflector(),
      new ConfigService({ WEB_URL: "https://college.example" }),
    );
    const request = {
      method: "POST",
      header: (name: string) =>
        name === "authorization" ? "bearer token-value" : undefined,
    };
    expect(guard.canActivate(context(request))).toBe(true);
  });

  it("limits temporary-password sessions to security endpoints", () => {
    const guard = new PasswordChangeGuard(
      reflector(),
      new ConfigService({ API_PREFIX: "service/v2" }),
    );
    expect(() =>
      guard.canActivate(
        context({
          originalUrl: "/service/v2/issues",
          user: { mustChangePassword: true },
        }),
      ),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(
        context({
          originalUrl: "/service/v2/auth/change-password",
          user: { mustChangePassword: true },
        }),
      ),
    ).toBe(true);
  });

  it("limits incomplete-profile users to profile setup and its academic lookups", () => {
    const guard = new ProfileCompletionGuard(
      reflector(),
      new ConfigService({ API_PREFIX: "service/v2" }),
    );
    expect(
      guard.canActivate(
        context({
          originalUrl: "/service/v2/auth/change-password",
          method: "POST",
          user: {
            mustChangePassword: true,
            profileCompletionStatus: "NOT_STARTED",
            roles: ["STUDENT"],
          },
        }),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        context({
          originalUrl: "/service/v2/learn/courses",
          method: "GET",
          user: {
            mustChangePassword: false,
            profileCompletionStatus: "NOT_STARTED",
            roles: ["STUDENT"],
          },
        }),
      ),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(
        context({
          originalUrl: "/service/v2/users/me/profile/submit",
          method: "POST",
          user: {
            mustChangePassword: false,
            profileCompletionStatus: "REJECTED",
            roles: ["STUDENT"],
          },
        }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        context({
          originalUrl: "/service/v2/academic/sections?semesterId=semester-id",
          method: "GET",
          user: {
            mustChangePassword: false,
            profileCompletionStatus: "IN_PROGRESS",
            roles: ["STUDENT"],
          },
        }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        context({
          originalUrl: "/service/v2/issues",
          method: "GET",
          user: {
            mustChangePassword: false,
            profileCompletionStatus: "SUBMITTED",
            roles: ["STUDENT"],
          },
        }),
      ),
    ).toBe(true);
  });
});
