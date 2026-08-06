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
  accountStatus: "ACTIVE" | "PENDING";
  roleCodes: string[];
  scopes: ScopeRow[];
  profileType: ProfileType;
  departmentId: string;
  programmeId: string;
  sectionId: string;
  studentId: string;
  admissionYear: string;
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
  accountStatus: "ACTIVE" | "PENDING";
  roleCodes: string[];
  scopes: Array<{
    type: ScopeType;
    id?: string;
    issueCategoryId?: string;
  }>;
  studentProfile?: {
    departmentId: string;
    programmeId: string;
    sectionId: string;
    studentId: string;
    admissionYear: number;
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
    accountStatus: "ACTIVE",
    roleCodes: ["STUDENT"],
    scopes: [{ type: "SECTION", targetId: "" }],
    profileType: "student",
    departmentId: "",
    programmeId: "",
    sectionId: "",
    studentId: "",
    admissionYear: String(new Date().getFullYear()),
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
    if (!form.departmentId || !form.programmeId || !form.sectionId) {
      return "Select the student's department, programme, and section.";
    }
    if ((form.studentId || form.collegeIdentityId).trim().length < 2) {
      return "Student ID must contain at least 2 characters.";
    }
    const admissionYear = Number(form.admissionYear);
    if (
      !Number.isInteger(admissionYear) ||
      admissionYear < 1990 ||
      admissionYear > 2200
    ) {
      return "Admission year must be a whole year from 1990 to 2200.";
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
    accountStatus: form.accountStatus,
    roleCodes: [...form.roleCodes],
    scopes,
    ...(form.profileType === "student"
      ? {
          studentProfile: {
            departmentId: form.departmentId,
            programmeId: form.programmeId,
            sectionId: form.sectionId,
            studentId: (form.studentId || form.collegeIdentityId).trim(),
            admissionYear: Number(form.admissionYear),
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
