"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Plus, ShieldCheck, UserRoundCog, Wrench } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

interface Option { id: string; code: string; name: string }
interface Floor extends Option { blockId: string }
interface Room extends Option { floorId: string }
interface ScopeOptions { campuses: Option[]; blocks: Array<Option & { campusId: string }>; floors: Floor[]; rooms: Room[]; issueCategories: Option[] }
interface MaintenanceUser { publicId: string; collegeIdentityId: string; fullName: string; email: string | null; mobile: string | null; status: string; mustChangePassword: boolean; roles: Array<{ role: { code: string; name: string } }>; staffProfile: { employeeId: string; specialization: string | null; shift: string | null } | null }

const ROLES = [
  ["MAINTENANCE_ADMIN", "Maintenance Admin"], ["MAINTENANCE_SUPERVISOR", "Maintenance Supervisor"], ["ELECTRICIAN", "Electrician"], ["PLUMBER", "Plumber"], ["IT_SUPPORT", "IT Support"], ["LAB_TECHNICIAN", "Laboratory Technician"], ["HOUSEKEEPING", "Housekeeping"], ["SECURITY", "Security"], ["MAINTENANCE_STAFF", "General Maintenance Staff"], ["OTHER_RESPONSIBLE", "Other Responsible Person"],
] as const;

export default function MaintenanceStaffPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ roleCode: "MAINTENANCE_STAFF", accountStatus: "ACTIVE" });
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const options = useQuery({ queryKey: ["scope-options"], queryFn: () => api.get<ScopeOptions>("/users/scope-options") });
  const staff = useQuery({ queryKey: ["maintenance-staff"], queryFn: () => api.get<MaintenanceUser[]>("/maintenance-staff") });
  const create = useMutation({
    mutationFn: () => api.post("/maintenance-staff", { ...form, roomIds, issueCategoryIds: categoryIds }),
    onSuccess: () => { setForm({ roleCode: "MAINTENANCE_STAFF", accountStatus: "ACTIVE" }); setRoomIds([]); setCategoryIds([]); setError(""); setShowForm(false); void client.invalidateQueries({ queryKey: ["maintenance-staff"] }); },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "The maintenance account could not be created."),
  });
  function submit(event: FormEvent) { event.preventDefault(); create.mutate(); }
  const blocks = options.data?.blocks.filter((block) => block.campusId === form.campusId) ?? [];
  const floors = options.data?.floors.filter((floor) => floor.blockId === form.blockId) ?? [];
  const rooms = options.data?.rooms.filter((room) => room.floorId === form.floorId) ?? [];

  return <>
    <div className="page-heading"><div><span className="eyebrow">User management</span><h1 className="page-title">Maintenance staff</h1><p className="page-subtitle">Create operational accounts with controlled location and issue access.</p></div><div className="heading-actions">{user?.permissions.includes("users.import") && <Link className="btn btn-secondary" href="/admin/imports"><FileUp size={17} />Excel import</Link>}<button className="btn btn-primary" onClick={() => setShowForm((value) => !value)}><Plus size={17} />{showForm ? "Cancel" : "Add staff"}</button></div></div>
    {showForm && <form className="maintenance-form" onSubmit={submit}><header><Wrench /><div><h2>New maintenance account</h2><p>The temporary password must be changed at first login.</p></div></header>{error && <div className="error-box">{error}</div>}<div className="form-grid"><Field label="Employee ID" value={form.employeeId} onChange={(employeeId) => setForm({ ...form, employeeId })} /><Field label="Full name" value={form.fullName} onChange={(fullName) => setForm({ ...form, fullName })} /><Field label="Email" type="email" optional value={form.email} onChange={(email) => setForm({ ...form, email })} /><Field label="Mobile number" type="tel" value={form.mobile} onChange={(mobile) => setForm({ ...form, mobile })} /><Field label="WhatsApp number" type="tel" optional value={form.whatsappNumber} onChange={(whatsappNumber) => setForm({ ...form, whatsappNumber })} /><Select label="Role" value={form.roleCode} options={ROLES.map(([value, label]) => ({ value, label }))} onChange={(roleCode) => setForm({ ...form, roleCode })} /><Field label="Specialization" optional value={form.specialization} onChange={(specialization) => setForm({ ...form, specialization })} /><Field label="Shift" optional value={form.shift} onChange={(shift) => setForm({ ...form, shift })} /><Select label="Campus" value={form.campusId} options={options.data?.campuses.map(toOption) ?? []} onChange={(campusId) => { setForm({ ...form, campusId, blockId: "", floorId: "" }); setRoomIds([]); }} /><Select label="Block" optional value={form.blockId} options={blocks.map(toOption)} onChange={(blockId) => { setForm({ ...form, blockId, floorId: "" }); setRoomIds([]); }} /><Select label="Floor" optional value={form.floorId} options={floors.map(toOption)} onChange={(floorId) => { setForm({ ...form, floorId }); setRoomIds([]); }} /><Field label="Emergency contact" type="tel" optional value={form.emergencyContact} onChange={(emergencyContact) => setForm({ ...form, emergencyContact })} /><Field label="Temporary password" type="password" value={form.temporaryPassword} onChange={(temporaryPassword) => setForm({ ...form, temporaryPassword })} /><Select label="Account status" value={form.accountStatus} options={[{ value: "ACTIVE", label: "Active" }, { value: "PENDING", label: "Pending" }]} onChange={(accountStatus) => setForm({ ...form, accountStatus })} /></div><ChoiceGrid title="Assigned rooms" items={rooms} selected={roomIds} onChange={setRoomIds} /><ChoiceGrid title="Issue responsibilities" items={options.data?.issueCategories ?? []} selected={categoryIds} onChange={setCategoryIds} /><footer><button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button><button className="btn btn-primary" disabled={create.isPending}><UserRoundCog size={17} />{create.isPending ? "Creating..." : "Create account"}</button></footer></form>}
    {staff.isLoading ? <LoadingState /> : staff.isError ? <ErrorState /> : <div className="maintenance-grid">{staff.data?.map((person) => <article key={person.publicId}><header><span className="avatar">{person.fullName[0]}</span><div><h3>{person.fullName}</h3><p>{person.collegeIdentityId}</p></div><span className={`badge ${person.status === "ACTIVE" ? "badge-success" : "badge-warning"}`}>{person.status}</span></header><dl><div><dt>Role</dt><dd>{person.roles.map((entry) => entry.role.name).join(", ")}</dd></div><div><dt>Specialization</dt><dd>{person.staffProfile?.specialization || "General"}</dd></div><div><dt>Shift</dt><dd>{person.staffProfile?.shift || "Not assigned"}</dd></div><div><dt>Mobile</dt><dd>{person.mobile || "Not provided"}</dd></div></dl>{person.mustChangePassword && <footer><ShieldCheck size={15} />Password change required</footer>}</article>)}{!staff.data?.length && <div className="empty">No maintenance staff accounts have been created.</div>}</div>}
  </>;
}

function Field({ label, value = "", onChange, type = "text", optional = false }: { label: string; value?: string; onChange: (value: string) => void; type?: string; optional?: boolean }) { return <div className="field"><label>{label}</label><input className="input" type={type} required={!optional} value={value} onChange={(event) => onChange(event.target.value)} /></div>; }
function Select({ label, value = "", options, onChange, optional = false }: { label: string; value?: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; optional?: boolean }) { return <div className="field"><label>{label}</label><select className="input" required={!optional} value={value} onChange={(event) => onChange(event.target.value)}><option value="">{optional ? "Not assigned" : "Select..."}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>; }
function ChoiceGrid({ title, items, selected, onChange }: { title: string; items: Option[]; selected: string[]; onChange: (value: string[]) => void }) { return <fieldset className="choice-grid"><legend>{title}</legend>{items.length ? items.map((item) => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => onChange(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} /><span>{item.code}</span>{item.name}</label>) : <small>No matching options.</small>}</fieldset>; }
function toOption(item: Option) { return { value: item.id, label: `${item.code} - ${item.name}` }; }
