import { describe, expect, it } from "vitest";
import {
  buildCreatePersonPayload,
  createBlankPersonForm,
  createPersonErrorField,
  generateTemporaryPassword,
  isStrongTemporaryPassword,
  validateCreatePersonForm,
} from "./create-person";

function validBaseForm() {
  return {
    ...createBlankPersonForm(),
    collegeIdentityId: "FAC-1042",
    fullName: "Test Faculty",
    temporaryPassword: "Strong!Pass123",
    roleCodes: ["FACULTY"],
    scopes: [
      {
        type: "DEPARTMENT" as const,
        targetId: "8a0c1d92-45b6-4e4b-9194-8a4d66d380d9",
      },
    ],
    profileType: "none" as const,
  };
}

function validStudentForm() {
  return {
    ...createBlankPersonForm(),
    collegeIdentityId: "AVS001",
    fullName: "Test Student",
    email: "student1@college.edu",
    temporaryPassword: "Strong!Pass123",
    roleCodes: ["STUDENT"],
    scopes: [{ type: "SECTION" as const, targetId: "section-cse-a" }],
    profileType: "student" as const,
    departmentId: "department-cse",
    programmeId: "programme-cse",
    academicYearId: "academic-year-2026",
    studyYear: "2",
    semesterId: "semester-3",
    sectionId: "section-cse-a",
    studentId: "AVS001",
    registerNumber: "620124104001",
    dateOfBirth: "2007-05-17",
    gender: "FEMALE",
    admissionYear: "2026",
  };
}

describe("person creation helpers", () => {
  it("generates strong temporary passwords", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(isStrongTemporaryPassword(generateTemporaryPassword())).toBe(true);
    }
  });

  it("serializes targeted, college, assigned-issue, and category scopes", () => {
    const payload = buildCreatePersonPayload({
      ...validBaseForm(),
      email: "  faculty@example.edu  ",
      scopes: [
        { type: "COLLEGE", targetId: "" },
        { type: "ASSIGNED_ISSUES", targetId: "" },
        {
          type: "ISSUE_CATEGORY",
          targetId: "b65e8430-4085-4752-a78e-41cdf84dcbec",
        },
        {
          type: "DEPARTMENT",
          targetId: "8a0c1d92-45b6-4e4b-9194-8a4d66d380d9",
        },
      ],
      roleCodes: ["PRINCIPAL"],
    });

    expect(payload.email).toBe("faculty@example.edu");
    expect(payload.scopes).toEqual([
      { type: "COLLEGE" },
      { type: "ASSIGNED_ISSUES" },
      {
        type: "ISSUE_CATEGORY",
        issueCategoryId: "b65e8430-4085-4752-a78e-41cdf84dcbec",
      },
      {
        type: "DEPARTMENT",
        id: "8a0c1d92-45b6-4e4b-9194-8a4d66d380d9",
      },
    ]);
  });

  it("accepts a complete scoped account", () => {
    expect(validateCreatePersonForm(validBaseForm())).toBeNull();
  });

  it("accepts a complete student and serializes the full academic profile", () => {
    const form = validStudentForm();

    expect(validateCreatePersonForm(form)).toBeNull();
    expect(buildCreatePersonPayload(form)).toMatchObject({
      email: "student1@college.edu",
      mustChangePassword: true,
      studentProfile: {
        departmentId: "department-cse",
        programmeId: "programme-cse",
        academicYearId: "academic-year-2026",
        studyYear: 2,
        semesterId: "semester-3",
        sectionId: "section-cse-a",
        studentId: "AVS001",
        registerNumber: "620124104001",
        dateOfBirth: "2007-05-17",
        gender: "FEMALE",
        admissionYear: 2026,
      },
    });
  });

  it("requires an official college email for student accounts only", () => {
    expect(
      validateCreatePersonForm({ ...validStudentForm(), email: "" }),
    ).toMatch(/official college email is required/i);
    expect(validateCreatePersonForm(validBaseForm())).toBeNull();
  });

  it("requires every academic parent before a student section", () => {
    expect(
      validateCreatePersonForm({
        ...validStudentForm(),
        academicYearId: "",
      }),
    ).toMatch(/academic year, study year, semester, and section/i);
  });

  it("keeps gender and date of birth optional for student creation", () => {
    const form = {
      ...validStudentForm(),
      gender: "",
      dateOfBirth: "",
    };

    expect(validateCreatePersonForm(form)).toBeNull();
    expect(buildCreatePersonPayload(form).studentProfile).not.toHaveProperty(
      "gender",
    );
    expect(buildCreatePersonPayload(form).studentProfile).not.toHaveProperty(
      "dateOfBirth",
    );
  });

  it("preserves the administrator's first-login password choice", () => {
    expect(
      buildCreatePersonPayload({
        ...validStudentForm(),
        mustChangePassword: false,
      }).mustChangePassword,
    ).toBe(false);
  });

  it("requires a college scope for college administrators", () => {
    expect(
      validateCreatePersonForm({
        ...validBaseForm(),
        roleCodes: ["MAIN_ADMIN"],
      }),
    ).toMatch(/requires a college-wide scope/i);
  });

  it("rejects a targetless scope before posting", () => {
    expect(
      validateCreatePersonForm({
        ...validBaseForm(),
        scopes: [{ type: "SECTION", targetId: "" }],
      }),
    ).toMatch(/select a target/i);
  });

  it("maps server validation and duplicate errors back to form fields", () => {
    expect(createPersonErrorField("A user with this college ID exists")).toBe(
      "collegeIdentityId",
    );
    expect(createPersonErrorField("email must be an email")).toBe("email");
    expect(createPersonErrorField("registerNumber must be unique")).toBe(
      "registerNumber",
    );
    expect(createPersonErrorField("Unrelated server error")).toBeNull();
  });
});
