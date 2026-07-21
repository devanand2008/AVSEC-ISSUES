"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pencil, Plus, Save, ToggleLeft, ToggleRight, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { api, ApiError } from "@/lib/api";
import type { PageResponse, SelectOption } from "@/lib/types";

const targetTypes = [
  "STAFF", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "DEPARTMENT", "BUILDING", "BLOCK", "FLOOR",
  "CLASSROOM", "LABORATORY", "LIBRARY", "CANTEEN", "TRANSPORT", "MAINTENANCE", "SECURITY",
  "OFFICE", "PLACEMENT", "TRAINING", "HOSTEL", "SPORTS", "MEDICAL", "DRINKING_WATER",
  "RESTROOM", "CAMPUS_SERVICE", "OTHER_SERVICE",
] as const;

type TargetType = typeof targetTypes[number];
type CycleStatus = "DRAFT" | "ACTIVE" | "CLOSED" | "ARCHIVED";
type SubmissionRule = "ONCE_PER_DAY" | "ONCE_PER_WEEK" | "ONCE_PER_CYCLE" | "UNLIMITED";

interface FeedbackCycle {
  id: string;
  cycleName: string;
  academicYearId: string | null;
  semesterId: string | null;
  startDate: string;
  endDate: string;
  submissionRule: SubmissionRule;
  anonymousMode: boolean;
  commentsRequired: boolean;
  staffCanViewComments: boolean;
  studentIdentityVisibleToManagement: boolean;
  negativeFeedbackRequiresInvestigation: boolean;
  status: CycleStatus;
  academicYear?: SelectOption | null;
  semester?: SelectOption | null;
}

interface FeedbackQuestion {
  id: string;
  targetType: TargetType;
  category: string;
  questionText: string;
  questionType: "RATING" | "TEXT" | "BOOLEAN";
  displayOrder: number;
  isRequired: boolean;
  isActive: boolean;
}

interface SemesterOption extends SelectOption {
  academicYearId?: string;
  academicYear?: SelectOption;
  programme?: SelectOption;
}

const emptyCycle = {
  cycleName: "",
  academicYearId: "",
  semesterId: "",
  startDate: new Date().toISOString().slice(0, 10),
  endDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  submissionRule: "ONCE_PER_DAY" as SubmissionRule,
  anonymousMode: true,
  commentsRequired: false,
  staffCanViewComments: false,
  studentIdentityVisibleToManagement: false,
  negativeFeedbackRequiresInvestigation: true,
  status: "DRAFT" as CycleStatus,
};

const emptyQuestion = {
  targetType: "STAFF" as TargetType,
  category: "",
  questionText: "",
  questionType: "RATING" as "RATING" | "TEXT" | "BOOLEAN",
  displayOrder: 0,
  isRequired: true,
  isActive: true,
};

function message(error: unknown) {
  return error instanceof ApiError ? error.message : "The change could not be saved.";
}

function dateValue(value: string) {
  return value ? value.slice(0, 10) : "";
}

export function FeedbackCyclesAdminPage() {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyCycle);
  const [formVisible, setFormVisible] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["feedback-cycles", page, status],
    queryFn: () => api.get<PageResponse<FeedbackCycle>>(`/admin/feedback/cycles?page=${page}&pageSize=20${status ? `&status=${status}` : ""}`),
  });
  const years = useQuery({ queryKey: ["academic-years-options"], queryFn: () => api.get<SelectOption[]>("/academic/years") });
  const semesters = useQuery({ queryKey: ["semester-options", form.academicYearId], queryFn: () => api.get<SemesterOption[]>(`/academic/semesters${form.academicYearId ? `?academicYearId=${form.academicYearId}` : ""}`) });
  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, academicYearId: form.academicYearId || undefined, semesterId: form.semesterId || undefined };
      return editingId ? api.patch(`/admin/feedback/cycles/${editingId}`, payload) : api.post("/admin/feedback/cycles", payload);
    },
    onSuccess: () => {
      setError("");
      setEditingId(null);
      setForm(emptyCycle);
      setFormVisible(false);
      void client.invalidateQueries({ queryKey: ["feedback-cycles"] });
    },
    onError: (caught) => setError(message(caught)),
  });
  const changeStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: CycleStatus }) => api.patch(`/admin/feedback/cycles/${id}/status`, { status: next }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["feedback-cycles"] }),
    onError: (caught) => setError(message(caught)),
  });

  function edit(row: FeedbackCycle) {
    setEditingId(row.id);
    setForm({
      cycleName: row.cycleName,
      academicYearId: row.academicYearId ?? "",
      semesterId: row.semesterId ?? "",
      startDate: dateValue(row.startDate),
      endDate: dateValue(row.endDate),
      submissionRule: row.submissionRule,
      anonymousMode: row.anonymousMode,
      commentsRequired: row.commentsRequired,
      staffCanViewComments: row.staffCanViewComments,
      studentIdentityVisibleToManagement: row.studentIdentityVisibleToManagement,
      negativeFeedbackRequiresInvestigation: row.negativeFeedbackRequiresInvestigation,
      status: row.status,
    });
    setFormVisible(true);
    setError("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (form.endDate < form.startDate) {
      setError("End date must be on or after the start date.");
      return;
    }
    save.mutate();
  }

  return <>
    <div className="page-heading">
      <div><span className="eyebrow">Administration</span><h1 className="page-title" style={{ marginTop: 6 }}>Feedback cycles</h1><p className="page-subtitle">Control academic windows, duplicate rules, anonymity and comment visibility.</p></div>
      <button className="btn btn-primary" onClick={() => { setEditingId(null); setForm(emptyCycle); setFormVisible((visible) => !visible); setError(""); }}><Plus size={17} />New cycle</button>
    </div>
    {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}
    {formVisible && <form className="card settings-grid feedback-admin-form" onSubmit={submit} style={{ marginBottom: 18 }}>
      <div className="section-head feedback-admin-form-heading"><div><h2>{editingId ? "Edit cycle" : "Create cycle"}</h2><p>Cycle policy overrides college defaults while the cycle is active.</p></div><button type="button" className="icon-button" aria-label="Close cycle form" onClick={() => setFormVisible(false)}><X size={18} /></button></div>
      <label className="field feedback-admin-wide"><span>Cycle name</span><input className="input" required minLength={2} maxLength={160} value={form.cycleName} onChange={(event) => setForm({ ...form, cycleName: event.target.value })} /></label>
      <label className="field"><span>Academic year</span><select className="input" value={form.academicYearId} onChange={(event) => setForm({ ...form, academicYearId: event.target.value, semesterId: "" })}><option value="">Any academic year</option>{years.data?.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label>
      <label className="field"><span>Semester</span><select className="input" value={form.semesterId} onChange={(event) => setForm({ ...form, semesterId: event.target.value })}><option value="">Any semester</option>{semesters.data?.map((semester) => <option key={semester.id} value={semester.id}>{semester.programme?.name ? `${semester.programme.name} - ` : ""}{semester.name}</option>)}</select></label>
      <label className="field"><span>Start date</span><input className="input" required type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
      <label className="field"><span>End date</span><input className="input" required type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label>
      <label className="field"><span>Submission rule</span><select className="input" value={form.submissionRule} onChange={(event) => setForm({ ...form, submissionRule: event.target.value as SubmissionRule })}>{["ONCE_PER_DAY", "ONCE_PER_WEEK", "ONCE_PER_CYCLE", "UNLIMITED"].map((rule) => <option key={rule} value={rule}>{rule.replaceAll("_", " ")}</option>)}</select></label>
      <label className="field"><span>Status</span><select className="input" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as CycleStatus })}>{["DRAFT", "ACTIVE", "CLOSED", "ARCHIVED"].map((item) => <option key={item}>{item}</option>)}</select></label>
      {(["anonymousMode", "commentsRequired", "staffCanViewComments", "studentIdentityVisibleToManagement", "negativeFeedbackRequiresInvestigation"] as const).map((key) => <label className="check-field settings-check" key={key}><input type="checkbox" checked={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} />{key.replace(/([A-Z])/g, " $1").toLowerCase()}</label>)}
      <div className="button-row feedback-admin-wide"><button className="btn btn-primary" disabled={save.isPending}><Save size={17} />{save.isPending ? "Saving..." : "Save cycle"}</button><button type="button" className="btn btn-secondary" onClick={() => setFormVisible(false)}>Cancel</button></div>
    </form>}
    <section className="card" style={{ marginBottom: 18 }}><div className="filters"><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{["DRAFT", "ACTIVE", "CLOSED", "ARCHIVED"].map((item) => <option key={item}>{item}</option>)}</select></div></section>
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState /> : !query.data?.data.length ? <EmptyState title="No feedback cycles" message="Create a cycle to control student submission windows." /> : <div className="card table-wrap"><table><thead><tr><th>Cycle</th><th>Academic period</th><th>Dates</th><th>Rule</th><th>Policy</th><th>Status</th><th>Actions</th></tr></thead><tbody>{query.data.data.map((row) => <tr key={row.id}><td><strong>{row.cycleName}</strong></td><td>{row.academicYear?.name ?? "All years"}<small className="muted" style={{ display: "block" }}>{row.semester?.name ?? "All semesters"}</small></td><td>{new Date(row.startDate).toLocaleDateString()} – {new Date(row.endDate).toLocaleDateString()}</td><td>{row.submissionRule.replaceAll("_", " ")}</td><td><small style={{ display: "block" }}>{row.anonymousMode ? "Anonymous allowed" : "Identified"}</small><small>{row.commentsRequired ? "Comments required" : "Comments optional"}</small></td><td><StatusBadge value={row.status} /></td><td><div className="button-row"><button className="btn btn-secondary" onClick={() => edit(row)}><Pencil size={15} />Edit</button>{row.status === "ACTIVE" ? <button className="btn btn-secondary" onClick={() => changeStatus.mutate({ id: row.id, next: "CLOSED" })}><ToggleLeft size={15} />Close</button> : row.status !== "ARCHIVED" && <button className="btn btn-secondary" onClick={() => changeStatus.mutate({ id: row.id, next: "ACTIVE" })}><CheckCircle2 size={15} />Activate</button>}</div></td></tr>)}</tbody></table><Pagination page={query.data.meta.page} pageCount={query.data.meta.pageCount} onPage={setPage} /></div>}
  </>;
}

export function FeedbackQuestionsAdminPage() {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [targetType, setTargetType] = useState("");
  const [active, setActive] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyQuestion);
  const [formVisible, setFormVisible] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["feedback-questions", page, targetType, active],
    queryFn: () => api.get<PageResponse<FeedbackQuestion>>(`/admin/feedback/questions?page=${page}&pageSize=20${targetType ? `&targetType=${targetType}` : ""}${active ? `&isActive=${active}` : ""}`),
  });
  const save = useMutation({
    mutationFn: () => editingId ? api.patch(`/admin/feedback/questions/${editingId}`, form) : api.post("/admin/feedback/questions", form),
    onSuccess: () => {
      setError("");
      setEditingId(null);
      setForm(emptyQuestion);
      setFormVisible(false);
      void client.invalidateQueries({ queryKey: ["feedback-questions"] });
    },
    onError: (caught) => setError(message(caught)),
  });
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/admin/feedback/questions/${id}/status`, { isActive }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["feedback-questions"] }),
    onError: (caught) => setError(message(caught)),
  });

  function edit(row: FeedbackQuestion) {
    setEditingId(row.id);
    setForm({ targetType: row.targetType, category: row.category, questionText: row.questionText, questionType: row.questionType, displayOrder: row.displayOrder, isRequired: row.isRequired, isActive: row.isActive });
    setFormVisible(true);
    setError("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    save.mutate();
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">Administration</span><h1 className="page-title" style={{ marginTop: 6 }}>Feedback questions</h1><p className="page-subtitle">Configure target-specific rating questions without redeploying; written responses use the feedback form’s protected comment fields.</p></div><button className="btn btn-primary" onClick={() => { setEditingId(null); setForm(emptyQuestion); setFormVisible((visible) => !visible); setError(""); }}><Plus size={17} />New question</button></div>
    {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}
    {formVisible && <form className="card settings-grid feedback-admin-form" onSubmit={submit} style={{ marginBottom: 18 }}>
      <div className="section-head feedback-admin-form-heading"><div><h2>{editingId ? "Edit question" : "Create question"}</h2><p>Required rating questions contribute to the server-calculated overall score.</p></div><button type="button" className="icon-button" aria-label="Close question form" onClick={() => setFormVisible(false)}><X size={18} /></button></div>
      <label className="field"><span>Target type</span><select className="input" value={form.targetType} onChange={(event) => setForm({ ...form, targetType: event.target.value as TargetType })}>{targetTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="field"><span>Question type</span><input className="input" value="RATING" readOnly aria-describedby="rating-question-note" /><small id="rating-question-note" className="muted">Written responses use the dedicated comment and complaint fields.</small></label>
      <label className="field"><span>Category</span><input className="input" required minLength={2} maxLength={120} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>
      <label className="field"><span>Display order</span><input className="input" type="number" min={0} max={10000} value={form.displayOrder} onChange={(event) => setForm({ ...form, displayOrder: Number(event.target.value) })} /></label>
      <label className="field feedback-admin-wide"><span>Question text</span><textarea className="input" required minLength={3} maxLength={300} value={form.questionText} onChange={(event) => setForm({ ...form, questionText: event.target.value })} /></label>
      <label className="check-field settings-check"><input type="checkbox" checked={form.isRequired} onChange={(event) => setForm({ ...form, isRequired: event.target.checked })} />Required</label>
      <label className="check-field settings-check"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />Active</label>
      <div className="button-row feedback-admin-wide"><button className="btn btn-primary" disabled={save.isPending}><Save size={17} />{save.isPending ? "Saving..." : "Save question"}</button><button type="button" className="btn btn-secondary" onClick={() => setFormVisible(false)}>Cancel</button></div>
    </form>}
    <section className="card" style={{ marginBottom: 18 }}><div className="filters"><select value={targetType} onChange={(event) => { setTargetType(event.target.value); setPage(1); }}><option value="">All target types</option>{targetTypes.map((item) => <option key={item}>{item.replaceAll("_", " ")}</option>)}</select><select value={active} onChange={(event) => { setActive(event.target.value); setPage(1); }}><option value="">Active and inactive</option><option value="true">Active</option><option value="false">Inactive</option></select></div></section>
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState /> : !query.data?.data.length ? <EmptyState title="No feedback questions" message="Create questions for the selected target type." /> : <div className="card table-wrap"><table><thead><tr><th>Order</th><th>Target</th><th>Category</th><th>Question</th><th>Type</th><th>Required</th><th>Status</th><th>Actions</th></tr></thead><tbody>{query.data.data.map((row) => <tr key={row.id}><td>{row.displayOrder}</td><td>{row.targetType.replaceAll("_", " ")}</td><td><strong>{row.category}</strong></td><td>{row.questionText}</td><td>{row.questionType}</td><td>{row.isRequired ? "Yes" : "No"}</td><td><StatusBadge value={row.isActive ? "ACTIVE" : "DISABLED"} /></td><td><div className="button-row"><button className="btn btn-secondary" onClick={() => edit(row)}><Pencil size={15} />Edit</button><button className="btn btn-secondary" onClick={() => toggle.mutate({ id: row.id, isActive: !row.isActive })}>{row.isActive ? <ToggleLeft size={15} /> : <ToggleRight size={15} />}{row.isActive ? "Disable" : "Enable"}</button></div></td></tr>)}</tbody></table><Pagination page={query.data.meta.page} pageCount={query.data.meta.pageCount} onPage={setPage} /></div>}
  </>;
}

function Pagination({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  if (pageCount <= 1) return null;
  return <div className="pagination"><button className="btn btn-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button className="btn btn-secondary" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Next</button></div>;
}
