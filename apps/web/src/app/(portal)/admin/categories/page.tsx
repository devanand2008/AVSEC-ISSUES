"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FolderOpen, Plus, Tag, ToggleLeft, ToggleRight } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { api, ApiError } from "@/lib/api";

interface Category { id: string; code: string; name: string; description: string | null; icon: string | null; isActive: boolean; sortOrder: number; _count: { issueTypes: number; issues: number; rules: number } }
interface IssueType { id: string; code: string; name: string; defaultPriority: string | null; isOther: boolean; isActive: boolean; sortOrder: number; category: { id: string; name: string }; _count: { issues: number } }

export default function CategoriesAdminPage() {
  const client = useQueryClient();
  const [tab, setTab] = useState<"categories" | "types">("categories");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const categories = useQuery({ queryKey: ["admin", "categories"], queryFn: () => api.get<Category[]>("/issue-categories/admin") });
  const types = useQuery({ queryKey: ["admin", "issue-types"], queryFn: () => api.get<IssueType[]>("/issue-types/admin"), enabled: tab === "types" });

  const toggleCategory = useMutation({
    mutationFn: (item: Category) => api.patch(`/issue-categories/${item.id}`, { isActive: !item.isActive }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["admin"] }),
  });

  const toggleType = useMutation({
    mutationFn: (item: IssueType) => api.patch(`/issue-types/${item.id}`, { isActive: !item.isActive }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["admin"] }),
  });

  /* ─── Create forms ─── */

  const [catForm, setCatForm] = useState({ code: "", name: "", description: "" });
  const createCategory = useMutation({
    mutationFn: () => api.post("/issue-categories", { code: catForm.code, name: catForm.name, description: catForm.description || undefined }),
    onSuccess: () => { setCatForm({ code: "", name: "", description: "" }); setCreating(false); setError(""); void client.invalidateQueries({ queryKey: ["admin"] }); },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Creation failed."),
  });

  const [typeForm, setTypeForm] = useState({ categoryId: "", code: "", name: "", defaultPriority: "MEDIUM" });
  const createType = useMutation({
    mutationFn: () => api.post("/issue-types", { categoryId: typeForm.categoryId, code: typeForm.code, name: typeForm.name, defaultPriority: typeForm.defaultPriority }),
    onSuccess: () => { setTypeForm({ categoryId: "", code: "", name: "", defaultPriority: "MEDIUM" }); setCreating(false); setError(""); void client.invalidateQueries({ queryKey: ["admin"] }); },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Creation failed."),
  });

  function submitCategory(event: FormEvent) { event.preventDefault(); setError(""); createCategory.mutate(); }
  function submitType(event: FormEvent) { event.preventDefault(); setError(""); createType.mutate(); }

  if (categories.isLoading) return <LoadingState />;
  if (categories.isError) return <ErrorState />;

  return <>
    <div className="page-heading"><div><span className="eyebrow">Issue configuration</span><h1 className="page-title" style={{ marginTop: 6 }}>Categories & common problems</h1><p className="page-subtitle">Manage issue categories and their common problem types used in the report wizard.</p></div><button className="btn btn-primary" onClick={() => setCreating(!creating)}><Plus size={17} />{creating ? "Cancel" : "Add new"}</button></div>

    <div className="tab-bar" style={{ marginBottom: 18 }}>
      <button className={`tab-item ${tab === "categories" ? "active" : ""}`} onClick={() => { setTab("categories"); setCreating(false); }}><FolderOpen size={16} />Categories</button>
      <button className={`tab-item ${tab === "types" ? "active" : ""}`} onClick={() => { setTab("types"); setCreating(false); }}><Tag size={16} />Common problems</button>
    </div>

    {creating && tab === "categories" && <form className="card" style={{ padding: 20, marginBottom: 18, display: "grid", gap: 14, maxWidth: 500 }} onSubmit={submitCategory}>
      <h3 style={{ margin: 0 }}>New issue category</h3>
      {error && <div className="error-box">{error}</div>}
      <div className="field"><label>Code</label><input className="input" required maxLength={50} value={catForm.code} onChange={(e) => setCatForm({ ...catForm, code: e.target.value.toUpperCase() })} /></div>
      <div className="field"><label>Name</label><input className="input" required value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} /></div>
      <div className="field"><label>Description (optional)</label><textarea className="input" rows={2} value={catForm.description} onChange={(e) => setCatForm({ ...catForm, description: e.target.value })} /></div>
      <button className="btn btn-primary" disabled={createCategory.isPending}><Plus size={17} />{createCategory.isPending ? "Creating…" : "Create category"}</button>
    </form>}

    {creating && tab === "types" && <form className="card" style={{ padding: 20, marginBottom: 18, display: "grid", gap: 14, maxWidth: 500 }} onSubmit={submitType}>
      <h3 style={{ margin: 0 }}>New common problem</h3>
      {error && <div className="error-box">{error}</div>}
      <div className="field"><label>Category</label><select className="input" required value={typeForm.categoryId} onChange={(e) => setTypeForm({ ...typeForm, categoryId: e.target.value })}><option value="">Select…</option>{categories.data?.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="field"><label>Code</label><input className="input" required maxLength={60} value={typeForm.code} onChange={(e) => setTypeForm({ ...typeForm, code: e.target.value.toUpperCase() })} /></div>
      <div className="field"><label>Name</label><input className="input" required value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} /></div>
      <div className="field"><label>Default priority</label><select className="input" value={typeForm.defaultPriority} onChange={(e) => setTypeForm({ ...typeForm, defaultPriority: e.target.value })}>{["LOW", "MEDIUM", "HIGH", "CRITICAL", "EMERGENCY"].map((p) => <option key={p}>{p}</option>)}</select></div>
      <button className="btn btn-primary" disabled={createType.isPending}><Plus size={17} />{createType.isPending ? "Creating…" : "Create problem type"}</button>
    </form>}

    {tab === "categories" && <div className="card"><table className="data-table"><thead><tr><th>Code</th><th>Category</th><th>Description</th><th>Problem types</th><th>Issues</th><th>Routing rules</th><th>Status</th></tr></thead><tbody>
      {categories.data?.map((cat) => <tr key={cat.id}>
        <td><code>{cat.code}</code></td>
        <td><strong>{cat.name}</strong></td>
        <td className="muted">{cat.description || "—"}</td>
        <td>{cat._count.issueTypes}</td>
        <td>{cat._count.issues}</td>
        <td>{cat._count.rules}</td>
        <td><button className="icon-button" title={cat.isActive ? "Deactivate" : "Activate"} onClick={() => toggleCategory.mutate(cat)} disabled={toggleCategory.isPending} style={{ color: cat.isActive ? "var(--success)" : "var(--muted)" }}>{cat.isActive ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}</button></td>
      </tr>)}
    </tbody></table>{!categories.data?.length && <div className="empty">No issue categories configured yet.</div>}</div>}

    {tab === "types" && (types.isLoading ? <LoadingState /> : types.isError ? <ErrorState /> : <div className="card"><table className="data-table"><thead><tr><th>Code</th><th>Problem</th><th>Category</th><th>Priority</th><th>Issues</th><th>Other?</th><th>Status</th></tr></thead><tbody>
      {types.data?.map((t) => <tr key={t.id}>
        <td><code>{t.code}</code></td>
        <td><strong>{t.name}</strong></td>
        <td className="muted">{t.category.name}</td>
        <td>{t.defaultPriority ? <StatusBadge value={t.defaultPriority} /> : "—"}</td>
        <td>{t._count.issues}</td>
        <td>{t.isOther ? <AlertTriangle size={14} style={{ color: "var(--warning)" }} /> : "—"}</td>
        <td><button className="icon-button" title={t.isActive ? "Deactivate" : "Activate"} onClick={() => toggleType.mutate(t)} disabled={toggleType.isPending} style={{ color: t.isActive ? "var(--success)" : "var(--muted)" }}>{t.isActive ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}</button></td>
      </tr>)}
    </tbody></table>{!types.data?.length && <div className="empty">No common problems configured yet.</div>}</div>)}
  </>;
}
