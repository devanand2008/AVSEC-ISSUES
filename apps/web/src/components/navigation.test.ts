import { describe, expect, it } from "vitest";
import { visibleNavigation } from "./navigation";

describe("visibleNavigation", () => {
  it("shows the newly linked work and administration routes to their exact permissions", () => {
    const routes = visibleNavigation([
      "issues.read_assigned",
      "academic.manage",
      "issue_config.manage",
    ]).map((item) => item.href);
    expect(routes).toContain("/assigned");
    expect(routes).toContain("/admin/academic");
    expect(routes).toContain("/admin/categories");
    expect(routes).not.toContain("/admin/settings");
  });

  it.each(["settings.read", "settings.manage", "integrations.manage"])(
    "shows settings for %s",
    (permission) => {
      expect(
        visibleNavigation([permission]).map((item) => item.href),
      ).toContain("/admin/settings");
    },
  );

  it.each(["settings.read", "integrations.manage", "backups.manage"])(
    "shows storage and backups for %s",
    (permission) => {
      expect(
        visibleNavigation([permission]).map((item) => item.href),
      ).toContain("/settings/storage");
    },
  );

  it("hides storage and backups without an administrative storage permission", () => {
    expect(
      visibleNavigation(["issues.read"]).map((item) => item.href),
    ).not.toContain("/settings/storage");
  });

  it("shows scoped staff rating and insights routes to management roles", () => {
    const hod = visibleNavigation(["feedback.read_department"], ["HOD"]).map(
      (item) => item.href,
    );
    const managementPermissions = [
      "feedback.read_college",
      "attendance.read_college",
    ];
    const vicePrincipal = visibleNavigation(managementPermissions, [
      "VICE_PRINCIPAL",
    ]).map((item) => item.href);
    const principal = visibleNavigation(managementPermissions, [
      "PRINCIPAL",
    ]).map((item) => item.href);

    expect(hod).toContain("/hod/staff-ratings");
    expect(vicePrincipal).toContain("/vice-principal/staff-ratings");
    expect(vicePrincipal).toContain("/vice-principal/management-insights");
    expect(principal).toContain("/principal/management-insights");
    expect(
      visibleNavigation(["feedback.read_college"], ["VICE_PRINCIPAL"]).map(
        (item) => item.href,
      ),
    ).not.toContain("/vice-principal/management-insights");
  });

  it("shows AVS Bot only to users with AI access", () => {
    expect(visibleNavigation(["ai.use"]).map((item) => item.href)).toContain(
      "/avs-bot",
    );
    expect(visibleNavigation([]).map((item) => item.href)).not.toContain(
      "/avs-bot",
    );
  });

  it("maps each feedback administration route to its exact permission and admin role", () => {
    const permissions = [
      "feedback.targets.manage",
      "feedback.questions.manage",
      "feedback.cycles.manage",
      "feedback.actions.manage",
      "feedback.qr.manage",
      "feedback.export",
      "feedback.settings.manage",
    ];
    const routes = visibleNavigation(permissions, ["MAIN_ADMIN"]).map(
      (item) => item.href,
    );

    expect(routes).toEqual(
      expect.arrayContaining([
        "/admin/feedback/targets",
        "/admin/feedback/questions",
        "/admin/feedback/cycles",
        "/admin/feedback/submissions",
        "/admin/qr-management",
        "/admin/feedback/qr-management",
        "/admin/feedback/reports",
        "/admin/feedback/settings",
      ]),
    );
    expect(
      visibleNavigation(permissions, ["FACULTY"]).map((item) => item.href),
    ).not.toContain("/admin/feedback/targets");
  });
});
