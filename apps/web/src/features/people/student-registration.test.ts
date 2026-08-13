import { describe, expect, it } from "vitest";
import { createBlankPersonForm } from "./create-person";
import {
  ENGINEERING_STUDY_YEARS,
  STUDENT_REGISTRATION_VIEWPORTS,
  academicYearGroups,
  currentAcademicYearId,
  expectedGraduationYear,
  programmesForDegreeDepartment,
  registrationSectionFilters,
  registrationQuery,
  sectionRegistrationLabel,
  semesterNumbersForStudyYear,
  semestersForRegistration,
  studentFormAfterAcademicYearChange,
  studentFormAfterDepartmentChange,
  studentFormAfterDegreeChange,
  studentFormAfterOverrideChange,
  studentFormAfterProgrammeChange,
  studentFormAfterSectionChange,
  studentFormAfterSemesterChange,
  studentFormAfterStudyYearChange,
  studentRegistrationStepForField,
  studyYearLabel,
  type RegistrationAcademicYearOption,
  type RegistrationProgrammeOption,
  type RegistrationSemesterOption,
} from "./student-registration";

const semesters: RegistrationSemesterOption[] = Array.from(
  { length: 8 },
  (_, index) => ({
    id: `semester-${index + 1}`,
    number: index + 1,
    name: `Semester ${index + 1}`,
    programmeId: "programme-cse",
    academicYearId: "year-current",
    studyYear: Math.ceil((index + 1) / 2),
  }),
);

const years: RegistrationAcademicYearOption[] = [
  {
    id: "year-past",
    name: "2025-2026",
    startsOn: "2025-07-01",
    endsOn: "2026-06-30",
    isCurrent: false,
  },
  {
    id: "year-current",
    name: "2026-2027",
    startsOn: "2026-07-01",
    endsOn: "2027-06-30",
    isCurrent: true,
  },
  {
    id: "year-future",
    name: "2027-2028",
    startsOn: "2027-07-01",
    endsOn: "2028-06-30",
    isCurrent: false,
  },
];

describe("student registration academic helpers", () => {
  it("always exposes all four Engineering study years with ordinal labels", () => {
    expect(ENGINEERING_STUDY_YEARS).toEqual([1, 2, 3, 4]);
    expect(ENGINEERING_STUDY_YEARS.map(studyYearLabel)).toEqual([
      "1st Year",
      "2nd Year",
      "3rd Year",
      "4th Year",
    ]);
  });

  it.each([
    [1, [1, 2]],
    [2, [3, 4]],
    [3, [5, 6]],
    [4, [7, 8]],
  ])("maps Study Year %i to only its two semesters", (studyYear, expected) => {
    expect(semesterNumbersForStudyYear(studyYear)).toEqual(expected);
    expect(
      semestersForRegistration(semesters, String(studyYear), false).map(
        ({ number }) => number,
      ),
    ).toEqual(expected);
  });

  it("allows an authorised override to retain configured semesters", () => {
    expect(
      semestersForRegistration(semesters, "2", true).map(
        ({ number }) => number,
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("keeps previous, current, and future configured academic years", () => {
    expect(currentAcademicYearId(years)).toBe("year-current");
    expect(academicYearGroups(years)).toEqual({
      previous: [years[0]],
      current: [years[1]],
      future: [years[2]],
    });
  });

  it("filters programmes by both database degree mapping and department", () => {
    const programmes: RegistrationProgrammeOption[] = [
      {
        id: "be-cse",
        code: "CSE",
        name: "Computer Science and Engineering",
        departmentId: "cse",
        degreeTypeId: "be",
        durationYears: 4,
        totalSemesters: 8,
      },
      {
        id: "btech-cse",
        code: "CSE-BT",
        name: "Computer Science and Engineering",
        departmentId: "cse",
        degreeTypeId: "btech",
        durationYears: 4,
        totalSemesters: 8,
      },
      {
        id: "be-ece",
        code: "ECE",
        name: "Electronics and Communication Engineering",
        departmentId: "ece",
        degreeTypeId: "be",
        durationYears: 4,
        totalSemesters: 8,
      },
    ];
    expect(
      programmesForDegreeDepartment(programmes, "be", "cse").map(
        ({ id }) => id,
      ),
    ).toEqual(["be-cse"]);
  });

  it("clears every incompatible descendant when a parent changes", () => {
    const form = {
      ...createBlankPersonForm(),
      degreeTypeId: "be",
      departmentId: "cse",
      programmeId: "be-cse",
      academicYearId: "year-current",
      studyYear: "2",
      semesterId: "semester-3",
      sectionId: "section-a",
      scopes: [{ type: "SECTION" as const, targetId: "section-a" }],
    };
    expect(studentFormAfterDegreeChange(form, "btech")).toMatchObject({
      degreeTypeId: "btech",
      departmentId: "",
      programmeId: "",
      academicYearId: "year-current",
      semesterId: "",
      sectionId: "",
      expectedGraduationYear: "",
      scopes: [{ type: "SECTION", targetId: "" }],
    });
    expect(studentFormAfterDepartmentChange(form, "ece")).toMatchObject({
      departmentId: "ece",
      programmeId: "",
      semesterId: "",
      sectionId: "",
      expectedGraduationYear: "",
    });
    expect(studentFormAfterProgrammeChange(form, "be-ece")).toMatchObject({
      programmeId: "be-ece",
      semesterId: "",
      sectionId: "",
      expectedGraduationYear: "",
    });
    expect(studentFormAfterAcademicYearChange(form, "year-future")).toMatchObject({
      academicYearId: "year-future",
      semesterId: "",
      sectionId: "",
    });
    expect(studentFormAfterStudyYearChange(form, "3")).toMatchObject({
      studyYear: "3",
      semesterId: "",
      sectionId: "",
    });
    expect(studentFormAfterSectionChange(form, "section-b")).toMatchObject({
      sectionId: "section-b",
      roleCodes: ["STUDENT"],
      scopes: [{ type: "SECTION", targetId: "section-b" }],
    });
    expect(studentFormAfterSemesterChange(form, "semester-4")).toMatchObject({
      semesterId: "semester-4",
      sectionId: "",
    });
    expect(studentFormAfterOverrideChange(form, true)).toMatchObject({
      academicOverride: true,
      academicOverrideReason: "",
      semesterId: "",
      sectionId: "",
    });
  });

  it("removes the normal Study Year constraint from Section requests only for an authorised override", () => {
    const base = {
      programmeId: "be-cse",
      academicYearId: "year-current",
      studyYear: "2",
      semesterId: "semester-7",
      academicOverride: false,
    };
    expect(registrationSectionFilters(base)).toEqual({
      programmeId: "be-cse",
      academicYearId: "year-current",
      studyYear: "2",
      semesterId: "semester-7",
    });
    expect(
      registrationSectionFilters({ ...base, academicOverride: true }),
    ).toEqual({
      programmeId: "be-cse",
      academicYearId: "year-current",
      studyYear: undefined,
      semesterId: "semester-7",
    });
  });

  it("calculates graduation and presents section capacity", () => {
    expect(expectedGraduationYear("2026", 4)).toBe("2030");
    expect(
      sectionRegistrationLabel({
        id: "section-a",
        code: "A",
        name: "Section A",
        semesterId: "semester-1",
        studyYear: 1,
        capacity: 70,
        currentStudentCount: 70,
        availableSeats: 0,
        isFull: true,
      }),
    ).toMatch(/70 \/ 70 - Section Full$/);
  });

  it("routes validation errors to the responsible wizard step", () => {
    expect(studentRegistrationStepForField("registerNumber")).toBe(1);
    expect(studentRegistrationStepForField("degreeTypeId")).toBe(2);
    expect(studentRegistrationStepForField("semesterId")).toBe(3);
    expect(studentRegistrationStepForField("temporaryPassword")).toBe(4);
  });

  it("builds narrow endpoint queries without empty filters", () => {
    expect(
      registrationQuery("/academic/programmes", {
        degreeTypeId: "be",
        departmentId: "cse",
        ignored: "",
      }),
    ).toBe("/academic/programmes?degreeTypeId=be&departmentId=cse");
  });

  it("locks the responsive acceptance matrix to all six requested phones", () => {
    expect(STUDENT_REGISTRATION_VIEWPORTS).toEqual([
      { width: 320, height: 568 },
      { width: 360, height: 800 },
      { width: 375, height: 812 },
      { width: 390, height: 844 },
      { width: 412, height: 915 },
      { width: 430, height: 932 },
    ]);
  });
});
