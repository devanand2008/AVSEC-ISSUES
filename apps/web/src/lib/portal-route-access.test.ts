import { describe, expect, it } from "vitest";
import { canAccessPortalPath } from "./portal-route-access";

describe("canAccessPortalPath", () => {
  it("allows dynamic student feedback routes only to a permitted student role", () => {
    expect(
      canAccessPortalPath(
        "/student/feedback/target/FB_demo",
        ["feedback.scan", "feedback.submit"],
        ["STUDENT"],
      ),
    ).toBe(true);
    expect(
      canAccessPortalPath(
        "/student/feedback/target/FB_demo",
        ["feedback.scan"],
        ["STUDENT"],
      ),
    ).toBe(false);
    expect(
      canAccessPortalPath(
        "/student/feedback/target/FB_demo",
        ["feedback.scan", "feedback.submit"],
        ["FACULTY"],
      ),
    ).toBe(false);
  });

  it("enforces both role and page-specific management permission", () => {
    expect(
      canAccessPortalPath(
        "/hod/staff-ratings/staff-1",
        ["feedback.read_department"],
        ["HOD"],
      ),
    ).toBe(true);
    expect(
      canAccessPortalPath(
        "/hod/staff-ratings/staff-1",
        ["feedback.read_college"],
        ["PRINCIPAL"],
      ),
    ).toBe(false);
    expect(
      canAccessPortalPath(
        "/principal/attendance",
        ["feedback.read_college"],
        ["PRINCIPAL"],
      ),
    ).toBe(false);
  });

  it("requires both analytics domains for combined management insights", () => {
    expect(
      canAccessPortalPath(
        "/vice-principal/management-insights",
        ["feedback.read_college", "attendance.read_college"],
        ["VICE_PRINCIPAL"],
      ),
    ).toBe(true);
    expect(
      canAccessPortalPath(
        "/vice-principal/management-insights",
        ["feedback.read_college"],
        ["VICE_PRINCIPAL"],
      ),
    ).toBe(false);
  });

  it("maps feedback administration routes to exact permissions", () => {
    expect(
      canAccessPortalPath(
        "/admin/feedback/questions",
        ["feedback.questions.manage"],
        ["MAIN_ADMIN"],
      ),
    ).toBe(true);
    expect(
      canAccessPortalPath(
        "/admin/feedback/questions",
        ["feedback.targets.manage"],
        ["MAIN_ADMIN"],
      ),
    ).toBe(false);
  });

  it("allows the admin QR hub to QR-capable admin roles only", () => {
    expect(
      canAccessPortalPath(
        "/admin/qr-management",
        ["locations.qr"],
        ["MAIN_ADMIN"],
      ),
    ).toBe(true);
    expect(
      canAccessPortalPath(
        "/admin/qr-management",
        ["locations.qr"],
        ["FACULTY"],
      ),
    ).toBe(false);
  });

  it("does not block shared issue or attendance detail routes", () => {
    expect(canAccessPortalPath("/issues/issue-1", [], [])).toBe(true);
    expect(canAccessPortalPath("/attendance/session-1", [], [])).toBe(true);
  });
});
