export const SCOPE_TYPES = [
  "COLLEGE",
  "CAMPUS",
  "DEPARTMENT",
  "PROGRAMME",
  "ACADEMIC_YEAR",
  "SEMESTER",
  "SECTION",
  "BLOCK",
  "FLOOR",
  "ROOM",
  "ISSUE_CATEGORY",
  "ASSIGNED_ISSUES",
] as const;

export type ScopeType = (typeof SCOPE_TYPES)[number];
export type ProfileType = "student" | "staff" | "none";
export type AdmissionType =
  | "REGULAR"
  | "LATERAL_ENTRY"
  | "TRANSFER"
  | "READMISSION"
  | "OTHER";
export type CreatePersonField =
  | "collegeIdentityId"
  | "fullName"
  | "email"
  | "temporaryPassword"
  | "roleCodes"
  | "scopes"
  | "departmentId"
  | "degreeTypeId"
  | "programmeId"
  | "academicYearId"
  | "studyYear"
  | "semesterId"
  | "sectionId"
  | "studentId"
  | "registerNumber"
  | "dateOfBirth"
  | "gender"
  | "admissionYear"
  | "admissionType"
  | "expectedGraduationYear"
  | "personalEmail"
  | "academicOverrideReason"
  | "employeeId";

export interface ScopeRow {
  type: ScopeType;
  targetId: string;
}

export interface CreatePersonFormState {
  collegeIdentityId: string;
  fullName: string;
  email: string;
  mobile: string;
  whatsappNumber: string;
  temporaryPassword: string;
  mustChangePassword: boolean;
  accountStatus: "ACTIVE" | "PENDING";
  roleCodes: string[];
  scopes: ScopeRow[];
  profileType: ProfileType;
  degreeTypeId: string;
  departmentId: string;
  programmeId: string;
  academicYearId: string;
  studyYear: string;
  semesterId: string;
  sectionId: string;
  studentId: string;
  registerNumber: string;
  dateOfBirth: string;
  gender: string;
  admissionYear: string;
  admissionType: AdmissionType;
  expectedGraduationYear: string;
  personalEmail: string;
  academicOverride: boolean;
  academicOverrideReason: string;
  rollNumber: string;
  employeeId: string;
  designation: string;
}

export interface CreatePersonPayload {
  collegeIdentityId: string;
  fullName: string;
  email?: string;
  mobile?: string;
  whatsappNumber?: string;
  temporaryPassword: string;
  mustChangePassword: boolean;
  accountStatus: "ACTIVE" | "PENDING";
  roleCodes: string[];
  scopes: Array<{
    type: ScopeType;
    id?: string;
    issueCategoryId?: string;
  }>;
  studentProfile?: {
    degreeTypeId: string;
    departmentId: string;
    programmeId: string;
    academicYearId: string;
    studyYear: number;
    semesterId: string;
    sectionId: string;
    studentId: string;
    registerNumber: string;
    dateOfBirth?: string;
    gender?: string;
    admissionYear: number;
    admissionType: AdmissionType;
    expectedGraduationYear: number;
    personalEmail?: string;
    academicOverride?: boolean;
    academicOverrideReason?: string;
    rollNumber?: string;
  };
  staffProfile?: {
    departmentId?: string;
    employeeId: string;
    designation?: string;
  };
}

const COLLEGE_WIDE_ROLES = new Set([
  "SUPER_ADMIN",
  "MAIN_ADMIN",
  "PRINCIPAL",
  "VICE_PRINCIPAL",
]);
const ROLES_REQUIRING_COLLEGE_SCOPE = new Set([
  "SUPER_ADMIN",
  "MAIN_ADMIN",
  "PRINCIPAL",
]);

export function createBlankPersonForm(): CreatePersonFormState {
  return {
    collegeIdentityId: "",
    fullName: "",
    email: "",
    mobile: "",
    whatsappNumber: "",
    temporaryPassword: "",
    mustChangePassword: true,
    accountStatus: "ACTIVE",
    roleCodes: ["STUDENT"],
    scopes: [{ type: "SECTION", targetId: "" }],
    profileType: "student",
    degreeTypeId: "",
    departmentId: "",
    programmeId: "",
    academicYearId: "",
    studyYear: "1",
    semesterId: "",
    sectionId: "",
    studentId: "",
    registerNumber: "",
    dateOfBirth: "",
    gender: "",
    admissionYear: String(new Date().getFullYear()),
    admissionType: "REGULAR",
    expectedGraduationYear: String(new Date().getFullYear() + 4),
    personalEmail: "",
    academicOverride: false,
    academicOverrideReason: "",
    rollNumber: "",
    employeeId: "",
    designation: "",
  };
}

export function isStrongTemporaryPassword(password: string): boolean {
  return (
    password.length >= 12 &&
    password.length <= 200 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export function generateTemporaryPassword(): string {
  const groups = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%^&*",
  ];
  const all = groups.join("");
  const randomIndex = (max: number) => {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return (values[0] ?? 0) % max;
  };
  const pick = (characters: string) =>
    characters[randomIndex(characters.length)] ?? "A";
  const password = [
    ...groups.map(pick),
    ...Array.from({ length: 10 }, () => pick(all)),
  ];
  for (let index = password.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [password[index], password[swapIndex]] = [
      password[swapIndex] ?? "A",
      password[index] ?? "A",
    ];
  }
  return password.join("");
}

export function scopeRequiresTarget(type: ScopeType): boolean {
  return type !== "COLLEGE" && type !== "ASSIGNED_ISSUES";
}

export function validateCreatePersonForm(
  form: CreatePersonFormState,
): string | null {
  if (form.collegeIdentityId.trim().length < 2) {
    return "College ID must contain at least 2 characters.";
  }
  if (form.fullName.trim().length < 2) {
    return "Full name must contain at least 2 characters.";
  }
  if (!isStrongTemporaryPassword(form.temporaryPassword)) {
    return "Temporary password must be 12 or more characters and include uppercase, lowercase, number, and special characters.";
  }
  if (!form.roleCodes.length) return "Select at least one role.";
  if (!form.scopes.length) return "Add at least one access scope.";

  const identities = new Set<string>();
  for (const scope of form.scopes) {
    if (scopeRequiresTarget(scope.type) && !scope.targetId) {
      return `Select a target for the ${scope.type.replaceAll("_", " ").toLowerCase()} scope.`;
    }
    const identity = `${scope.type}:${scope.targetId}`;
    if (identities.has(identity)) {
      return "The same access scope cannot be assigned more than once.";
    }
    identities.add(identity);
  }

  const hasCollegeScope = form.scopes.some((scope) => scope.type === "COLLEGE");
  if (
    hasCollegeScope &&
    !form.roleCodes.some((role) => COLLEGE_WIDE_ROLES.has(role))
  ) {
    return "College-wide scope is only valid for a college-wide administrative role.";
  }
  if (
    form.roleCodes.some((role) => ROLES_REQUIRING_COLLEGE_SCOPE.has(role)) &&
    !hasCollegeScope
  ) {
    return "The selected administrative role requires a college-wide scope.";
  }

  if (form.profileType === "student") {
    if (!form.email.trim()) {
      return "Official college email is required for a student.";
    }
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      return "Official college email must be a valid email address.";
    }
    if (
      !form.degreeTypeId ||
      !form.departmentId ||
      !form.programmeId ||
      !form.academicYearId ||
      !form.studyYear ||
      !form.semesterId ||
      !form.sectionId
    ) {
      return "Select the student's degree type, department, programme, academic year, study year, semester, and section.";
    }
    if ((form.studentId || form.collegeIdentityId).trim().length < 2) {
      return "Student ID must contain at least 2 characters.";
    }
    if (form.registerNumber.trim().length < 2) {
      return "Register number must contain at least 2 characters.";
    }
    const studyYear = Number(form.studyYear);
    if (!Number.isInteger(studyYear) || studyYear < 1 || studyYear > 4) {
      return "Study year must be one of the four Engineering study years.";
    }
    if (form.dateOfBirth) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth)) {
        return "Date of birth must be a valid date.";
      }
      const dateOfBirth = new Date(`${form.dateOfBirth}T00:00:00Z`);
      if (Number.isNaN(dateOfBirth.getTime()) || dateOfBirth > new Date()) {
        return "Date of birth must be a valid date that is not in the future.";
      }
    }
    const admissionYear = Number(form.admissionYear);
    if (
      !Number.isInteger(admissionYear) ||
      admissionYear < 1990 ||
      admissionYear > 2200
    ) {
      return "Admission year must be a whole year from 1990 to 2200.";
    }
    const expectedGraduationYear = Number(form.expectedGraduationYear);
    if (
      !Number.isInteger(expectedGraduationYear) ||
      expectedGraduationYear <= admissionYear ||
      expectedGraduationYear > 2210
    ) {
      return "Expected graduation year must be later than the admission year.";
    }
    if (
      form.personalEmail.trim() &&
      !/^\S+@\S+\.\S+$/.test(form.personalEmail.trim())
    ) {
      return "Personal email must be a valid email address.";
    }
    if (
      form.academicOverride &&
      form.academicOverrideReason.trim().length < 10
    ) {
      return "Enter an academic override reason with at least 10 characters.";
    }
  }
  if (
    form.profileType === "staff" &&
    (form.employeeId || form.collegeIdentityId).trim().length < 2
  ) {
    return "Employee ID must contain at least 2 characters.";
  }
  return null;
}

export function createPersonErrorField(
  message: string,
): CreatePersonField | null {
  const value = message.toLowerCase();
  if (value.includes("collegeidentityid") || value.includes("college id")) {
    return "collegeIdentityId";
  }
  if (value.includes("full name") || value.includes("fullname")) {
    return "fullName";
  }
  if (value.includes("email")) return "email";
  if (
    value.includes("temporarypassword") ||
    value.includes("temporary password")
  ) {
    return "temporaryPassword";
  }
  if (value.includes("role")) return "roleCodes";
  if (value.includes("scope")) return "scopes";
  if (value.includes("department")) return "departmentId";
  if (value.includes("degree type")) return "degreeTypeId";
  if (value.includes("programme")) return "programmeId";
  if (value.includes("academic year")) return "academicYearId";
  if (value.includes("study year")) return "studyYear";
  if (value.includes("semester")) return "semesterId";
  if (value.includes("section")) return "sectionId";
  if (value.includes("student id") || value.includes("studentid")) {
    return "studentId";
  }
  if (value.includes("admission year") || value.includes("admissionyear")) {
    return "admissionYear";
  }
  if (value.includes("admission type") || value.includes("admissiontype")) {
    return "admissionType";
  }
  if (
    value.includes("expected graduation") ||
    value.includes("expectedgraduationyear")
  ) {
    return "expectedGraduationYear";
  }
  if (value.includes("personal email") || value.includes("personalemail")) {
    return "personalEmail";
  }
  if (value.includes("override")) return "academicOverrideReason";
  if (value.includes("register number") || value.includes("registernumber")) {
    return "registerNumber";
  }
  if (value.includes("date of birth") || value.includes("dateofbirth")) {
    return "dateOfBirth";
  }
  if (value.includes("gender")) return "gender";
  if (value.includes("employee id") || value.includes("employeeid")) {
    return "employeeId";
  }
  return null;
}

export function buildCreatePersonPayload(
  form: CreatePersonFormState,
): CreatePersonPayload {
  const optional = (value: string) => value.trim() || undefined;
  const scopes = form.scopes.map((scope) => {
    if (scope.type === "COLLEGE" || scope.type === "ASSIGNED_ISSUES") {
      return { type: scope.type };
    }
    if (scope.type === "ISSUE_CATEGORY") {
      return { type: scope.type, issueCategoryId: scope.targetId };
    }
    return { type: scope.type, id: scope.targetId };
  });
  return {
    collegeIdentityId: form.collegeIdentityId.trim(),
    fullName: form.fullName.trim(),
    email: optional(form.email),
    mobile: optional(form.mobile),
    whatsappNumber: optional(form.whatsappNumber),
    temporaryPassword: form.temporaryPassword,
    mustChangePassword: form.mustChangePassword,
    accountStatus: form.accountStatus,
    roleCodes: [...form.roleCodes],
    scopes,
    ...(form.profileType === "student"
      ? {
          studentProfile: {
            degreeTypeId: form.degreeTypeId,
            departmentId: form.departmentId,
            programmeId: form.programmeId,
            academicYearId: form.academicYearId,
            studyYear: Number(form.studyYear),
            semesterId: form.semesterId,
            sectionId: form.sectionId,
            studentId: (form.studentId || form.collegeIdentityId).trim(),
            registerNumber: form.registerNumber.trim(),
            ...(optional(form.dateOfBirth)
              ? { dateOfBirth: optional(form.dateOfBirth) }
              : {}),
            ...(optional(form.gender)
              ? { gender: optional(form.gender) }
              : {}),
            admissionYear: Number(form.admissionYear),
            admissionType: form.admissionType,
            expectedGraduationYear: Number(form.expectedGraduationYear),
            ...(optional(form.personalEmail)
              ? { personalEmail: optional(form.personalEmail) }
              : {}),
            ...(form.academicOverride
              ? {
                  academicOverride: true,
                  academicOverrideReason:
                    optional(form.academicOverrideReason) ?? "",
                }
              : {}),
            ...(optional(form.rollNumber)
              ? { rollNumber: optional(form.rollNumber) }
              : {}),
          },
        }
      : {}),
    ...(form.profileType === "staff"
      ? {
          staffProfile: {
            ...(form.departmentId ? { departmentId: form.departmentId } : {}),
            employeeId: (form.employeeId || form.collegeIdentityId).trim(),
            ...(optional(form.designation)
              ? { designation: optional(form.designation) }
              : {}),
          },
        }
      : {}),
  };
}
