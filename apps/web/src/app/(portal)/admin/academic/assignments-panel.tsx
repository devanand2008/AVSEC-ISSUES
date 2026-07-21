"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, UserMinus } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { api, ApiError } from "@/lib/api";

type AssignmentKind = "faculty" | "coordinators" | "representatives";

interface Person {
  publicId: string;
  collegeIdentityId: string;
  fullName: string;
}

interface SectionOption {
  id: string;
  code: string;
  name: string;
  semesterId: string;
  semester: {
    name: string;
    programme: { name: string };
    academicYear: { name: string; startsOn: string; endsOn: string };
  };
}

interface SubjectOption {
  id: string;
  code: string;
  name: string;
  semesterId: string;
  semester: { name: string; programme: { name: string } };
}

interface AssignmentOptions {
  users: Array<Person & { roles: Array<{ role: { code: string; name: string } }> }>;
  sections: SectionOption[];
  subjects: SubjectOption[];
}

interface AssignmentBase {
  id: string;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  section: SectionOption;
}

interface AssignmentData {
  faculty: Array<AssignmentBase & { faculty: Person; subject: SubjectOption }>;
  coordinators: Array<AssignmentBase & { coordinator: Person }>;
  representatives: Array<AssignmentBase & { representative: Person }>;
}

const roleForKind: Record<AssignmentKind, string> = {
  faculty: "FACULTY",
  coordinators: "CLASS_COORDINATOR",
  representatives: "CLASS_REPRESENTATIVE",
};

const labelForKind: Record<AssignmentKind, string> = {
  faculty: "Faculty subject",
  coordinators: "Class coordinator",
  representatives: "Class representative",
};

const today = () => new Date().toISOString().slice(0, 10);

export function AssignmentsPanel({ creating, onCreated }: { creating: boolean; onCreated: () => void }) {
  return <div style={{ display: "grid", gap: 18 }}>
    {creating && <AssignmentCreateForm onCreated={onCreated} />}
    <AssignmentsTable />
  </div>;
}

function AssignmentCreateForm({ onCreated }: { onCreated: () => void }) {
  const client = useQueryClient();
  const options = useQuery({
    queryKey: ["admin", "assignment-options"],
    queryFn: () => api.get<AssignmentOptions>("/academic/admin/assignments/options"),
  });
  const [form, setForm] = useState({ kind: "faculty" as AssignmentKind, userPublicId: "", sectionId: "", subjectId: "", validFrom: today(), validUntil: "" });
  const [error, setError] = useState("");
  const selectedSection = options.data?.sections.find((section) => section.id === form.sectionId);
  const people = useMemo(
    () => options.data?.users.filter((person) => person.roles.some(({ role }) => role.code === roleForKind[form.kind])) ?? [],
    [form.kind, options.data],
  );
  const subjects = useMemo(
    () => options.data?.subjects.filter((subject) => subject.semesterId === selectedSection?.semesterId) ?? [],
    [options.data, selectedSection?.semesterId],
  );
  const create = useMutation({
    mutationFn: () => {
      const personKey = form.kind === "faculty" ? "facultyPublicId" : form.kind === "coordinators" ? "coordinatorPublicId" : "representativePublicId";
      return api.post(`/academic/admin/assignments/${form.kind}`, {
        [personKey]: form.userPublicId,
        sectionId: form.sectionId,
        ...(form.kind === "faculty" ? { subjectId: form.subjectId } : {}),
        validFrom: form.validFrom,
        ...(form.validUntil ? { validUntil: form.validUntil } : {}),
      });
    },
    onSuccess: () => {
      setError("");
      void client.invalidateQueries({ queryKey: ["admin", "assignments"] });
      onCreated();
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "The assignment could not be created."),
  });

  function selectSection(sectionId: string) {
    const section = options.data?.sections.find((item) => item.id === sectionId);
    const start = section?.semester.academicYear.startsOn.slice(0, 10);
    const end = section?.semester.academicYear.endsOn.slice(0, 10);
    const current = today();
    const validFrom = start && end ? current < start ? start : current > end ? end : current : form.validFrom;
    setForm({ ...form, sectionId, subjectId: "", validFrom });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    create.mutate();
  }

  if (options.isLoading) return <LoadingState rows={2} />;
  if (options.isError) return <ErrorState message="Assignment choices could not be loaded." />;
  const minDate = selectedSection?.semester.academicYear.startsOn.slice(0, 10);
  const maxDate = selectedSection?.semester.academicYear.endsOn.slice(0, 10);

  return <form className="card" style={{ padding: 20, display: "grid", gap: 14 }} onSubmit={submit}>
    <div className="section-head"><div><h2>New academic assignment</h2><p>Only active people, classes and subjects are available.</p></div></div>
    {error && <div className="error-box">{error}</div>}
    <div className="form-grid">
      <label className="field">Assignment type<select className="input" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as AssignmentKind, userPublicId: "", subjectId: "" })}><option value="faculty">Faculty subject</option><option value="coordinators">Class coordinator</option><option value="representatives">Class representative</option></select></label>
      <label className="field">Person<select className="input" required value={form.userPublicId} onChange={(event) => setForm({ ...form, userPublicId: event.target.value })}><option value="">Select person</option>{people.map((person) => <option key={person.publicId} value={person.publicId}>{person.fullName} · {person.collegeIdentityId}</option>)}</select>{!people.length && <small className="muted">No active users have the required role.</small>}</label>
      <label className="field">Section<select className="input" required value={form.sectionId} onChange={(event) => selectSection(event.target.value)}><option value="">Select section</option>{options.data?.sections.map((section) => <option key={section.id} value={section.id}>{section.semester.programme.name} · {section.semester.name} · {section.code}</option>)}</select></label>
      {form.kind === "faculty" && <label className="field">Subject<select className="input" required value={form.subjectId} disabled={!form.sectionId} onChange={(event) => setForm({ ...form, subjectId: event.target.value })}><option value="">Select subject</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.code} · {subject.name}</option>)}</select></label>}
      <label className="field">Effective from<input className="input" type="date" required min={minDate} max={maxDate} value={form.validFrom} onChange={(event) => setForm({ ...form, validFrom: event.target.value })} /></label>
      <label className="field">Effective until <small className="muted">(optional)</small><input className="input" type="date" min={form.validFrom || minDate} max={maxDate} value={form.validUntil} onChange={(event) => setForm({ ...form, validUntil: event.target.value })} /></label>
    </div>
    <div><button className="btn btn-primary" disabled={create.isPending || !people.length}><Plus size={17} />{create.isPending ? "Assigning…" : `Create ${labelForKind[form.kind].toLowerCase()} assignment`}</button></div>
  </form>;
}

function AssignmentsTable() {
  const client = useQueryClient();
  const assignments = useQuery({
    queryKey: ["admin", "assignments"],
    queryFn: () => api.get<AssignmentData>("/academic/admin/assignments"),
  });
  const [deactivating, setDeactivating] = useState<{ kind: AssignmentKind; id: string; label: string } | null>(null);
  const [deactivation, setDeactivation] = useState({ effectiveOn: today(), reason: "" });
  const [error, setError] = useState("");
  const deactivate = useMutation({
    mutationFn: () => api.patch(`/academic/admin/assignments/${deactivating?.kind}/${deactivating?.id}/deactivate`, deactivation),
    onSuccess: () => {
      setDeactivating(null);
      setDeactivation({ effectiveOn: today(), reason: "" });
      setError("");
      void client.invalidateQueries({ queryKey: ["admin", "assignments"] });
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "The assignment could not be deactivated."),
  });

  if (assignments.isLoading) return <LoadingState />;
  if (assignments.isError) return <ErrorState message="Academic assignments could not be loaded." />;
  const data = assignments.data;
  if (!data) return null;

  return <>
    {deactivating && <form className="card" style={{ padding: 18, display: "grid", gap: 12 }} onSubmit={(event) => { event.preventDefault(); setError(""); deactivate.mutate(); }}>
      <div><h3 style={{ margin: 0 }}>Deactivate {deactivating.label}</h3><p className="muted">The record is retained for attendance and audit history.</p></div>
      {error && <div className="error-box">{error}</div>}
      <div className="form-grid"><label className="field">Effective on<input className="input" type="date" required value={deactivation.effectiveOn} onChange={(event) => setDeactivation({ ...deactivation, effectiveOn: event.target.value })} /></label><label className="field">Reason<input className="input" required minLength={3} maxLength={500} value={deactivation.reason} onChange={(event) => setDeactivation({ ...deactivation, reason: event.target.value })} /></label></div>
      <div className="button-row"><button type="button" className="btn btn-secondary" onClick={() => { setDeactivating(null); setError(""); }}>Cancel</button><button className="btn btn-primary" disabled={deactivate.isPending}><UserMinus size={17} />{deactivate.isPending ? "Saving…" : "Deactivate"}</button></div>
    </form>}
    <AssignmentSection title="Faculty subject assignments" empty="No faculty subject assignments yet." isEmpty={!data.faculty.length}>
      <table><thead><tr><th>Faculty</th><th>Class</th><th>Subject</th><th>Effective dates</th><th>Status</th><th /></tr></thead><tbody>{data.faculty.map((row) => <tr key={row.id}><td><strong>{row.faculty.fullName}</strong><small className="muted" style={{ display: "block" }}>{row.faculty.collegeIdentityId}</small></td><td>{className(row.section)}</td><td>{row.subject.code} · {row.subject.name}</td><td>{dateRange(row)}</td><td><StatusBadge value={assignmentStatus(row)} /></td><td>{row.isActive && <button className="btn btn-secondary" onClick={() => setDeactivating({ kind: "faculty", id: row.id, label: `${row.faculty.fullName}'s assignment` })}>Deactivate</button>}</td></tr>)}</tbody></table>
    </AssignmentSection>
    <AssignmentSection title="Class coordinator assignments" empty="No class coordinator assignments yet." isEmpty={!data.coordinators.length}>
      <table><thead><tr><th>Coordinator</th><th>Class</th><th>Effective dates</th><th>Status</th><th /></tr></thead><tbody>{data.coordinators.map((row) => <tr key={row.id}><td><strong>{row.coordinator.fullName}</strong><small className="muted" style={{ display: "block" }}>{row.coordinator.collegeIdentityId}</small></td><td>{className(row.section)}</td><td>{dateRange(row)}</td><td><StatusBadge value={assignmentStatus(row)} /></td><td>{row.isActive && <button className="btn btn-secondary" onClick={() => setDeactivating({ kind: "coordinators", id: row.id, label: `${row.coordinator.fullName}'s assignment` })}>Deactivate</button>}</td></tr>)}</tbody></table>
    </AssignmentSection>
    <AssignmentSection title="Class representative assignments" empty="No class representative assignments yet." isEmpty={!data.representatives.length}>
      <table><thead><tr><th>Representative</th><th>Class</th><th>Effective dates</th><th>Status</th><th /></tr></thead><tbody>{data.representatives.map((row) => <tr key={row.id}><td><strong>{row.representative.fullName}</strong><small className="muted" style={{ display: "block" }}>{row.representative.collegeIdentityId}</small></td><td>{className(row.section)}</td><td>{dateRange(row)}</td><td><StatusBadge value={assignmentStatus(row)} /></td><td>{row.isActive && <button className="btn btn-secondary" onClick={() => setDeactivating({ kind: "representatives", id: row.id, label: `${row.representative.fullName}'s assignment` })}>Deactivate</button>}</td></tr>)}</tbody></table>
    </AssignmentSection>
  </>;
}

function AssignmentSection({ title, empty, isEmpty, children }: { title: string; empty: string; isEmpty: boolean; children: ReactNode }) {
  return <section className="card"><div className="section-head"><div><h2>{title}</h2></div></div><div className="table-wrap">{isEmpty ? <div className="empty">{empty}</div> : children}</div></section>;
}

function className(section: SectionOption) {
  return `${section.semester.programme.name} · ${section.semester.name} · ${section.code}`;
}

function dateRange(assignment: AssignmentBase) {
  return `${new Date(assignment.validFrom).toLocaleDateString()} – ${assignment.validUntil ? new Date(assignment.validUntil).toLocaleDateString() : "Open-ended"}`;
}

export function assignmentStatus(assignment: Pick<AssignmentBase, "isActive" | "validFrom" | "validUntil">, now = new Date()) {
  const from = new Date(assignment.validFrom);
  const until = assignment.validUntil ? new Date(assignment.validUntil) : null;
  if (!assignment.isActive) return "INACTIVE";
  if (from > now) return "SCHEDULED";
  if (until && until < now) return "ENDED";
  return "ACTIVE";
}
