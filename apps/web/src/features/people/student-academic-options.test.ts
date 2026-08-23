import { describe, expect, it } from "vitest";
import {
  academicYearsForProgramme,
  buildSectionMovePayload,
  isSectionFull,
  programmesForDepartment,
  sectionCapacity,
  sectionOptionLabel,
  sectionsForAcademicSelection,
  semestersForStudyYear,
  studyYearsForAcademicPeriod,
  validateSectionMove,
  type StudentAcademicOptions,
  type StudentAcademicSelection,
} from "./student-academic-options";

const options: StudentAcademicOptions = {
  departments: [
    { id: "cse", code: "CSE", name: "Computer Science and Engineering" },
    { id: "it", code: "IT", name: "Information Technology" },
  ],
  programmes: [
    {
      id: "cse-programme",
      code: "CSE",
      name: "B.E. Computer Science and Engineering",
      departmentId: "cse",
    },
    {
      id: "it-programme",
      code: "IT",
      name: "B.Tech. Information Technology",
      departmentId: "it",
    },
  ],
  academicYears: [
    { id: "2026", name: "2026-2027" },
    { id: "2027", name: "2027-2028" },
  ],
  semesters: [
    {
      id: "cse-semester-3",
      name: "Semester 3",
      number: 3,
      programmeId: "cse-programme",
      academicYearId: "2026",
    },
    {
      id: "cse-semester-4",
      name: "Semester 4",
      number: 4,
      programmeId: "cse-programme",
      academicYearId: "2026",
    },
    {
      id: "it-semester-3",
      name: "Semester 3",
      number: 3,
      programmeId: "it-programme",
      academicYearId: "2026",
    },
  ],
  sections: [
    {
      id: "cse-a",
      code: "A",
      name: "Section A",
      semesterId: "cse-semester-3",
      studyYear: 2,
      capacity: 70,
      currentStudentCount: 69,
      availableSeats: 1,
      assignedRoom: { code: "CSE-201", name: "Second Year CSE" },
    },
    {
      id: "cse-b",
      code: "B",
      name: "Section B",
      semesterId: "cse-semester-3",
      studyYear: 2,
      capacity: 70,
      currentStudentCount: 70,
      availableSeats: 0,
    },
    {
      id: "cse-fourth-a",
      code: "A",
      name: "Section A",
      semesterId: "cse-semester-4",
      studyYear: 2,
    },
    {
      id: "it-a",
      code: "A",
      name: "Section A",
      semesterId: "it-semester-3",
      studyYear: 2,
    },
  ],
};

const cseSelection: StudentAcademicSelection = {
  departmentId: "cse",
  programmeId: "cse-programme",
  academicYearId: "2026",
  studyYear: "2",
  semesterId: "cse-semester-3",
};

describe("student academic option helpers", () => {
  it("keeps every dependent option empty until its parent is selected", () => {
    expect(programmesForDepartment(options, "")).toEqual([]);
    expect(academicYearsForProgramme(options, "")).toEqual([]);
    expect(
      studyYearsForAcademicPeriod(options, {
        programmeId: "cse-programme",
        academicYearId: "",
      }),
    ).toEqual([]);
    expect(
      semestersForStudyYear(options, {
        programmeId: "cse-programme",
        academicYearId: "2026",
        studyYear: "",
      }),
    ).toEqual([]);
    expect(
      sectionsForAcademicSelection(options, {
        ...cseSelection,
        semesterId: "",
      }),
    ).toEqual([]);
  });

  it("walks the department to section cascade within one hierarchy", () => {
    expect(programmesForDepartment(options, "cse").map(({ id }) => id)).toEqual([
      "cse-programme",
    ]);
    expect(
      academicYearsForProgramme(options, "cse-programme").map(({ id }) => id),
    ).toEqual(["2026"]);
    expect(
      studyYearsForAcademicPeriod(options, {
        programmeId: "cse-programme",
        academicYearId: "2026",
      }),
    ).toEqual([2]);
    expect(
      semestersForStudyYear(options, cseSelection).map(({ id }) => id),
    ).toEqual(["cse-semester-3", "cse-semester-4"]);
    expect(
      sectionsForAcademicSelection(options, cseSelection).map(({ id }) => id),
    ).toEqual(["cse-a", "cse-b"]);
  });

  it("never returns IT sections for a CSE department selection", () => {
    expect(
      sectionsForAcademicSelection(options, {
        ...cseSelection,
        programmeId: "it-programme",
        semesterId: "it-semester-3",
      }),
    ).toEqual([]);
  });

  it("labels and disables a section whose capacity is exhausted", () => {
    const fullSection = options.sections[1]!;
    expect(sectionCapacity(fullSection)).toEqual({
      capacity: 70,
      currentStudentCount: 70,
      availableSeats: 0,
    });
    expect(isSectionFull(fullSection)).toBe(true);
    expect(sectionOptionLabel(fullSection)).toMatch(/70 \/ 70 - Full$/);
    expect(sectionOptionLabel(options.sections[0]!)).toContain(
      "Classroom CSE-201 - Second Year CSE",
    );
    expect(sectionCapacity(options.sections[2]!)).toEqual({
      capacity: 70,
      currentStudentCount: 0,
      availableSeats: 70,
    });
  });

  it("validates and trims a safe section-move request", () => {
    expect(validateSectionMove("", "2026-08-11", "Timetable change")).toMatch(
      /new section/i,
    );
    expect(validateSectionMove("cse-b", "2026-08-11", "  ")).toMatch(
      /reason/i,
    );
    expect(
      validateSectionMove("cse-b", "2026-02-31", "Timetable change"),
    ).toMatch(/valid effective date/i);
    expect(validateSectionMove("cse-b", "2026-08-11", "Timetable change")).toBeNull();
    expect(
      buildSectionMovePayload(
        "student-public-id",
        "2026-08-11",
        "  Timetable change  ",
      ),
    ).toEqual({
      studentPublicId: "student-public-id",
      startsOn: "2026-08-11",
      reason: "Timetable change",
    });
  });
});
