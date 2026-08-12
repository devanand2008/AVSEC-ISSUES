import { describe, expect, it } from "vitest";
import {
  academicYearsForProgramme,
  activeProgrammes,
  buildDepartmentPayload,
  buildSectionPayload,
  departmentCampusName,
  filterDepartments,
  positiveDependencies,
  preferredCampusId,
  sectionCapacity,
  sectionCodeFromName,
  sectionsForDepartment,
  semestersForSectionDraft,
  staffAssignmentCandidates,
  studyYearsForProgrammeYear,
  validateDepartmentDraft,
  validateSectionDraft,
  validateSectionEditDraft,
  type DepartmentDraft,
  type SectionDraft,
  type WorkspaceAcademicYear,
  type WorkspaceDepartment,
  type WorkspaceProgramme,
  type WorkspaceSection,
} from "./departments-sections";

const departments: WorkspaceDepartment[] = [
  { id: "cse", code: "CSE", name: "Computer Science and Engineering", isActive: true },
  { id: "it", code: "IT", name: "Information Technology", isActive: false },
  { id: "ece", code: "ECE", name: "Electronics and Communication Engineering", isActive: false, archivedAt: "2026-08-01" },
];

const programmes: WorkspaceProgramme[] = [
  {
    id: "cse-programme",
    departmentId: "cse",
    code: "BTECH-CSE",
    name: "B.Tech CSE",
    isActive: true,
    semesters: [
      { id: "cse-sem-3", name: "Semester 3", number: 3, programmeId: "cse-programme", academicYearId: "2026", isActive: true },
      { id: "cse-sem-4", name: "Semester 4", number: 4, programmeId: "cse-programme", academicYearId: "2026", isActive: true },
    ],
  },
  {
    id: "it-programme",
    departmentId: "it",
    code: "BTECH-IT",
    name: "B.Tech IT",
    isActive: true,
    semesters: [
      { id: "it-sem-3", name: "Semester 3", number: 3, programmeId: "it-programme", academicYearId: "2026", isActive: true },
    ],
  },
];

const years: WorkspaceAcademicYear[] = [
  { id: "2026", name: "2026-2027", isActive: true, isCurrent: true },
  { id: "2025", name: "2025-2026", isActive: false },
];

const sections: WorkspaceSection[] = [
  { id: "cse-a", semesterId: "cse-sem-3", code: "A", name: "Section A", capacity: 70, currentStudentCount: 70, isActive: true, semester: { programme: { id: "cse-programme", name: "B.Tech CSE" }, academicYear: { id: "2026", name: "2026-2027" } } },
  { id: "cse-b", semesterId: "cse-sem-3", code: "B", name: "Section B", capacity: 70, currentStudentCount: 68, isActive: true, semester: { programme: { id: "cse-programme", name: "B.Tech CSE" }, academicYear: { id: "2026", name: "2026-2027" } } },
  { id: "it-a", semesterId: "it-sem-3", code: "A", name: "Section A", capacity: 70, currentStudentCount: 10, isActive: true, semester: { programme: { id: "it-programme", name: "B.Tech IT" }, academicYear: { id: "2026", name: "2026-2027" } } },
];

const departmentDraft: DepartmentDraft = {
  campusId: "main-campus",
  name: "Biomedical Engineering",
  code: " bme ",
  description: "  Biomedical department  ",
  isActive: true,
};

const sectionDraft: SectionDraft = {
  departmentId: "cse",
  programmeId: "cse-programme",
  academicYearId: "2026",
  studyYear: "2",
  semesterId: "cse-sem-3",
  name: " C ",
  capacity: "70",
  assignedRoomId: "room-1",
  coordinatorPublicId: "coordinator-1",
  prospectiveClassStaffPublicIds: ["staff-1", "staff-1", "staff-2"],
  isActive: true,
};

describe("departments and sections workspace helpers", () => {
  it("auto-selects a sole campus or an explicitly named main campus", () => {
    expect(preferredCampusId([{ id: "one", code: "CITY", name: "City Campus" }])).toBe("one");
    expect(preferredCampusId([
      { id: "north", code: "NORTH", name: "North Campus" },
      { id: "main", code: "MAIN", name: "Central Campus" },
    ])).toBe("main");
    expect(preferredCampusId([
      { id: "north", code: "NORTH", name: "North Campus" },
      { id: "south", code: "SOUTH", name: "South Campus" },
    ])).toBe("");
    expect(departmentCampusName({ campus: null })).toBe("College campus");
    expect(departmentCampusName({ campus: { name: "Main Campus" } })).toBe(
      "Main Campus",
    );
  });

  it("excludes representative-only students from staff assignment choices", () => {
    const candidates = [
      { id: "faculty", roles: [{ role: { code: "FACULTY" } }] },
      { id: "hod", roles: [{ role: { code: "HOD" } }] },
      { id: "staff-profile", roles: [] },
      {
        id: "representative",
        roles: [{ role: { code: "CLASS_REPRESENTATIVE" } }],
      },
    ];

    expect(staffAssignmentCandidates(candidates).map(({ id }) => id)).toEqual([
      "faculty",
      "hod",
      "staff-profile",
    ]);
  });

  it("filters active, inactive and archived departments independently", () => {
    expect(filterDepartments(departments, "computer", "ALL").map(({ id }) => id)).toEqual(["cse"]);
    expect(filterDepartments(departments, "", "ACTIVE").map(({ id }) => id)).toEqual(["cse"]);
    expect(filterDepartments(departments, "", "INACTIVE").map(({ id }) => id)).toEqual(["it"]);
    expect(filterDepartments(departments, "", "ARCHIVED").map(({ id }) => id)).toEqual(["ece"]);
  });

  it("protects department names and short codes case-insensitively", () => {
    expect(validateDepartmentDraft({ ...departmentDraft, name: " cOmPuTeR   Science and Engineering " }, departments)).toMatch(/already exists/i);
    expect(validateDepartmentDraft({ ...departmentDraft, code: "cSe" }, departments)).toMatch(/already exists/i);
    expect(validateDepartmentDraft(departmentDraft, departments)).toBeNull();
    expect(buildDepartmentPayload(departmentDraft)).toMatchObject({ code: "BME", name: "Biomedical Engineering", description: "Biomedical department" });
  });

  it("keeps the section hierarchy empty until every parent is selected", () => {
    expect(activeProgrammes(programmes, "")).toEqual([]);
    expect(academicYearsForProgramme(programmes, years, "cse", "")).toEqual([]);
    expect(studyYearsForProgrammeYear(programmes, "cse", "cse-programme", "")).toEqual([]);
    expect(semestersForSectionDraft(programmes, { ...sectionDraft, studyYear: "" })).toEqual([]);
  });

  it("returns every matching section without imposing a section-count limit", () => {
    expect(academicYearsForProgramme(programmes, years, "cse", "cse-programme").map(({ id }) => id)).toEqual(["2026"]);
    expect(studyYearsForProgrammeYear(programmes, "cse", "cse-programme", "2026")).toEqual([2]);
    expect(semestersForSectionDraft(programmes, sectionDraft).map(({ id }) => id)).toEqual(["cse-sem-3", "cse-sem-4"]);
    expect(sectionsForDepartment(sections, programmes, "cse").map(({ id }) => id)).toEqual(["cse-a", "cse-b"]);
  });

  it("derives a professional section payload with default-safe assignments", () => {
    expect(sectionCodeFromName("Section c")).toBe("C");
    expect(validateSectionDraft(sectionDraft, programmes, sections)).toBeNull();
    expect(buildSectionPayload(sectionDraft)).toEqual({
      semesterId: "cse-sem-3",
      code: "C",
      name: "Section C",
      studyYear: 2,
      capacity: 70,
      assignedRoomId: "room-1",
      coordinatorPublicId: "coordinator-1",
      prospectiveClassStaffPublicIds: ["staff-1", "staff-2"],
      isActive: true,
    });
  });

  it("blocks a duplicate section only within the same semester", () => {
    expect(validateSectionDraft({ ...sectionDraft, name: "a" }, programmes, sections)).toMatch(/already exists/i);
    expect(validateSectionDraft({ ...sectionDraft, semesterId: "cse-sem-4", name: "A" }, programmes, sections)).toBeNull();
  });

  it("allows safe edits when an existing section hierarchy is inactive", () => {
    expect(
      validateSectionEditDraft(
        { ...sectionDraft, name: "Section B", capacity: "68" },
        sections,
        "cse-b",
      ),
    ).toBeNull();
  });

  it("reports section capacity and positive lifecycle dependencies", () => {
    expect(sectionCapacity(sections[0]!)).toEqual({ current: 70, maximum: 70, available: 0, isFull: true });
    expect(positiveDependencies({ students: 70, issues: 0, attendanceRecords: 120 }).map(({ key }) => key)).toEqual(["attendanceRecords", "students"]);
  });
});
