export interface WorkspaceCampus {
  id: string;
  code: string;
  name: string;
}

export interface WorkspaceAcademicYear {
  id: string;
  name: string;
  isActive: boolean;
  isCurrent?: boolean;
}

export interface WorkspaceSemester {
  id: string;
  name: string;
  number: number;
  programmeId: string;
  academicYearId: string;
  isActive: boolean;
}

export interface WorkspaceProgramme {
  id: string;
  departmentId: string;
  code: string;
  name: string;
  isActive: boolean;
  semesters: WorkspaceSemester[];
}

export interface WorkspaceDepartment {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  campusId?: string | null;
  isActive: boolean;
  archivedAt?: string | null;
}

export interface WorkspaceAssignmentCandidate {
  roles: Array<{ role: { code: string } }>;
}

export interface WorkspaceSection {
  id: string;
  semesterId: string;
  code: string;
  name: string;
  studyYear?: number | null;
  capacity?: number | null;
  maximumCapacity?: number;
  currentStudentCount?: number;
  availableSeats?: number;
  isActive: boolean;
  archivedAt?: string | null;
  semester: {
    programme: { id: string; name: string };
    academicYear: { id: string; name: string };
  };
}

export interface DepartmentDraft {
  campusId: string;
  name: string;
  code: string;
  description: string;
  isActive: boolean;
}

export interface SectionDraft {
  departmentId: string;
  programmeId: string;
  academicYearId: string;
  studyYear: string;
  semesterId: string;
  name: string;
  capacity: string;
  assignedRoomId: string;
  coordinatorPublicId: string;
  prospectiveClassStaffPublicIds: string[];
  isActive: boolean;
}

export interface SectionPayload {
  semesterId: string;
  code: string;
  name: string;
  studyYear: number;
  capacity: number;
  assignedRoomId?: string;
  coordinatorPublicId?: string;
  prospectiveClassStaffPublicIds?: string[];
  isActive: boolean;
}

export type DepartmentFilter = "ALL" | "ACTIVE" | "INACTIVE" | "ARCHIVED";

export function normalizeAcademicIdentity(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function preferredCampusId(campuses: WorkspaceCampus[]): string {
  if (campuses.length === 1) return campuses[0]?.id ?? "";
  return (
    campuses.find(
      (campus) =>
        normalizeAcademicIdentity(campus.code) === "main" ||
        ["main campus", "avs engineering college"].includes(
          normalizeAcademicIdentity(campus.name),
        ),
    )?.id ?? ""
  );
}

export function departmentCampusName(
  department: { campus?: { name: string } | null },
): string {
  return department.campus?.name ?? "College campus";
}

export function staffAssignmentCandidates<
  T extends WorkspaceAssignmentCandidate,
>(candidates: T[]): T[] {
  const allowedRoleCodes = new Set(["HOD", "FACULTY", "CLASS_COORDINATOR"]);
  return candidates.filter((candidate) => {
    const roleCodes = candidate.roles.map(({ role }) => role.code);
    // The API also returns staff-profile accounts that do not need a separate
    // staff role assignment. A representative-only account must never pass.
    return (
      roleCodes.length === 0 ||
      roleCodes.some((roleCode) => allowedRoleCodes.has(roleCode))
    );
  });
}

export function filterDepartments<T extends WorkspaceDepartment>(
  departments: T[],
  search: string,
  filter: DepartmentFilter,
): T[] {
  const query = normalizeAcademicIdentity(search);
  return departments.filter((department) => {
    const matchesSearch =
      !query ||
      normalizeAcademicIdentity(department.name).includes(query) ||
      normalizeAcademicIdentity(department.code).includes(query);
    const matchesStatus =
      filter === "ALL" ||
      (filter === "ARCHIVED" && Boolean(department.archivedAt)) ||
      (filter === "ACTIVE" && department.isActive && !department.archivedAt) ||
      (filter === "INACTIVE" && !department.isActive && !department.archivedAt);
    return matchesSearch && matchesStatus;
  });
}

export function selectedDepartmentId(
  requestedId: string,
  departments: WorkspaceDepartment[],
): string {
  return departments.some((department) => department.id === requestedId)
    ? requestedId
    : departments[0]?.id ?? "";
}

export function validateDepartmentDraft(
  draft: DepartmentDraft,
  departments: WorkspaceDepartment[],
  editingId?: string,
  requireCampus = true,
): string | null {
  if (!draft.name.trim()) return "Department name is required.";
  if (!draft.code.trim()) return "Department short code is required.";
  if (requireCampus && !draft.campusId) return "Select the department campus.";
  const name = normalizeAcademicIdentity(draft.name);
  const code = normalizeAcademicIdentity(draft.code);
  const duplicate = departments.find(
    (department) =>
      department.id !== editingId &&
      (normalizeAcademicIdentity(department.name) === name ||
        normalizeAcademicIdentity(department.code) === code),
  );
  return duplicate
    ? "A department with this name or short code already exists in the college."
    : null;
}

export function buildDepartmentPayload(draft: DepartmentDraft) {
  return {
    campusId: draft.campusId,
    name: draft.name.normalize("NFKC").trim().replace(/\s+/g, " "),
    code: draft.code.normalize("NFKC").trim().toLocaleUpperCase(),
    description: draft.description.trim() || undefined,
    isActive: draft.isActive,
  };
}

export function activeProgrammes(
  programmes: WorkspaceProgramme[],
  departmentId: string,
): WorkspaceProgramme[] {
  if (!departmentId) return [];
  return programmes.filter(
    (programme) =>
      programme.departmentId === departmentId && programme.isActive,
  );
}

export function academicYearsForProgramme(
  programmes: WorkspaceProgramme[],
  years: WorkspaceAcademicYear[],
  departmentId: string,
  programmeId: string,
): WorkspaceAcademicYear[] {
  if (!departmentId || !programmeId) return [];
  const programme = activeProgrammes(programmes, departmentId).find(
    (candidate) => candidate.id === programmeId,
  );
  if (!programme) return [];
  const yearIds = new Set(
    programme.semesters
      .filter((semester) => semester.isActive)
      .map((semester) => semester.academicYearId),
  );
  return years.filter((year) => year.isActive && yearIds.has(year.id));
}

export function studyYearsForProgrammeYear(
  programmes: WorkspaceProgramme[],
  departmentId: string,
  programmeId: string,
  academicYearId: string,
): number[] {
  if (!departmentId || !programmeId || !academicYearId) return [];
  const programme = activeProgrammes(programmes, departmentId).find(
    (candidate) => candidate.id === programmeId,
  );
  if (!programme) return [];
  return [
    ...new Set(
      programme.semesters
        .filter(
          (semester) =>
            semester.isActive &&
            semester.academicYearId === academicYearId,
        )
        .map((semester) => Math.ceil(semester.number / 2)),
    ),
  ].sort((left, right) => left - right);
}

export function semestersForSectionDraft(
  programmes: WorkspaceProgramme[],
  draft: Pick<
    SectionDraft,
    "departmentId" | "programmeId" | "academicYearId" | "studyYear"
  >,
): WorkspaceSemester[] {
  const studyYear = Number(draft.studyYear);
  if (
    !draft.departmentId ||
    !draft.programmeId ||
    !draft.academicYearId ||
    !Number.isInteger(studyYear)
  ) {
    return [];
  }
  const programme = activeProgrammes(programmes, draft.departmentId).find(
    (candidate) => candidate.id === draft.programmeId,
  );
  if (!programme) return [];
  return programme.semesters.filter(
    (semester) =>
      semester.isActive &&
      semester.academicYearId === draft.academicYearId &&
      Math.ceil(semester.number / 2) === studyYear,
  );
}

export function sectionsForDepartment<T extends WorkspaceSection>(
  sections: T[],
  programmes: WorkspaceProgramme[],
  departmentId: string,
): T[] {
  if (!departmentId) return [];
  const programmeIds = new Set(
    programmes
      .filter((programme) => programme.departmentId === departmentId)
      .map((programme) => programme.id),
  );
  return sections.filter((section) =>
    programmeIds.has(section.semester.programme.id),
  );
}

export function sectionCodeFromName(name: string): string {
  const trimmed = name.normalize("NFKC").trim().replace(/\s+/g, " ");
  const withoutPrefix = trimmed.replace(/^section\s+/i, "");
  return withoutPrefix.replace(/\s+/g, "-").toLocaleUpperCase().slice(0, 30);
}

export function sectionDisplayName(name: string): string {
  const trimmed = name.normalize("NFKC").trim().replace(/\s+/g, " ");
  return /^section\s+/i.test(trimmed) ? trimmed : `Section ${trimmed}`;
}

export function validateSectionDraft(
  draft: SectionDraft,
  programmes: WorkspaceProgramme[],
  sections: WorkspaceSection[],
  editingId?: string,
): string | null {
  if (!draft.departmentId) return "Select a department.";
  if (!draft.programmeId) return "Select a programme.";
  if (!draft.academicYearId) return "Select an academic year.";
  if (!draft.studyYear) return "Select a study year.";
  if (!draft.semesterId) return "Select a semester.";
  if (!draft.name.trim()) return "Section name is required.";
  const capacity = Number(draft.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 70) {
    return "Maximum students must be a whole number from 1 to 70.";
  }
  const semester = semestersForSectionDraft(programmes, draft).find(
    (candidate) => candidate.id === draft.semesterId,
  );
  if (!semester) {
    return "Select a semester that belongs to the chosen academic hierarchy.";
  }
  const code = normalizeAcademicIdentity(sectionCodeFromName(draft.name));
  const name = normalizeAcademicIdentity(sectionDisplayName(draft.name));
  const duplicate = sections.find(
    (section) =>
      section.id !== editingId &&
      section.semesterId === draft.semesterId &&
      (normalizeAcademicIdentity(section.code) === code ||
        normalizeAcademicIdentity(section.name) === name),
  );
  return duplicate
    ? "A section with this name already exists for the selected semester."
    : null;
}

export function validateSectionEditDraft(
  draft: SectionDraft,
  sections: WorkspaceSection[],
  editingId: string,
): string | null {
  if (!draft.name.trim()) return "Section name is required.";
  const capacity = Number(draft.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 70) {
    return "Maximum students must be a whole number from 1 to 70.";
  }
  if (!draft.semesterId) return "The section semester is missing.";
  const code = normalizeAcademicIdentity(sectionCodeFromName(draft.name));
  const name = normalizeAcademicIdentity(sectionDisplayName(draft.name));
  const duplicate = sections.find(
    (section) =>
      section.id !== editingId &&
      section.semesterId === draft.semesterId &&
      (normalizeAcademicIdentity(section.code) === code ||
        normalizeAcademicIdentity(section.name) === name),
  );
  return duplicate
    ? "A section with this name already exists for the selected semester."
    : null;
}

export function buildSectionPayload(draft: SectionDraft): SectionPayload {
  return {
    semesterId: draft.semesterId,
    code: sectionCodeFromName(draft.name),
    name: sectionDisplayName(draft.name),
    studyYear: Number(draft.studyYear),
    capacity: Number(draft.capacity || 70),
    ...(draft.assignedRoomId
      ? { assignedRoomId: draft.assignedRoomId }
      : {}),
    ...(draft.coordinatorPublicId
      ? { coordinatorPublicId: draft.coordinatorPublicId }
      : {}),
    ...(draft.prospectiveClassStaffPublicIds.length
      ? {
          prospectiveClassStaffPublicIds: [
            ...new Set(draft.prospectiveClassStaffPublicIds),
          ],
        }
      : {}),
    isActive: draft.isActive,
  };
}

export function sectionCapacity(section: WorkspaceSection): {
  current: number;
  maximum: number;
  available: number;
  isFull: boolean;
} {
  const maximum = section.maximumCapacity ?? section.capacity ?? 70;
  const current = section.currentStudentCount ?? 0;
  const available = section.availableSeats ?? Math.max(0, maximum - current);
  return { current, maximum, available, isFull: available <= 0 };
}

export function positiveDependencies(
  dependencies: Record<string, number>,
): Array<{ key: string; label: string; count: number }> {
  return Object.entries(dependencies)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({
      key,
      label: key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replaceAll("_", " ")
        .replace(/^./, (character) => character.toLocaleUpperCase()),
      count,
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}
