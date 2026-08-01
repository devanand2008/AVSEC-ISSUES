"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, BookOpen, ChevronRight, GraduationCap, Layers, Library, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, RotateCcw, Search, ToggleLeft, ToggleRight, UserRoundCheck, Users, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { api, ApiError } from "@/lib/api";
import { AssignmentsPanel } from "./assignments-panel";

interface Department { id: string; code: string; name: string; shortName: string | null; description: string | null; officialEmail: string | null; contactNumber: string | null; location: string | null; isActive: boolean; archivedAt: string | null; campus: { id: string; name: string } | null; hod: { publicId: string; fullName: string; status: string } | null; _count: { programmes: number; studentProfiles: number; staffProfiles: number; rooms: number; issues: number } }
interface Programme { id: string; code: string; name: string; degreeType: string | null; durationYears: number; isActive: boolean; department: { id: string; name: string }; _count: { semesters: number; studentProfiles: number } }
interface AcademicYear { id: string; name: string; startsOn: string; endsOn: string; isCurrent: boolean; isActive: boolean; _count: { semesters: number; attendanceSessions: number } }
interface Semester { id: string; number: number; name: string; isActive: boolean; programme: { id: string; name: string }; academicYear: { id: string; name: string }; _count: { sections: number; subjects: number } }
interface Section { id: string; code: string; name: string; studyYear: number | null; displayName: string | null; assignedRoomId: string | null; officialGroupEnabled: boolean; capacity: number | null; isActive: boolean; assignedRoom: { id: string; code: string; name: string; floor: { name: string; block: { name: string } } } | null; coordinatorAssignments: Array<{ coordinator: { publicId: string; fullName: string } }>; representativeAssignments: Array<{ representative: { publicId: string; fullName: string } }>; semester: { id: string; name: string; programme: { id: string; name: string }; academicYear: { id: string; name: string } }; _count: { studentProfiles: number; attendanceSessions: number } }
interface Subject { id: string; code: string; name: string; isActive: boolean; semester: { id: string; name: string; programme: { id: string; name: string } }; _count: { facultyAssignments: number; attendanceSessions: number } }
interface Campus { id: string; code: string; name: string }

type StructureTab = "departments" | "programmes" | "years" | "semesters" | "sections" | "subjects";
type Tab = StructureTab | "assignments";

import { PageHeader } from "@/components/ui/page-header";

export default function AcademicAdminPage() {
  const [tab, setTab] = useState<Tab>("departments");
  const [creating, setCreating] = useState(false);
  const tabs: { key: Tab; label: string; icon: typeof BookOpen }[] = [
    { key: "departments", label: "Departments", icon: Library },
    { key: "programmes", label: "Programmes", icon: GraduationCap },
    { key: "years", label: "Academic years", icon: BookOpen },
    { key: "semesters", label: "Semesters", icon: Layers },
    { key: "sections", label: "Sections", icon: Layers },
    { key: "subjects", label: "Subjects", icon: BookOpen },
    { key: "assignments", label: "Assignments", icon: UserRoundCheck },
  ];

  return <>
    <PageHeader
      title="Academic Structure"
      description="Manage hierarchy, courses, and the people assigned to each class."
      breadcrumbs={[{ label: "Admin" }, { label: "Academic Setup" }]}
      actions={
        <button className="btn btn-primary" onClick={() => setCreating(!creating)}>
          <Plus size={17} />
          {creating ? "Cancel" : "Add new"}
        </button>
      }
    />
    <div className="tab-bar" style={{ marginBottom: 18 }}>{tabs.map(({ key, label, icon: Icon }) => <button key={key} className={`tab-item ${tab === key ? "active" : ""}`} onClick={() => { setTab(key); setCreating(false); }}><Icon size={16} />{label}</button>)}</div>
    {creating && tab !== "assignments" && <CreateForm tab={tab} onCreated={() => setCreating(false)} />}
    {tab === "departments" && <DepartmentsTable />}
    {tab === "programmes" && <ProgrammesTable />}
    {tab === "years" && <YearsTable />}
    {tab === "semesters" && <SemestersTable />}
    {tab === "sections" && <SectionsTable />}
    {tab === "subjects" && <SubjectsTable />}
    {tab === "assignments" && <AssignmentsPanel creating={creating} onCreated={() => setCreating(false)} />}
  </>;
}

/* ─── Tables ─── */

function DepartmentsTable() {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [hodFilter, setHodFilter] = useState("ALL");
  const [selected, setSelected] = useState<Department | null>(null);
  const [editing, setEditing] = useState<Department | null>(null);
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["admin", "departments"], queryFn: () => api.get<Department[]>("/academic/admin/departments") });
  const lifecycle = useMutation({
    mutationFn: ({ item, action }: { item: Department; action: "archive" | "restore" }) => api.post(`/academic/departments/${item.id}/${action}`, action === "archive" ? { reason: "Archived from Academic Management" } : undefined),
    onSuccess: () => { setSelected(null); void client.invalidateQueries({ queryKey: ["admin", "departments"] }); },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Department status could not be changed."),
  });
  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState />;
  const filtered = query.data?.filter((item) => {
    const matchesSearch = `${item.code} ${item.name} ${item.shortName ?? ""} ${item.hod?.fullName ?? ""}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = status === "ALL" || (status === "ARCHIVED" ? Boolean(item.archivedAt) : status === "ACTIVE" ? item.isActive && !item.archivedAt : !item.isActive && !item.archivedAt);
    const matchesHod = hodFilter === "ALL" || (hodFilter === "ASSIGNED" ? Boolean(item.hod) : !item.hod);
    return matchesSearch && matchesStatus && matchesHod;
  }) ?? [];
  return <>
    <div className="academic-filters"><label className="search-field"><Search size={17} /><input aria-label="Search departments" placeholder="Search departments or HOD" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select className="input" aria-label="Department status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ARCHIVED">Archived</option></select><select className="input" aria-label="HOD filter" value={hodFilter} onChange={(event) => setHodFilter(event.target.value)}><option value="ALL">All HOD assignments</option><option value="ASSIGNED">HOD assigned</option><option value="UNASSIGNED">HOD unassigned</option></select></div>
    {error && <div className="error-box">{error}</div>}
    <div className="department-grid">{filtered.map((item) => <article className="department-card" key={item.id}><header><span className="department-code">{item.code}</span><span className={`badge ${item.archivedAt ? "" : item.isActive ? "badge-success" : "badge-warning"}`}>{item.archivedAt ? "Archived" : item.isActive ? "Active" : "Inactive"}</span></header><div><h3>{item.name}</h3><p>{item.description || "No department description has been added."}</p></div><dl><div><dt>HOD</dt><dd>{item.hod?.fullName ?? "Not assigned"}</dd></div><div><dt>Campus</dt><dd>{item.campus?.name ?? "College campus"}</dd></div></dl><div className="department-metrics"><span><strong>{item._count.studentProfiles}</strong>Students</span><span><strong>{item._count.staffProfiles}</strong>Staff</span><span><strong>{item._count.programmes}</strong>Programmes</span><span><strong>{item._count.issues}</strong>Open issues</span></div><footer><button className="btn btn-secondary" onClick={() => setSelected(item)}>Details</button><button className="icon-button" title="Edit department" onClick={() => setEditing(item)}><Pencil size={17} /></button>{item.archivedAt ? <button className="icon-button" title="Restore department" disabled={lifecycle.isPending} onClick={() => lifecycle.mutate({ item, action: "restore" })}><RotateCcw size={17} /></button> : <button className="icon-button danger" title="Archive department" disabled={lifecycle.isPending} onClick={() => { if (window.confirm(`Archive ${item.name}? Existing records will be preserved.`)) lifecycle.mutate({ item, action: "archive" }); }}><Archive size={17} /></button>}</footer></article>)}{!filtered.length && <div className="empty">No departments match these filters.</div>}</div>
    {selected && <div className="drawer-backdrop" onClick={() => setSelected(null)}><aside className="details-drawer" onClick={(event) => event.stopPropagation()}><header><div><span className="eyebrow">{selected.code}</span><h2>{selected.name}</h2></div><button className="icon-button" aria-label="Close details" onClick={() => setSelected(null)}><X /></button></header><p>{selected.description || "No description has been added."}</p><div className="details-list"><span><UserRoundCheck /> <strong>HOD</strong>{selected.hod?.fullName ?? "Not assigned"}</span><span><MapPin /> <strong>Location</strong>{selected.location || selected.campus?.name || "Not set"}</span><span><Mail /> <strong>Email</strong>{selected.officialEmail || "Not set"}</span><span><Phone /> <strong>Contact</strong>{selected.contactNumber || "Not set"}</span><span><Users /> <strong>Users</strong>{selected._count.studentProfiles + selected._count.staffProfiles}</span><span><MessageCircle /> <strong>Official group</strong>{selected.archivedAt ? "Archived" : "Synchronized"}</span></div><footer><button className="btn btn-secondary" onClick={() => setSelected(null)}>Close</button><button className="btn btn-primary" onClick={() => { setEditing(selected); setSelected(null); }}><Pencil size={16} />Edit</button></footer></aside></div>}
    {editing && <DepartmentEditModal department={editing} onClose={() => setEditing(null)} />}
  </>;
}

function DepartmentEditModal({ department, onClose }: { department: Department; onClose: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState({ code: department.code, name: department.name, shortName: department.shortName ?? "", description: department.description ?? "", hodPublicId: department.hod?.publicId ?? "", officialEmail: department.officialEmail ?? "", contactNumber: department.contactNumber ?? "", location: department.location ?? "" });
  const [error, setError] = useState("");
  const options = useQuery({ queryKey: ["admin", "assignment-options"], queryFn: () => api.get<{ users: Array<{ publicId: string; fullName: string; roles: Array<{ role: { code: string } }> }> }>("/academic/admin/assignments/options") });
  const hods = options.data?.users ?? [];
  const update = useMutation({ mutationFn: () => api.patch(`/academic/departments/${department.id}`, { ...form, hodPublicId: form.hodPublicId || null }), onSuccess: () => { void client.invalidateQueries({ queryKey: ["admin", "departments"] }); onClose(); }, onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Department could not be updated.") });
  return <div className="modal-backdrop"><form className="card modal-panel department-modal" onSubmit={(event) => { event.preventDefault(); update.mutate(); }}><header><div><span className="eyebrow">Department</span><h2>Edit details</h2></div><button type="button" aria-label="Close" onClick={onClose}><X /></button></header>{error && <div className="error-box">{error}</div>}<div className="form-grid"><InputField label="Code" value={form.code} onChange={(code) => setForm({ ...form, code: code.toUpperCase() })} maxLength={30} /><InputField label="Short name" value={form.shortName} onChange={(shortName) => setForm({ ...form, shortName })} /><div className="field full"><label>Department name</label><input className="input" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div><div className="field full"><label>Description</label><textarea className="input" rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div><SelectField label="HOD" options={[{ value: "", label: "Not assigned" }, ...hods.map((hod) => ({ value: hod.publicId, label: hod.fullName }))]} value={form.hodPublicId} onChange={(hodPublicId) => setForm({ ...form, hodPublicId })} optional /><InputField label="Official email" type="email" value={form.officialEmail} onChange={(officialEmail) => setForm({ ...form, officialEmail })} /><InputField label="Contact number" value={form.contactNumber} onChange={(contactNumber) => setForm({ ...form, contactNumber })} /><InputField label="Location" value={form.location} onChange={(location) => setForm({ ...form, location })} /></div><footer><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={update.isPending}>{update.isPending ? "Saving..." : "Save changes"}</button></footer></form></div>;
}

function ProgrammesTable() {
  const query = useQuery({ queryKey: ["admin", "programmes"], queryFn: () => api.get<Programme[]>("/academic/admin/programmes") });
  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState />;
  return <div className="card"><table className="data-table"><thead><tr><th>Code</th><th>Programme</th><th>Department</th><th>Duration</th><th>Semesters</th><th>Students</th><th>Status</th></tr></thead><tbody>{query.data?.map((item) => <tr key={item.id}><td><code>{item.code}</code></td><td>{item.name}</td><td>{item.department.name}</td><td>{item.durationYears} years</td><td>{item._count.semesters}</td><td>{item._count.studentProfiles}</td><td><ToggleButton entityType="programmes" id={item.id} isActive={item.isActive} /></td></tr>)}</tbody></table>{!query.data?.length && <div className="empty">No programmes yet.</div>}</div>;
}

function YearsTable() {
  const query = useQuery({ queryKey: ["admin", "years"], queryFn: () => api.get<AcademicYear[]>("/academic/admin/years") });
  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState />;
  return <div className="card"><table className="data-table"><thead><tr><th>Year</th><th>Start</th><th>End</th><th>Current</th><th>Semesters</th><th>Sessions</th><th>Status</th></tr></thead><tbody>{query.data?.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{new Date(item.startsOn).toLocaleDateString()}</td><td>{new Date(item.endsOn).toLocaleDateString()}</td><td>{item.isCurrent ? <span className="badge badge-success">Current</span> : "—"}</td><td>{item._count.semesters}</td><td>{item._count.attendanceSessions}</td><td><ToggleButton entityType="academicYear" id={item.id} isActive={item.isActive} /></td></tr>)}</tbody></table>{!query.data?.length && <div className="empty">No academic years yet.</div>}</div>;
}

function SemestersTable() {
  const query = useQuery({ queryKey: ["admin", "semesters"], queryFn: () => api.get<Semester[]>("/academic/admin/semesters") });
  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState />;
  return <div className="card"><table className="data-table"><thead><tr><th>Semester</th><th>Programme</th><th>Year</th><th>Sections</th><th>Subjects</th><th>Status</th></tr></thead><tbody>{query.data?.map((item) => <tr key={item.id}><td><strong>Sem {item.number}</strong> <small className="muted">{item.name}</small></td><td>{item.programme.name}</td><td>{item.academicYear.name}</td><td>{item._count.sections}</td><td>{item._count.subjects}</td><td><ToggleButton entityType="semester" id={item.id} isActive={item.isActive} /></td></tr>)}</tbody></table>{!query.data?.length && <div className="empty">No semesters yet.</div>}</div>;
}

function SectionsTable() {
  const [programme, setProgramme] = useState("ALL");
  const [year, setYear] = useState("ALL");
  const [semester, setSemester] = useState("ALL");
  const [active, setActive] = useState("ALL");
  const query = useQuery({ queryKey: ["admin", "sections"], queryFn: () => api.get<Section[]>("/academic/admin/sections") });
  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState />;
  const programmes = uniqueValues(query.data ?? [], (item) => item.semester.programme.id, (item) => item.semester.programme.name);
  const years = uniqueValues(query.data ?? [], (item) => item.semester.academicYear.id, (item) => item.semester.academicYear.name);
  const semesters = uniqueValues(query.data ?? [], (item) => item.semester.id, (item) => item.semester.name);
  const filtered = query.data?.filter((item) => (programme === "ALL" || item.semester.programme.id === programme) && (year === "ALL" || item.semester.academicYear.id === year) && (semester === "ALL" || item.semester.id === semester) && (active === "ALL" || item.isActive === (active === "ACTIVE"))) ?? [];
  
  return (
    <>
      <div className="academic-filters class-filters">
        <FilterSelect label="Programme" value={programme} options={programmes} onChange={setProgramme} />
        <FilterSelect label="Academic year" value={year} options={years} onChange={setYear} />
        <FilterSelect label="Semester" value={semester} options={semesters} onChange={setSemester} />
        <select className="input" aria-label="Section status" value={active} onChange={(event) => setActive(event.target.value)}>
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>
      <div className="class-grid">
        {filtered.map((item) => {
          const maxCapacity = item.capacity ?? 70;
          const students = item._count.studentProfiles;
          const isFull = students >= maxCapacity;
          const isNearFull = students >= maxCapacity * 0.9 && !isFull;
          
          return (
            <article className="class-card" key={item.id}>
              <header>
                <div>
                  <span className="eyebrow">{item.semester.academicYear.name}</span>
                  <h3>{item.displayName || `${item.semester.programme.name} ${item.name}`}</h3>
                </div>
                <ToggleButton entityType="section" id={item.id} isActive={item.isActive} />
              </header>
              <p>{item.semester.programme.name} <ChevronRight size={13} /> {item.semester.name} <ChevronRight size={13} /> Section {item.code}</p>
              <dl>
                <div>
                  <dt>Study year</dt>
                  <dd>{item.studyYear ?? "Not set"}</dd>
                </div>
                <div>
                  <dt>Students</dt>
                  <dd>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: isFull ? "var(--danger)" : isNearFull ? "var(--warning)" : "inherit", fontWeight: isFull ? 600 : "normal" }}>
                        {students} / {maxCapacity}
                      </span>
                      {isFull && <span className="badge badge-danger">Full</span>}
                      {isNearFull && <span className="badge badge-warning">Filling</span>}
                    </div>
                  </dd>
                </div>
                <div>
                  <dt>Class coordinator</dt>
                  <dd>{item.coordinatorAssignments[0]?.coordinator.fullName ?? "Not assigned"}</dd>
                </div>
                <div>
                  <dt>Class representative</dt>
                  <dd>{item.representativeAssignments[0]?.representative.fullName ?? "Not assigned"}</dd>
                </div>
                <div>
                  <dt>Classroom</dt>
                  <dd>{item.assignedRoom ? `${item.assignedRoom.floor.block.name}, ${item.assignedRoom.floor.name}, ${item.assignedRoom.name}` : "Not assigned"}</dd>
                </div>
              </dl>
              <footer>
                <span className={`badge ${item.officialGroupEnabled ? "badge-success" : ""}`}>
                  {item.officialGroupEnabled ? "Official group active" : "Group disabled"}
                </span>
                {item.officialGroupEnabled && (
                  <a className="btn btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--primary)", borderColor: "var(--primary)" }} href={`/messages?search=${encodeURIComponent(item.displayName || `${item.semester.programme.name} ${item.name}`)}`}>
                    <MessageCircle size={16} />Open group
                  </a>
                )}
              </footer>
            </article>
          );
        })}
        {!filtered.length && <div className="empty">No classes match these filters.</div>}
      </div>
    </>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <select className="input" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}><option value="ALL">All {label.toLowerCase()}s</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}

function uniqueValues<T>(items: T[], value: (item: T) => string, label: (item: T) => string) {
  return [...new Map(items.map((item) => [value(item), { value: value(item), label: label(item) }])).values()];
}

function LegacySectionsTable() {
  const query = useQuery({ queryKey: ["admin", "sections"], queryFn: () => api.get<Section[]>("/academic/admin/sections") });
  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState />;
  return <div className="card"><table className="data-table"><thead><tr><th>Code</th><th>Section</th><th>Programme <ChevronRight size={12} /> Semester</th><th>Capacity</th><th>Students</th><th>Sessions</th><th>Status</th></tr></thead><tbody>{query.data?.map((item) => <tr key={item.id}><td><code>{item.code}</code></td><td>{item.name}</td><td><span className="muted">{item.semester.programme.name} › {item.semester.name}</span></td><td>{item.capacity ?? "—"}</td><td>{item._count.studentProfiles}</td><td>{item._count.attendanceSessions}</td><td><ToggleButton entityType="section" id={item.id} isActive={item.isActive} /></td></tr>)}</tbody></table>{!query.data?.length && <div className="empty">No sections yet.</div>}</div>;
}

void LegacySectionsTable;

function SubjectsTable() {
  const query = useQuery({ queryKey: ["admin", "subjects"], queryFn: () => api.get<Subject[]>("/academic/admin/subjects") });
  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState />;
  return <div className="card"><table className="data-table"><thead><tr><th>Code</th><th>Subject</th><th>Programme <ChevronRight size={12} /> Semester</th><th>Faculty</th><th>Sessions</th><th>Status</th></tr></thead><tbody>{query.data?.map((item) => <tr key={item.id}><td><code>{item.code}</code></td><td>{item.name}</td><td><span className="muted">{item.semester.programme.name} › {item.semester.name}</span></td><td>{item._count.facultyAssignments}</td><td>{item._count.attendanceSessions}</td><td><ToggleButton entityType="subject" id={item.id} isActive={item.isActive} /></td></tr>)}</tbody></table>{!query.data?.length && <div className="empty">No subjects yet.</div>}</div>;
}

/* ─── Toggle ─── */

function ToggleButton({ entityType, id, isActive }: { entityType: string; id: string; isActive: boolean }) {
  const client = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => {
      const map: Record<string, string> = { departments: "departments", programmes: "programmes", academicYear: "academicYear", semester: "semester", section: "section", subject: "subject" };
      const mapped = map[entityType] ?? entityType;
      if (mapped === "departments") return api.patch(`/academic/departments/${id}`, { isActive: !isActive });
      if (mapped === "programmes") return api.patch(`/academic/programmes/${id}`, { isActive: !isActive });
      return api.patch(`/academic/${mapped}/${id}/status`, { isActive: !isActive });
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ["admin"] }),
  });
  return <button className="icon-button" title={isActive ? "Deactivate" : "Activate"} onClick={() => toggle.mutate()} disabled={toggle.isPending} style={{ color: isActive ? "var(--success)" : "var(--muted)" }}>{isActive ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}</button>;
}

/* ─── Create form ─── */

function CreateForm({ tab, onCreated }: { tab: StructureTab; onCreated: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const campuses = useQuery({ queryKey: ["campuses"], queryFn: () => api.get<Campus[]>("/locations/campuses") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api.get<{ id: string; code: string; name: string }[]>("/academic/departments") });
  const programmes = useQuery({ queryKey: ["programmes", form.departmentId], queryFn: () => api.get<Array<{ id: string; code: string; name: string; departmentId: string }>>(`/academic/programmes${form.departmentId ? `?departmentId=${form.departmentId}` : ""}`) });
  const years = useQuery({ queryKey: ["years"], queryFn: () => api.get<{ id: string; name: string }[]>("/academic/years") });
  const semesters = useQuery({ queryKey: ["semesters", form.programmeId, form.academicYearId], queryFn: () => api.get<Array<{ id: string; name: string; programmeId: string; academicYearId: string }>>(`/academic/semesters?${new URLSearchParams({ ...(form.programmeId ? { programmeId: form.programmeId } : {}), ...(form.academicYearId ? { academicYearId: form.academicYearId } : {}) })}`) });
  const scopeOptions = useQuery({ queryKey: ["scope-options"], queryFn: () => api.get<{ blocks: Array<{ id: string; name: string }>; floors: Array<{ id: string; name: string; blockId: string }>; rooms: Array<{ id: string; name: string; code: string; floorId: string }> }>("/users/scope-options"), enabled: tab === "sections" });
  const create = useMutation({
    mutationFn: async () => {
      if (tab === "departments") return api.post("/academic/departments", { campusId: form.campusId, code: form.code, name: form.name, shortName: form.shortName || undefined, description: form.description || undefined, officialEmail: form.officialEmail || undefined, contactNumber: form.contactNumber || undefined, location: form.location || undefined });
      if (tab === "programmes") return api.post("/academic/programmes", { departmentId: form.departmentId, code: form.code, name: form.name, degreeType: form.degreeType || undefined, durationYears: Number(form.durationYears ?? 4) });
      if (tab === "years") return api.post("/academic/years", { name: form.name, startsOn: form.startsOn, endsOn: form.endsOn, isCurrent: form.isCurrent === "true" });
      if (tab === "semesters") return api.post("/academic/semesters", { programmeId: form.programmeId, academicYearId: form.academicYearId, number: Number(form.number ?? 1), name: form.name });
      if (tab === "sections") return api.post("/academic/sections", { semesterId: form.semesterId, code: form.code, name: form.name, studyYear: form.studyYear ? Number(form.studyYear) : undefined, displayName: form.displayName || undefined, assignedRoomId: form.roomId || undefined, officialGroupEnabled: form.officialGroupEnabled !== "false", capacity: form.capacity ? Number(form.capacity) : undefined });
      return api.post("/academic/subjects", { semesterId: form.semesterId, code: form.code, name: form.name });
    },
    onSuccess: () => { setForm({}); setError(""); void client.invalidateQueries({ queryKey: ["admin"] }); onCreated(); },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Creation failed."),
  });
  function submit(event: FormEvent) { event.preventDefault(); setError(""); create.mutate(); }

  return <form className="card" style={{ padding: 20, marginBottom: 18, display: "grid", gap: 14, maxWidth: 600 }} onSubmit={submit}>
    <h3 style={{ margin: 0 }}>Add {tab.replace(/s$/, "")}</h3>
    {error && <div className="error-box">{error}</div>}
    {tab === "departments" && <><SelectField label="Campus" options={campuses.data?.map((c) => ({ value: c.id, label: c.name })) ?? []} value={form.campusId ?? ""} onChange={(v) => setForm({ ...form, campusId: v })} /><InputField label="Code" value={form.code ?? ""} onChange={(v) => setForm({ ...form, code: v.toUpperCase() })} maxLength={30} /><InputField label="Short name" value={form.shortName ?? ""} onChange={(v) => setForm({ ...form, shortName: v })} /><InputField label="Name" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} /><InputField label="Official email" type="email" value={form.officialEmail ?? ""} onChange={(v) => setForm({ ...form, officialEmail: v })} /><InputField label="Contact number" value={form.contactNumber ?? ""} onChange={(v) => setForm({ ...form, contactNumber: v })} /><InputField label="Location" value={form.location ?? ""} onChange={(v) => setForm({ ...form, location: v })} /><InputField label="Description" value={form.description ?? ""} onChange={(v) => setForm({ ...form, description: v })} /></>}
    {tab === "programmes" && <><SelectField label="Department" options={departments.data?.map((d) => ({ value: d.id, label: d.name })) ?? []} value={form.departmentId ?? ""} onChange={(v) => setForm({ ...form, departmentId: v })} /><InputField label="Code" value={form.code ?? ""} onChange={(v) => setForm({ ...form, code: v.toUpperCase() })} maxLength={30} /><InputField label="Name" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} /><InputField label="Degree type" value={form.degreeType ?? "B.E."} onChange={(v) => setForm({ ...form, degreeType: v })} /><InputField label="Duration (years)" type="number" value={form.durationYears ?? "4"} onChange={(v) => setForm({ ...form, durationYears: v })} /></>}
    {tab === "years" && <><InputField label="Name (e.g. 2025-26)" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} /><InputField label="Starts on" type="date" value={form.startsOn ?? ""} onChange={(v) => setForm({ ...form, startsOn: v })} /><InputField label="Ends on" type="date" value={form.endsOn ?? ""} onChange={(v) => setForm({ ...form, endsOn: v })} /><label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={form.isCurrent === "true"} onChange={(e) => setForm({ ...form, isCurrent: String(e.target.checked) })} /> Set as current year</label></>}
    {tab === "semesters" && <><SelectField label="Programme" options={programmes.data?.map((p) => ({ value: p.id, label: p.name })) ?? []} value={form.programmeId ?? ""} onChange={(v) => setForm({ ...form, programmeId: v })} /><SelectField label="Academic year" options={years.data?.map((y) => ({ value: y.id, label: y.name })) ?? []} value={form.academicYearId ?? ""} onChange={(v) => setForm({ ...form, academicYearId: v })} /><InputField label="Semester number" type="number" value={form.number ?? "1"} onChange={(v) => setForm({ ...form, number: v })} /><InputField label="Name" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} /></>}
    {tab === "sections" && <><SelectField label="Department" options={departments.data?.map((d) => ({ value: d.id, label: d.name })) ?? []} value={form.departmentId ?? ""} onChange={(v) => setForm({ ...form, departmentId: v, programmeId: "", semesterId: "" })} /><SelectField label="Programme" options={programmes.data?.map((p) => ({ value: p.id, label: p.name })) ?? []} value={form.programmeId ?? ""} onChange={(v) => setForm({ ...form, programmeId: v, semesterId: "" })} /><SelectField label="Academic year" options={years.data?.map((y) => ({ value: y.id, label: y.name })) ?? []} value={form.academicYearId ?? ""} onChange={(v) => setForm({ ...form, academicYearId: v, semesterId: "" })} /><SelectField label="Semester" options={semesters.data?.map((s) => ({ value: s.id, label: s.name })) ?? []} value={form.semesterId ?? ""} onChange={(v) => setForm({ ...form, semesterId: v })} /><InputField label="Study year" type="number" value={form.studyYear ?? "1"} onChange={(v) => setForm({ ...form, studyYear: v })} /><InputField label="Section code" value={form.code ?? ""} onChange={(v) => setForm({ ...form, code: v.toUpperCase() })} maxLength={30} /><InputField label="Section name" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} /><InputField label="Class display name" value={form.displayName ?? ""} onChange={(v) => setForm({ ...form, displayName: v })} /><SelectField label="Block" options={scopeOptions.data?.blocks.map((item) => ({ value: item.id, label: item.name })) ?? []} value={form.blockId ?? ""} onChange={(v) => setForm({ ...form, blockId: v, floorId: "", roomId: "" })} /><SelectField label="Floor" options={scopeOptions.data?.floors.filter((item) => item.blockId === form.blockId).map((item) => ({ value: item.id, label: item.name })) ?? []} value={form.floorId ?? ""} onChange={(v) => setForm({ ...form, floorId: v, roomId: "" })} /><SelectField label="Assigned room" options={scopeOptions.data?.rooms.filter((item) => item.floorId === form.floorId).map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` })) ?? []} value={form.roomId ?? ""} onChange={(v) => setForm({ ...form, roomId: v })} /><InputField label="Capacity" type="number" value={form.capacity ?? ""} onChange={(v) => setForm({ ...form, capacity: v })} /><label className="checkbox-field"><input type="checkbox" checked={form.officialGroupEnabled !== "false"} onChange={(event) => setForm({ ...form, officialGroupEnabled: String(event.target.checked) })} /> Create official class group</label></>}
    {tab === "subjects" && <><SelectField label="Semester" options={semesters.data?.map((s) => ({ value: s.id, label: s.name })) ?? []} value={form.semesterId ?? ""} onChange={(v) => setForm({ ...form, semesterId: v })} /><InputField label="Code" value={form.code ?? ""} onChange={(v) => setForm({ ...form, code: v.toUpperCase() })} maxLength={30} /><InputField label="Name" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} /></>}
    <button className="btn btn-primary" disabled={create.isPending}><Plus size={17} />{create.isPending ? "Creating…" : "Create"}</button>
  </form>;
}

function InputField({ label, value, onChange, type = "text", maxLength }: { label: string; value: string; onChange: (v: string) => void; type?: string; maxLength?: number }) {
  return <div className="field"><label>{label}</label><input className="input" type={type} required value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} /></div>;
}

function SelectField({ label, options, value, onChange, optional = false }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; optional?: boolean }) {
  return <div className="field"><label>{label}</label><select className="input" required={!optional} value={value} onChange={(e) => onChange(e.target.value)}><option value="">{optional ? "Not assigned" : "Select..."}</option>{options.filter((option) => option.value).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>;
}
