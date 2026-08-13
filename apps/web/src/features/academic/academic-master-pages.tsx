"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CheckCircle2, Pencil, Plus, RotateCcw, Star } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { PageHeader } from "@/components/ui/page-header";
import { api, ApiError } from "@/lib/api";
import {
  academicMasterDate,
  buildAcademicYearCreatePayload,
  buildAcademicYearUpdatePayload,
  buildDegreeTypePayload,
  buildProgrammeCreatePayload,
  buildProgrammeUpdatePayload,
  validateAcademicYearDraft,
  validateDegreeTypeDraft,
  validateProgrammeDraft,
  type AcademicYearDraft,
  type AcademicYearMasterRecord,
  type DegreeTypeDraft,
  type DegreeTypeMasterRecord,
  type ProgrammeDraft,
  type ProgrammeMasterRecord,
} from "./academic-masters";

const degreeTypeBlank = (): DegreeTypeDraft => ({ code: "", name: "", description: "", sortOrder: "0", isActive: true });
const yearBlank = (): AcademicYearDraft => ({ name: "", startYear: "", endYear: "", startsOn: "", endsOn: "", isCurrent: false, isActive: true });
const programmeBlank = (): ProgrammeDraft => ({ code: "", name: "", departmentId: "", degreeTypeId: "", durationYears: "4", totalSemesters: "8", isActive: true });

export function DegreeTypesMasterPage() {
  const client = useQueryClient();
  const [editing, setEditing] = useState<DegreeTypeMasterRecord | null>(null);
  const [draft, setDraft] = useState(degreeTypeBlank);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const records = useQuery({ queryKey: ["academic-master", "degree-types"], queryFn: () => api.get<DegreeTypeMasterRecord[]>("/academic/admin/degree-types") });
  const save = useMutation({
    mutationFn: () => editing ? api.patch(`/academic/degree-types/${editing.id}`, buildDegreeTypePayload(draft)) : api.post("/academic/degree-types", buildDegreeTypePayload(draft)),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["academic-master", "degree-types"] }); setFormOpen(false); setEditing(null); setDraft(degreeTypeBlank()); setError(""); setSuccess("Degree Type saved."); },
    onError: (caught) => setError(apiMessage(caught, "Degree Type could not be saved.")),
  });
  const lifecycle = useMasterLifecycle("degree-types", client, setError, setSuccess);
  function submit(event: FormEvent) { event.preventDefault(); const issue = validateDegreeTypeDraft(draft); if (issue) return setError(issue); save.mutate(); }
  function edit(record: DegreeTypeMasterRecord) { setEditing(record); setDraft({ code: record.code, name: record.name, description: record.description ?? "", sortOrder: String(record.sortOrder ?? 0), isActive: record.isActive }); setFormOpen(true); setError(""); }
  return <AcademicMasterShell title="Degree Types" description="Configure degrees independently from departments and programmes." actionLabel="Add Degree Type" onAdd={() => { setEditing(null); setDraft(degreeTypeBlank()); setFormOpen(true); }} success={success}>
    {formOpen && <MasterForm title={editing ? "Edit Degree Type" : "Add Degree Type"} error={error} pending={save.isPending} onSubmit={submit} onCancel={() => setFormOpen(false)}><MasterInput label="Degree Type Name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} placeholder="B.E." /><MasterInput label="Degree Type Code" value={draft.code} onChange={(code) => setDraft({ ...draft, code })} placeholder="BE" /><MasterInput label="Description" value={draft.description} onChange={(description) => setDraft({ ...draft, description })} optional /><MasterInput label="Sort Order" type="number" min={0} value={draft.sortOrder} onChange={(sortOrder) => setDraft({ ...draft, sortOrder })} /><ActiveCheck checked={draft.isActive} onChange={(isActive) => setDraft({ ...draft, isActive })} /></MasterForm>}
    {error && !formOpen && <div className="error-box" role="alert">{error}</div>}
    <MasterQueryState query={records}>{(items) => <div className="academic-master-grid">{items.map((record) => <MasterCard key={record.id} title={record.name} code={record.code} active={record.isActive} archived={Boolean(record.archivedAt)} details={[`${record._count?.programmes ?? 0} programmes`, record.description || "No description"]} actions={<><button className="avs-btn avs-btn-secondary avs-btn-sm" type="button" onClick={() => edit(record)}><Pencil size={15} /> Edit</button><LifecycleButton record={record} lifecycle={lifecycle} /></>} />)}</div>}</MasterQueryState>
  </AcademicMasterShell>;
}

export function AcademicYearsMasterPage() {
  const client = useQueryClient();
  const [editing, setEditing] = useState<AcademicYearMasterRecord | null>(null);
  const [draft, setDraft] = useState(yearBlank);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const records = useQuery({ queryKey: ["academic-master", "academic-years"], queryFn: () => api.get<AcademicYearMasterRecord[]>("/academic/admin/years") });
  const save = useMutation({ mutationFn: () => editing
    ? api.patch(`/academic/years/${editing.id}`, buildAcademicYearUpdatePayload(draft))
    : api.post("/academic/years", buildAcademicYearCreatePayload(draft)),
  onSuccess: async () => { await client.invalidateQueries({ queryKey: ["academic-master", "academic-years"] }); setEditing(null); setFormOpen(false); setDraft(yearBlank()); setError(""); setSuccess("Academic Year saved."); }, onError: (caught) => setError(apiMessage(caught, "Academic Year could not be saved.")) });
  const setCurrent = useMutation({ mutationFn: (id: string) => api.post(`/academic/years/${id}/set-current`), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["academic-master", "academic-years"] }); setSuccess("Current Academic Year updated."); }, onError: (caught) => setError(apiMessage(caught, "Current Academic Year could not be updated.")) });
  const lifecycle = useMasterLifecycle("years", client, setError, setSuccess, "academic-years");
  function submit(event: FormEvent) { event.preventDefault(); const issue = validateAcademicYearDraft(draft); if (issue) return setError(issue); save.mutate(); }
  function edit(record: AcademicYearMasterRecord) { const startsOn = academicMasterDate(record.startsOn); const endsOn = academicMasterDate(record.endsOn); setEditing(record); setDraft({ name: record.name, startYear: String(new Date(`${startsOn}T00:00:00Z`).getUTCFullYear()), endYear: String(new Date(`${endsOn}T00:00:00Z`).getUTCFullYear()), startsOn, endsOn, isCurrent: record.isCurrent, isActive: record.isActive }); setFormOpen(true); setError(""); }
  return <AcademicMasterShell title="Academic Years" description="Keep previous, current, and future configured years available for authorised data entry." actionLabel="Add Academic Year" onAdd={() => { setEditing(null); setDraft(yearBlank()); setFormOpen(true); }} success={success}>
    {formOpen && <MasterForm title={editing ? "Edit Academic Year" : "Add Academic Year"} error={error} pending={save.isPending} onSubmit={submit} onCancel={() => setFormOpen(false)}><MasterInput label="Academic Year Name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} placeholder="2026-2027" /><MasterInput label="Start Year" type="number" min={1900} max={2299} value={draft.startYear} onChange={(startYear) => { const year = Number(startYear); const endYear = Number.isInteger(year) ? String(year + 1) : draft.endYear; setDraft({ ...draft, startYear, endYear, name: Number.isInteger(year) ? `${startYear}-${endYear}` : draft.name, startsOn: Number.isInteger(year) ? `${startYear}-07-01` : draft.startsOn, endsOn: Number.isInteger(year) ? `${endYear}-06-30` : draft.endsOn }); }} /><MasterInput label="End Year" type="number" min={1901} max={2300} value={draft.endYear} onChange={(endYear) => setDraft({ ...draft, endYear, name: draft.startYear && endYear ? `${draft.startYear}-${endYear}` : draft.name })} /><MasterInput label="Start Date" type="date" value={draft.startsOn} onChange={(startsOn) => setDraft({ ...draft, startsOn })} /><MasterInput label="End Date" type="date" value={draft.endsOn} onChange={(endsOn) => setDraft({ ...draft, endsOn })} />{editing ? <p className="muted academic-master-current-help">Use the Set Current action on the Academic Year card to change the current year.</p> : <label className="check-field academic-master-active"><input type="checkbox" checked={draft.isCurrent} onChange={(event) => setDraft({ ...draft, isCurrent: event.target.checked })} /> Set as Current Academic Year</label>}<ActiveCheck checked={draft.isActive} onChange={(isActive) => setDraft({ ...draft, isActive })} /></MasterForm>}
    {error && !formOpen && <div className="error-box" role="alert">{error}</div>}
    <MasterQueryState query={records}>{(items) => <div className="academic-master-grid">{items.map((record) => <MasterCard key={record.id} title={record.name} active={record.isActive} archived={Boolean(record.archivedAt)} current={record.isCurrent} details={[`${academicMasterDate(record.startsOn)} to ${academicMasterDate(record.endsOn)}`, `${record._count?.semesters ?? 0} semesters`, `${record._count?.attendanceSessions ?? 0} attendance sessions`]} actions={<>{!record.isCurrent && !record.archivedAt && <button className="avs-btn avs-btn-secondary avs-btn-sm" type="button" disabled={setCurrent.isPending} onClick={() => setCurrent.mutate(record.id)}><Star size={15} /> Set Current</button>}<button className="avs-btn avs-btn-secondary avs-btn-sm" type="button" onClick={() => edit(record)}><Pencil size={15} /> Edit</button><LifecycleButton record={record} lifecycle={lifecycle} /></>} />)}</div>}</MasterQueryState>
  </AcademicMasterShell>;
}

interface DepartmentOption { id: string; code: string; name: string }

export function ProgrammesMasterPage() {
  const client = useQueryClient();
  const [editing, setEditing] = useState<ProgrammeMasterRecord | null>(null);
  const [draft, setDraft] = useState(programmeBlank);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const records = useQuery({ queryKey: ["academic-master", "programmes"], queryFn: () => api.get<ProgrammeMasterRecord[]>("/academic/admin/programmes") });
  const degrees = useQuery({ queryKey: ["academic-master", "degree-types"], queryFn: () => api.get<DegreeTypeMasterRecord[]>("/academic/admin/degree-types") });
  const departments = useQuery({ queryKey: ["academic-master", "departments"], queryFn: () => api.get<DepartmentOption[]>("/academic/admin/departments") });
  const save = useMutation({ mutationFn: () => editing ? api.patch(`/academic/programmes/${editing.id}`, buildProgrammeUpdatePayload(draft)) : api.post("/academic/programmes", buildProgrammeCreatePayload(draft)), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["academic-master", "programmes"] }); setEditing(null); setFormOpen(false); setDraft(programmeBlank()); setError(""); setSuccess("Programme saved."); }, onError: (caught) => setError(apiMessage(caught, "Programme could not be saved.")) });
  const lifecycle = useMasterLifecycle("programmes", client, setError, setSuccess);
  function submit(event: FormEvent) { event.preventDefault(); const issue = validateProgrammeDraft(draft); if (issue) return setError(issue); save.mutate(); }
  function edit(record: ProgrammeMasterRecord) { setEditing(record); setDraft({ code: record.code, name: record.name, departmentId: record.department.id, degreeTypeId: record.degreeTypeMaster?.id ?? record.degreeTypeId ?? "", durationYears: String(record.durationYears), totalSemesters: String(record.totalSemesters), isActive: record.isActive }); setFormOpen(true); setError(""); }
  return <AcademicMasterShell title="Programmes" description="Map each programme to its database Degree Type and Department." actionLabel="Add Programme" onAdd={() => { setEditing(null); setDraft(programmeBlank()); setFormOpen(true); }} success={success}>
    {formOpen && <MasterForm title={editing ? "Edit Programme" : "Add Programme"} error={error} pending={save.isPending} onSubmit={submit} onCancel={() => setFormOpen(false)}><MasterInput label="Programme Name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} /><MasterInput label="Programme Code" value={draft.code} onChange={(code) => setDraft({ ...draft, code })} /><MasterSelect label="Degree Type" value={draft.degreeTypeId} options={(degrees.data ?? []).filter((item) => item.isActive && !item.archivedAt).map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))} onChange={(degreeTypeId) => setDraft({ ...draft, degreeTypeId })} /><MasterSelect label="Department" value={draft.departmentId} disabled={Boolean(editing)} help={editing ? "Department is fixed after creation so existing academic dependencies are not moved silently." : undefined} options={(departments.data ?? []).map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))} onChange={(departmentId) => setDraft({ ...draft, departmentId })} /><MasterInput label="Duration (Years)" type="number" min={1} max={4} value={draft.durationYears} onChange={(durationYears) => setDraft({ ...draft, durationYears })} /><MasterInput label="Total Semesters" type="number" min={1} max={8} value={draft.totalSemesters} onChange={(totalSemesters) => setDraft({ ...draft, totalSemesters })} /><ActiveCheck checked={draft.isActive} onChange={(isActive) => setDraft({ ...draft, isActive })} /></MasterForm>}
    {error && !formOpen && <div className="error-box" role="alert">{error}</div>}
    <MasterQueryState query={records}>{(items) => <div className="academic-master-grid">{items.map((record) => <MasterCard key={record.id} title={record.name} code={record.code} active={record.isActive} archived={Boolean(record.archivedAt)} details={[record.degreeTypeMaster?.name ?? "Degree Type not assigned", record.department.name, `${record.durationYears} years · ${record.totalSemesters} semesters`, `${record._count?.studentProfiles ?? 0} students`]} actions={<><button className="avs-btn avs-btn-secondary avs-btn-sm" type="button" onClick={() => edit(record)}><Pencil size={15} /> Edit</button><LifecycleButton record={record} lifecycle={lifecycle} /></>} />)}</div>}</MasterQueryState>
  </AcademicMasterShell>;
}

function AcademicMasterShell({ title, description, actionLabel, onAdd, success, children }: { title: string; description: string; actionLabel: string; onAdd: () => void; success: string; children: ReactNode }) {
  return <div className="page-container main-with-bottom-nav academic-master-page"><PageHeader title={title} description={description} breadcrumbs={[{ label: "Admin" }, { label: "Academic Setup", href: "/admin/academic/departments-sections" }, { label: title }]} actions={<div className="academic-master-heading-actions"><Link className="avs-btn avs-btn-secondary" href="/admin/academic">Advanced Setup</Link><button className="avs-btn avs-btn-primary" type="button" onClick={onAdd}><Plus size={16} /> {actionLabel}</button></div>} />{success && <div className="academic-master-success" role="status"><CheckCircle2 size={17} /> {success}</div>}{children}</div>;
}

function MasterForm({ title, error, pending, onSubmit, onCancel, children }: { title: string; error: string; pending: boolean; onSubmit: (event: FormEvent) => void; onCancel: () => void; children: ReactNode }) {
  return <form className="avs-card academic-master-form" onSubmit={onSubmit}><h2>{title}</h2>{error && <div className="error-box" role="alert">{error}</div>}<div className="academic-master-form-grid">{children}</div><footer><button className="avs-btn avs-btn-secondary" type="button" onClick={onCancel}>Cancel</button><button className="avs-btn avs-btn-primary" disabled={pending}>{pending ? "Saving..." : "Save"}</button></footer></form>;
}

function MasterInput({ label, value, onChange, optional = false, ...props }: { label: string; value: string; onChange: (value: string) => void; optional?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) { return <label className="field"><span>{label}{optional ? " (optional)" : " *"}</span><input {...props} className="input" required={!optional} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function MasterSelect({ label, value, options, onChange, disabled = false, help }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; disabled?: boolean; help?: string }) { return <label className="field"><span>{label} *</span><select className="input" required disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}><option value="">Select...</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{help && <small className="muted">{help}</small>}</label>; }
function ActiveCheck({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) { return <label className="check-field academic-master-active"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /> Active for data entry</label>; }

function MasterCard({ title, code, active, archived, current, details, actions }: { title: string; code?: string; active: boolean; archived: boolean; current?: boolean; details: string[]; actions: ReactNode }) { return <article className="avs-card academic-master-card"><header><div>{code && <span className="eyebrow">{code}</span>}<h2>{title}</h2></div><div>{current && <span className="avs-badge avs-badge-success">Current</span>}<span className={`avs-badge ${archived ? "" : active ? "avs-badge-success" : "avs-badge-warning"}`}>{archived ? "Archived" : active ? "Active" : "Inactive"}</span></div></header><ul>{details.map((detail) => <li key={detail}>{detail}</li>)}</ul><footer>{actions}</footer></article>; }

function MasterQueryState<T>({ query, children }: { query: { isLoading: boolean; isError: boolean; data?: T[] }; children: (items: T[]) => ReactNode }) { if (query.isLoading) return <LoadingState rows={6} />; if (query.isError) return <ErrorState message="Academic master records could not be loaded." />; if (!query.data?.length) return <div className="avs-card empty">No records have been configured.</div>; return children(query.data); }

function useMasterLifecycle(resource: string, client: ReturnType<typeof useQueryClient>, setError: (message: string) => void, setSuccess: (message: string) => void, queryResource = resource) {
  return useMutation({ mutationFn: ({ id, action }: { id: string; action: "archive" | "restore" }) => api.post(`/academic/${resource}/${id}/${action}`, action === "archive" ? { reason: "Changed from Academic Setup" } : undefined), onSuccess: async (_, variables) => { await client.invalidateQueries({ queryKey: ["academic-master", queryResource] }); setError(""); setSuccess(variables.action === "archive" ? "Record archived safely." : "Record restored."); }, onError: (caught) => setError(apiMessage(caught, "Academic record status could not be changed.")) });
}

function LifecycleButton({ record, lifecycle }: { record: { id: string; archivedAt?: string | null }; lifecycle: ReturnType<typeof useMasterLifecycle> }) { const archived = Boolean(record.archivedAt); return <button className="avs-btn avs-btn-secondary avs-btn-sm" type="button" disabled={lifecycle.isPending} onClick={() => lifecycle.mutate({ id: record.id, action: archived ? "restore" : "archive" })}>{archived ? <RotateCcw size={15} /> : <Archive size={15} />} {archived ? "Restore" : "Archive"}</button>; }

function apiMessage(caught: unknown, fallback: string) { return caught instanceof ApiError ? `${caught.message}${caught.requestId ? ` Reference: ${caught.requestId}.` : ""}` : fallback; }
