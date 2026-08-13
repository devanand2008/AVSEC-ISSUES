export const STUDENT_COMPLETION_STATUSES = [
  "COMPLETED",
  "GRADUATED",
  "ALUMNI",
  "DISCONTINUED",
  "TRANSFERRED",
] as const;

export type StudentCompletionStatus =
  (typeof STUDENT_COMPLETION_STATUSES)[number];

export interface PromotionStudent {
  publicId: string;
  collegeIdentityId: string;
  fullName: string;
  status: string;
  studentProfile: {
    registerNumber?: string | null;
    studyYear?: number | null;
    section?: { id?: string; code: string; name: string };
  } | null;
}

export interface StudentPromotionDraft {
  sourceAcademicYearId: string;
  sourceProgrammeId: string;
  sourceStudyYear: string;
  sourceSectionId: string;
  studentPublicIds: string[];
  targetAcademicYearId: string;
  targetStudyYear: string;
  targetSemesterId: string;
  targetSectionId: string;
  completionStatus: StudentCompletionStatus | "";
  academicOverride: boolean;
  academicOverrideReason: string;
}

export function promotionAfterSourceAcademicYearChange(
  draft: StudentPromotionDraft,
  sourceAcademicYearId: string,
): StudentPromotionDraft {
  return {
    ...draft,
    sourceAcademicYearId,
    sourceProgrammeId: "",
    sourceStudyYear: "",
    sourceSectionId: "",
    studentPublicIds: [],
    targetAcademicYearId: "",
    targetStudyYear: "",
    targetSemesterId: "",
    targetSectionId: "",
    completionStatus: "",
  };
}

export function promotionAfterSourceProgrammeChange(
  draft: StudentPromotionDraft,
  sourceProgrammeId: string,
): StudentPromotionDraft {
  return {
    ...draft,
    sourceProgrammeId,
    sourceStudyYear: "",
    sourceSectionId: "",
    studentPublicIds: [],
    targetAcademicYearId: "",
    targetStudyYear: "",
    targetSemesterId: "",
    targetSectionId: "",
    completionStatus: "",
  };
}

export function promotionAfterSourceStudyYearChange(
  draft: StudentPromotionDraft,
  sourceStudyYear: string,
): StudentPromotionDraft {
  return {
    ...draft,
    sourceStudyYear,
    sourceSectionId: "",
    studentPublicIds: [],
    targetAcademicYearId: "",
    targetStudyYear: "",
    targetSemesterId: "",
    targetSectionId: "",
    completionStatus: "",
  };
}

export function promotionTargetSectionFilters(
  draft: Pick<
    StudentPromotionDraft,
    | "sourceProgrammeId"
    | "targetAcademicYearId"
    | "targetStudyYear"
    | "targetSemesterId"
    | "academicOverride"
  >,
): Record<string, string | undefined> {
  return {
    programmeId: draft.sourceProgrammeId,
    academicYearId: draft.targetAcademicYearId,
    studyYear: draft.academicOverride ? undefined : draft.targetStudyYear,
    semesterId: draft.targetSemesterId,
  };
}

export interface StudentPromotionPayload {
  sourceSectionId: string;
  studentPublicIds: string[];
  targetSectionId?: string;
  targetAcademicYearId?: string;
  targetStudyYear?: number;
  targetSemesterId?: string;
  completionStatus?: StudentCompletionStatus;
  academicOverride?: boolean;
  academicOverrideReason?: string;
}

export interface StudentPromotionPreview {
  mode: "PROMOTION" | "COMPLETION";
  selectedCount: number;
  selectedStudentPublicIds: string[];
  sourceSectionId: string;
  sourceStudyYear: number;
  targetSectionId: string | null;
  targetAcademicYearId: string | null;
  targetStudyYear: number | null;
  targetSemesterId: string | null;
  completionStatus: StudentCompletionStatus | null;
  targetCurrentStudents: number;
  targetCapacity: number | null;
  targetAvailableAfterMove: number | null;
  overrideApplied: boolean;
  confirmed?: boolean;
  affectedStudents?: number;
}

export function nextStudyYear(studyYear: number | null | undefined): number | null {
  if (!Number.isInteger(studyYear) || Number(studyYear) < 1) return null;
  return Number(studyYear) < 4 ? Number(studyYear) + 1 : null;
}

export function validatePromotionDraft(
  draft: StudentPromotionDraft,
): string | null {
  if (!draft.sourceSectionId) return "Select a source section.";
  if (!draft.studentPublicIds.length) return "Select at least one student.";
  if (draft.studentPublicIds.length > 500) {
    return "Select no more than 500 students in one promotion.";
  }
  const completion = Boolean(draft.completionStatus);
  if (
    !completion &&
    (!draft.targetAcademicYearId ||
      !draft.targetStudyYear ||
      !draft.targetSemesterId ||
      !draft.targetSectionId)
  ) {
    return "Select the target Academic Year, Study Year, Semester, and Section.";
  }
  if (
    draft.academicOverride &&
    draft.academicOverrideReason.trim().length < 10
  ) {
    return "Enter an academic override reason with at least 10 characters.";
  }
  return null;
}

export function buildPromotionPayload(
  draft: StudentPromotionDraft,
): StudentPromotionPayload {
  const shared = {
    sourceSectionId: draft.sourceSectionId,
    studentPublicIds: [...draft.studentPublicIds],
    ...(draft.academicOverride
      ? {
          academicOverride: true,
          academicOverrideReason: draft.academicOverrideReason.trim(),
        }
      : {}),
  };
  if (draft.completionStatus) {
    return { ...shared, completionStatus: draft.completionStatus };
  }
  return {
    ...shared,
    targetAcademicYearId: draft.targetAcademicYearId,
    targetStudyYear: Number(draft.targetStudyYear),
    targetSemesterId: draft.targetSemesterId,
    targetSectionId: draft.targetSectionId,
  };
}

export function toggleSelectedStudent(
  ids: string[],
  publicId: string,
  selected: boolean,
): string[] {
  return selected
    ? [...new Set([...ids, publicId])]
    : ids.filter((id) => id !== publicId);
}
