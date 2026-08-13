import type { CreatePersonField, CreatePersonFormState } from "./create-person";

export const ENGINEERING_STUDY_YEARS = [1, 2, 3, 4] as const;

export const STUDENT_REGISTRATION_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 430, height: 932 },
] as const;

export const STUDENT_REGISTRATION_STEPS = [
  "Personal",
  "Degree & Programme",
  "Academic Placement",
  "Account",
  "Review",
] as const;

export type StudentRegistrationStep = 1 | 2 | 3 | 4 | 5;

export interface DegreeTypeOption {
  id: string;
  code: string;
  name: string;
  isActive?: boolean;
}

export interface RegistrationDepartmentOption {
  id: string;
  code: string;
  name: string;
  campusId?: string | null;
}

export interface RegistrationProgrammeOption {
  id: string;
  code: string;
  name: string;
  departmentId: string;
  degreeTypeId: string;
  degreeTypeMaster?: { id: string; code: string; name: string };
  durationYears: number;
  totalSemesters: number;
}

export interface RegistrationAcademicYearOption {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
  isActive?: boolean;
  archivedAt?: string | null;
}

export interface RegistrationSemesterOption {
  id: string;
  number: number;
  name: string;
  programmeId: string;
  academicYearId: string;
  studyYear?: number;
  isCurrent?: boolean;
}

export interface RegistrationSectionOption {
  id: string;
  code: string;
  name: string;
  semesterId: string;
  studyYear: number | null;
  capacity: number;
  currentStudentCount: number;
  availableSeats: number;
  isFull: boolean;
}

export interface AcademicYearGroups {
  previous: RegistrationAcademicYearOption[];
  current: RegistrationAcademicYearOption[];
  future: RegistrationAcademicYearOption[];
}

export function studyYearLabel(studyYear: number): string {
  const labels: Record<number, string> = {
    1: "1st Year",
    2: "2nd Year",
    3: "3rd Year",
    4: "4th Year",
  };
  return labels[studyYear] ?? `Year ${studyYear}`;
}

export function semesterNumbersForStudyYear(studyYear: number): number[] {
  if (!ENGINEERING_STUDY_YEARS.includes(studyYear as 1 | 2 | 3 | 4)) {
    return [];
  }
  return [studyYear * 2 - 1, studyYear * 2];
}

export function semestersForRegistration(
  semesters: RegistrationSemesterOption[],
  studyYear: string,
  academicOverride: boolean,
): RegistrationSemesterOption[] {
  if (academicOverride) {
    return [...semesters].sort((left, right) => left.number - right.number);
  }
  const allowed = new Set(semesterNumbersForStudyYear(Number(studyYear)));
  return semesters
    .filter((semester) => allowed.has(semester.number))
    .sort((left, right) => left.number - right.number);
}

export function programmesForDegreeDepartment(
  programmes: RegistrationProgrammeOption[],
  degreeTypeId: string,
  departmentId: string,
): RegistrationProgrammeOption[] {
  if (!degreeTypeId || !departmentId) return [];
  return programmes.filter(
    (programme) =>
      programme.degreeTypeId === degreeTypeId &&
      programme.departmentId === departmentId,
  );
}

export function currentAcademicYearId(
  years: RegistrationAcademicYearOption[],
): string {
  return years.find((year) => year.isCurrent && !year.archivedAt)?.id ?? "";
}

export function academicYearGroups(
  years: RegistrationAcademicYearOption[],
): AcademicYearGroups {
  const byStartDate = (
    left: RegistrationAcademicYearOption,
    right: RegistrationAcademicYearOption,
  ) => {
    const dateDifference =
      Date.parse(left.startsOn) - Date.parse(right.startsOn);
    return dateDifference || left.name.localeCompare(right.name);
  };
  const current = years
    .filter((year) => year.isCurrent && !year.archivedAt)
    .sort(byStartDate);
  const currentStart = current[0]
    ? Date.parse(current[0].startsOn)
    : Date.now();
  const selectable = years.filter((year) => !year.archivedAt);
  return {
    previous: selectable
      .filter(
        (year) => !year.isCurrent && Date.parse(year.startsOn) < currentStart,
      )
      .sort(byStartDate),
    current,
    future: selectable
      .filter(
        (year) => !year.isCurrent && Date.parse(year.startsOn) >= currentStart,
      )
      .sort(byStartDate),
  };
}

export function admissionYearFromAcademicYear(
  year: RegistrationAcademicYearOption | undefined,
): number | null {
  if (!year) return null;
  const parsed = new Date(year.startsOn).getUTCFullYear();
  return Number.isInteger(parsed) ? parsed : null;
}

export function expectedGraduationYear(
  admissionYear: string | number,
  durationYears: number | undefined,
): string {
  const admission = Number(admissionYear);
  if (!Number.isInteger(admission) || !Number.isInteger(durationYears)) {
    return "";
  }
  return String(admission + Number(durationYears));
}

export function sectionRegistrationLabel(
  section: RegistrationSectionOption,
): string {
  const identity = section.code
    ? `${section.code} - ${section.name}`
    : section.name;
  return `${identity} - ${section.currentStudentCount} / ${section.capacity}${
    section.isFull || section.availableSeats <= 0 ? " - Section Full" : ""
  }`;
}

export function studentRegistrationStepForField(
  field: CreatePersonField | undefined,
): StudentRegistrationStep {
  if (
    field &&
    [
      "collegeIdentityId",
      "fullName",
      "email",
      "registerNumber",
      "dateOfBirth",
      "gender",
      "personalEmail",
    ].includes(field)
  ) {
    return 1;
  }
  if (
    field &&
    ["degreeTypeId", "departmentId", "programmeId"].includes(field)
  ) {
    return 2;
  }
  if (
    field &&
    [
      "academicYearId",
      "studyYear",
      "semesterId",
      "sectionId",
      "admissionType",
      "admissionYear",
      "expectedGraduationYear",
      "academicOverrideReason",
    ].includes(field)
  ) {
    return 3;
  }
  return 4;
}

export function studentFormAfterDegreeChange(
  form: CreatePersonFormState,
  degreeTypeId: string,
): CreatePersonFormState {
  return {
    ...form,
    degreeTypeId,
    departmentId: "",
    programmeId: "",
    semesterId: "",
    sectionId: "",
    expectedGraduationYear: "",
    scopes: [{ type: "SECTION", targetId: "" }],
  };
}

export function studentFormAfterDepartmentChange(
  form: CreatePersonFormState,
  departmentId: string,
): CreatePersonFormState {
  return {
    ...form,
    departmentId,
    programmeId: "",
    semesterId: "",
    sectionId: "",
    expectedGraduationYear: "",
    scopes: [{ type: "SECTION", targetId: "" }],
  };
}

export function studentFormAfterProgrammeChange(
  form: CreatePersonFormState,
  programmeId: string,
): CreatePersonFormState {
  return {
    ...form,
    programmeId,
    semesterId: "",
    sectionId: "",
    expectedGraduationYear: "",
    scopes: [{ type: "SECTION", targetId: "" }],
  };
}

export function studentFormAfterAcademicYearChange(
  form: CreatePersonFormState,
  academicYearId: string,
): CreatePersonFormState {
  return {
    ...form,
    academicYearId,
    semesterId: "",
    sectionId: "",
    scopes: [{ type: "SECTION", targetId: "" }],
  };
}

export function studentFormAfterStudyYearChange(
  form: CreatePersonFormState,
  studyYear: string,
): CreatePersonFormState {
  return {
    ...form,
    studyYear,
    semesterId: "",
    sectionId: "",
    scopes: [{ type: "SECTION", targetId: "" }],
  };
}

export function studentFormAfterSectionChange(
  form: CreatePersonFormState,
  sectionId: string,
): CreatePersonFormState {
  return {
    ...form,
    sectionId,
    roleCodes: ["STUDENT"],
    scopes: [{ type: "SECTION", targetId: sectionId }],
  };
}

export function studentFormAfterSemesterChange(
  form: CreatePersonFormState,
  semesterId: string,
): CreatePersonFormState {
  return {
    ...form,
    semesterId,
    sectionId: "",
    scopes: [{ type: "SECTION", targetId: "" }],
  };
}

export function studentFormAfterOverrideChange(
  form: CreatePersonFormState,
  academicOverride: boolean,
): CreatePersonFormState {
  return {
    ...form,
    academicOverride,
    academicOverrideReason: "",
    semesterId: "",
    sectionId: "",
    scopes: [{ type: "SECTION", targetId: "" }],
  };
}

export function registrationSectionFilters(
  form: Pick<
    CreatePersonFormState,
    | "programmeId"
    | "academicYearId"
    | "studyYear"
    | "semesterId"
    | "academicOverride"
  >,
): Record<string, string | undefined> {
  return {
    programmeId: form.programmeId,
    academicYearId: form.academicYearId,
    studyYear: form.academicOverride ? undefined : form.studyYear,
    semesterId: form.semesterId,
  };
}

export function registrationQuery(
  path: string,
  values: Record<string, string | undefined>,
): string {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const serialized = query.toString();
  return serialized ? `${path}?${serialized}` : path;
}
