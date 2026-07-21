"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Download, Plus, UserPlus, UsersRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { AttendanceMarkingPanel } from "@/components/attendance-marking-panel";
import { canViewAttendanceSessions } from "@/lib/attendance-permissions";
import { api, ApiError } from "@/lib/api";
import type { PageResponse, SelectOption } from "@/lib/types";
import { useAuth } from "@/providers/auth-provider";

interface Session {
  id: string;
  sessionDate: string;
  periodNumber: number;
  status: string;
  subject: { code: string; name: string };
  section: { code: string; name: string };
  faculty: { fullName: string };
  _count: { records: number };
}

interface Summary {
  overall: number;
  subjects: Array<{ subject: { id: string; code: string; name: string }; total: number; attended: number; percentage: number }>;
}

interface AcademicYear extends SelectOption { isCurrent?: boolean }
interface SectionOption extends SelectOption { semesterId: string; capacity: number | null }
interface SubjectOption extends SelectOption { semesterId: string }
interface ClassStudent {
  userId: string;
  publicId: string;
  collegeIdentityId: string;
  studentId: string;
  rollNumber: string | null;
  fullName: string;
  email: string | null;
  mobile: string | null;
  status: string;
}

const defaultStudentPassword = "Student@2026!";

export default function AttendancePage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [activeSessionId, setActiveSessionId] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ academicYearId: "", sectionId: "", subjectId: "", sessionDate: new Date().toISOString().slice(0, 10), periodNumber: 1 });
  const [studentForm, setStudentForm] = useState({ fullName: "", studentId: "", email: "", mobile: "", rollNumber: "", admissionYear: new Date().getFullYear(), temporaryPassword: defaultStudentPassword });
  const permissions = user?.permissions ?? [];
  const canCreate = permissions.includes("attendance.session.create");
  const canOwn = permissions.includes("attendance.read_own") && (user?.roles.includes("STUDENT") ?? false);
  const canViewSessions = canViewAttendanceSessions(permissions);
  const canManageClass = permissions.includes("attendance.read_class");
  const canAddStudents = permissions.includes("users.create");

  const sessions = useQuery({ queryKey: ["attendance-sessions"], queryFn: () => api.get<PageResponse<Session>>("/attendance/sessions?pageSize=50"), enabled: canViewSessions });
  const summary = useQuery({ queryKey: ["attendance-own"], queryFn: () => api.get<Summary>("/attendance/students/me"), enabled: canOwn });
  const years = useQuery({ queryKey: ["academic-years"], queryFn: () => api.get<AcademicYear[]>("/academic/years"), enabled: canCreate });
  const sections = useQuery({ queryKey: ["academic-sections"], queryFn: () => api.get<SectionOption[]>("/academic/sections"), enabled: canCreate || canManageClass });
  const subjects = useQuery({ queryKey: ["academic-subjects"], queryFn: () => api.get<SubjectOption[]>("/academic/subjects"), enabled: canCreate });
  const defaultAcademicYearId = useMemo(() => years.data?.find((item) => item.isCurrent)?.id ?? years.data?.[0]?.id ?? "", [years.data]);
  const selectedSectionValue = selectedSectionId || sections.data?.[0]?.id || "";
  const classStudents = useQuery({
    queryKey: ["attendance-class-students", selectedSectionValue],
    queryFn: () => api.get<ClassStudent[]>(`/attendance/classes/${selectedSectionValue}/students`),
    enabled: canManageClass && Boolean(selectedSectionValue),
  });

  const selectedSection = useMemo(() => sections.data?.find((item) => item.id === selectedSectionValue) ?? null, [sections.data, selectedSectionValue]);
  const createSection = useMemo(() => sections.data?.find((item) => item.id === form.sectionId) ?? null, [sections.data, form.sectionId]);
  const filteredSubjects = useMemo(() => subjects.data?.filter((item) => !createSection || item.semesterId === createSection.semesterId) ?? [], [subjects.data, createSection]);
  const formAcademicYearId = form.academicYearId || defaultAcademicYearId;
  const formSubjectId = filteredSubjects.some((item) => item.id === form.subjectId) ? form.subjectId : "";

  const create = useMutation({
    mutationFn: () => api.post<Session>("/attendance/sessions", { ...form, academicYearId: formAcademicYearId, subjectId: formSubjectId }),
    onSuccess: (session) => {
      setShowCreate(false);
      setActiveSessionId(session.id);
      setError("");
      void client.invalidateQueries({ queryKey: ["attendance-sessions"] });
    },
    onError: handleError,
  });

  const addStudent = useMutation({
    mutationFn: () => api.post(`/attendance/classes/${selectedSectionValue}/students`, {
      fullName: studentForm.fullName.trim(),
      studentId: studentForm.studentId.trim(),
      ...(studentForm.email.trim() ? { email: studentForm.email.trim() } : {}),
      ...(studentForm.mobile.trim() ? { mobile: studentForm.mobile.trim() } : {}),
      ...(studentForm.rollNumber.trim() ? { rollNumber: studentForm.rollNumber.trim() } : {}),
      admissionYear: studentForm.admissionYear,
      temporaryPassword: studentForm.temporaryPassword,
    }),
    onSuccess: () => {
      setShowStudentForm(false);
      setStudentForm({ fullName: "", studentId: "", email: "", mobile: "", rollNumber: "", admissionYear: new Date().getFullYear(), temporaryPassword: defaultStudentPassword });
      setError("");
      void client.invalidateQueries({ queryKey: ["attendance-class-students", selectedSectionValue] });
      void client.invalidateQueries({ queryKey: ["attendance-sessions"] });
    },
    onError: handleError,
  });

  function handleError(caught: unknown) {
    setError(caught instanceof ApiError ? caught.message : "Attendance change could not be saved.");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    create.mutate();
  }

  function submitStudent(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!selectedSectionValue) {
      setError("Select a class before adding a student.");
      return;
    }
    addStudent.mutate();
  }

  function startSessionForSelectedClass() {
    setActiveSessionId("");
    setForm((value) => ({
      ...value,
      academicYearId: value.academicYearId || defaultAcademicYearId,
      sectionId: selectedSectionValue || value.sectionId,
      subjectId: "",
    }));
    setShowCreate(true);
  }

  return <>
    <div className="page-heading">
      <div>
        <span className="eyebrow">Academics</span>
        <h1 className="page-title" style={{ marginTop: 6 }}>Attendance</h1>
        <p className="page-subtitle">Create class sessions, manage class students, and mark attendance.</p>
      </div>
      <div className="button-row">
        {permissions.includes("attendance.export") && <button className="btn" onClick={() => void api.download("/reports/attendance/export.csv", `attendance-${new Date().toISOString().slice(0, 10)}.csv`)}><Download size={17} />Export scoped CSV</button>}
        {canCreate && <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}><Plus size={18} />New session</button>}
      </div>
    </div>
    {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}

    {canManageClass && <section className="card class-roster-panel">
      <div className="section-head">
        <div>
          <h2>Class students</h2>
          <p>Add students to a class before creating or submitting attendance.</p>
        </div>
        <div className="button-row">
          {canCreate && <button type="button" className="btn btn-secondary" disabled={!selectedSectionValue} onClick={startSessionForSelectedClass}><Plus size={17} />Session for class</button>}
          {canAddStudents && <button type="button" className="btn btn-primary" disabled={!selectedSectionValue} onClick={() => setShowStudentForm((value) => !value)}><UserPlus size={17} />Add student</button>}
        </div>
      </div>
      <div className="class-roster-layout">
        <div className="class-roster-sidebar">
          <label className="field">
            <span>Class section</span>
            <select className="input" value={selectedSectionValue} onChange={(event) => { setSelectedSectionId(event.target.value); setActiveSessionId(""); }}>
              <option value="">Select class</option>
              {sections.data?.map((item) => <option key={item.id} value={item.id}>{item.code} - {item.name}</option>)}
            </select>
          </label>
          <div className="class-stat">
            <UsersRound size={20} />
            <span>
              <strong>{classStudents.data?.length ?? 0}</strong>
              <small>active students{selectedSection?.capacity ? ` / ${selectedSection.capacity} capacity` : ""}</small>
            </span>
          </div>
          {sections.isLoading && <p className="muted">Loading classes...</p>}
          {sections.isError && <p className="muted">Class list could not be loaded.</p>}
        </div>
        <div className="class-roster-main">
          {showStudentForm && canAddStudents && <form className="student-entry-form" onSubmit={submitStudent}>
            <div className="form-grid">
              <label className="field"><span>Full name</span><input className="input" required minLength={2} value={studentForm.fullName} onChange={(event) => setStudentForm({ ...studentForm, fullName: event.target.value })} /></label>
              <label className="field"><span>Student ID</span><input className="input" required minLength={2} value={studentForm.studentId} onChange={(event) => setStudentForm({ ...studentForm, studentId: event.target.value })} /></label>
              <label className="field"><span>Email</span><input className="input" type="email" value={studentForm.email} onChange={(event) => setStudentForm({ ...studentForm, email: event.target.value })} /></label>
              <label className="field"><span>Mobile</span><input className="input" value={studentForm.mobile} onChange={(event) => setStudentForm({ ...studentForm, mobile: event.target.value })} /></label>
              <label className="field"><span>Roll number</span><input className="input" value={studentForm.rollNumber} onChange={(event) => setStudentForm({ ...studentForm, rollNumber: event.target.value })} /></label>
              <label className="field"><span>Admission year</span><input className="input" type="number" min={1990} max={2200} required value={studentForm.admissionYear} onChange={(event) => setStudentForm({ ...studentForm, admissionYear: Number(event.target.value) })} /></label>
              <label className="field form-span"><span>Temporary password</span><input className="input" type="password" minLength={12} required value={studentForm.temporaryPassword} onChange={(event) => setStudentForm({ ...studentForm, temporaryPassword: event.target.value })} /></label>
            </div>
            <div className="button-row student-entry-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowStudentForm(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={addStudent.isPending}><UserPlus size={17} />{addStudent.isPending ? "Adding..." : "Add to class"}</button>
            </div>
          </form>}
          {classStudents.isLoading ? <LoadingState rows={3} /> : classStudents.isError ? <ErrorState message="Students could not be loaded for this class." /> : !classStudents.data?.length ? <div className="empty">No students in this class yet. Add students before submitting attendance.</div> : <div className="table-wrap class-student-table">
            <table>
              <thead><tr><th>Student</th><th>ID</th><th>Roll</th><th>Contact</th><th>Status</th></tr></thead>
              <tbody>{classStudents.data.map((student) => <tr key={student.userId}><td><strong>{student.fullName}</strong></td><td>{student.studentId}</td><td>{student.rollNumber ?? "Not set"}</td><td>{student.email ?? student.mobile ?? "Not set"}</td><td><StatusBadge value={student.status} /></td></tr>)}</tbody>
            </table>
          </div>}
        </div>
      </div>
    </section>}

    {showCreate && <form className="card create-session" onSubmit={submit}>
      <div>
        <h2>Create attendance session</h2>
        <p className="muted">Admins can create sessions for any active class; faculty are limited to their assigned classes.</p>
      </div>
      <div className="form-grid">
        <label className="field"><span>Academic year</span><select className="input" required value={formAcademicYearId} onChange={(event) => setForm({ ...form, academicYearId: event.target.value })}><option value="">Select year</option>{years.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span>Section</span><select className="input" required value={form.sectionId} onChange={(event) => setForm({ ...form, sectionId: event.target.value, subjectId: "" })}><option value="">Select section</option>{sections.data?.map((item) => <option key={item.id} value={item.id}>{item.code} - {item.name}</option>)}</select></label>
        <label className="field"><span>Subject</span><select className="input" required value={formSubjectId} onChange={(event) => setForm({ ...form, subjectId: event.target.value })}><option value="">Select subject</option>{filteredSubjects.map((item) => <option key={item.id} value={item.id}>{item.code} - {item.name}</option>)}</select></label>
        <label className="field"><span>Date</span><input className="input" type="date" required value={form.sessionDate} onChange={(event) => setForm({ ...form, sessionDate: event.target.value })} /></label>
        <label className="field"><span>Period</span><input className="input" type="number" min={1} max={20} value={form.periodNumber} onChange={(event) => setForm({ ...form, periodNumber: Number(event.target.value) })} /></label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button><button className="btn btn-primary" disabled={create.isPending}>{create.isPending ? "Creating..." : "Create session"}</button></div>
    </form>}

    {activeSessionId && <section style={{ marginBottom: 20 }}>
      <AttendanceMarkingPanel sessionId={activeSessionId} embedded onClose={() => setActiveSessionId("")} />
    </section>}

    {canOwn && <section style={{ marginBottom: 20 }}>
      {summary.isLoading ? <LoadingState rows={2} /> : summary.isError ? <ErrorState /> : summary.data && <div className="attendance-summary">
        <article className="card overall-attendance"><span><ClipboardCheck /></span><div><small>Your overall attendance</small><strong>{summary.data.overall}%</strong><p>Across submitted and locked sessions</p></div></article>
        <article className="card subject-summary"><div className="section-head"><div><h2>Subject breakdown</h2><p>Attended classes by subject</p></div></div>{summary.data.subjects.length ? summary.data.subjects.map((item) => <div className="subject-row" key={item.subject.id}><span><strong>{item.subject.name}</strong><small>{item.subject.code} - {item.attended}/{item.total} attended</small></span><div><span style={{ width: `${item.percentage}%` }} /></div><strong>{item.percentage}%</strong></div>) : <div className="empty">No submitted attendance records yet.</div>}</article>
      </div>}
    </section>}

    {canViewSessions && <section>
      <div className="section-title"><div><h2>Class sessions</h2><p>Sessions available in your assigned scope</p></div></div>
      {sessions.isLoading ? <LoadingState /> : sessions.isError ? <ErrorState /> : !sessions.data?.data.length ? <EmptyState title="No attendance sessions" message="Create a session when your class begins." /> : <div className="card table-wrap"><table><thead><tr><th>Date</th><th>Class</th><th>Subject</th><th>Period</th><th>Faculty</th><th>Records</th><th>Status</th><th>Work</th></tr></thead><tbody>{sessions.data.data.map((session) => <tr key={session.id}><td><Link href={`/attendance/${session.id}`} style={{ color: "var(--primary)", fontWeight: 700 }}>{new Date(session.sessionDate).toLocaleDateString()}</Link></td><td>{session.section.code} - {session.section.name}</td><td><strong>{session.subject.code}</strong><small className="muted" style={{ display: "block" }}>{session.subject.name}</small></td><td>{session.periodNumber}</td><td>{session.faculty.fullName}</td><td>{session._count.records}</td><td><StatusBadge value={session.status} /></td><td><button type="button" className="btn btn-secondary" onClick={() => setActiveSessionId(session.id)}>Mark here</button></td></tr>)}</tbody></table></div>}
    </section>}
  </>;
}
