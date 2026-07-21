"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

interface Permission { id: string; code: string; resource: string; action: string; description: string | null }
interface Role { code: string; name: string; description: string | null; isSystem: boolean; permissions: Array<{ permission: { code: string } }> }
interface RoleForm { code: string; name: string; description: string; permissionCodes: string[]; reason: string }
const blank: RoleForm = { code: "", name: "", description: "", permissionCodes: [], reason: "Initial role configuration" };

export default function RolesPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const [form, setForm] = useState<RoleForm>(blank);
  const [error, setError] = useState("");
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api.get<Role[]>("/roles") });
  const permissions = useQuery({ queryKey: ["permissions"], queryFn: () => api.get<Permission[]>("/permissions") });
  const grouped = useMemo(() => Object.groupBy(permissions.data ?? [], (permission) => permission.resource), [permissions.data]);
  const save = useMutation({
    mutationFn: () => editing === "new"
      ? api.post("/roles", { code: form.code, name: form.name, description: form.description || undefined, permissionCodes: form.permissionCodes })
      : api.patch(`/roles/${editing?.code}`, { name: form.name, description: form.description || undefined, permissionCodes: form.permissionCodes, reason: form.reason }),
    onSuccess: () => { setEditing(null); setForm(blank); void client.invalidateQueries({ queryKey: ["roles"] }); },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "The role could not be saved."),
  });

  function openRole(role: Role) {
    setError("");
    setEditing(role);
    setForm({ code: role.code, name: role.name, description: role.description ?? "", permissionCodes: role.permissions.map((entry) => entry.permission.code), reason: "Permission review" });
  }
  function toggle(code: string) {
    setForm((value) => ({ ...value, permissionCodes: value.permissionCodes.includes(code) ? value.permissionCodes.filter((item) => item !== code) : [...value.permissionCodes, code] }));
  }
  function submit(event: FormEvent) { event.preventDefault(); setError(""); save.mutate(); }
  const systemEditable = user?.roles.includes("SUPER_ADMIN") ?? false;

  return <>
    <div className="page-heading"><div><span className="eyebrow">Access control</span><h1 className="page-title" style={{ marginTop: 6 }}>Roles & permissions</h1><p className="page-subtitle">Configure reusable permission sets. User scopes are assigned separately.</p></div><button className="btn btn-primary" onClick={() => { setEditing("new"); setForm(blank); }}><Plus size={18} />New role</button></div>
    {roles.isLoading || permissions.isLoading ? <LoadingState /> : roles.isError || permissions.isError ? <ErrorState message="You do not have permission to manage roles." /> : !roles.data?.length ? <EmptyState title="No roles configured" /> : <div className="card table-wrap"><table><thead><tr><th>Role</th><th>Code</th><th>Type</th><th>Permissions</th><th /></tr></thead><tbody>{roles.data.map((role) => <tr key={role.code}><td><strong>{role.name}</strong><small className="muted" style={{ display: "block" }}>{role.description ?? "No description"}</small></td><td>{role.code}</td><td>{role.isSystem ? "System" : "Custom"}</td><td>{role.permissions.length}</td><td><button className="btn btn-secondary" disabled={role.isSystem && !systemEditable} onClick={() => openRole(role)}>Edit</button></td></tr>)}</tbody></table></div>}
    {editing && <div className="modal-backdrop"><form className="card modal-panel" onSubmit={submit} style={{ maxWidth: 920 }}><header><div><span className="eyebrow">Access policy</span><h2>{editing === "new" ? "Create role" : `Edit ${editing.name}`}</h2></div><button type="button" onClick={() => setEditing(null)} aria-label="Close"><X /></button></header>{error && <div className="error-box">{error}</div>}<div className="form-grid"><div className="field"><label>Role name</label><input className="input" required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div><div className="field"><label>Role code</label><input className="input" required pattern="[A-Z][A-Z0-9_]{2,59}" disabled={editing !== "new"} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })} /></div><div className="field form-span"><label>Description</label><textarea className="input" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div>{editing !== "new" && <div className="field form-span"><label>Change reason</label><input className="input" required minLength={3} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></div>}</div><section><h3><ShieldCheck size={18} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />Permissions</h3><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>{Object.entries(grouped).map(([resource, entries]) => <fieldset className="card" style={{ padding: 14 }} key={resource}><legend style={{ fontWeight: 750, padding: "0 6px" }}>{resource.replaceAll("_", " ")}</legend>{entries?.map((permission) => <label key={permission.code} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "7px 0" }}><input type="checkbox" checked={form.permissionCodes.includes(permission.code)} onChange={() => toggle(permission.code)} /><span><strong style={{ display: "block", fontSize: 13 }}>{permission.action.replaceAll("_", " ")}</strong><small className="muted">{permission.code}</small></span></label>)}</fieldset>)}</div></section><footer><button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" disabled={save.isPending || !form.permissionCodes.length}>{save.isPending ? "Saving…" : "Save role"}</button></footer></form></div>}
  </>;
}
