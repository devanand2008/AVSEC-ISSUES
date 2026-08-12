"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, CheckCircle2, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import {
  academicYearsForProgramme,
  buildSectionMovePayload,
  isSectionFull,
  programmesForDepartment,
  sectionCapacity,
  sectionOptionLabel,
  sectionsForAcademicSelection,
  semestersForStudyYear,
  studyYearsForAcademicPeriod,
  validateSectionMove,
  type StudentAcademicOption,
  type StudentAcademicOptions,
  type StudentAcademicSelection,
} from "./student-academic-options";

interface CurrentStudentAcademicProfile {
  departmentId: string;
  programmeId: string;
  sectionId: string;
  studyYear: number | null;
  department: { name: string; code: string };
  programme: { name: string; code: string };
  section: {
    id: string;
    name: string;
    code: string;
    semesterId: string;
    studyYear: number | null;
  };
}

interface StudentSectionMoveProps {
  studentPublicId: string;
  studentName: string;
  profile: CurrentStudentAcademicProfile;
}

interface MoveForm extends StudentAcademicSelection {
  sectionId: string;
  startsOn: string;
  reason: string;
}

const today = () => {
  const value = new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const blankMoveForm = (): MoveForm => ({
  departmentId: "",
  programmeId: "",
  academicYearId: "",
  studyYear: "",
  semesterId: "",
  sectionId: "",
  startsOn: today(),
  reason: "",
});

export function StudentSectionMove({
  studentPublicId,
  studentName,
  profile,
}: StudentSectionMoveProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<MoveForm>(() => blankMoveForm());
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const options = useQuery({
    queryKey: ["scope-options", "student-section-move"],
    queryFn: () =>
      api.get<StudentAcademicOptions>("/users/scope-options"),
  });

  const programmes = useMemo(
    () =>
      options.data
        ? programmesForDepartment(options.data, form.departmentId)
        : [],
    [form.departmentId, options.data],
  );
  const academicYears = useMemo(
    () =>
      options.data
        ? academicYearsForProgramme(options.data, form.programmeId)
        : [],
    [form.programmeId, options.data],
  );
  const studyYears = useMemo(
    () =>
      options.data
        ? studyYearsForAcademicPeriod(options.data, {
            programmeId: form.programmeId,
            academicYearId: form.academicYearId,
          })
        : [],
    [form.academicYearId, form.programmeId, options.data],
  );
  const semesters = useMemo(
    () =>
      options.data
        ? semestersForStudyYear(options.data, {
            programmeId: form.programmeId,
            academicYearId: form.academicYearId,
            studyYear: form.studyYear,
          })
        : [],
    [form.academicYearId, form.programmeId, form.studyYear, options.data],
  );
  const sections = useMemo(
    () =>
      options.data
        ? sectionsForAcademicSelection(options.data, form).filter(
            (section) => section.id !== profile.sectionId,
          )
        : [],
    [form, options.data, profile.sectionId],
  );

  const move = useMutation({
    mutationFn: () =>
      api.post(
        `/academic/sections/${form.sectionId}/students`,
        buildSectionMovePayload(studentPublicId, form.startsOn, form.reason),
      ),
    onSuccess: async () => {
      const destination = sections.find(
        (section) => section.id === form.sectionId,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["person", studentPublicId],
        }),
        queryClient.invalidateQueries({ queryKey: ["people"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "sections"] }),
        queryClient.invalidateQueries({ queryKey: ["scope-options"] }),
      ]);
      setSuccess(
        `${studentName} was moved to Section ${destination?.code ?? destination?.name ?? "selected"}.`,
      );
      setError("");
      setEditing(false);
      setForm(blankMoveForm());
    },
    onError: (caught) => {
      const message =
        caught instanceof ApiError
          ? caught.message
          : "The student's section could not be changed.";
      setError(
        caught instanceof ApiError && caught.requestId
          ? `${message} Reference: ${caught.requestId}.`
          : message,
      );
    },
  });

  function beginMove() {
    const currentSemester = options.data?.semesters.find(
      (semester) => semester.id === profile.section.semesterId,
    );
    setForm({
      ...blankMoveForm(),
      departmentId: profile.departmentId,
      programmeId: profile.programmeId,
      academicYearId: currentSemester?.academicYearId ?? "",
      studyYear: String(
        profile.studyYear ?? profile.section.studyYear ?? "",
      ),
      semesterId: profile.section.semesterId,
    });
    setError("");
    setSuccess("");
    setEditing(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const validationError = validateSectionMove(
      form.sectionId,
      form.startsOn,
      form.reason,
    );
    if (validationError) {
      setError(validationError);
      return;
    }
    const selectedSection = sections.find(
      (section) => section.id === form.sectionId,
    );
    if (!selectedSection) {
      setError(
        "Select an active section that belongs to the chosen academic period.",
      );
      return;
    }
    if (isSectionFull(selectedSection)) {
      const { capacity, currentStudentCount } =
        sectionCapacity(selectedSection);
      setError(
        `Section ${selectedSection.code ?? selectedSection.name} is full. Current capacity: ${currentStudentCount} / ${capacity}. Please select another Section.`,
      );
      return;
    }
    move.mutate();
  }

  return (
    <section className="avs-card student-section-move">
      <div className="student-section-move-header">
        <div>
          <h3>Section assignment</h3>
          <p>
            Current: {profile.department.code} - {profile.programme.code} -
            Section {profile.section.code}
          </p>
        </div>
        {!editing && (
          <button
            className="avs-btn avs-btn-secondary"
            type="button"
            disabled={options.isLoading || options.isError}
            onClick={beginMove}
          >
            <ArrowRightLeft size={16} /> Change section
          </button>
        )}
      </div>

      {options.isError && (
        <div className="error-box" role="alert">
          Active academic options could not be loaded. Refresh and try again.
        </div>
      )}
      {success && (
        <div className="student-section-move-success" role="status">
          <CheckCircle2 size={17} /> {success}
        </div>
      )}

      {editing && (
        <form onSubmit={submit} className="student-section-move-form">
          <MoveSelect
            label="Department"
            value={form.departmentId}
            options={options.data?.departments ?? []}
            onChange={(departmentId) =>
              setForm({
                ...form,
                departmentId,
                programmeId: "",
                academicYearId: "",
                studyYear: "",
                semesterId: "",
                sectionId: "",
              })
            }
          />
          <MoveSelect
            label="Programme"
            value={form.programmeId}
            options={programmes}
            disabled={!form.departmentId}
            onChange={(programmeId) =>
              setForm({
                ...form,
                programmeId,
                academicYearId: "",
                studyYear: "",
                semesterId: "",
                sectionId: "",
              })
            }
          />
          <MoveSelect
            label="Academic year"
            value={form.academicYearId}
            options={academicYears}
            disabled={!form.programmeId}
            onChange={(academicYearId) =>
              setForm({
                ...form,
                academicYearId,
                studyYear: "",
                semesterId: "",
                sectionId: "",
              })
            }
          />
          <MoveSelect
            label="Study year"
            value={form.studyYear}
            options={studyYears.map((year) => ({
              id: String(year),
              name: `Year ${year}`,
            }))}
            disabled={!form.academicYearId}
            onChange={(studyYear) =>
              setForm({
                ...form,
                studyYear,
                semesterId: "",
                sectionId: "",
              })
            }
          />
          <MoveSelect
            label="Semester"
            value={form.semesterId}
            options={semesters}
            disabled={!form.studyYear}
            onChange={(semesterId) =>
              setForm({ ...form, semesterId, sectionId: "" })
            }
          />
          <MoveSelect
            label="New section"
            value={form.sectionId}
            options={sections}
            disabled={!form.semesterId}
            getOptionLabel={sectionOptionLabel}
            isOptionDisabled={isSectionFull}
            onChange={(sectionId) => setForm({ ...form, sectionId })}
          />
          <label className="field">
            <span>Effective from</span>
            <input
              className="input"
              type="date"
              required
              value={form.startsOn}
              onChange={(event) =>
                setForm({ ...form, startsOn: event.target.value })
              }
            />
          </label>
          <label className="field student-section-move-reason">
            <span>Reason</span>
            <textarea
              className="input"
              required
              minLength={3}
              maxLength={500}
              rows={3}
              value={form.reason}
              onChange={(event) =>
                setForm({ ...form, reason: event.target.value })
              }
              placeholder="Reason for changing the student's section"
            />
          </label>
          {sections.some(isSectionFull) && (
            <p className="student-section-move-capacity" role="status">
              Full sections cannot accept another active student.
            </p>
          )}
          {error && (
            <div className="error-box student-section-move-error" role="alert">
              {error}
            </div>
          )}
          <div className="student-section-move-actions">
            <button
              className="avs-btn avs-btn-ghost"
              type="button"
              onClick={() => {
                setEditing(false);
                setError("");
              }}
            >
              <X size={16} /> Cancel
            </button>
            <button
              className="avs-btn avs-btn-primary"
              type="submit"
              disabled={move.isPending || !form.sectionId}
            >
              <ArrowRightLeft size={16} />
              {move.isPending ? "Changing section..." : "Confirm section change"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function MoveSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  getOptionLabel = defaultOptionLabel,
  isOptionDisabled = () => false,
}: {
  label: string;
  value: string;
  options: StudentAcademicOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  getOptionLabel?: (option: StudentAcademicOption) => string;
  isOptionDisabled?: (option: StudentAcademicOption) => boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        className="input"
        required
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select...</option>
        {options.map((option) => (
          <option
            key={option.id}
            value={option.id}
            disabled={isOptionDisabled(option)}
          >
            {getOptionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function defaultOptionLabel(option: StudentAcademicOption): string {
  return option.code ? `${option.code} - ${option.name}` : option.name;
}
