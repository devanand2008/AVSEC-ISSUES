"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, LockKeyhole, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { getPostAuthenticationRoute } from "@/features/auth/post-login-routing";
import {
  buildProfilePayload,
  profileCompletion,
  studentAcademicFormValues,
  type ProfileLockedValues,
} from "@/features/profile/profile-completion";
import { api, ApiError } from "@/lib/api";
import type { User } from "@/lib/types";
import { useAuth } from "@/providers/auth-provider";

interface Option {
  id: string;
  code?: string;
  name: string;
  number?: number;
  programmeId?: string;
  academicYearId?: string;
  semesterId?: string;
  startsOn?: string;
  isCurrent?: boolean;
}

interface Requirements {
  role: string;
  profileKind: "STUDENT" | "STAFF";
  requiredFields: string[];
  lockedFields: string[];
  optionalFields?: string[];
  lockedValues: ProfileLockedValues;
}

interface ProfileSnapshot {
  fullName: string;
  mobile: string | null;
  whatsappNumber?: string | null;
  profilePhotoKey?: string | null;
  studentProfile?: {
    studentId: string;
    registerNumber: string | null;
    departmentId: string;
    programmeId: string;
    sectionId: string;
    section?: {
      id: string;
      semester?: {
        id: string;
        academicYearId: string;
      } | null;
    } | null;
    studyYear: number | null;
    dateOfBirth: string | null;
    gender: string | null;
    parentMobileNumber: string | null;
    emergencyContact: string | null;
  } | null;
  staffProfile?: {
    employeeId: string;
    designation: string | null;
    qualification: string | null;
    specialization: string | null;
    joinedOn: string | null;
    shift: string | null;
    emergencyContact: string | null;
  } | null;
}

function dateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

export default function ProfileSetupPage() {
  const router = useRouter();
  const client = useQueryClient();
  const { user, refetch } = useAuth();
  const requirements = useQuery({
    queryKey: ["profile-requirements"],
    queryFn: () => api.get<Requirements>("/users/me/profile-requirements"),
  });
  const existingProfile = useQuery({
    queryKey: ["profile", "me", "setup"],
    queryFn: () => api.get<ProfileSnapshot>("/profile/me"),
  });
  const departments = useQuery({
    queryKey: ["academic", "departments"],
    queryFn: () => api.get<Option[]>("/academic/departments"),
    enabled:
      requirements.isSuccess && !requirements.data.lockedValues.department,
  });
  const [form, setForm] = useState<Record<string, string>>({
    fullName: user?.fullName ?? "",
    mobileNumber: "",
    departmentId: "",
    collegeId: "",
    registerNumber: "",
    programmeId: "",
    academicYearId: "",
    studyYear: "",
    semesterId: "",
    sectionId: "",
    dateOfBirth: "",
    gender: "",
    employeeId: "",
    designation: "",
    qualification: "",
    specialization: "",
    dateOfJoining: "",
    shift: "",
    emergencyContact: "",
    parentMobileNumber: "",
  });
  const initialized = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lockedValues = requirements.data?.lockedValues;
  const profileForm = lockedValues
    ? buildProfilePayload(
        {
          ...form,
          fullName: form.fullName || lockedValues.fullName || "",
        },
        requirements.data?.lockedFields ?? [],
        lockedValues,
      )
    : form;

  useEffect(() => {
    if (!requirements.data || !existingProfile.data || initialized.current)
      return;
    const account = existingProfile.data;
    const student = account.studentProfile;
    const staff = account.staffProfile;
    const locked = requirements.data.lockedValues;
    const academic = studentAcademicFormValues(student, locked);
    initialized.current = true;
    setForm((current) => ({
      ...current,
      fullName: account.fullName || locked.fullName,
      mobileNumber: account.mobile ?? "",
      collegeId: locked.collegeIdentityId ?? student?.studentId ?? "",
      registerNumber: locked.registerNumber ?? student?.registerNumber ?? "",
      departmentId: locked.department?.id ?? student?.departmentId ?? "",
      programmeId: academic.programmeId,
      academicYearId: academic.academicYearId,
      studyYear: String(locked.studyYear ?? student?.studyYear ?? ""),
      semesterId: academic.semesterId,
      sectionId: academic.sectionId,
      dateOfBirth: dateInput(student?.dateOfBirth),
      gender: student?.gender ?? "",
      parentMobileNumber: student?.parentMobileNumber ?? "",
      emergencyContact:
        student?.emergencyContact ?? staff?.emergencyContact ?? "",
      employeeId: staff?.employeeId ?? "",
      designation: staff?.designation ?? "",
      qualification: staff?.qualification ?? "",
      specialization: staff?.specialization ?? "",
      dateOfJoining: dateInput(staff?.joinedOn),
      shift: staff?.shift ?? "",
    }));
  }, [existingProfile.data, requirements.data]);

  const departmentId =
    requirements.data?.lockedValues.department?.id ?? form.departmentId;
  const programmes = useQuery({
    queryKey: ["academic", "programmes", departmentId],
    queryFn: () =>
      api.get<Option[]>(`/academic/programmes?departmentId=${departmentId}`),
    enabled:
      Boolean(departmentId) && requirements.data?.profileKind === "STUDENT",
  });
  const years = useQuery({
    queryKey: ["academic", "years"],
    queryFn: () => api.get<Option[]>("/academic/years"),
    enabled: requirements.data?.profileKind === "STUDENT",
  });
  const semesters = useQuery({
    queryKey: [
      "academic",
      "semesters",
      profileForm.programmeId,
      profileForm.academicYearId,
    ],
    queryFn: () =>
      api.get<Option[]>(
        `/academic/semesters?programmeId=${profileForm.programmeId}&academicYearId=${profileForm.academicYearId}`,
      ),
    enabled:
      Boolean(profileForm.programmeId && profileForm.academicYearId) &&
      requirements.data?.profileKind === "STUDENT",
  });
  const sections = useQuery({
    queryKey: ["academic", "sections", profileForm.semesterId],
    queryFn: () =>
      api.get<Option[]>(
        `/academic/sections?semesterId=${profileForm.semesterId}`,
      ),
    enabled:
      Boolean(profileForm.semesterId) &&
      requirements.data?.profileKind === "STUDENT",
  });

  function update(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
    setMessage("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.post<{
        allowedNextRoute?: string;
      }>("/users/me/profile/submit", profileForm);
      setMessage("Your profile has been submitted.");
      await client.invalidateQueries({ queryKey: ["me"] });
      const refreshed = (await refetch()) as { data?: User };
      router.replace(
        result.allowedNextRoute ??
          (refreshed.data ? getPostAuthenticationRoute(refreshed.data) : "/"),
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Profile submission failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    setBusy(true);
    setError("");
    try {
      await api.patch("/users/me/profile", profileForm);
      setMessage("Draft saved.");
      await client.invalidateQueries({ queryKey: ["me"] });
      void refetch();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Draft could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function checkVerification() {
    setBusy(true);
    setError("");
    try {
      const refreshed = (await refetch()) as { data?: User };
      if (refreshed.data) {
        router.replace(getPostAuthenticationRoute(refreshed.data));
      }
    } catch {
      setError("Verification status could not be refreshed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (
    requirements.isLoading ||
    existingProfile.isLoading ||
    (departments.isLoading && departments.fetchStatus !== "idle")
  )
    return <LoadingState />;
  if (requirements.isError || !requirements.data)
    return (
      <ErrorState message="Profile requirements could not be loaded. Refresh the page or contact the administrator if this continues." />
    );
  if (existingProfile.isError)
    return (
      <ErrorState message="Your saved profile could not be loaded. Refresh before entering information so existing data is not overwritten." />
    );
  if (departments.isError)
    return (
      <ErrorState message="Departments could not be loaded. Try again before completing your profile." />
    );

  if (user?.profileCompletionStatus === "SUBMITTED") {
    return (
      <div
        className="card"
        style={{
          maxWidth: 640,
          margin: "48px auto",
          padding: 32,
          textAlign: "center",
        }}
      >
        <CheckCircle2
          size={52}
          style={{ margin: "0 auto 16px", color: "var(--success)" }}
        />
        <h1 className="page-title">Profile awaiting verification</h1>
        <p className="page-subtitle" style={{ margin: "12px auto 20px" }}>
          Your information is saved. An authorised Admin will review your
          academic or professional details.
        </p>
        <div className="button-row" style={{ justifyContent: "center" }}>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => router.replace("/")}
          >
            Return to portal
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            type="button"
            onClick={() => void checkVerification()}
          >
            {busy ? "Checking..." : "Check verification status"}
          </button>
        </div>
      </div>
    );
  }

  const lockedDepartment = requirements.data.lockedValues.department;
  const isStudent = requirements.data.profileKind === "STUDENT";
  const isRejected = user?.profileCompletionStatus === "REJECTED";
  const requiredFields = new Set(requirements.data.requiredFields);
  const collegeIdentityLocked =
    requirements.data.lockedValues.collegeIdentityId != null ||
    requirements.data.lockedFields.some((field) =>
      ["collegeId", "collegeIdentityId"].includes(field),
    );
  const registerNumberLocked =
    isStudent ||
    requirements.data.lockedValues.registerNumber != null ||
    requirements.data.lockedFields.includes("registerNumber");
  const studyYearLocked =
    requirements.data.lockedValues.studyYear != null ||
    requirements.data.lockedFields.includes("studyYear");
  const programmeLocked =
    requirements.data.lockedValues.programmeId != null ||
    requirements.data.lockedFields.includes("programmeId");
  const academicYearLocked =
    requirements.data.lockedValues.academicYearId != null ||
    requirements.data.lockedFields.includes("academicYearId");
  const semesterLocked =
    requirements.data.lockedValues.semesterId != null ||
    requirements.data.lockedFields.includes("semesterId");
  const sectionLocked =
    requirements.data.lockedValues.sectionId != null ||
    requirements.data.lockedFields.includes("sectionId");
  const completion = profileCompletion(
    requirements.data.requiredFields,
    profileForm,
    requirements.data.lockedValues,
    Boolean(existingProfile.data?.profilePhotoKey),
  );
  const academicOptionsError = [programmes, years, semesters, sections].some(
    (query) => query.isError,
  );
  const missingRequiredLockedValue =
    (collegeIdentityLocked &&
      requiredFields.has("collegeId") &&
      !profileForm.collegeId) ||
    (registerNumberLocked &&
      requiredFields.has("registerNumber") &&
      !profileForm.registerNumber) ||
    (studyYearLocked &&
      requiredFields.has("studyYear") &&
      !profileForm.studyYear) ||
    (programmeLocked &&
      requiredFields.has("programmeId") &&
      !profileForm.programmeId) ||
    (academicYearLocked &&
      requiredFields.has("academicYearId") &&
      !profileForm.academicYearId) ||
    (semesterLocked &&
      requiredFields.has("semesterId") &&
      !profileForm.semesterId) ||
    (sectionLocked &&
      requiredFields.has("sectionId") &&
      !profileForm.sectionId) ||
    (Boolean(lockedDepartment) &&
      requiredFields.has("departmentId") &&
      !profileForm.departmentId);

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">First login</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            Complete your profile
          </h1>
          <p className="page-subtitle">
            Locked account fields come from the admin import and cannot be
            changed here.
          </p>
        </div>
      </div>
      {error && (
        <div className="error-box" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}
      {isRejected && (
        <div className="error-box" style={{ marginBottom: 16 }}>
          Your profile requires correction.{" "}
          {user?.profileRejectionReason ??
            "Review the highlighted information and submit it again."}
        </div>
      )}
      {missingRequiredLockedValue && (
        <div className="error-box" role="alert" style={{ marginBottom: 16 }}>
          A required Admin-controlled identity or academic value is missing.
          Contact an administrator; this value cannot be entered or changed from
          Profile Setup.
        </div>
      )}
      {academicOptionsError && (
        <div className="error-box" role="alert" style={{ marginBottom: 16 }}>
          One or more academic option lists could not be loaded. Refresh the
          page before submitting so your placement is not incomplete.
        </div>
      )}
      {message && (
        <div className="card" style={{ padding: 12, marginBottom: 16 }}>
          {message}
        </div>
      )}

      <form className="card" style={{ padding: 20 }} onSubmit={submit}>
        <section
          aria-labelledby="profile-progress-heading"
          style={{ marginBottom: 24 }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 16,
              marginBottom: 8,
            }}
          >
            <strong id="profile-progress-heading">Profile completion</strong>
            <strong>{completion.percentage}%</strong>
          </div>
          <div
            aria-label={`Profile completion: ${completion.percentage}%`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={completion.percentage}
            role="progressbar"
            style={{
              background: "var(--border)",
              borderRadius: 999,
              height: 9,
              overflow: "hidden",
            }}
          >
            <span
              style={{
                background: "var(--success)",
                display: "block",
                height: "100%",
                transition: "width 160ms ease",
                width: `${completion.percentage}%`,
              }}
            />
          </div>
          <div
            style={{
              display: "grid",
              gap: 8,
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              marginTop: 14,
            }}
          >
            {completion.checklist.map((item) => (
              <div
                key={item.key}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                {item.complete ? (
                  <CheckCircle2 size={17} color="var(--success)" />
                ) : (
                  <Circle size={17} color="var(--muted)" />
                )}
                <span>
                  {item.key === "academic" && !isStudent
                    ? "Professional information"
                    : item.label}
                </span>
                <small className="muted">
                  {item.required
                    ? item.complete
                      ? "Complete"
                      : "Incomplete"
                    : item.complete
                      ? "Added"
                      : "Optional"}
                </small>
              </div>
            ))}
          </div>
        </section>

        <div className="form-grid">
          <label className="field">
            <span>Full Name</span>
            <input
              className="input"
              value={profileForm.fullName}
              onChange={(event) => update("fullName", event.target.value)}
              required={requiredFields.has("fullName")}
            />
          </label>
          <label className="field">
            <span>
              College Email <LockKeyhole size={13} />
            </span>
            <input
              className="input"
              value={requirements.data.lockedValues.email ?? ""}
              disabled
            />
          </label>
          {lockedDepartment ? (
            <label className="field">
              <span>
                Department <LockKeyhole size={13} />
              </span>
              <input
                className="input"
                value={`${lockedDepartment.code} - ${lockedDepartment.name}`}
                disabled
              />
            </label>
          ) : (
            <label className="field">
              <span>Department</span>
              <select
                className="input"
                value={form.departmentId}
                onChange={(event) => {
                  update("departmentId", event.target.value);
                  update("programmeId", "");
                  update("semesterId", "");
                  update("sectionId", "");
                }}
                required={isStudent}
              >
                <option value="">Select department</option>
                {departments.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code ?? item.name} - {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Mobile Number</span>
            <input
              className="input"
              inputMode="tel"
              value={form.mobileNumber}
              onChange={(event) => update("mobileNumber", event.target.value)}
              required={requiredFields.has("mobileNumber")}
            />
          </label>

          {isStudent ? (
            <>
              <label className="field">
                <span>
                  User / College ID{" "}
                  {collegeIdentityLocked && <LockKeyhole size={13} />}
                </span>
                <input
                  className="input"
                  value={profileForm.collegeId}
                  disabled={collegeIdentityLocked}
                  onChange={(event) => update("collegeId", event.target.value)}
                  required={requiredFields.has("collegeId")}
                />
              </label>
              <label className="field">
                <span>
                  Register Number{" "}
                  {registerNumberLocked && <LockKeyhole size={13} />}
                </span>
                <input
                  className="input"
                  value={profileForm.registerNumber}
                  disabled={registerNumberLocked}
                  placeholder="Not assigned"
                  onChange={(event) =>
                    update("registerNumber", event.target.value)
                  }
                  required={requiredFields.has("registerNumber")}
                />
              </label>
              <label className="field">
                <span>
                  Programme {programmeLocked && <LockKeyhole size={13} />}
                </span>
                <select
                  className="input"
                  value={profileForm.programmeId}
                  disabled={programmeLocked}
                  onChange={(event) => {
                    update("programmeId", event.target.value);
                    update("semesterId", "");
                    update("sectionId", "");
                  }}
                  required={requiredFields.has("programmeId")}
                >
                  <option value="">Select programme</option>
                  {programmes.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code ?? item.name} - {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>
                  Academic Year{" "}
                  {academicYearLocked && <LockKeyhole size={13} />}
                </span>
                <select
                  className="input"
                  value={profileForm.academicYearId}
                  disabled={academicYearLocked}
                  onChange={(event) => {
                    update("academicYearId", event.target.value);
                    update("semesterId", "");
                    update("sectionId", "");
                  }}
                  required={requiredFields.has("academicYearId")}
                >
                  <option value="">Select academic year</option>
                  {years.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.isCurrent ? " (current)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>
                  Study Year {studyYearLocked && <LockKeyhole size={13} />}
                </span>
                <select
                  className="input"
                  value={profileForm.studyYear}
                  disabled={studyYearLocked}
                  onChange={(event) => update("studyYear", event.target.value)}
                  required={requiredFields.has("studyYear")}
                >
                  <option value="">Select year</option>
                  <option value="1">First year</option>
                  <option value="2">Second year</option>
                  <option value="3">Third year</option>
                  <option value="4">Fourth year</option>
                </select>
              </label>
              <label className="field">
                <span>
                  Semester {semesterLocked && <LockKeyhole size={13} />}
                </span>
                <select
                  className="input"
                  value={profileForm.semesterId}
                  disabled={semesterLocked}
                  onChange={(event) => {
                    update("semesterId", event.target.value);
                    update("sectionId", "");
                  }}
                  required={requiredFields.has("semesterId")}
                >
                  <option value="">Select semester</option>
                  {semesters.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>
                  Section {sectionLocked && <LockKeyhole size={13} />}
                </span>
                <select
                  className="input"
                  value={profileForm.sectionId}
                  disabled={sectionLocked}
                  onChange={(event) => update("sectionId", event.target.value)}
                  required={requiredFields.has("sectionId")}
                >
                  <option value="">Select section</option>
                  {sections.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code ?? item.name} - {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Date of Birth</span>
                <input
                  className="input"
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(event) =>
                    update("dateOfBirth", event.target.value)
                  }
                  required={requiredFields.has("dateOfBirth")}
                />
              </label>
              <label className="field">
                <span>Gender</span>
                <select
                  className="input"
                  value={form.gender}
                  onChange={(event) => update("gender", event.target.value)}
                  required={requiredFields.has("gender")}
                >
                  <option value="">Select gender</option>
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                  <option value="OTHER">Other</option>
                  <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                </select>
              </label>
              <label className="field">
                <span>Parent Mobile Number</span>
                <input
                  className="input"
                  value={form.parentMobileNumber ?? ""}
                  onChange={(event) =>
                    update("parentMobileNumber", event.target.value)
                  }
                />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>Employee ID</span>
                <input
                  className="input"
                  value={form.employeeId}
                  onChange={(event) => update("employeeId", event.target.value)}
                  required={requiredFields.has("employeeId")}
                />
              </label>
              <label className="field">
                <span>Designation</span>
                <input
                  className="input"
                  value={form.designation}
                  onChange={(event) =>
                    update("designation", event.target.value)
                  }
                  required={requiredFields.has("designation")}
                />
              </label>
              <label className="field">
                <span>Qualification</span>
                <input
                  className="input"
                  value={form.qualification}
                  onChange={(event) =>
                    update("qualification", event.target.value)
                  }
                  required={requiredFields.has("qualification")}
                />
              </label>
              <label className="field">
                <span>Specialization</span>
                <input
                  className="input"
                  value={form.specialization}
                  onChange={(event) =>
                    update("specialization", event.target.value)
                  }
                  required={requiredFields.has("specialization")}
                />
              </label>
              <label className="field">
                <span>Date of Joining</span>
                <input
                  className="input"
                  type="date"
                  value={form.dateOfJoining}
                  onChange={(event) =>
                    update("dateOfJoining", event.target.value)
                  }
                  required={requiredFields.has("dateOfJoining")}
                />
              </label>
              <label className="field">
                <span>Shift</span>
                <input
                  className="input"
                  value={form.shift}
                  onChange={(event) => update("shift", event.target.value)}
                  required={requiredFields.has("shift")}
                />
              </label>
              <label className="field">
                <span>Emergency Contact</span>
                <input
                  className="input"
                  value={form.emergencyContact}
                  onChange={(event) =>
                    update("emergencyContact", event.target.value)
                  }
                  required={requiredFields.has("emergencyContact")}
                />
              </label>
            </>
          )}
        </div>
        <div className="button-row" style={{ marginTop: 18 }}>
          <button
            className="btn btn-secondary"
            disabled={busy}
            type="button"
            onClick={() => void saveDraft()}
          >
            <Save size={17} />
            Save draft
          </button>
          <button
            className="btn btn-primary"
            disabled={
              busy || missingRequiredLockedValue || academicOptionsError
            }
            type="submit"
          >
            {busy ? <CheckCircle2 size={17} /> : <Save size={17} />}
            {busy ? "Submitting..." : "Submit profile"}
          </button>
        </div>
      </form>
    </>
  );
}
