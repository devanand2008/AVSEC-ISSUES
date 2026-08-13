import { describe, expect, it } from "vitest";
import {
  academicMasterDate,
  buildAcademicYearCreatePayload,
  buildAcademicYearUpdatePayload,
  buildDegreeTypePayload,
  buildProgrammeCreatePayload,
  buildProgrammeUpdatePayload,
  validateAcademicYearDraft,
  validateDegreeTypeDraft,
  validateProgrammeDraft,
} from "./academic-masters";

describe("academic master helpers", () => {
  it("normalizes a configurable Degree Type without hardcoding choices", () => {
    const draft = {
      code: " be ",
      name: " B.E. ",
      description: " Bachelor of Engineering ",
      sortOrder: "1",
      isActive: true,
    };
    expect(validateDegreeTypeDraft(draft)).toBeNull();
    expect(buildDegreeTypePayload(draft)).toEqual({
      code: "BE",
      name: "B.E.",
      description: "Bachelor of Engineering",
      sortOrder: 1,
      isActive: true,
    });
  });

  it("requires an ordered Academic Year range and preserves current status", () => {
    const draft = {
      name: "2026-2027",
      startYear: "2026",
      endYear: "2027",
      startsOn: "2026-07-01",
      endsOn: "2027-06-30",
      isCurrent: true,
      isActive: true,
    };
    expect(validateAcademicYearDraft(draft)).toBeNull();
    expect(buildAcademicYearCreatePayload(draft)).toEqual({
      name: "2026-2027",
      startsOn: "2026-07-01",
      endsOn: "2027-06-30",
      isCurrent: true,
      isActive: true,
    });
    expect(buildAcademicYearUpdatePayload(draft)).toEqual({
      name: "2026-2027",
      startsOn: "2026-07-01",
      endsOn: "2027-06-30",
      isActive: true,
    });
    expect(
      validateAcademicYearDraft({ ...draft, endsOn: "2026-01-01" }),
    ).toMatch(/later than/i);
    expect(
      validateAcademicYearDraft({ ...draft, endYear: "2026" }),
    ).toMatch(/greater than/i);
    expect(academicMasterDate("2026-07-01T00:00:00.000Z")).toBe("2026-07-01");
  });

  it("stores Degree Type independently from Department and Programme", () => {
    const draft = {
      code: " cse ",
      name: " Computer Science and Engineering ",
      departmentId: "department-cse",
      degreeTypeId: "degree-be",
      durationYears: "4",
      totalSemesters: "8",
      isActive: true,
    };
    expect(validateProgrammeDraft(draft)).toBeNull();
    expect(buildProgrammeCreatePayload(draft)).toEqual({
      code: "CSE",
      name: "Computer Science and Engineering",
      departmentId: "department-cse",
      degreeTypeId: "degree-be",
      durationYears: 4,
      totalSemesters: 8,
      isActive: true,
    });
    expect(buildProgrammeUpdatePayload(draft)).toEqual({
      code: "CSE",
      name: "Computer Science and Engineering",
      degreeTypeId: "degree-be",
      durationYears: 4,
      totalSemesters: 8,
      isActive: true,
    });

    expect(validateProgrammeDraft({ ...draft, durationYears: "5" })).toBe(
      "Duration must be a whole number from 1 to 4.",
    );
    expect(validateProgrammeDraft({ ...draft, totalSemesters: "9" })).toBe(
      "Total semesters must be a whole number from 1 to 8.",
    );
  });
});
