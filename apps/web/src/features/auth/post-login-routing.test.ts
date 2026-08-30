import { describe, expect, it } from "vitest";
import type { User } from "@/lib/types";
import {
  getPostAuthenticationRoute,
  requiresProfileSetup,
} from "./post-login-routing";

function user(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    fullName: "AVS Student",
    email: "student@example.edu",
    status: "ACTIVE",
    mustChangePassword: false,
    roles: ["STUDENT"],
    permissions: [],
    ...overrides,
  };
}

describe("post-authentication routing", () => {
  it("honours the profile setup route returned by the API", () => {
    const account = user({
      allowedNextRoute: "/profile/setup",
      profileCompletionStatus: "NOT_STARTED",
    });

    expect(requiresProfileSetup(account)).toBe(true);
    expect(getPostAuthenticationRoute(account)).toBe("/profile/setup");
  });

  it("keeps password change ahead of profile setup", () => {
    expect(
      getPostAuthenticationRoute(
        user({
          mustChangePassword: true,
          allowedNextRoute: "/profile/setup",
        }),
      ),
    ).toBe("/change-password");
  });

  it("uses incomplete managed-profile status as a legacy fallback", () => {
    expect(
      getPostAuthenticationRoute(
        user({
          allowedNextRoute: undefined,
          profileCompletionStatus: "IN_PROGRESS",
        }),
      ),
    ).toBe("/profile/setup");
  });

  it("does not force an admin with a legacy incomplete status into setup", () => {
    expect(
      getPostAuthenticationRoute(
        user({
          roles: ["MAIN_ADMIN"],
          allowedNextRoute: undefined,
          profileCompletionStatus: "NOT_STARTED",
        }),
      ),
    ).toBe("/");
  });

  it("allows submitted and verified profiles into the portal", () => {
    expect(
      getPostAuthenticationRoute(
        user({
          profileCompletionStatus: "SUBMITTED",
          allowedNextRoute: "/",
        }),
      ),
    ).toBe("/");
    expect(
      getPostAuthenticationRoute(
        user({
          profileCompletionStatus: "VERIFIED",
          allowedNextRoute: "/",
        }),
      ),
    ).toBe("/");
  });
});
