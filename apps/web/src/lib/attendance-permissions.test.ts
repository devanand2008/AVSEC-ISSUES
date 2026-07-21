import { describe, expect, it } from "vitest";
import { canViewAttendanceSessions } from "./attendance-permissions";

describe("canViewAttendanceSessions", () => {
  it("keeps class sessions visible for a multi-role student and coordinator", () => {
    expect(canViewAttendanceSessions(["attendance.read_own", "attendance.read_class"])).toBe(true);
  });

  it("keeps the student-only view limited to the personal summary", () => {
    expect(canViewAttendanceSessions(["attendance.read_own"])).toBe(false);
  });
});
