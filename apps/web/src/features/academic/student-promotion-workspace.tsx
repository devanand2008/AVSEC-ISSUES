"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Users } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  ENGINEERING_STUDY_YEARS,
  registrationQuery,
  sectionRegistrationLabel,
  semestersForRegistration,
  studyYearLabel,
  type RegistrationAcademicYearOption,
  type RegistrationProgrammeOption,
  type RegistrationSectionOption,
  type RegistrationSemesterOption,
} from "@/features/people/student-registration";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";
import {
  STUDENT_COMPLETION_STATUSES,
  buildPromotionPayload,
  nextStudyYear,
  promotionAfterSourceAcademicYearChange,
  promotionAfterSourceProgrammeChange,
  promotionAfterSourceStudyYearChange,
  promotionTargetSectionFilters,
  toggleSelectedStudent,
  validatePromotionDraft,
  type PromotionStudent,
  type StudentCompletionStatus,
  type StudentPromotionDraft,
  type StudentPromotionPreview,
} from "./student-promotion";

interface PromotionSection extends RegistrationSectionOption {
  programmeId?: string;
  academicYearId?: string;
  semester?: {
    programme: { id: string; code?: string; name: string };
    academicYear: { id: string; name: string };
  };
}

interface PeopleResponse {
  data: PromotionStudent[];
  meta: { total: number };
}

const blankDraft = (): StudentPromotionDraft => ({
  sourceAcademicYearId: "",
  sourceProgrammeId: "",
  sourceStudyYear: "",
  sourceSectionId: "",
  studentPublicIds: [],
  targetAcademicYearId: "",
  targetStudyYear: "",
  targetSemesterId: "",
  targetSectionId: "",
  completionStatus: "",
  academicOverride: false,
  academicOverrideReason: "",
});

export function StudentPromotionWorkspace() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [draft, setDraft] = useState(blankDraft);
  const [preview, setPreview] = useState<StudentPromotionPreview | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const canOverride = user?.permissions.includes("academic.override_placement") ?? false;

  function changeDraft(next: StudentPromotionDraft) {
    setDraft(next);
    setPreview(null);
    setError("");
  }

  const programmes = useQuery({ queryKey: ["student-promotion", "programmes"], queryFn: () => api.get<RegistrationProgrammeOption[]>("/academic/programmes") });
  const academicYears = useQuery({ queryKey: ["student-promotion", "academic-years"], queryFn: () => api.get<RegistrationAcademicYearOption[]>("/academic/years") });
  const sourceSections = useQuery({
    queryKey: ["student-promotion", "source-sections", draft.sourceAcademicYearId, draft.sourceProgrammeId, draft.sourceStudyYear],
    queryFn: () => api.get<PromotionSection[]>(registrationQuery("/academic/sections", {
      academicYearId: draft.sourceAcademicYearId,
      programmeId: draft.sourceProgrammeId,
      studyYear: draft.sourceStudyYear,
    })),
    enabled: Boolean(draft.sourceAcademicYearId && draft.sourceProgrammeId && draft.sourceStudyYear),
  });
  const source = sourceSections.data?.find((section) => section.id === draft.sourceSectionId);
  const sourceStudyYear =
    source?.studyYear ?? (Number(draft.sourceStudyYear) || null);
  const sourceProgrammeId = draft.sourceProgrammeId || source?.programmeId || source?.semester?.programme.id || "";
  const selectedProgramme = programmes.data?.find((programme) => programme.id === sourceProgrammeId);
  const students = useQuery({
    queryKey: ["student-promotion", "students", draft.sourceSectionId],
    queryFn: () => api.get<PeopleResponse>(registrationQuery("/admin/people", { role: "STUDENT", status: "ACTIVE", sectionId: draft.sourceSectionId, pageSize: "100" })),
    enabled: Boolean(draft.sourceSectionId),
  });
  const semesters = useQuery({
    queryKey: ["student-promotion", "semesters", sourceProgrammeId, draft.targetAcademicYearId, draft.targetStudyYear, draft.academicOverride],
    queryFn: () => api.get<RegistrationSemesterOption[]>(registrationQuery("/academic/semesters", { programmeId: sourceProgrammeId, academicYearId: draft.targetAcademicYearId, studyYear: draft.academicOverride ? undefined : draft.targetStudyYear })),
    enabled: Boolean(sourceProgrammeId && draft.targetAcademicYearId && draft.targetStudyYear && !draft.completionStatus),
  });
  const visibleSemesters = useMemo(() => semestersForRegistration(semesters.data ?? [], draft.targetStudyYear, draft.academicOverride), [draft.academicOverride, draft.targetStudyYear, semesters.data]);
  const targets = useQuery({
    queryKey: ["student-promotion", "targets", sourceProgrammeId, draft.targetAcademicYearId, draft.targetStudyYear, draft.targetSemesterId, draft.academicOverride],
    queryFn: () => api.get<PromotionSection[]>(registrationQuery("/academic/sections", promotionTargetSectionFilters({ ...draft, sourceProgrammeId }))),
    enabled: Boolean(sourceProgrammeId && draft.targetAcademicYearId && draft.targetStudyYear && draft.targetSemesterId && !draft.completionStatus),
  });

  const previewMutation = useMutation({ mutationFn: () => api.post<StudentPromotionPreview>("/academic/student-promotions/preview", buildPromotionPayload(draft)), onSuccess: (result) => { setPreview(result); setError(""); }, onError: (caught) => setError(apiMessage(caught, "Promotion preview could not be created.")) });
  const confirmMutation = useMutation({ mutationFn: () => api.post<StudentPromotionPreview>("/academic/student-promotions/confirm", buildPromotionPayload(draft)), onSuccess: async (result) => { setSuccess(`${result.affectedStudents ?? result.selectedCount} student records were updated.`); setPreview(null); setDraft(blankDraft()); await Promise.all([client.invalidateQueries({ queryKey: ["student-promotion"] }), client.invalidateQueries({ queryKey: ["people"] }), client.invalidateQueries({ queryKey: ["academic-workspace"] })]); }, onError: (caught) => setError(apiMessage(caught, "Promotion could not be confirmed.")) });

  function chooseSource(sourceSectionId: string) {
    const selection = sourceSections.data?.find((section) => section.id === sourceSectionId);
    const next = nextStudyYear(selection?.studyYear);
    changeDraft({ ...blankDraft(), sourceAcademicYearId: draft.sourceAcademicYearId, sourceProgrammeId, sourceStudyYear: draft.sourceStudyYear, sourceSectionId, targetStudyYear: next ? String(next) : "", completionStatus: next ? "" : "COMPLETED" });
  }

  function requestPreview(event: FormEvent) {
    event.preventDefault();
    const issue = validatePromotionDraft(draft);
    if (issue) return setError(issue);
    previewMutation.mutate();
  }

  const allVisibleIds = (students.data?.data ?? []).map(({ publicId }) => publicId);
  const allSelected = Boolean(allVisibleIds.length && allVisibleIds.every((id) => draft.studentPublicIds.includes(id)));
  const loading = programmes.isLoading || academicYears.isLoading;
  const loadError = programmes.isError || academicYears.isError;

  return <div className="page-container main-with-bottom-nav student-promotion-page">
    <PageHeader title="Student Promotion" description="Promote selected students to the next academic placement or safely complete fourth-year records." breadcrumbs={[{ label: "Admin" }, { label: "Academic Operations" }, { label: "Student Promotion" }]} />
    {success && <div className="academic-master-success" role="status"><CheckCircle2 size={17} /> {success}</div>}
    {loading && <LoadingState rows={6} />}
    {loadError && <ErrorState message="Promotion options could not be loaded." />}
    {!loading && !loadError && <form className="student-promotion-workspace" onSubmit={requestPreview}>
      {error && <div className="error-box" role="alert">{error}</div>}
      <section className="avs-card student-promotion-section">
        <header><span>1</span><div><h2>Source Class</h2><p>Select the current Section and students.</p></div></header>
        <div className="student-promotion-grid">
          <PromotionSelect label="Academic Year" value={draft.sourceAcademicYearId} options={(academicYears.data ?? []).map((year) => ({ id: year.id, name: `${year.name}${year.isCurrent ? " (Current)" : ""}` }))} onChange={(sourceAcademicYearId) => changeDraft(promotionAfterSourceAcademicYearChange(draft, sourceAcademicYearId))} />
          <PromotionSelect label="Programme" value={draft.sourceProgrammeId} disabled={!draft.sourceAcademicYearId} options={(programmes.data ?? []).map((programme) => ({ id: programme.id, name: `${programme.code} - ${programme.name}` }))} onChange={(sourceProgrammeId) => changeDraft(promotionAfterSourceProgrammeChange(draft, sourceProgrammeId))} />
          <PromotionSelect label="Current Study Year" value={draft.sourceStudyYear} disabled={!draft.sourceProgrammeId} options={ENGINEERING_STUDY_YEARS.map((year) => ({ id: String(year), name: studyYearLabel(year) }))} onChange={(sourceStudyYear) => changeDraft(promotionAfterSourceStudyYearChange(draft, sourceStudyYear))} />
          <PromotionSelect label="Source Section" value={draft.sourceSectionId} disabled={!draft.sourceStudyYear || sourceSections.isLoading} options={(sourceSections.data ?? []).filter((section) => section.currentStudentCount > 0).map((section) => ({ id: section.id, name: sectionRegistrationLabel(section) }))} onChange={chooseSource} />
        </div>
        {sourceSections.isError && <ErrorState message="Source sections could not be loaded." />}
        {draft.sourceSectionId && <div className="promotion-student-picker"><div className="promotion-student-picker-head"><div><strong>Select Students</strong><small>{draft.studentPublicIds.length} selected of {students.data?.meta.total ?? 0}</small></div><label className="check-field"><input type="checkbox" checked={allSelected} disabled={!allVisibleIds.length} onChange={(event) => changeDraft({ ...draft, studentPublicIds: event.target.checked ? allVisibleIds : [] })} /> Select all visible</label></div>{students.isLoading && <LoadingState rows={4} />}{students.isError && <ErrorState message="Students in this Section could not be loaded." />}{!students.isLoading && !students.data?.data.length && <p className="muted">No active students are assigned to this Section.</p>}<div className="promotion-student-list">{students.data?.data.map((student) => <label key={student.publicId}><input type="checkbox" checked={draft.studentPublicIds.includes(student.publicId)} onChange={(event) => changeDraft({ ...draft, studentPublicIds: toggleSelectedStudent(draft.studentPublicIds, student.publicId, event.target.checked) })} /><span><strong>{student.fullName}</strong><small>{student.studentProfile?.registerNumber || student.collegeIdentityId}</small></span></label>)}</div></div>}
      </section>

      <section className="avs-card student-promotion-section">
        <header><span>2</span><div><h2>{sourceStudyYear === 4 ? "Next Placement or Completion" : "Next Academic Placement"}</h2><p>{selectedProgramme ? `${selectedProgramme.name} · ${selectedProgramme.durationYears} years` : "Choose the destination academic period."}</p></div></header>
        {sourceStudyYear === 4 && <label className="field"><span>Completion Status</span><select className="input" value={draft.completionStatus} onChange={(event) => changeDraft({ ...draft, completionStatus: event.target.value as StudentCompletionStatus, targetAcademicYearId: "", targetStudyYear: "", targetSemesterId: "", targetSectionId: "" })}><option value="">Continue to another placement</option>{STUDENT_COMPLETION_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>}
        {!draft.completionStatus && <div className="student-promotion-grid"><PromotionSelect label="Next Academic Year" value={draft.targetAcademicYearId} options={(academicYears.data ?? []).map((year) => ({ id: year.id, name: year.name }))} onChange={(targetAcademicYearId) => changeDraft({ ...draft, targetAcademicYearId, targetSemesterId: "", targetSectionId: "" })} /><PromotionSelect label="Next Study Year" value={draft.targetStudyYear} options={ENGINEERING_STUDY_YEARS.map((year) => ({ id: String(year), name: studyYearLabel(year) }))} onChange={(targetStudyYear) => changeDraft({ ...draft, targetStudyYear, targetSemesterId: "", targetSectionId: "" })} /><PromotionSelect label="Semester" value={draft.targetSemesterId} disabled={!draft.targetAcademicYearId || !draft.targetStudyYear} options={visibleSemesters.map((semester) => ({ id: semester.id, name: `Semester ${semester.number}` }))} onChange={(targetSemesterId) => changeDraft({ ...draft, targetSemesterId, targetSectionId: "" })} /><PromotionSelect label="Section" value={draft.targetSectionId} disabled={!draft.targetSemesterId} options={(targets.data ?? []).map((section) => ({ id: section.id, name: sectionRegistrationLabel(section), disabled: section.isFull || section.availableSeats <= 0 }))} onChange={(targetSectionId) => changeDraft({ ...draft, targetSectionId })} /></div>}
        {canOverride && <div className="student-registration-override"><label className="check-field"><input type="checkbox" checked={draft.academicOverride} onChange={(event) => changeDraft({ ...draft, academicOverride: event.target.checked, academicOverrideReason: "", targetSemesterId: "", targetSectionId: "" })} /> Advanced Academic Override</label>{draft.academicOverride && <label className="field"><span>Override Reason *</span><textarea className="input" required minLength={10} maxLength={500} value={draft.academicOverrideReason} onChange={(event) => changeDraft({ ...draft, academicOverrideReason: event.target.value })} /></label>}</div>}
      </section>

      {preview && <section className="avs-card student-promotion-preview" aria-label="Promotion preview"><header><Users size={20} /><div><h2>Review Before Confirm</h2><p>No database rows have been changed yet.</p></div></header><dl><div><dt>Action</dt><dd>{preview.mode}</dd></div><div><dt>Students</dt><dd>{preview.selectedCount}</dd></div><div><dt>Current Study Year</dt><dd>{studyYearLabel(preview.sourceStudyYear)}</dd></div><div><dt>Next State</dt><dd>{preview.completionStatus ?? (preview.targetStudyYear ? studyYearLabel(preview.targetStudyYear) : "Not selected")}</dd></div>{preview.targetCapacity != null && <><div><dt>Target Capacity</dt><dd>{preview.targetCurrentStudents} / {preview.targetCapacity}</dd></div><div><dt>Seats After</dt><dd>{preview.targetAvailableAfterMove}</dd></div></>}</dl><div className="student-promotion-confirm"><button className="avs-btn avs-btn-secondary" type="button" onClick={() => setPreview(null)}>Back & Edit</button><button className="avs-btn avs-btn-primary" type="button" disabled={confirmMutation.isPending} onClick={() => confirmMutation.mutate()}><CheckCircle2 size={16} /> {confirmMutation.isPending ? "Confirming..." : "Confirm Selected Students"}</button></div></section>}

      {!preview && <footer className="student-promotion-actions"><span>{draft.studentPublicIds.length} students selected</span><button className="avs-btn avs-btn-primary" disabled={previewMutation.isPending}><ArrowRight size={16} /> {previewMutation.isPending ? "Preparing preview..." : "Preview Promotion"}</button></footer>}
    </form>}
  </div>;
}

function PromotionSelect({ label, value, options, disabled = false, onChange }: { label: string; value: string; options: Array<{ id: string; name: string; disabled?: boolean }>; disabled?: boolean; onChange: (value: string) => void }) { return <label className="field"><span>{label} *</span><select className="input" required disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}><option value="">Select...</option>{options.map((option) => <option key={option.id} value={option.id} disabled={option.disabled}>{option.name}</option>)}</select></label>; }
function apiMessage(caught: unknown, fallback: string) { return caught instanceof ApiError ? `${caught.message}${caught.requestId ? ` Reference: ${caught.requestId}.` : ""}` : fallback; }
