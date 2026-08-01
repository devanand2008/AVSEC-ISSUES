import { describe, expect, it } from "vitest";
import { dashboardKindForRoles } from "./dashboard-role";

describe("dashboardKindForRoles", () => {
  it.each([
    ["MAIN_ADMIN", "admin"],
    ["ACADEMIC_ADMIN", "admin"],
    ["PRINCIPAL", "principal"],
    ["VICE_PRINCIPAL", "vice-principal"],
    ["HOD", "hod"],
    ["CLASS_COORDINATOR", "faculty"],
    ["FACULTY", "faculty"],
    ["CLASS_REPRESENTATIVE", "student"],
    ["STUDENT", "student"],
    ["MAINTENANCE_ADMIN", "maintenance"],
    ["MAINTENANCE_SUPERVISOR", "maintenance"],
    ["ELECTRICIAN", "maintenance"],
    ["PLUMBER", "maintenance"],
    ["IT_SUPPORT", "maintenance"],
    ["LAB_TECHNICIAN", "maintenance"],
    ["HOUSEKEEPING", "maintenance"],
    ["SECURITY", "maintenance"],
    ["GENERAL_STAFF", "staff"],
  ] as const)("maps %s to %s", (role, expected) => {
    expect(dashboardKindForRoles([role])).toBe(expected);
  });

  it("uses the highest-privilege role when a user has several roles", () => {
    expect(dashboardKindForRoles(["STUDENT", "MAIN_ADMIN"])).toBe("admin");
  });
});
