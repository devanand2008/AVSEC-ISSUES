import { describe, expect, it } from "vitest";
import {
  buildAttendanceStudentPayload,
  createAttendanceStudentDraft,
  validateAttendanceStudentDraft,
} from "./class-student-entry";

function validDraft() {
  return {
    ...createAttendanceStudentDraft(),
    fullName: "Test Student",
    studentId: "AVS001",
    email: " Student.One@College.edu ",
    registerNumber: " 620124104001 ",
    admissionYear: 2026,
  };
}

describe("attendance class student entry", () => {
  it("requires the official email and register number expected by the API", () => {
    expect(validateAttendanceStudentDraft({ ...validDraft(), email: "" })).toMatch(/official college email/i);
    expect(validateAttendanceStudentDraft({ ...validDraft(), registerNumber: "" })).toMatch(/register number/i);
  });

  it("builds the complete quick-add payload without dropping required fields", () => {
    const draft = { ...validDraft(), mobile: " 9876543210 ", rollNumber: " 12 " };
    expect(validateAttendanceStudentDraft(draft)).toBeNull();
    expect(buildAttendanceStudentPayload(draft)).toEqual({
      fullName: "Test Student",
      studentId: "AVS001",
      email: "student.one@college.edu",
      registerNumber: "620124104001",
      mobile: "9876543210",
      rollNumber: "12",
      admissionYear: 2026,
      temporaryPassword: "Student@2026!",
    });
  });
});
