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
    expect(createPersonErrorField("Unrelated server error")).toBeNull();
  });
});
