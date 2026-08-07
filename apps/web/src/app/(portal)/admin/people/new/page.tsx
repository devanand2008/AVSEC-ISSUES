"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  SCOPE_TYPES,
  buildCreatePersonPayload,
  createBlankPersonForm,
  createPersonErrorField,
  generateTemporaryPassword,
  isStrongTemporaryPassword,
  scopeRequiresTarget,
  validateCreatePersonForm,
  type CreatePersonFormState,
  type CreatePersonField,
  type ProfileType,
  type ScopeRow,
  type ScopeType,
} from "@/features/people/create-person";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

interface Role {
  code: string;
  name: string;
  description: string | null;
}

interface Option {
  id: string;
  code?: string;
  name: string;
  departmentId?: string;
  programmeId?: string;
  academicYearId?: string;
  semesterId?: string;
}

interface ScopeOptions {
  college: Option[];
  campuses: Option[];
  departments: Option[];
  programmes: Option[];
  academicYears: Option[];
  semesters: Option[];
  sections: Option[];
  blocks: Option[];
  floors: Option[];
  rooms: Option[];
  issueCategories: Option[];
}

interface CreatedPerson {
  id: string;
  collegeIdentityId: string;
  fullName: string;
  status: string;
  mustChangePassword: boolean;
}

interface CreationResult extends CreatedPerson {
  temporaryPassword: string;
}

const SCOPE_LABELS: Record<ScopeType, string> = {
  COLLEGE: "Entire college",
  CAMPUS: "Campus",
  DEPARTMENT: "Department",
  PROGRAMME: "Programme",
  ACADEMIC_YEAR: "Academic year",
  SEMESTER: "Semester",
  SECTION: "Section",
  BLOCK: "Block",
  FLOOR: "Floor",
  ROOM: "Room",
  ISSUE_CATEGORY: "Issue category",
  ASSIGNED_ISSUES: "Only assigned issues",
};

const SCOPE_OPTION_KEYS: Partial<Record<ScopeType, keyof ScopeOptions>> = {
  COLLEGE: "college",
  CAMPUS: "campuses",
  DEPARTMENT: "departments",
  PROGRAMME: "programmes",
  ACADEMIC_YEAR: "academicYears",
  SEMESTER: "semesters",
  SECTION: "sections",
  BLOCK: "blocks",
  FLOOR: "floors",
  ROOM: "rooms",
  ISSUE_CATEGORY: "issueCategories",
};

export default function CreatePersonPage() {
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreatePersonFormState>(() =>
    createBlankPersonForm(),
  );
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<{
    field: CreatePersonField;
    message: string;
  } | null>(null);
  const [created, setCreated] = useState<CreationResult | null>(null);
  const canCreate = user?.permissions.includes("users.create") ?? false;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setForm((current) =>
        current.temporaryPassword
          ? current
          : { ...current, temporaryPassword: generateTemporaryPassword() },
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const roles = useQuery({
    queryKey: ["roles", "person-creation"],
    queryFn: () => api.get<Role[]>("/roles"),
    enabled: canCreate,
  });
  const options = useQuery({
    queryKey: ["scope-options", "person-creation"],
    queryFn: () => api.get<ScopeOptions>("/users/scope-options"),
    enabled: canCreate,
  });

  const programmes = useMemo(
    () =>
      options.data?.programmes.filter(
        (item) => !form.departmentId || item.departmentId === form.departmentId,
      ) ?? [],
    [form.departmentId, options.data?.programmes],
  );
  const programmeSemesterIds = useMemo(
    () =>
      new Set(
        options.data?.semesters
          .filter(
            (item) =>
              !form.programmeId || item.programmeId === form.programmeId,
          )
          .map((item) => item.id) ?? [],
      ),
    [form.programmeId, options.data?.semesters],
  );
  const sections = useMemo(
    () =>
      options.data?.sections.filter((item) =>
        programmeSemesterIds.has(item.semesterId ?? ""),
      ) ?? [],
    [options.data?.sections, programmeSemesterIds],
  );

  const create = useMutation({
    mutationFn: () =>
      api.post<CreatedPerson>("/users", buildCreatePersonPayload(form)),
    onSuccess: (person) => {
      setCreated({ ...person, temporaryPassword: form.temporaryPassword });
      setError("");
      setFieldError(null);
      void queryClient.invalidateQueries({ queryKey: ["people"] });
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (caught) => {
      const message =
        caught instanceof ApiError
          ? caught.message
          : "The account could not be created. Please try again.";
      setError(
        caught instanceof ApiError && caught.requestId
          ? `${message} Reference: ${caught.requestId}.`
          : message,
      );
      const field = createPersonErrorField(message);
      setFieldError(field ? { field, message } : null);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setFieldError(null);
    const validationError = validateCreatePersonForm(form);
    if (validationError) {
      setError(validationError);
      const field = createPersonErrorField(validationError);
      setFieldError(field ? { field, message: validationError } : null);
      return;
    }
    create.mutate();
  }

  function updateScope(index: number, value: Partial<ScopeRow>) {
    setForm((current) => ({
      ...current,
      scopes: current.scopes.map((scope, scopeIndex) =>
        scopeIndex === index ? { ...scope, ...value } : scope,
      ),
    }));
  }

  function choicesForScope(type: ScopeType): Option[] {
    const key = SCOPE_OPTION_KEYS[type];
    return key && options.data ? options.data[key] : [];
  }

  function resetForAnother() {
    const blank = createBlankPersonForm();
    setForm({ ...blank, temporaryPassword: generateTemporaryPassword() });
    setCreated(null);
    setError("");
    setFieldError(null);
    setShowPassword(false);
  }

  return (
    <div className="page-container main-with-bottom-nav">
      <div style={{ marginBottom: "var(--space-3)" }}>
        <Link
          href="/admin/people"
          className="avs-btn avs-btn-ghost avs-btn-sm"
          style={{ display: "inline-flex", gap: 6 }}
        >
          <ArrowLeft size={16} /> Back to People
        </Link>
      </div>
      <PageHeader
        title="Add Person"
        description="Create a secure account, assign roles, and limit access to the correct college scope."
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "People", href: "/admin/people" },
          { label: "Add Person" },
        ]}
      />

      {authLoading && <LoadingState rows={5} />}
      {!authLoading && !canCreate && (
        <ErrorState message="You do not have permission to create user accounts." />
      )}
      {canCreate && (roles.isLoading || options.isLoading) && (
        <LoadingState rows={6} />
      )}
      {canCreate && (roles.isError || options.isError) && (
        <ErrorState message="Roles or college scope options could not be loaded. Refresh the page and try again." />
      )}

      {created && (
        <section
          className="card"
          aria-live="polite"
          style={{ padding: 24, maxWidth: 760 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <CheckCircle2 size={28} style={{ color: "var(--success)" }} />
            <div>
              <h2 style={{ margin: 0 }}>Account created</h2>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {created.fullName} can sign in now and must change this
                temporary password after the first login.
              </p>
            </div>
          </div>
          <dl className="details-list" style={{ marginBottom: 20 }}>
            <div>
              <dt>College ID</dt>
              <dd>{created.collegeIdentityId}</dd>
            </div>
            <div>
              <dt>Temporary password</dt>
              <dd>
                <code>{created.temporaryPassword}</code>
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{created.status}</dd>
            </div>
          </dl>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/admin/people" className="avs-btn avs-btn-primary">
              View People
            </Link>
            <button
              type="button"
              className="avs-btn avs-btn-secondary"
              onClick={resetForAnother}
            >
              <Plus size={16} /> Add another person
            </button>
          </div>
        </section>
      )}

      {canCreate && roles.isSuccess && options.isSuccess && !created && (
        <form
          className="card"
          onSubmit={submit}
          style={{ padding: 24, maxWidth: 1000 }}
        >
          {error && (
            <div
              className="error-box"
              role="alert"
              style={{ marginBottom: 20 }}
            >
              {error}
            </div>
          )}

          <FormSection
            title="Account details"
            description="The college ID or email can be used to sign in."
          >
            <div className="form-grid">
              <TextField
                label="College ID"
                value={form.collegeIdentityId}
                minLength={2}
                maxLength={60}
                autoComplete="off"
                error={
                  fieldError?.field === "collegeIdentityId"
                    ? fieldError.message
                    : undefined
                }
                onChange={(collegeIdentityId) =>
                  setForm({ ...form, collegeIdentityId })
                }
              />
              <TextField
                label="Full name"
                value={form.fullName}
                minLength={2}
                maxLength={180}
                autoComplete="name"
                error={
                  fieldError?.field === "fullName"
                    ? fieldError.message
                    : undefined
                }
                onChange={(fullName) => setForm({ ...form, fullName })}
              />
              <TextField
                label="Email"
                value={form.email}
                type="email"
                optional
                maxLength={254}
                autoComplete="email"
                error={
                  fieldError?.field === "email" ? fieldError.message : undefined
                }
                onChange={(email) => setForm({ ...form, email })}
              />
              <TextField
                label="Mobile"
                value={form.mobile}
                type="tel"
                optional
                maxLength={30}
                autoComplete="tel"
                onChange={(mobile) => setForm({ ...form, mobile })}
              />
              <TextField
                label="WhatsApp number"
                value={form.whatsappNumber}
                type="tel"
                optional
                maxLength={30}
                autoComplete="off"
                onChange={(whatsappNumber) =>
                  setForm({ ...form, whatsappNumber })
                }
              />
              <label className="field">
                <span>Account status</span>
                <select
                  className="input"
                  value={form.accountStatus}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      accountStatus: event.target.value as "ACTIVE" | "PENDING",
                    })
                  }
                >
                  <option value="ACTIVE">Active</option>
                  <option value="PENDING">Pending</option>
                </select>
              </label>
            </div>
            <label className="field" style={{ marginTop: 16 }}>
              <span>Temporary password</span>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <input
                  className="input"
                  style={{ flex: "1 1 240px" }}
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={12}
                  maxLength={200}
                  autoComplete="new-password"
                  value={form.temporaryPassword}
                  aria-invalid={
                    fieldError?.field === "temporaryPassword" || undefined
                  }
                  onChange={(event) =>
                    setForm({
                      ...form,
                      temporaryPassword: event.target.value,
                    })
                  }
                />
                <button
                  type="button"
                  className="avs-btn avs-btn-ghost avs-btn-icon"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
                <button
                  type="button"
                  className="avs-btn avs-btn-secondary"
                  onClick={() =>
                    setForm({
                      ...form,
                      temporaryPassword: generateTemporaryPassword(),
                    })
                  }
                >
                  <RefreshCw size={16} /> Regenerate
                </button>
              </div>
              <small
                style={{
                  color: isStrongTemporaryPassword(form.temporaryPassword)
                    ? "var(--success)"
                    : "var(--avs-text-muted)",
                }}
              >
                {fieldError?.field === "temporaryPassword"
                  ? fieldError.message
                  : "Use 12+ characters with uppercase, lowercase, number, and special characters."}
              </small>
            </label>
          </FormSection>

          <FormSection
            title="Roles and access"
            description="Choose what this person can do and where that access applies."
          >
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="avs-label" style={{ marginBottom: 8 }}>
                Roles
              </legend>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                  gap: 8,
                }}
              >
                {roles.data.map((role) => (
                  <label
                    key={role.code}
                    className="avs-card-flat"
                    style={{
                      padding: 10,
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={form.roleCodes.includes(role.code)}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          roleCodes: event.target.checked
                            ? [...form.roleCodes, role.code]
                            : form.roleCodes.filter(
                                (code) => code !== role.code,
                              ),
                        })
                      }
                    />
                    <span>
                      <strong>{role.name}</strong>
                      <small className="muted" style={{ display: "block" }}>
                        {role.code}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              {fieldError?.field === "roleCodes" && (
                <small className="error-box" role="alert">
                  {fieldError.message}
                </small>
              )}
            </fieldset>

            <div style={{ marginTop: 20 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 10,
                }}
              >
                <div>
                  <div className="avs-label">Access scopes</div>
                  <small className="muted">
                    Every account needs at least one server-enforced scope.
                  </small>
                </div>
                <button
                  type="button"
                  className="avs-btn avs-btn-secondary avs-btn-sm"
                  onClick={() =>
                    setForm({
                      ...form,
                      scopes: [
                        ...form.scopes,
                        { type: "DEPARTMENT", targetId: "" },
                      ],
                    })
                  }
                >
                  <Plus size={15} /> Add scope
                </button>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {form.scopes.map((scope, index) => {
                  const choices = choicesForScope(scope.type);
                  return (
                    <div
                      key={`${index}-${scope.type}`}
                      className="avs-card-flat"
                      style={{
                        padding: 12,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      <select
                        className="input"
                        style={{ flex: "1 1 190px" }}
                        aria-label={`Scope ${index + 1} type`}
                        value={scope.type}
                        onChange={(event) =>
                          updateScope(index, {
                            type: event.target.value as ScopeType,
                            targetId: "",
                          })
                        }
                      >
                        {SCOPE_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {SCOPE_LABELS[type]}
                          </option>
                        ))}
                      </select>
                      {scopeRequiresTarget(scope.type) ? (
                        <select
                          className="input"
                          style={{ flex: "1 1 230px" }}
                          aria-label={`Scope ${index + 1} target`}
                          required
                          value={scope.targetId}
                          onChange={(event) =>
                            updateScope(index, {
                              targetId: event.target.value,
                            })
                          }
                        >
                          <option value="">Select target...</option>
                          {choices.map((choice) => (
                            <option key={choice.id} value={choice.id}>
                              {optionLabel(choice)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className="muted"
                          style={{ padding: "0 8px", flex: "1 1 230px" }}
                        >
                          No target is required.
                        </span>
                      )}
                      <button
                        type="button"
                        className="avs-btn avs-btn-ghost avs-btn-icon"
                        aria-label={`Remove scope ${index + 1}`}
                        disabled={form.scopes.length === 1}
                        onClick={() =>
                          setForm({
                            ...form,
                            scopes: form.scopes.filter(
                              (_, scopeIndex) => scopeIndex !== index,
                            ),
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
              {fieldError?.field === "scopes" && (
                <small className="error-box" role="alert">
                  {fieldError.message}
                </small>
              )}
            </div>
          </FormSection>

          <FormSection
            title="Student or staff record"
            description="Attach an academic or employment profile now, or let the person complete onboarding later."
          >
            <label className="field" style={{ maxWidth: 360 }}>
              <span>Profile type</span>
              <select
                className="input"
                value={form.profileType}
                onChange={(event) =>
                  setForm({
                    ...form,
                    profileType: event.target.value as ProfileType,
                    departmentId: "",
                    programmeId: "",
                    sectionId: "",
                  })
                }
              >
                <option value="student">Student</option>
                <option value="staff">Staff</option>
                <option value="none">Complete during onboarding</option>
              </select>
            </label>

            {form.profileType === "student" && (
              <div className="form-grid" style={{ marginTop: 16 }}>
                <OptionField
                  label="Department"
                  value={form.departmentId}
                  options={options.data.departments}
                  error={
                    fieldError?.field === "departmentId"
                      ? fieldError.message
                      : undefined
                  }
                  onChange={(departmentId) =>
                    setForm({
                      ...form,
                      departmentId,
                      programmeId: "",
                      sectionId: "",
                    })
                  }
                />
                <OptionField
                  label="Programme"
                  value={form.programmeId}
                  options={programmes}
                  error={
                    fieldError?.field === "programmeId"
                      ? fieldError.message
                      : undefined
                  }
                  onChange={(programmeId) =>
                    setForm({ ...form, programmeId, sectionId: "" })
                  }
                />
                <OptionField
                  label="Section"
                  value={form.sectionId}
                  options={sections}
                  error={
                    fieldError?.field === "sectionId"
                      ? fieldError.message
                      : undefined
                  }
                  onChange={(sectionId) =>
                    setForm({
                      ...form,
                      sectionId,
                      scopes: form.scopes.map((scope) =>
                        scope.type === "SECTION"
                          ? { ...scope, targetId: sectionId }
                          : scope,
                      ),
                    })
                  }
                />
                <TextField
                  label="Student ID"
                  value={form.studentId}
                  optional
                  placeholder="Defaults to college ID"
                  maxLength={60}
                  error={
                    fieldError?.field === "studentId"
                      ? fieldError.message
                      : undefined
                  }
                  onChange={(studentId) => setForm({ ...form, studentId })}
                />
                <TextField
                  label="Admission year"
                  value={form.admissionYear}
                  type="number"
                  min={1990}
                  max={2200}
                  error={
                    fieldError?.field === "admissionYear"
                      ? fieldError.message
                      : undefined
                  }
                  onChange={(admissionYear) =>
                    setForm({ ...form, admissionYear })
                  }
                />
                <TextField
                  label="Roll number"
                  value={form.rollNumber}
                  optional
                  maxLength={60}
                  error={
                    fieldError?.field === "employeeId"
                      ? fieldError.message
                      : undefined
                  }
                  onChange={(rollNumber) => setForm({ ...form, rollNumber })}
                />
              </div>
            )}

            {form.profileType === "staff" && (
              <div className="form-grid" style={{ marginTop: 16 }}>
                <OptionField
                  label="Department"
                  value={form.departmentId}
                  options={options.data.departments}
                  optional
                  onChange={(departmentId) =>
                    setForm({ ...form, departmentId })
                  }
                />
                <TextField
                  label="Employee ID"
                  value={form.employeeId}
                  optional
                  placeholder="Defaults to college ID"
                  maxLength={60}
                  onChange={(employeeId) => setForm({ ...form, employeeId })}
                />
                <TextField
                  label="Designation"
                  value={form.designation}
                  optional
                  maxLength={120}
                  onChange={(designation) => setForm({ ...form, designation })}
                />
              </div>
            )}

            {form.profileType === "none" && (
              <p className="muted" style={{ margin: "16px 0 0" }}>
                The account will start with an incomplete profile and the user
                can supply the required details during onboarding.
              </p>
            )}
          </FormSection>

          <footer
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <Link href="/admin/people" className="avs-btn avs-btn-secondary">
              Cancel
            </Link>
            <button
              className="avs-btn avs-btn-primary"
              disabled={create.isPending}
            >
              <UserPlus size={17} />
              {create.isPending ? "Creating account..." : "Create account"}
            </button>
          </footer>
        </form>
      )}
    </div>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        paddingBottom: 24,
        marginBottom: 24,
        borderBottom: "1px solid var(--avs-border)",
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: "var(--text-lg)", margin: 0 }}>{title}</h2>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  optional = false,
  type = "text",
  error,
  ...inputProps
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
  type?: string;
  error?: string;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
>) {
  return (
    <label className="field">
      <span>
        {label}
        {optional ? " (optional)" : ""}
      </span>
      <input
        className="input"
        type={type}
        required={!optional}
        aria-invalid={Boolean(error) || undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...inputProps}
      />
      {error && (
        <small className="error-box" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}

function OptionField({
  label,
  value,
  options,
  onChange,
  optional = false,
  error,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  optional?: boolean;
  error?: string;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {optional ? " (optional)" : ""}
      </span>
      <select
        className="input"
        required={!optional}
        aria-invalid={Boolean(error) || undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{optional ? "Not assigned" : "Select..."}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
      {error && (
        <small className="error-box" role="alert">
          {error}
        </small>
      )}
      {!options.length && (
        <small className="muted">
          No active {label.toLowerCase()} options.
        </small>
      )}
    </label>
  );
}

function optionLabel(option: Option): string {
  return option.code ? `${option.code} - ${option.name}` : option.name;
}
