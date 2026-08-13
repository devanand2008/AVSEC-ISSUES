export interface DegreeTypeMasterRecord {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
  isActive: boolean;
  archivedAt?: string | null;
  _count?: { programmes: number };
}

export interface AcademicYearMasterRecord {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
  isActive: boolean;
  archivedAt?: string | null;
  _count?: { semesters: number; attendanceSessions: number };
}

export interface ProgrammeMasterRecord {
  id: string;
  code: string;
  name: string;
  departmentId?: string;
  degreeTypeId?: string;
  durationYears: number;
  totalSemesters: number;
  isActive: boolean;
  archivedAt?: string | null;
  department: { id: string; code?: string; name: string };
  degreeTypeMaster?: { id: string; code: string; name: string } | null;
  _count?: { semesters: number; studentProfiles: number };
}

export interface DegreeTypeDraft {
  code: string;
  name: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
}

export interface AcademicYearDraft {
  name: string;
  startYear: string;
  endYear: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
  isActive: boolean;
}

export interface ProgrammeDraft {
  code: string;
  name: string;
  departmentId: string;
  degreeTypeId: string;
  durationYears: string;
  totalSemesters: string;
  isActive: boolean;
}

export function academicMasterDate(value: string): string {
  return value.includes("T") ? value.slice(0, 10) : value;
}

export function validateDegreeTypeDraft(draft: DegreeTypeDraft): string | null {
  if (!draft.name.trim()) return "Degree Type name is required.";
  if (!draft.code.trim()) return "Degree Type code is required.";
  const sortOrder = Number(draft.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return "Sort order must be a non-negative whole number.";
  }
  return null;
}

export function buildDegreeTypePayload(draft: DegreeTypeDraft) {
  return {
    code: draft.code.trim().toLocaleUpperCase(),
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    sortOrder: Number(draft.sortOrder),
    isActive: draft.isActive,
  };
}

export function validateAcademicYearDraft(
  draft: AcademicYearDraft,
): string | null {
  const startYear = Number(draft.startYear);
  const endYear = Number(draft.endYear);
  if (
    !Number.isInteger(startYear) ||
    !Number.isInteger(endYear) ||
    startYear < 1900 ||
    endYear > 2300 ||
    endYear <= startYear
  ) {
    return "Academic Year end year must be greater than the start year.";
  }
  if (!/^\d{4}-\d{4}$/.test(draft.name.trim())) {
    return "Academic Year name must use the format 2026-2027.";
  }
  if (!draft.startsOn || !draft.endsOn) {
    return "Start and end dates are required.";
  }
  const startsOn = Date.parse(`${draft.startsOn}T00:00:00Z`);
  const endsOn = Date.parse(`${draft.endsOn}T00:00:00Z`);
  if (!Number.isFinite(startsOn) || !Number.isFinite(endsOn) || endsOn <= startsOn) {
    return "Academic Year end date must be later than the start date.";
  }
  if (draft.name.trim() !== `${startYear}-${endYear}`) {
    return "Academic Year name must match the configured Start Year and End Year.";
  }
  return null;
}

export function buildAcademicYearCreatePayload(draft: AcademicYearDraft) {
  return {
    name: draft.name.trim(),
    startsOn: draft.startsOn,
    endsOn: draft.endsOn,
    isCurrent: draft.isCurrent,
    isActive: draft.isActive,
  };
}

export function buildAcademicYearUpdatePayload(draft: AcademicYearDraft) {
  return {
    name: draft.name.trim(),
    startsOn: draft.startsOn,
    endsOn: draft.endsOn,
    isActive: draft.isActive,
  };
}

export function validateProgrammeDraft(draft: ProgrammeDraft): string | null {
  if (!draft.name.trim()) return "Programme name is required.";
  if (!draft.code.trim()) return "Programme code is required.";
  if (!draft.degreeTypeId) return "Select a Degree Type.";
  if (!draft.departmentId) return "Select a Department.";
  const duration = Number(draft.durationYears);
  const semesters = Number(draft.totalSemesters);
  if (!Number.isInteger(duration) || duration < 1 || duration > 4) {
    return "Duration must be a whole number from 1 to 4.";
  }
  if (!Number.isInteger(semesters) || semesters < 1 || semesters > 8) {
    return "Total semesters must be a whole number from 1 to 8.";
  }
  return null;
}

export function buildProgrammeCreatePayload(draft: ProgrammeDraft) {
  return {
    code: draft.code.trim().toLocaleUpperCase(),
    name: draft.name.trim(),
    departmentId: draft.departmentId,
    degreeTypeId: draft.degreeTypeId,
    durationYears: Number(draft.durationYears),
    totalSemesters: Number(draft.totalSemesters),
    isActive: draft.isActive,
  };
}

export function buildProgrammeUpdatePayload(draft: ProgrammeDraft) {
  return {
    code: draft.code.trim().toLocaleUpperCase(),
    name: draft.name.trim(),
    degreeTypeId: draft.degreeTypeId,
    durationYears: Number(draft.durationYears),
    totalSemesters: Number(draft.totalSemesters),
    isActive: draft.isActive,
  };
}
