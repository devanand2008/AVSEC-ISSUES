"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  UserPlus,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  createPersonErrorField,
  generateTemporaryPassword,
  isStrongTemporaryPassword,
  validateCreatePersonForm,
  type CreatePersonField,
  type CreatePersonFormState,
} from "./create-person";
import {
  ENGINEERING_STUDY_YEARS,
  STUDENT_REGISTRATION_STEPS,
  academicYearGroups,
  admissionYearFromAcademicYear,
  currentAcademicYearId,
  expectedGraduationYear,
  registrationSectionFilters,
  registrationQuery,
  sectionRegistrationLabel,
  semestersForRegistration,
  studentFormAfterAcademicYearChange,
  studentFormAfterDepartmentChange,
  studentFormAfterDegreeChange,
  studentFormAfterOverrideChange,
  studentFormAfterProgrammeChange,
  studentFormAfterSectionChange,
  studentFormAfterSemesterChange,
  studentFormAfterStudyYearChange,
  studentRegistrationStepForField,
  studyYearLabel,
  type DegreeTypeOption,
  type RegistrationAcademicYearOption,
  type RegistrationDepartmentOption,
  type RegistrationProgrammeOption,
  type RegistrationSectionOption,
  type RegistrationSemesterOption,
  type StudentRegistrationStep,
} from "./student-registration";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

interface StudentRegistrationWizardProps {
  form: CreatePersonFormState;
  setForm: (form: CreatePersonFormState) => void;
  error: string;
  fieldError: { field: CreatePersonField; message: string } | null;
  isPending: boolean;
  onCreate: () => void;
  onSwitchToOther: () => void;
}

const QUERY_STALE_TIME = 60_000;

export function StudentRegistrationWizard({
  form,
  setForm,
  error,
  fieldError,
  isPending,
  onCreate,
  onSwitchToOther,
}: StudentRegistrationWizardProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<StudentRegistrationStep>(1);
  const [localError, setLocalError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const defaultYearApplied = useRef(false);
  const admissionYearTouched = useRef(false);
  const graduationYearTouched = useRef(false);
  const canOverride =
    user?.permissions.includes("academic.override_placement") ?? false;

  const degreeTypes = useQuery({
    queryKey: ["student-registration", "degree-types"],
    queryFn: () => api.get<DegreeTypeOption[]>("/academic/degree-types"),
    staleTime: QUERY_STALE_TIME,
  });
  const departments = useQuery({
    queryKey: ["student-registration", "departments", form.degreeTypeId],
    queryFn: () =>
      api.get<RegistrationDepartmentOption[]>(
        registrationQuery("/academic/departments", {
          degreeTypeId: form.degreeTypeId,
        }),
      ),
    enabled: Boolean(form.degreeTypeId),
    staleTime: QUERY_STALE_TIME,
  });
  const programmes = useQuery({
    queryKey: [
      "student-registration",
      "programmes",
      form.degreeTypeId,
      form.departmentId,
    ],
    queryFn: () =>
      api.get<RegistrationProgrammeOption[]>(
        registrationQuery("/academic/programmes", {
          degreeTypeId: form.degreeTypeId,
          departmentId: form.departmentId,
        }),
      ),
    enabled: Boolean(form.degreeTypeId && form.departmentId),
    staleTime: QUERY_STALE_TIME,
  });
  const academicYears = useQuery({
    queryKey: ["student-registration", "academic-years"],
    queryFn: () =>
      api.get<RegistrationAcademicYearOption[]>("/academic/years"),
    staleTime: QUERY_STALE_TIME,
  });
  const semesters = useQuery({
    queryKey: [
      "student-registration",
      "semesters",
      form.programmeId,
      form.academicYearId,
      form.studyYear,
      form.academicOverride,
    ],
    queryFn: () =>
      api.get<RegistrationSemesterOption[]>(
        registrationQuery("/academic/semesters", {
          programmeId: form.programmeId,
          academicYearId: form.academicYearId,
          studyYear: form.academicOverride ? undefined : form.studyYear,
        }),
      ),
    enabled: Boolean(
      form.programmeId && form.academicYearId && form.studyYear,
    ),
    staleTime: QUERY_STALE_TIME,
  });
  const sections = useQuery({
    queryKey: [
      "student-registration",
      "sections",
      form.programmeId,
      form.academicYearId,
      form.studyYear,
      form.semesterId,
      form.academicOverride,
    ],
    queryFn: () =>
      api.get<RegistrationSectionOption[]>(
        registrationQuery(
          "/academic/sections",
          registrationSectionFilters(form),
        ),
      ),
    enabled: Boolean(
      form.programmeId &&
        form.academicYearId &&
        form.studyYear &&
        form.semesterId,
    ),
    staleTime: 10_000,
  });

  const selectedProgramme = programmes.data?.find(
    (programme) => programme.id === form.programmeId,
  );
  const visibleSemesters = useMemo(
    () =>
      semestersForRegistration(
        semesters.data ?? [],
        form.studyYear,
        form.academicOverride,
      ),
    [form.academicOverride, form.studyYear, semesters.data],
  );

  useEffect(() => {
    if (defaultYearApplied.current || !academicYears.data?.length) return;
    defaultYearApplied.current = true;
    const academicYearId = currentAcademicYearId(academicYears.data);
    if (!form.academicYearId && academicYearId) {
      setForm({ ...form, academicYearId });
    }
  }, [academicYears.data, form, setForm]);

  useEffect(() => {
    if (!form.academicYearId || admissionYearTouched.current) return;
    const year = academicYears.data?.find(
      (candidate) => candidate.id === form.academicYearId,
    );
    const admissionYear = admissionYearFromAcademicYear(year);
    if (!admissionYear || form.admissionYear === String(admissionYear)) return;
    setForm({
      ...form,
      admissionYear: String(admissionYear),
      ...(!graduationYearTouched.current && selectedProgramme
        ? {
            expectedGraduationYear: expectedGraduationYear(
              admissionYear,
              selectedProgramme.durationYears,
            ),
          }
        : {}),
    });
  }, [
    academicYears.data,
    form,
    form.academicYearId,
    selectedProgramme,
    setForm,
  ]);

  useEffect(() => {
    if (!selectedProgramme || graduationYearTouched.current) return;
    const calculated = expectedGraduationYear(
      form.admissionYear,
      selectedProgramme.durationYears,
    );
    if (calculated && calculated !== form.expectedGraduationYear) {
      setForm({ ...form, expectedGraduationYear: calculated });
    }
  }, [form, form.admissionYear, selectedProgramme, setForm]);

  useEffect(() => {
    if (!fieldError) return;
    const frame = window.requestAnimationFrame(() => {
      setStep(studentRegistrationStepForField(fieldError.field));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fieldError]);

  function advance(event: FormEvent) {
    event.preventDefault();
    setLocalError("");
    const validationError = validateStep(step, form);
    if (validationError) {
      setLocalError(validationError);
      return;
    }
    if (step < 5) {
      setStep((step + 1) as StudentRegistrationStep);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const finalError = validateCreatePersonForm(form);
    if (finalError) {
      setLocalError(finalError);
      const field = createPersonErrorField(finalError);
      if (field) setStep(studentRegistrationStepForField(field));
      return;
    }
    const selectedSection = sections.data?.find(
      (section) => section.id === form.sectionId,
    );
    if (!selectedSection) {
      setLocalError(
        "Select an active Section that belongs to the chosen academic placement.",
      );
      setStep(3);
      return;
    }
    if (selectedSection.isFull || selectedSection.availableSeats <= 0) {
      setLocalError(
        `Section ${selectedSection.code || selectedSection.name} is full. Current capacity: ${selectedSection.currentStudentCount} / ${selectedSection.capacity}. Please select another Section.`,
      );
      setStep(3);
      return;
    }
    onCreate();
  }

  function updateAdmissionYear(admissionYear: string) {
    admissionYearTouched.current = true;
    setForm({
      ...form,
      admissionYear,
      ...(!graduationYearTouched.current
        ? {
            expectedGraduationYear: expectedGraduationYear(
              admissionYear,
              selectedProgramme?.durationYears,
            ),
          }
        : {}),
    });
  }

  const displayedError = localError || error;

  return (
    <section className="student-registration" aria-labelledby="student-registration-title">
      <div className="student-registration-heading">
        <div>
          <span className="eyebrow">Student account</span>
          <h2 id="student-registration-title">Student Registration</h2>
          <p>Complete the academic placement in five short steps.</p>
        </div>
        <button
          className="avs-btn avs-btn-secondary"
          type="button"
          onClick={onSwitchToOther}
        >
          Create staff or other account
        </button>
      </div>

      <ol className="student-registration-progress" aria-label="Registration progress">
        {STUDENT_REGISTRATION_STEPS.map((label, index) => {
          const number = (index + 1) as StudentRegistrationStep;
          return (
            <li key={label} className={number === step ? "current" : number < step ? "complete" : ""}>
              <button
                type="button"
                disabled={number > step}
                aria-current={number === step ? "step" : undefined}
                onClick={() => number < step && setStep(number)}
              >
                <span>{number < step ? <Check size={14} /> : number}</span>
                <strong>{label}</strong>
              </button>
            </li>
          );
        })}
      </ol>

      <form className="avs-card student-registration-card" onSubmit={advance}>
        <div className="student-registration-step-caption">
          Step {step} of {STUDENT_REGISTRATION_STEPS.length}
        </div>
        {displayedError && (
          <div className="error-box" role="alert">
            {displayedError}
          </div>
        )}

        {step === 1 && (
          <WizardSection title="Personal Information" description="Use official college identity details for this student.">
            <div className="student-registration-grid">
              <Field label="Full Name" value={form.fullName} autoComplete="name" error={fieldMessage(fieldError, "fullName")} onChange={(fullName) => setForm({ ...form, fullName })} />
              <Field label="Official College Email" value={form.email} type="email" autoComplete="email" error={fieldMessage(fieldError, "email")} onChange={(email) => setForm({ ...form, email })} />
              <Field label="College ID" value={form.collegeIdentityId} maxLength={60} error={fieldMessage(fieldError, "collegeIdentityId")} onChange={(collegeIdentityId) => setForm({ ...form, collegeIdentityId })} />
              <Field label="Register Number" value={form.registerNumber} maxLength={60} error={fieldMessage(fieldError, "registerNumber")} onChange={(registerNumber) => setForm({ ...form, registerNumber })} />
              <Field label="Date of Birth" value={form.dateOfBirth} type="date" optional max={new Date().toISOString().slice(0, 10)} error={fieldMessage(fieldError, "dateOfBirth")} onChange={(dateOfBirth) => setForm({ ...form, dateOfBirth })} />
              <SelectField label="Gender" value={form.gender} optional options={[{ id: "FEMALE", name: "Female" }, { id: "MALE", name: "Male" }, { id: "NON_BINARY", name: "Non-binary" }, { id: "PREFER_NOT_TO_SAY", name: "Prefer not to say" }]} onChange={(gender) => setForm({ ...form, gender })} />
              <Field label="Mobile Number" value={form.mobile} type="tel" optional autoComplete="tel" onChange={(mobile) => setForm({ ...form, mobile })} />
              <Field label="Personal Email" value={form.personalEmail} type="email" optional autoComplete="email" error={fieldMessage(fieldError, "personalEmail")} onChange={(personalEmail) => setForm({ ...form, personalEmail })} />
            </div>
          </WizardSection>
        )}

        {step === 2 && (
          <WizardSection title="Degree & Programme" description="Options come from the College Programme Master; degree and programme are stored separately.">
            <div className="student-registration-grid">
              <SelectField label="Degree Type" value={form.degreeTypeId} options={(degreeTypes.data ?? []).map((option) => ({ id: option.id, name: option.name, code: option.code }))} loading={degreeTypes.isLoading} error={fieldMessage(fieldError, "degreeTypeId")} onChange={(degreeTypeId) => { graduationYearTouched.current = false; setForm(studentFormAfterDegreeChange(form, degreeTypeId)); }} />
              <SelectField label="Department" value={form.departmentId} options={departments.data ?? []} disabled={!form.degreeTypeId} loading={departments.isLoading} error={fieldMessage(fieldError, "departmentId")} emptyMessage="No department is mapped to this degree type." onChange={(departmentId) => { graduationYearTouched.current = false; setForm(studentFormAfterDepartmentChange(form, departmentId)); }} />
              <SearchableSelectField key={`${form.degreeTypeId}:${form.departmentId}`} label="Programme" value={form.programmeId} options={programmes.data ?? []} disabled={!form.departmentId} loading={programmes.isLoading} error={fieldMessage(fieldError, "programmeId")} emptyMessage="No active programme matches this degree and department." onChange={(programmeId) => { graduationYearTouched.current = false; setForm(studentFormAfterProgrammeChange(form, programmeId)); }} />
            </div>
            <QueryError queries={[degreeTypes, departments, programmes]} />
          </WizardSection>
        )}

        {step === 3 && (
          <WizardSection title="Academic Placement" description="Choose a configured academic period and a section with an available seat.">
            <div className="student-registration-grid">
              <AcademicYearField years={academicYears.data ?? []} value={form.academicYearId} loading={academicYears.isLoading} error={fieldMessage(fieldError, "academicYearId")} onChange={(academicYearId) => setForm(studentFormAfterAcademicYearChange(form, academicYearId))} />
              <SelectField label="Study Year" value={form.studyYear} options={ENGINEERING_STUDY_YEARS.map((year) => ({ id: String(year), name: studyYearLabel(year) }))} error={fieldMessage(fieldError, "studyYear")} onChange={(studyYear) => setForm(studentFormAfterStudyYearChange(form, studyYear))} />
              <SelectField label="Semester" value={form.semesterId} options={visibleSemesters.map((semester) => ({ id: semester.id, name: `Semester ${semester.number}` }))} disabled={!form.academicYearId || !form.studyYear} loading={semesters.isLoading} error={fieldMessage(fieldError, "semesterId")} emptyMessage={form.academicOverride ? "No configured semester is available." : `Configure Semester ${Math.max(1, Number(form.studyYear) * 2 - 1)} or ${Number(form.studyYear) * 2} for this period.`} onChange={(semesterId) => setForm(studentFormAfterSemesterChange(form, semesterId))} />
              <SearchableSelectField key={`${form.programmeId}:${form.academicYearId}:${form.studyYear}:${form.semesterId}:${form.academicOverride}`} label="Section" value={form.sectionId} options={(sections.data ?? []).map((section) => ({ ...section, code: undefined, name: sectionRegistrationLabel(section), disabled: section.isFull || section.availableSeats <= 0 }))} disabled={!form.semesterId} loading={sections.isLoading} error={fieldMessage(fieldError, "sectionId")} emptyMessage="No active section matches this programme and period." onChange={(sectionId) => setForm(studentFormAfterSectionChange(form, sectionId))} />
              <SelectField label="Admission Type" value={form.admissionType} options={[{ id: "REGULAR", name: "Regular" }, { id: "LATERAL_ENTRY", name: "Lateral Entry" }, { id: "TRANSFER", name: "Transfer" }, { id: "READMISSION", name: "Re-admission" }, { id: "OTHER", name: "Other" }]} error={fieldMessage(fieldError, "admissionType")} onChange={(admissionType) => setForm({ ...form, admissionType: admissionType as CreatePersonFormState["admissionType"] })} />
              <Field label="Admission Year" value={form.admissionYear} type="number" min={1990} max={2200} error={fieldMessage(fieldError, "admissionYear")} onChange={updateAdmissionYear} />
              <Field label="Expected Graduation Year" value={form.expectedGraduationYear} type="number" min={1991} max={2210} error={fieldMessage(fieldError, "expectedGraduationYear")} onChange={(expectedGraduationYear) => { graduationYearTouched.current = true; setForm({ ...form, expectedGraduationYear }); }} />
            </div>
            {canOverride && (
              <div className="student-registration-override">
                <label className="check-field">
                  <input type="checkbox" checked={form.academicOverride} onChange={(event) => setForm(studentFormAfterOverrideChange(form, event.target.checked))} />
                  Advanced Academic Override
                </label>
                <small>For lateral entry, rejoining, transfer, migration, or approved curriculum exceptions. Every use is audited.</small>
                {form.academicOverride && <Field label="Override Reason" value={form.academicOverrideReason} minLength={10} maxLength={500} error={fieldMessage(fieldError, "academicOverrideReason")} onChange={(academicOverrideReason) => setForm({ ...form, academicOverrideReason })} />}
              </div>
            )}
            <QueryError queries={[academicYears, semesters, sections]} />
          </WizardSection>
        )}

        {step === 4 && (
          <WizardSection title="Account Information" description="Set the one-time credential and initial account state.">
            <div className="student-registration-grid">
              <label className="field student-registration-password">
                <span>Temporary Password</span>
                <div>
                  <input className="input" type={showPassword ? "text" : "password"} required minLength={12} maxLength={200} autoComplete="new-password" value={form.temporaryPassword} aria-invalid={Boolean(fieldMessage(fieldError, "temporaryPassword")) || undefined} onChange={(event) => setForm({ ...form, temporaryPassword: event.target.value })} />
                  <button className="avs-btn avs-btn-ghost avs-btn-icon" type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                  <button className="avs-btn avs-btn-secondary" type="button" onClick={() => setForm({ ...form, temporaryPassword: generateTemporaryPassword() })}><RefreshCw size={16} /> Generate</button>
                </div>
                <small className={isStrongTemporaryPassword(form.temporaryPassword) ? "valid" : ""}>{fieldMessage(fieldError, "temporaryPassword") ?? "12+ characters with uppercase, lowercase, number, and special character."}</small>
              </label>
              <SelectField label="Account Status" value={form.accountStatus} options={[{ id: "ACTIVE", name: "Active" }, { id: "PENDING", name: "Pending" }]} onChange={(accountStatus) => setForm({ ...form, accountStatus: accountStatus as "ACTIVE" | "PENDING" })} />
            </div>
            <label className="check-field student-registration-first-login"><input type="checkbox" checked={form.mustChangePassword} onChange={(event) => setForm({ ...form, mustChangePassword: event.target.checked })} /> Require password change on first login</label>
          </WizardSection>
        )}

        {step === 5 && (
          <WizardSection title="Student Registration Review" description="Confirm the final placement before the PostgreSQL transaction creates the account.">
            <RegistrationReview form={form} degreeTypes={degreeTypes.data ?? []} departments={departments.data ?? []} programmes={programmes.data ?? []} years={academicYears.data ?? []} semesters={visibleSemesters} sections={sections.data ?? []} />
          </WizardSection>
        )}

        <footer className="student-registration-actions">
          <button className="avs-btn avs-btn-secondary" type="button" disabled={step === 1 || isPending} onClick={() => setStep((step - 1) as StudentRegistrationStep)}><ArrowLeft size={16} /> Back & Edit</button>
          <button className="avs-btn avs-btn-primary" type="submit" disabled={isPending}>
            {step === 5 ? <UserPlus size={17} /> : <ArrowRight size={17} />}
            {isPending ? "Creating student..." : step === 5 ? "Create Student" : "Continue"}
          </button>
        </footer>
      </form>
    </section>
  );
}

function validateStep(step: StudentRegistrationStep, form: CreatePersonFormState) {
  if (step === 1) {
    if (form.fullName.trim().length < 2) return "Enter the student's full name.";
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return "Enter a valid official college email.";
    if (form.collegeIdentityId.trim().length < 2) return "Enter the student's College ID.";
    if (form.registerNumber.trim().length < 2) return "Enter the student's register number.";
    if (form.personalEmail && !/^\S+@\S+\.\S+$/.test(form.personalEmail.trim())) return "Enter a valid personal email or leave it blank.";
  }
  if (step === 2 && (!form.degreeTypeId || !form.departmentId || !form.programmeId)) return "Select the Degree Type, Department, and Programme.";
  if (step === 3) {
    if (!form.academicYearId || !form.studyYear || !form.semesterId || !form.sectionId) return "Select the Academic Year, Study Year, Semester, and Section.";
    if (form.academicOverride && form.academicOverrideReason.trim().length < 10) return "Enter an academic override reason with at least 10 characters.";
  }
  if (step === 4 && !isStrongTemporaryPassword(form.temporaryPassword)) return "Generate or enter a strong temporary password before continuing.";
  return null;
}

function WizardSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="student-registration-panel"><header><h3>{title}</h3><p>{description}</p></header>{children}</section>;
}

interface BasicOption { id: string; name: string; code?: string; disabled?: boolean }

function SelectField({ label, value, options, onChange, optional = false, disabled = false, loading = false, error, emptyMessage }: { label: string; value: string; options: BasicOption[]; onChange: (value: string) => void; optional?: boolean; disabled?: boolean; loading?: boolean; error?: string; emptyMessage?: string }) {
  return <label className="field"><span>{label}{optional ? " (optional)" : " *"}</span><select className="input" required={!optional} disabled={disabled || loading} aria-invalid={Boolean(error) || undefined} value={value} onChange={(event) => onChange(event.target.value)}><option value="">{loading ? "Loading..." : optional ? "Not provided" : "Select..."}</option>{options.map((option) => <option key={option.id} value={option.id} disabled={option.disabled}>{option.code ? `${option.code} - ${option.name}` : option.name}</option>)}</select>{error && <small className="field-error" role="alert">{error}</small>}{!loading && !options.length && emptyMessage && <small className="muted">{emptyMessage}</small>}</label>;
}

function SearchableSelectField(props: Omit<Parameters<typeof SelectField>[0], "options"> & { options: BasicOption[] }) {
  const [search, setSearch] = useState("");
  const visible = props.options.filter((option) => `${option.code ?? ""} ${option.name}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className="student-registration-searchable"><label className="field"><span>Search {props.label}</span><input className="input" type="search" value={search} disabled={props.disabled || props.loading} onChange={(event) => setSearch(event.target.value)} placeholder={`Search by ${props.label.toLocaleLowerCase()} name or code`} /></label><SelectField {...props} options={visible} /></div>;
}

function AcademicYearField({ years, value, onChange, loading, error }: { years: RegistrationAcademicYearOption[]; value: string; onChange: (value: string) => void; loading: boolean; error?: string }) {
  const groups = academicYearGroups(years);
  return <label className="field"><span>Academic Year *</span><select className="input" required disabled={loading} value={value} aria-invalid={Boolean(error) || undefined} onChange={(event) => onChange(event.target.value)}><option value="">{loading ? "Loading..." : "Select..."}</option><YearGroup label="Previous Academic Years" years={groups.previous} /><YearGroup label="Current Academic Year" years={groups.current} /><YearGroup label="Future Configured Academic Years" years={groups.future} /></select>{error && <small className="field-error" role="alert">{error}</small>}</label>;
}

function YearGroup({ label, years }: { label: string; years: RegistrationAcademicYearOption[] }) {
  return years.length ? <optgroup label={label}>{years.map((year) => <option key={year.id} value={year.id}>{year.name}{year.isCurrent ? " (Current)" : ""}</option>)}</optgroup> : null;
}

function Field({ label, value, onChange, optional = false, error, ...props }: { label: string; value: string; onChange: (value: string) => void; optional?: boolean; error?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return <label className="field"><span>{label}{optional ? " (optional)" : " *"}</span><input {...props} className="input" required={!optional} value={value} aria-invalid={Boolean(error) || undefined} onChange={(event) => onChange(event.target.value)} />{error && <small className="field-error" role="alert">{error}</small>}</label>;
}

function QueryError({ queries }: { queries: Array<{ isError: boolean }> }) {
  return queries.some((query) => query.isError) ? <div className="error-box" role="alert">Academic options could not be loaded. Refresh the page and try again.</div> : null;
}

function fieldMessage(error: StudentRegistrationWizardProps["fieldError"], field: CreatePersonField) { return error?.field === field ? error.message : undefined; }

function RegistrationReview({ form, degreeTypes, departments, programmes, years, semesters, sections }: { form: CreatePersonFormState; degreeTypes: DegreeTypeOption[]; departments: RegistrationDepartmentOption[]; programmes: RegistrationProgrammeOption[]; years: RegistrationAcademicYearOption[]; semesters: RegistrationSemesterOption[]; sections: RegistrationSectionOption[] }) {
  const rows = [
    ["Name", form.fullName],
    ["Register Number", form.registerNumber],
    ["Degree", degreeTypes.find((item) => item.id === form.degreeTypeId)?.name],
    ["Department", departments.find((item) => item.id === form.departmentId)?.name],
    ["Programme", programmes.find((item) => item.id === form.programmeId)?.name],
    ["Academic Year", years.find((item) => item.id === form.academicYearId)?.name],
    ["Study Year", studyYearLabel(Number(form.studyYear))],
    ["Semester", semesters.find((item) => item.id === form.semesterId)?.number ? `Semester ${semesters.find((item) => item.id === form.semesterId)?.number}` : undefined],
    ["Section", sections.find((item) => item.id === form.sectionId)?.code],
    ["Admission Type", form.admissionType.replaceAll("_", " ")],
    ["Admission / Graduation", `${form.admissionYear} / ${form.expectedGraduationYear}`],
    ["Account Status", form.accountStatus],
  ];
  return <dl className="student-registration-review">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "Not selected"}</dd></div>)}</dl>;
}
