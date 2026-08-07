import { describe, expect, it } from "vitest";
import { ApiError, ApiNetworkError } from "@/lib/api";
import { loginErrorMessage } from "./login-error";

describe("loginErrorMessage", () => {
  it("uses the credential message only for an authentication rejection", () => {
    expect(loginErrorMessage(new ApiError("Unauthorized", 401))).toBe(
      "Incorrect college ID, email, password, or college code.",
    );
  });

  it("does not describe a missing endpoint as invalid credentials", () => {
    expect(loginErrorMessage(new ApiError("Not found", 404))).toContain(
      "update the installed app",
    );
  });

  it("explains Render cold-start timeouts", () => {
    expect(loginErrorMessage(new ApiNetworkError("timeout"))).toContain(
      "taking longer than expected to start",
    );
  });

  it("distinguishes an offline device from an unavailable server", () => {
    expect(loginErrorMessage(new ApiNetworkError("offline"), false)).toContain(
      "offline",
    );
    expect(
      loginErrorMessage(new ApiNetworkError("unreachable"), true),
    ).toContain("could not be reached");
  });

  it("uses a temporary-service message for gateway failures", () => {
    expect(
      loginErrorMessage(new ApiError("Service unavailable", 503)),
    ).toContain("temporarily unavailable");
  });

  it("maps access and required-action states and retains the request reference", () => {
    expect(
      loginErrorMessage(
        new ApiError(
          "This account is SUSPENDED.",
          403,
          undefined,
          undefined,
          "req-403",
        ),
      ),
    ).toBe(
      "This account is suspended. Contact the college administrator for access. Reference: req-403.",
    );
    expect(
      loginErrorMessage(new ApiError("Password action required", 409)),
    ).toContain("requires a password or profile action");
  });
});
