export interface AttendanceStudentDraft {
  fullName: string;
  studentId: string;
  email: string;
  registerNumber: string;
  mobile: string;
  rollNumber: string;
  admissionYear: number;
  temporaryPassword: string;
}

export interface AttendanceStudentPayload {
  fullName: string;
  studentId: string;
  email: string;
  registerNumber: string;
  mobile?: string;
  rollNumber?: string;
  admissionYear: number;
  temporaryPassword: string;
}

export const defaultAttendanceStudentPassword = "Student@2026!";

export function createAttendanceStudentDraft(): AttendanceStudentDraft {
  return {
    fullName: "",
    studentId: "",
    email: "",
    registerNumber: "",
    mobile: "",
    rollNumber: "",
    admissionYear: new Date().getFullYear(),
    temporaryPassword: defaultAttendanceStudentPassword,
  };
}

export function validateAttendanceStudentDraft(
  draft: AttendanceStudentDraft,
): string | null {
  if (draft.fullName.trim().length < 2) {
    return "Full name must contain at least 2 characters.";
  }
  if (draft.studentId.trim().length < 2) {
    return "Student ID must contain at least 2 characters.";
  }
  if (!/^\S+@\S+\.\S+$/.test(draft.email.trim())) {
    return "Official college email is required and must be valid.";
  }
  if (draft.registerNumber.trim().length < 2) {
    return "Register number must contain at least 2 characters.";
  }
  if (
    !Number.isInteger(draft.admissionYear) ||
    draft.admissionYear < 1990 ||
    draft.admissionYear > 2200
  ) {
    return "Admission year must be a whole year from 1990 to 2200.";
  }
  if (draft.temporaryPassword.length < 12) {
    return "Temporary password must contain at least 12 characters.";
  }
  return null;
}

export function buildAttendanceStudentPayload(
  draft: AttendanceStudentDraft,
): AttendanceStudentPayload {
  const optional = (value: string) => value.trim() || undefined;
  return {
    fullName: draft.fullName.trim(),
    studentId: draft.studentId.trim(),
    email: draft.email.trim().toLocaleLowerCase(),
    registerNumber: draft.registerNumber.trim(),
    ...(optional(draft.mobile) ? { mobile: optional(draft.mobile) } : {}),
    ...(optional(draft.rollNumber)
      ? { rollNumber: optional(draft.rollNumber) }
      : {}),
    admissionYear: draft.admissionYear,
    temporaryPassword: draft.temporaryPassword,
  };
}
