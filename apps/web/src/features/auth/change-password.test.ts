import { describe, expect, it } from "vitest";
import { ApiError, ApiNetworkError } from "@/lib/api";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordChangeErrorMessage,
  passwordChecks,
  passwordIdentityCheck,
  passwordInputError,
} from "./change-password";

describe("passwordChecks", () => {
  it("keeps the browser rules aligned with the API password DTO", () => {
    const checks = passwordChecks("Old-password-1", "Valid-password-2");

    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(checks.every((check) => check.ok)).toBe(true);
  });

  it("requires a new value that differs from the temporary password", () => {
    const password = "Same-password-1";

    expect(
      passwordChecks(password, password).find(
        (check) => check.label === "Different from temporary password",
      )?.ok,
    ).toBe(false);
  });
});

describe("passwordIdentityCheck", () => {
  const identity = {
    fullName: "Alice B Rao",
    email: "alice.rao@example.edu",
  };

  it("rejects a case-insensitive name token with at least three characters", () => {
    expect(passwordIdentityCheck("Secure-RAO-2048", identity).ok).toBe(false);
  });

  it("rejects a case-insensitive full email address", () => {
    expect(
      passwordIdentityCheck("Prefix-ALICE.RAO@EXAMPLE.EDU-2048", identity).ok,
    ).toBe(false);
  });

  it("allows an unrelated password and ignores name tokens below three characters", () => {
    expect(passwordIdentityCheck("Secure-B-2048", identity).ok).toBe(true);
  });
});

describe("passwordInputError", () => {
  it("requires the temporary password before the request is sent", () => {
    expect(passwordInputError("", "Valid-password-2", "Valid-password-2")).toBe(
      "Enter your temporary password.",
    );
  });

  it("keeps all password inputs within the API maximum", () => {
    const tooLong = "A".repeat(MAX_PASSWORD_LENGTH + 1);
    expect(
      passwordInputError(tooLong, "Valid-password-2", "Valid-password-2"),
    ).toBe("The temporary password is too long.");
    expect(passwordInputError("Old-password-1", tooLong, tooLong)).toBe(
      "The new password is too long.",
    );
  });

  it("accepts bounded nonempty inputs", () => {
    expect(
      passwordInputError(
        "Old-password-1",
        "Valid-password-2",
        "Valid-password-2",
      ),
    ).toBeNull();
  });
});

describe("passwordChangeErrorMessage", () => {
  it.each([
    [
      "The new password must be different.",
      "The new password must be different.",
    ],
    [
      "The new password must not contain your college ID.",
      "The new password must not contain your college ID.",
    ],
    [
      "The new password must not contain your email address.",
      "The new password must not contain your email address.",
    ],
    [
      "The new password must not contain your name.",
      "The new password must not contain your name.",
    ],
  ])("shows a safe HTTP 409 policy message", (serverMessage, expected) => {
    expect(passwordChangeErrorMessage(new ApiError(serverMessage, 409))).toBe(
      expected,
    );
  });

  it("does not expose an unexpected HTTP 409 response", () => {
    expect(
      passwordChangeErrorMessage(
        new ApiError("unexpected sensitive database detail", 409),
      ),
    ).toBe(
      "The new password conflicts with the account password policy. Choose a different password.",
    );
  });

  it("maps DTO validation failures to the checklist", () => {
    expect(
      passwordChangeErrorMessage(
        new ApiError("newPassword failed internal validation", 400),
      ),
    ).toBe(
      "The new password does not meet every password requirement. Review the checklist and try again.",
    );
  });

  it("gives actionable current-password and session guidance", () => {
    expect(
      passwordChangeErrorMessage(
        new ApiError("The current password is incorrect.", 401),
      ),
    ).toContain("temporary password is incorrect or your session expired");
  });

  it.each([
    ["offline", "This device is offline."],
    ["timeout", "The AVS server took too long to respond."],
    ["unreachable", "The AVS server could not be reached."],
  ] as const)("maps the %s network failure", (kind, expectedStart) => {
    expect(passwordChangeErrorMessage(new ApiNetworkError(kind))).toContain(
      expectedStart,
    );
  });

  it("treats timeout completion as indeterminate before another submission", () => {
    expect(
      passwordChangeErrorMessage(new ApiNetworkError("timeout")),
    ).toContain("check whether the change completed before submitting again");
  });

  it("uses a safe fallback for server failures", () => {
    expect(
      passwordChangeErrorMessage(
        new ApiError("unexpected sensitive database detail", 503),
      ),
    ).toBe(
      "The AVS server could not change the password right now. Please try again.",
    );
  });

  it("uses a safe fallback for unknown failures", () => {
    expect(passwordChangeErrorMessage(new Error("sensitive input"))).toBe(
      "Password change failed. Please try again.",
    );
  });
});
