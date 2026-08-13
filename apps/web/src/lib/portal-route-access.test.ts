import { describe, expect, it } from "vitest";
import { canAccessPortalPath } from "./portal-route-access";

describe("canAccessPortalPath", () => {
  it("gates storage settings by its read, integration, or backup permission", () => {
    for (const permission of [
      "settings.read",
      "integrations.manage",
      "backups.manage",
    ]) {
      expect(
        canAccessPortalPath("/settings/storage", [permission], []),
      ).toBe(true);
    }
    expect(canAccessPortalPath("/settings/storage", [], [])).toBe(false);
  });

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

  it("gates people, imports, and exports by their page permissions", () => {
    expect(canAccessPortalPath("/admin/people", [], ["PRINCIPAL"])).toBe(
      false,
    );
    expect(
      canAccessPortalPath("/admin/people/person-1", ["users.read"], []),
    ).toBe(true);
    expect(canAccessPortalPath("/admin/imports", ["users.read"], [])).toBe(
      false,
    );
    expect(
      canAccessPortalPath("/admin/imports", ["attendance.import"], []),
    ).toBe(true);
    expect(canAccessPortalPath("/admin/exports", ["issues.read"], [])).toBe(
      false,
    );
    expect(
      canAccessPortalPath("/admin/exports", ["issues.export"], []),
    ).toBe(true);
  });

  it("allows account creators to open Add Person without broad People read access", () => {
    expect(
      canAccessPortalPath("/admin/people/new", ["users.create"], []),
    ).toBe(true);
    expect(
      canAccessPortalPath("/admin/people/new", ["users.read"], []),
    ).toBe(false);
  });

  it("gates both academic setup routes by academic management permission", () => {
    expect(
      canAccessPortalPath(
        "/admin/academic/departments-sections",
        ["academic.manage"],
        [],
      ),
    ).toBe(true);
    expect(canAccessPortalPath("/admin/academic", [], ["MAIN_ADMIN"])).toBe(
      false,
    );
    for (const path of [
      "/admin/academic/degree-types",
      "/admin/academic/academic-years",
      "/admin/academic/programmes",
      "/admin/academic/student-promotion",
    ]) {
      expect(canAccessPortalPath(path, ["academic.manage"], [])).toBe(true);
      expect(canAccessPortalPath(path, ["academic.read"], [])).toBe(false);
    }
  });
});
