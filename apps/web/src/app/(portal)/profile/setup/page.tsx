"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LockKeyhole, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { api, ApiError } from "@/lib/api";
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
  lockedValues: {
    email: string | null;
    fullName: string;
    studyYear: number | null;
    department: { id: string; code: string; name: string } | null;
    primaryRole: string;
  };
}

export default function ProfileSetupPage() {
  const router = useRouter();
  const client = useQueryClient();
  const { user, refetch } = useAuth();
  const requirements = useQuery({
    queryKey: ["profile-requirements"],
    queryFn: () => api.get<Requirements>("/users/me/profile-requirements"),
  });
  const departments = useQuery({
    queryKey: ["academic", "departments"],
    queryFn: () => api.get<Option[]>("/academic/departments"),
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
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const profileForm = {
    ...form,
    fullName:
      form.fullName || requirements.data?.lockedValues.fullName || "",
    studyYear:
      form.studyYear ||
      String(requirements.data?.lockedValues.studyYear ?? ""),
  };

  const departmentId =
    requirements.data?.lockedValues.department?.id ?? form.departmentId;
  const programmes = useQuery({
    queryKey: ["academic", "programmes", departmentId],
    queryFn: () => api.get<Option[]>(`/academic/programmes?departmentId=${departmentId}`),
    enabled: Boolean(departmentId) && requirements.data?.profileKind === "STUDENT",
  });
  const years = useQuery({
    queryKey: ["academic", "years"],
    queryFn: () => api.get<Option[]>("/academic/years"),
    enabled: requirements.data?.profileKind === "STUDENT",
  });
  const semesters = useQuery({
    queryKey: ["academic", "semesters", form.programmeId, form.academicYearId],
    queryFn: () => api.get<Option[]>(`/academic/semesters?programmeId=${form.programmeId}&academicYearId=${form.academicYearId}`),
    enabled: Boolean(form.programmeId && form.academicYearId) && requirements.data?.profileKind === "STUDENT",
  });
  const sections = useQuery({
    queryKey: ["academic", "sections", form.semesterId],
    queryFn: () => api.get<Option[]>(`/academic/sections?semesterId=${form.semesterId}`),
    enabled: Boolean(form.semesterId) && requirements.data?.profileKind === "STUDENT",
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
      await api.post("/users/me/profile/submit", profileForm);
      setMessage("Your profile has been submitted.");
      await client.invalidateQueries({ queryKey: ["me"] });
      await refetch();
      router.replace("/");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Profile submission failed.");
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
      setError(caught instanceof ApiError ? caught.message : "Draft could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (requirements.isLoading || departments.isLoading) return <LoadingState />;
  if (requirements.isError || !requirements.data) return <ErrorState message="Profile requirements could not be loaded." />;

  if (user?.profileCompletionStatus === "SUBMITTED") {
    return (
      <div className="card" style={{ maxWidth: 640, margin: "48px auto", padding: 32, textAlign: "center" }}>
        <CheckCircle2 size={52} style={{ margin: "0 auto 16px", color: "var(--success)" }} />
        <h1 className="page-title">Profile awaiting verification</h1>
        <p className="page-subtitle" style={{ margin: "12px auto 20px" }}>
          An authorised Admin must verify your academic or professional details before the dashboard opens.
        </p>
        <button className="btn btn-primary" type="button" onClick={() => void refetch()}>
          Check verification status
        </button>
      </div>
    );
  }

  const lockedDepartment = requirements.data.lockedValues.department;
  const isStudent = requirements.data.profileKind === "STUDENT";
  const isRejected = user?.profileCompletionStatus === "REJECTED";

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">First login</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>Complete your profile</h1>
          <p className="page-subtitle">Locked account fields come from the admin import and cannot be changed here.</p>
        </div>
      </div>
      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}
      {isRejected && (
        <div className="error-box" style={{ marginBottom: 16 }}>
          Your profile requires correction. {user?.profileRejectionReason ?? "Review the highlighted information and submit it again."}
        </div>
      )}
      {message && <div className="card" style={{ padding: 12, marginBottom: 16 }}>{message}</div>}

      <form className="card" style={{ padding: 20 }} onSubmit={submit}>
        <div className="wizard-steps" style={{ marginBottom: 18 }}>
          {["Identity", isStudent ? "Academic" : "Professional", "Contact", "Review"].map((step, index) => (
            <span className={index === 0 ? "complete" : ""} key={step}><span>{index + 1}</span>{step}</span>
          ))}
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Full Name</span>
            <input className="input" value={profileForm.fullName} onChange={(event) => update("fullName", event.target.value)} required />
          </label>
          <label className="field">
            <span>College Email <LockKeyhole size={13} /></span>
            <input className="input" value={requirements.data.lockedValues.email ?? ""} disabled />
          </label>
          {lockedDepartment ? (
            <label className="field">
              <span>Department <LockKeyhole size={13} /></span>
              <input className="input" value={`${lockedDepartment.code} - ${lockedDepartment.name}`} disabled />
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
            <input className="input" value={form.mobileNumber} onChange={(event) => update("mobileNumber", event.target.value)} required />
          </label>

          {isStudent ? (
            <>
              <label className="field">
                <span>College ID</span>
                <input className="input" value={form.collegeId} onChange={(event) => update("collegeId", event.target.value)} required />
              </label>
              <label className="field">
                <span>Register Number</span>
                <input className="input" value={form.registerNumber} onChange={(event) => update("registerNumber", event.target.value)} required />
              </label>
              <label className="field">
                <span>Programme</span>
                <select className="input" value={form.programmeId} onChange={(event) => update("programmeId", event.target.value)} required>
                  <option value="">Select programme</option>
                  {programmes.data?.map((item) => <option key={item.id} value={item.id}>{item.code ?? item.name} - {item.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Academic Year</span>
                <select
                  className="input"
                  value={form.academicYearId}
                  onChange={(event) => {
                    update("academicYearId", event.target.value);
                    update("semesterId", "");
                    update("sectionId", "");
                  }}
                  required
                >
                  <option value="">Select academic year</option>
                  {years.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}{item.isCurrent ? " (current)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Study Year</span>
                <select className="input" value={profileForm.studyYear} onChange={(event) => update("studyYear", event.target.value)} required>
                  <option value="">Select year</option>
                  <option value="1">First year</option>
                  <option value="2">Second year</option>
                  <option value="3">Third year</option>
                  <option value="4">Fourth year</option>
                </select>
              </label>
              <label className="field">
                <span>Semester</span>
                <select className="input" value={form.semesterId} onChange={(event) => update("semesterId", event.target.value)} required>
                  <option value="">Select semester</option>
                  {semesters.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Section</span>
                <select className="input" value={form.sectionId} onChange={(event) => update("sectionId", event.target.value)} required>
                  <option value="">Select section</option>
                  {sections.data?.map((item) => <option key={item.id} value={item.id}>{item.code ?? item.name} - {item.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Date of Birth</span>
                <input className="input" type="date" value={form.dateOfBirth} onChange={(event) => update("dateOfBirth", event.target.value)} required />
              </label>
              <label className="field">
                <span>Gender</span>
                <select className="input" value={form.gender} onChange={(event) => update("gender", event.target.value)} required>
                  <option value="">Select gender</option>
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                  <option value="OTHER">Other</option>
                  <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                </select>
              </label>
              <label className="field">
                <span>Parent Mobile Number</span>
                <input className="input" value={form.parentMobileNumber ?? ""} onChange={(event) => update("parentMobileNumber", event.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>Employee ID</span>
                <input className="input" value={form.employeeId} onChange={(event) => update("employeeId", event.target.value)} required />
              </label>
              <label className="field">
                <span>Designation</span>
                <input className="input" value={form.designation} onChange={(event) => update("designation", event.target.value)} required />
              </label>
              <label className="field">
                <span>Qualification</span>
                <input className="input" value={form.qualification} onChange={(event) => update("qualification", event.target.value)} required />
              </label>
              <label className="field">
                <span>Specialization</span>
                <input className="input" value={form.specialization} onChange={(event) => update("specialization", event.target.value)} required />
              </label>
              <label className="field">
                <span>Date of Joining</span>
                <input className="input" type="date" value={form.dateOfJoining} onChange={(event) => update("dateOfJoining", event.target.value)} required />
              </label>
              <label className="field">
                <span>Shift</span>
                <input className="input" value={form.shift} onChange={(event) => update("shift", event.target.value)} />
              </label>
              <label className="field">
                <span>Emergency Contact</span>
                <input className="input" value={form.emergencyContact} onChange={(event) => update("emergencyContact", event.target.value)} />
              </label>
            </>
          )}
        </div>
        <div className="button-row" style={{ marginTop: 18 }}>
          <button className="btn btn-secondary" disabled={busy} type="button" onClick={() => void saveDraft()}>
            <Save size={17} />
            Save draft
          </button>
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? <CheckCircle2 size={17} /> : <Save size={17} />}
            {busy ? "Submitting..." : "Submit profile"}
          </button>
        </div>
      </form>
    </>
  );
}
