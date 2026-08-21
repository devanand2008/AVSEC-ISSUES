import { describe, expect, it } from "vitest";
import {
  getActiveNavigationHref,
  getMobileBottomNav,
  isMobileNavigationItemActive,
  visibleNavigation,
} from "./navigation";

describe("visibleNavigation", () => {
  it("shows the newly linked work and administration routes to their exact permissions", () => {
    const routes = visibleNavigation([
      "issues.read_assigned",
      "academic.manage",
      "issue_config.manage",
    ]).map((item) => item.href);
    expect(routes).toContain("/assigned");
    expect(routes).toContain("/admin/academic/departments-sections");
    expect(routes).toContain("/admin/academic/degree-types");
    expect(routes).toContain("/admin/academic/academic-years");
    expect(routes).toContain("/admin/academic/programmes");
    expect(routes).toContain("/admin/academic/student-promotion");
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

  it("shows notifications only with read access and exposes own notification settings", () => {
    const withoutRead = visibleNavigation([]).map((item) => item.href);
    const withRead = visibleNavigation(["notifications.read_own"]).map(
      (item) => item.href,
    );

    expect(withoutRead).not.toContain("/notifications");
    expect(withRead).toContain("/notifications");
    expect(withoutRead).not.toContain("/settings/notifications");
    expect(withRead).toContain("/settings/notifications");
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

  it("shows Bulk imports only with a supported import permission", () => {
    expect(
      visibleNavigation(["users.read"]).map((item) => item.href),
    ).not.toContain("/admin/imports");
    expect(
      visibleNavigation(["attendance.import"]).map((item) => item.href),
    ).toContain("/admin/imports");
  });

  it("selects only the most specific matching sidebar route", () => {
    const candidates = [
      { href: "/attendance" },
      { href: "/attendance/corrections" },
      { href: "/admin/settings" },
      { href: "/admin/settings/database-backups" },
    ];

    expect(
      getActiveNavigationHref("/attendance/corrections/request-1", candidates),
    ).toBe("/attendance/corrections");
    expect(
      getActiveNavigationHref(
        "/admin/settings/database-backups",
        candidates,
      ),
    ).toBe("/admin/settings/database-backups");
    expect(getActiveNavigationHref("/attendance-extra", candidates)).toBeNull();
  });
});

describe("getMobileBottomNav", () => {
  it.each([
    ["admin", ["MAIN_ADMIN"]],
    ["maintenance", ["IT_SUPPORT"]],
    ["general", ["STUDENT"]],
  ])("uses the real profile page for %s users", (_label, roles) => {
    const profile = getMobileBottomNav(roles, []).find(
      (item) => item.label === "Profile",
    );

    expect(profile?.href).toBe("/profile");
  });

  it("uses the deployed exports page for the admin Reports tab", () => {
    const reports = getMobileBottomNav(["MAIN_ADMIN"], ["issues.export"]).find(
      (item) => item.label === "Reports",
    );

    expect(reports?.href).toBe("/admin/exports");
  });

  it.each(["PRINCIPAL", "VICE_PRINCIPAL"])(
    "does not show an inaccessible People tab to %s",
    (role) => {
      const items = getMobileBottomNav([role], [
        "attendance.export",
        "issues.export",
      ]);

      expect(items.map((item) => item.href)).not.toContain("/admin/people");
    },
  );

  it("shows People only when the user can read people", () => {
    expect(
      getMobileBottomNav(["MAIN_ADMIN"], ["users.read"]).map(
        (item) => item.href,
      ),
    ).toContain("/admin/people");
    expect(
      getMobileBottomNav(["MAIN_ADMIN"], []).map((item) => item.href),
    ).not.toContain("/admin/people");
  });

  it("shows Campus setup in the admin app tabs when location management is allowed", () => {
    const items = getMobileBottomNav(["MAIN_ADMIN"], ["locations.manage"]);

    expect(items.map((item) => item.href)).toContain("/admin/locations");
    expect(items.find((item) => item.href === "/admin/locations")?.label).toBe(
      "Campus",
    );
    expect(items.length).toBeLessThanOrEqual(5);
  });

  it.each([
    "MAINTENANCE_ADMIN",
    "MAINTENANCE_SUPERVISOR",
    "MAINTENANCE_STAFF",
    "ELECTRICIAN",
    "PLUMBER",
    "IT_SUPPORT",
    "LAB_TECHNICIAN",
    "HOUSEKEEPING",
    "SECURITY",
    "OTHER_RESPONSIBLE",
  ])("uses the maintenance tabs for backend role %s", (role) => {
    expect(getMobileBottomNav([role], [])[0]?.href).toBe("/assigned");
  });

  it("matches query-based maintenance tabs against the live search params", () => {
    expect(
      isMobileNavigationItemActive(
        "/issues?status=IN_PROGRESS",
        "/issues",
        "status=IN_PROGRESS",
      ),
    ).toBe(true);
    expect(
      isMobileNavigationItemActive(
        "/issues?status=OVERDUE",
        "/issues",
        "status=IN_PROGRESS",
      ),
    ).toBe(false);
    expect(
      isMobileNavigationItemActive(
        "/issues?status=OVERDUE",
        "/issues",
        "status=OVERDUE&page=2",
      ),
    ).toBe(true);
    expect(
      isMobileNavigationItemActive(
        "/issues?status=OVERDUE",
        "/issues/issue-1",
        "status=OVERDUE",
      ),
    ).toBe(false);
  });
});
