export interface ProfileLockedValues {
  email: string | null;
  fullName: string;
  collegeIdentityId?: string | null;
  registerNumber?: string | null;
  studyYear: number | null;
  department: { id: string; code: string; name: string } | null;
  programmeId?: string | null;
  academicYearId?: string | null;
  semesterId?: string | null;
  sectionId?: string | null;
  primaryRole: string;
}

export type ProfileFormValues = Record<string, string>;

export interface StudentAcademicSnapshot {
  programmeId?: string | null;
  sectionId?: string | null;
  section?: {
    id?: string | null;
    semester?: {
      id?: string | null;
      academicYearId?: string | null;
    } | null;
  } | null;
}

const CATEGORY_FIELDS = {
  personal: ["fullName", "dateOfBirth", "gender"],
  contact: [
    "email",
    "mobileNumber",
    "personalEmail",
    "address",
    "city",
    "district",
    "state",
    "pinCode",
  ],
  academic: [
    "collegeId",
    "registerNumber",
    "departmentId",
    "programmeId",
    "academicYearId",
    "studyYear",
    "semesterId",
    "sectionId",
    "employeeId",
    "designation",
    "qualification",
    "specialization",
    "dateOfJoining",
    "shift",
  ],
  emergency: ["parentName", "parentMobileNumber", "emergencyContact"],
  photo: ["profilePhoto", "profilePhotoKey"],
} as const;

export interface ProfileChecklistItem {
  key: keyof typeof CATEGORY_FIELDS;
  label: string;
  complete: boolean;
  required: boolean;
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (typeof value === "number") return Number.isFinite(value);
  return value === true;
}

function fieldValue(
  field: string,
  values: ProfileFormValues,
  locked: ProfileLockedValues,
  hasProfilePhoto: boolean,
): unknown {
  if (field === "email") return locked.email;
  if (field === "departmentId")
    return locked.department?.id ?? values.departmentId;
  if (field === "collegeId")
    return locked.collegeIdentityId ?? values.collegeId;
  if (field === "registerNumber")
    return locked.registerNumber ?? values.registerNumber;
  if (field === "studyYear") return locked.studyYear ?? values.studyYear;
  if (field === "programmeId") return locked.programmeId ?? values.programmeId;
  if (field === "academicYearId")
    return locked.academicYearId ?? values.academicYearId;
  if (field === "semesterId") return locked.semesterId ?? values.semesterId;
  if (field === "sectionId") return locked.sectionId ?? values.sectionId;
  if (field === "primaryRole") return locked.primaryRole;
  if (field === "profilePhoto" || field === "profilePhotoKey")
    return hasProfilePhoto;
  return values[field];
}

function fieldIsLocked(
  lockedFields: readonly string[],
  ...fieldNames: string[]
): boolean {
  return fieldNames.some((field) => lockedFields.includes(field));
}

export function buildProfilePayload(
  form: ProfileFormValues,
  lockedFields: readonly string[],
  locked: ProfileLockedValues,
): ProfileFormValues {
  const payload = { ...form };

  if (locked.department) payload.departmentId = locked.department.id;
  if (
    locked.collegeIdentityId != null ||
    fieldIsLocked(lockedFields, "collegeId", "collegeIdentityId")
  )
    payload.collegeId = locked.collegeIdentityId ?? "";
  if (
    locked.registerNumber != null ||
    fieldIsLocked(lockedFields, "registerNumber")
  )
    payload.registerNumber = locked.registerNumber ?? "";
  if (locked.studyYear != null || fieldIsLocked(lockedFields, "studyYear"))
    payload.studyYear = String(locked.studyYear ?? "");
  for (const field of [
    "programmeId",
    "academicYearId",
    "semesterId",
    "sectionId",
  ] as const) {
    if (locked[field] != null || fieldIsLocked(lockedFields, field))
      payload[field] = locked[field] ?? "";
  }

  return payload;
}

export function studentAcademicFormValues(
  student: StudentAcademicSnapshot | null | undefined,
  locked: ProfileLockedValues,
): Pick<
  ProfileFormValues,
  "programmeId" | "academicYearId" | "semesterId" | "sectionId"
> {
  return {
    programmeId: locked.programmeId ?? student?.programmeId ?? "",
    academicYearId:
      locked.academicYearId ?? student?.section?.semester?.academicYearId ?? "",
    semesterId: locked.semesterId ?? student?.section?.semester?.id ?? "",
    sectionId:
      locked.sectionId ?? student?.section?.id ?? student?.sectionId ?? "",
  };
}

export function profileCompletion(
  requiredFields: readonly string[],
  values: ProfileFormValues,
  locked: ProfileLockedValues,
  hasProfilePhoto: boolean,
): { percentage: number; checklist: ProfileChecklistItem[] } {
  const required = [...new Set(requiredFields)];
  const completeCount = required.filter((field) =>
    hasValue(fieldValue(field, values, locked, hasProfilePhoto)),
  ).length;
  const percentage = required.length
    ? Math.round((completeCount / required.length) * 100)
    : 100;
  const labels: Record<keyof typeof CATEGORY_FIELDS, string> = {
    personal: "Personal information",
    contact: "Contact information",
    academic: "Academic information",
    emergency: "Emergency information",
    photo: "Profile photo",
  };

  return {
    percentage,
    checklist: (
      Object.keys(CATEGORY_FIELDS) as Array<keyof typeof CATEGORY_FIELDS>
    ).map((key) => {
      const categoryRequired = required.filter((field) =>
        (CATEGORY_FIELDS[key] as readonly string[]).includes(field),
      );
      const hasOptionalValue = (CATEGORY_FIELDS[key] as readonly string[]).some(
        (field) => hasValue(fieldValue(field, values, locked, hasProfilePhoto)),
      );
      return {
        key,
        label: labels[key],
        required: categoryRequired.length > 0,
        complete:
          categoryRequired.length > 0
            ? categoryRequired.every((field) =>
                hasValue(fieldValue(field, values, locked, hasProfilePhoto)),
              )
            : hasOptionalValue,
      };
    }),
  };
}
