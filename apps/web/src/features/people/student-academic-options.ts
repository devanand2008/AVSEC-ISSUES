export interface StudentAcademicOption {
  id: string;
  name: string;
  code?: string;
  departmentId?: string;
  programmeId?: string;
  academicYearId?: string;
  semesterId?: string;
  studyYear?: number | null;
  number?: number;
  isCurrent?: boolean;
  capacity?: number;
  currentStudentCount?: number;
  availableSeats?: number;
  assignedRoom?: { code: string; name: string } | null;
}

export interface StudentAcademicOptions {
  departments: StudentAcademicOption[];
  programmes: StudentAcademicOption[];
  academicYears: StudentAcademicOption[];
  semesters: StudentAcademicOption[];
  sections: StudentAcademicOption[];
}

export interface StudentAcademicSelection {
  departmentId: string;
  programmeId: string;
  academicYearId: string;
  studyYear: string;
  semesterId: string;
}

export interface SectionMovePayload {
  studentPublicId: string;
  startsOn: string;
  reason: string;
}

export function programmesForDepartment(
  options: Pick<StudentAcademicOptions, "programmes">,
  departmentId: string,
): StudentAcademicOption[] {
  if (!departmentId) return [];
  return options.programmes.filter(
    (programme) => programme.departmentId === departmentId,
  );
}

export function academicYearsForProgramme(
  options: Pick<StudentAcademicOptions, "academicYears" | "semesters">,
  programmeId: string,
): StudentAcademicOption[] {
  if (!programmeId) return [];
  const yearIds = new Set(
    options.semesters
      .filter((semester) => semester.programmeId === programmeId)
      .map((semester) => semester.academicYearId)
      .filter((id): id is string => Boolean(id)),
  );
  return options.academicYears.filter((year) => yearIds.has(year.id));
}

export function studyYearsForAcademicPeriod(
  options: Pick<StudentAcademicOptions, "semesters" | "sections">,
  selection: Pick<
    StudentAcademicSelection,
    "programmeId" | "academicYearId"
  >,
): number[] {
  if (!selection.programmeId || !selection.academicYearId) return [];
  const semesters = options.semesters.filter(
    (semester) =>
      semester.programmeId === selection.programmeId &&
      semester.academicYearId === selection.academicYearId,
  );
  const semesterById = new Map(
    semesters.map((semester) => [semester.id, semester]),
  );
  return [
    ...new Set(
      options.sections
        .filter((section) => semesterById.has(section.semesterId ?? ""))
        .map((section) =>
          sectionStudyYear(
            section,
            semesterById.get(section.semesterId ?? ""),
          ),
        )
        .filter(
          (year): year is number =>
            typeof year === "number" && Number.isInteger(year) && year > 0,
        ),
    ),
  ].sort((left, right) => left - right);
}

export function semestersForStudyYear(
  options: Pick<StudentAcademicOptions, "semesters" | "sections">,
  selection: Pick<
    StudentAcademicSelection,
    "programmeId" | "academicYearId" | "studyYear"
  >,
): StudentAcademicOption[] {
  const studyYear = Number(selection.studyYear);
  if (
    !selection.programmeId ||
    !selection.academicYearId ||
    !Number.isInteger(studyYear)
  ) {
    return [];
  }
  return options.semesters.filter((semester) => {
    if (
      semester.programmeId !== selection.programmeId ||
      semester.academicYearId !== selection.academicYearId
    ) {
      return false;
    }
    return options.sections.some(
      (section) =>
        section.semesterId === semester.id &&
        sectionStudyYear(section, semester) === studyYear,
    );
  });
}

export function sectionsForAcademicSelection(
  options: Pick<
    StudentAcademicOptions,
    "programmes" | "semesters" | "sections"
  >,
  selection: StudentAcademicSelection,
): StudentAcademicOption[] {
  const studyYear = Number(selection.studyYear);
  if (
    !selection.departmentId ||
    !selection.programmeId ||
    !selection.academicYearId ||
    !Number.isInteger(studyYear) ||
    !selection.semesterId
  ) {
    return [];
  }
  const programme = options.programmes.find(
    (candidate) =>
      candidate.id === selection.programmeId &&
      candidate.departmentId === selection.departmentId,
  );
  if (!programme) return [];
  const semester = options.semesters.find(
    (candidate) =>
      candidate.id === selection.semesterId &&
      candidate.programmeId === selection.programmeId &&
      candidate.academicYearId === selection.academicYearId,
  );
  if (!semester) return [];
  return options.sections.filter(
    (section) =>
      section.semesterId === semester.id &&
      sectionStudyYear(section, semester) === studyYear,
  );
}

export function sectionCapacity(section: StudentAcademicOption): {
  capacity: number;
  currentStudentCount: number;
  availableSeats: number;
} {
  const capacity = section.capacity ?? 70;
  const currentStudentCount =
    section.currentStudentCount ??
    (section.availableSeats === undefined
      ? 0
      : Math.max(0, capacity - section.availableSeats));
  const availableSeats =
    section.availableSeats ?? Math.max(0, capacity - currentStudentCount);
  return { capacity, currentStudentCount, availableSeats };
}

export function isSectionFull(section: StudentAcademicOption): boolean {
  const capacity = sectionCapacity(section);
  return (
    capacity.availableSeats <= 0 ||
    capacity.currentStudentCount >= capacity.capacity
  );
}

export function sectionOptionLabel(section: StudentAcademicOption): string {
  const { capacity, currentStudentCount } = sectionCapacity(section);
  const identity = section.code
    ? `${section.code} - ${section.name}`
    : section.name;
  const classroom = section.assignedRoom
    ? ` - Classroom ${section.assignedRoom.code} - ${section.assignedRoom.name}`
    : "";
  return `${identity}${classroom} - ${currentStudentCount} / ${capacity}${
    isSectionFull(section) ? " - Full" : ""
  }`;
}

export function validateSectionMove(
  sectionId: string,
  startsOn: string,
  reason: string,
): string | null {
  if (!sectionId) return "Select the student's new section.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) {
    return "Select a valid effective date.";
  }
  const effectiveDate = new Date(`${startsOn}T00:00:00Z`);
  if (
    Number.isNaN(effectiveDate.getTime()) ||
    effectiveDate.toISOString().slice(0, 10) !== startsOn
  ) {
    return "Select a valid effective date.";
  }
  if (reason.trim().length < 3) {
    return "Enter a reason with at least 3 characters.";
  }
  return null;
}

export function buildSectionMovePayload(
  studentPublicId: string,
  startsOn: string,
  reason: string,
): SectionMovePayload {
  return {
    studentPublicId,
    startsOn,
    reason: reason.trim(),
  };
}

function sectionStudyYear(
  section: StudentAcademicOption,
  semester?: StudentAcademicOption,
): number | undefined {
  if (Number.isInteger(section.studyYear) && Number(section.studyYear) > 0) {
    return Number(section.studyYear);
  }
  if (Number.isInteger(semester?.studyYear) && Number(semester?.studyYear) > 0) {
    return Number(semester?.studyYear);
  }
  if (Number.isInteger(semester?.number) && Number(semester?.number) > 0) {
    return Math.ceil(Number(semester?.number) / 2);
  }
  return undefined;
}
