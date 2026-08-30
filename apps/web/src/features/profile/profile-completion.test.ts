import { describe, expect, it } from "vitest";
import {
  buildProfilePayload,
  profileCompletion,
  studentAcademicFormValues,
  type ProfileLockedValues,
} from "./profile-completion";

const locked: ProfileLockedValues = {
  email: "student@example.edu",
  fullName: "AVS Student",
  collegeIdentityId: "AVS001",
  registerNumber: "REG001",
  studyYear: 2,
  department: { id: "department-1", code: "CSE", name: "Computer Science" },
  programmeId: "programme-1",
  academicYearId: "academic-year-1",
  semesterId: "semester-1",
  sectionId: "section-1",
  primaryRole: "STUDENT",
};

describe("profile completion", () => {
  it("always submits authoritative imported academic identity values", () => {
    expect(
      buildProfilePayload(
        {
          collegeId: "changed-id",
          registerNumber: "changed-register",
          studyYear: "4",
          departmentId: "changed-department",
          programmeId: "changed-programme",
          academicYearId: "changed-academic-year",
          semesterId: "changed-semester",
          sectionId: "changed-section",
        },
        [
          "collegeId",
          "registerNumber",
          "studyYear",
          "departmentId",
          "programmeId",
          "academicYearId",
          "semesterId",
          "sectionId",
        ],
        locked,
      ),
    ).toEqual({
      collegeId: "AVS001",
      registerNumber: "REG001",
      studyYear: "2",
      departmentId: "department-1",
      programmeId: "programme-1",
      academicYearId: "academic-year-1",
      semesterId: "semester-1",
      sectionId: "section-1",
    });
  });

  it("calculates progress from required fields and ignores optional fields", () => {
    const result = profileCompletion(
      ["fullName", "mobileNumber", "collegeId", "departmentId", "studyYear"],
      { fullName: "AVS Student", mobileNumber: "" },
      locked,
      false,
    );

    expect(result.percentage).toBe(80);
    expect(
      result.checklist.find((item) => item.key === "emergency"),
    ).toMatchObject({ required: false, complete: false });
    expect(
      result.checklist.find((item) => item.key === "academic"),
    ).toMatchObject({ required: true, complete: true });
  });

  it("does not accept a changed value when a locked source value is empty", () => {
    const payload = buildProfilePayload(
      { collegeId: "user-supplied" },
      ["collegeIdentityId"],
      { ...locked, collegeIdentityId: null },
    );

    expect(payload.collegeId).toBe("");
  });

  it("clears manipulated academic placement values when an empty value is locked", () => {
    const payload = buildProfilePayload(
      {
        programmeId: "user-programme",
        academicYearId: "user-year",
        semesterId: "user-semester",
        sectionId: "user-section",
      },
      ["programmeId", "academicYearId", "semesterId", "sectionId"],
      {
        ...locked,
        programmeId: null,
        academicYearId: null,
        semesterId: null,
        sectionId: null,
      },
    );

    expect(payload).toMatchObject({
      programmeId: "",
      academicYearId: "",
      semesterId: "",
      sectionId: "",
    });
  });

  it("reads saved academic placement through section.semester", () => {
    expect(
      studentAcademicFormValues(
        {
          programmeId: "saved-programme",
          sectionId: "saved-section-id",
          section: {
            id: "saved-section",
            semester: {
              id: "saved-semester",
              academicYearId: "saved-academic-year",
            },
          },
        },
        {
          ...locked,
          programmeId: undefined,
          academicYearId: undefined,
          semesterId: undefined,
          sectionId: undefined,
        },
      ),
    ).toEqual({
      programmeId: "saved-programme",
      academicYearId: "saved-academic-year",
      semesterId: "saved-semester",
      sectionId: "saved-section",
    });
  });

  it("prefers authoritative locked placement over saved profile relations", () => {
    expect(
      studentAcademicFormValues(
        {
          programmeId: "saved-programme",
          section: {
            id: "saved-section",
            semester: {
              id: "saved-semester",
              academicYearId: "saved-academic-year",
            },
          },
        },
        locked,
      ),
    ).toEqual({
      programmeId: "programme-1",
      academicYearId: "academic-year-1",
      semesterId: "semester-1",
      sectionId: "section-1",
    });
  });
});
