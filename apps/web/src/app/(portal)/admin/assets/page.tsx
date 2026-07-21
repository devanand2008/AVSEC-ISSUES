"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { api, ApiError } from "@/lib/api";

interface AssetItem {
  id: string;
  code: string;
  name: string;
  serialNumber: string | null;
  isActive: boolean;
  installedOn: string | null;
  createdAt: string;
  room: { id: string; name: string; code: string; floor: { name: string; block: { name: string; campus: { name: string } } } };
  category: { id: string; name: string };
  _count: { issues: number };
}

interface AssetCategory { id: string; name: string }
interface Room { id: string; code: string; name: string }

export default function AssetsAdminPage() {
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  const assets = useQuery({ queryKey: ["admin", "assets"], queryFn: () => api.get<AssetItem[]>("/assets") });
  const categories = useQuery({ queryKey: ["asset-categories"], queryFn: () => api.get<AssetCategory[]>("/asset-categories"), enabled: creating });

  /* Room search: we need a room selector — use the campus cascade from locations */
  const [campusId, setCampusId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [floorId, setFloorId] = useState("");
  const campuses = useQuery({ queryKey: ["campuses"], queryFn: () => api.get<{ id: string; name: string }[]>("/locations/campuses"), enabled: creating });
  const blocks = useQuery({ queryKey: ["blocks", campusId], queryFn: () => api.get<{ id: string; name: string }[]>(`/locations/blocks?campusId=${campusId}`), enabled: Boolean(campusId) });
  const floors = useQuery({ queryKey: ["floors", blockId], queryFn: () => api.get<{ id: string; name: string }[]>(`/locations/floors?blockId=${blockId}`), enabled: Boolean(blockId) });
  const rooms = useQuery({ queryKey: ["rooms", floorId], queryFn: () => api.get<Room[]>(`/locations/rooms?floorId=${floorId}`), enabled: Boolean(floorId) });

  const [form, setForm] = useState({ roomId: "", categoryId: "", code: "", name: "", serialNumber: "" });
  const createAsset = useMutation({
    mutationFn: () => api.post("/assets", { roomId: form.roomId, categoryId: form.categoryId, code: form.code, name: form.name, serialNumber: form.serialNumber || undefined }),
    onSuccess: () => { setForm({ roomId: "", categoryId: "", code: "", name: "", serialNumber: "" }); setCreating(false); setError(""); void client.invalidateQueries({ queryKey: ["admin", "assets"] }); },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Could not create asset."),
  });

  const toggleAsset = useMutation({
    mutationFn: (item: AssetItem) => api.patch(`/assets/${item.id}/status`, { isActive: !item.isActive }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["admin", "assets"] }),
  });

  function submit(event: FormEvent) { event.preventDefault(); setError(""); createAsset.mutate(); }

  if (assets.isLoading) return <LoadingState />;
  if (assets.isError) return <ErrorState message="Assets could not be loaded." />;

  const data = (assets.data ?? []).filter((a) => !filter || a.name.toLowerCase().includes(filter.toLowerCase()) || a.code.toLowerCase().includes(filter.toLowerCase()) || a.room.name.toLowerCase().includes(filter.toLowerCase()));
  const activeCount = (assets.data ?? []).filter((a) => a.isActive).length;
  const totalIssues = (assets.data ?? []).reduce((sum, a) => sum + a._count.issues, 0);

  return <>
    <div className="page-heading"><div><span className="eyebrow">Campus infrastructure</span><h1 className="page-title" style={{ marginTop: 6 }}>Assets</h1><p className="page-subtitle">Track physical assets across campus rooms and labs.</p></div><button className="btn btn-primary" onClick={() => setCreating(!creating)}><Plus size={17} />{creating ? "Cancel" : "Add asset"}</button></div>

    <section className="metric-grid" style={{ marginBottom: 18 }}>
      <article className="card metric-card"><span className="metric-icon" style={{ color: "#6366f1", background: "#eef2ff" }}><Box size={21} /></span><div><span className="muted">Total assets</span><strong>{assets.data?.length ?? 0}</strong></div></article>
      <article className="card metric-card"><span className="metric-icon" style={{ color: "#16a34a", background: "#f0fdf4" }}><Box size={21} /></span><div><span className="muted">Active</span><strong>{activeCount}</strong></div></article>
      <article className="card metric-card"><span className="metric-icon" style={{ color: "#d97706", background: "#fff7ed" }}><Box size={21} /></span><div><span className="muted">Linked issues</span><strong>{totalIssues}</strong></div></article>
    </section>

    {creating && <form className="card" style={{ padding: 20, marginBottom: 18, display: "grid", gap: 14, maxWidth: 600 }} onSubmit={submit}>
      <h3 style={{ margin: 0 }}>Register new asset</h3>
      {error && <div className="error-box">{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        <div className="field"><label>Campus</label><select className="input" value={campusId} onChange={(e) => { setCampusId(e.target.value); setBlockId(""); setFloorId(""); setForm({ ...form, roomId: "" }); }}><option value="">Select…</option>{campuses.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>Block</label><select className="input" value={blockId} onChange={(e) => { setBlockId(e.target.value); setFloorId(""); setForm({ ...form, roomId: "" }); }} disabled={!campusId}><option value="">Select…</option>{blocks.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div className="field"><label>Floor</label><select className="input" value={floorId} onChange={(e) => { setFloorId(e.target.value); setForm({ ...form, roomId: "" }); }} disabled={!blockId}><option value="">Select…</option>{floors.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div className="field"><label>Room</label><select className="input" required value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })} disabled={!floorId}><option value="">Select…</option>{rooms.data?.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}</select></div>
        <div className="field"><label>Category</label><select className="input" required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">Select…</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        <div className="field"><label>Code</label><input className="input" required maxLength={60} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="AC-001" /></div>
        <div className="field"><label>Name</label><input className="input" required maxLength={160} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Split AC Unit" /></div>
        <div className="field"><label>Serial no. <small className="muted">(opt.)</small></label><input className="input" maxLength={120} value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} /></div>
      </div>
      <button className="btn btn-primary" disabled={createAsset.isPending}><Plus size={17} />{createAsset.isPending ? "Creating…" : "Register asset"}</button>
    </form>}

    <section className="card">
      <div className="section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><h2>All assets</h2><p>{data.length} asset{data.length !== 1 ? "s" : ""} found</p></div><input className="input" style={{ maxWidth: 260 }} placeholder="Filter by name, code, room…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      {data.length === 0 ? <div className="empty" style={{ padding: 40 }}>No assets found{filter ? " matching your filter" : ""}.</div> : <table className="data-table"><thead><tr><th>Code</th><th>Asset</th><th>Category</th><th>Location</th><th>Serial</th><th>Issues</th><th>Registered</th><th>Status</th></tr></thead><tbody>
        {data.map((a) => <tr key={a.id}>
          <td><code>{a.code}</code></td>
          <td><strong>{a.name}</strong></td>
          <td>{a.category.name}</td>
          <td><span className="muted">{a.room.floor.block.campus.name} › {a.room.floor.block.name} › {a.room.floor.name} ›</span> {a.room.name}</td>
          <td className="muted">{a.serialNumber || "—"}</td>
          <td>{a._count.issues}</td>
          <td className="muted">{new Date(a.createdAt).toLocaleDateString()}</td>
          <td><button className="icon-button" title={a.isActive ? "Deactivate" : "Activate"} onClick={() => toggleAsset.mutate(a)} disabled={toggleAsset.isPending} style={{ color: a.isActive ? "var(--success)" : "var(--muted)" }}>{a.isActive ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}</button></td>
        </tr>)}
      </tbody></table>}
    </section>
  </>;
}
