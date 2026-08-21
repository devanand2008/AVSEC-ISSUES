"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, Building2, ChevronRight, DoorOpen, FlaskConical, Layers3,
  MapPin, Plus, QrCode, RotateCcw, ShieldCheck, Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { PageHeader } from "@/components/ui/page-header";
import { SearchBar } from "@/components/ui/search-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { api, ApiError } from "@/lib/api";
import type { SelectOption } from "@/lib/types";

type ManagedKind = "campus" | "block" | "floor" | "room";
type CreateKind = ManagedKind;
interface ManagedLocation extends SelectOption {
  isActive: boolean;
  isTestData: boolean;
  archivedAt: string | null;
}
interface DependencyReport {
  canDelete: boolean;
  totalDependencies: number;
  dependencies: Record<string, number>;
  message: string;
}

const ROOM_TYPES = [
  "CLASSROOM", "LABORATORY", "SEMINAR_HALL", "AUDITORIUM", "STAFF_ROOM",
  "HOD_ROOM", "PRINCIPAL_OFFICE", "ADMINISTRATIVE_OFFICE", "LIBRARY",
  "WORKSHOP", "RESTROOM", "CANTEEN", "HOSTEL_ROOM", "CORRIDOR",
  "STAIRCASE", "PARKING_AREA", "PLAYGROUND", "OTHER",
];

function emptyLocationForm() {
  return {
    code: "",
    name: "",
    level: 1,
    roomType: "CLASSROOM",
    roomNumber: "",
    capacity: "",
  };
}

export default function LocationsAdminPage() {
  const client = useQueryClient();
  const [campusId, setCampus] = useState("");
  const [blockId, setBlock] = useState("");
  const [floorId, setFloor] = useState("");
  const [search, setSearch] = useState("");

  // Create form
  const [kind, setKind] = useState<CreateKind>("campus");
  const [form, setForm] = useState(emptyLocationForm());
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  // Management panel
  const [managedKind, setManagedKind] = useState<ManagedKind>("campus");
  const [managedStatus, setManagedStatus] = useState("ALL");
  const [dependency, setDependency] = useState<{ record: ManagedLocation; report: DependencyReport } | null>(null);

  const campuses = useQuery({ queryKey: ["campuses"], queryFn: () => api.get<SelectOption[]>("/locations/campuses") });
  const blocks = useQuery({ queryKey: ["blocks", campusId], queryFn: () => api.get<SelectOption[]>(`/locations/blocks?campusId=${campusId}`), enabled: Boolean(campusId) });
  const floors = useQuery({ queryKey: ["floors", blockId], queryFn: () => api.get<SelectOption[]>(`/locations/floors?blockId=${blockId}`), enabled: Boolean(blockId) });
  const rooms = useQuery({ queryKey: ["rooms", floorId], queryFn: () => api.get<Array<SelectOption & { roomType: string }>>(`/locations/rooms?floorId=${floorId}`), enabled: Boolean(floorId) });

  const create = useMutation({
    mutationFn: () => {
      if (kind === "campus") return api.post("/admin/campuses", { code: form.code, name: form.name });
      if (kind === "block") return api.post("/locations/blocks", { campusId, code: form.code, name: form.name });
      if (kind === "floor") return api.post("/locations/floors", { blockId, code: form.code, name: form.name, level: form.level });
      return api.post("/locations/rooms", {
        floorId,
        code: form.code,
        name: form.name,
        roomType: form.roomType.replaceAll(" ", "_"),
        ...(form.roomNumber.trim() ? { roomNumber: form.roomNumber.trim() } : {}),
        ...(form.capacity.trim() ? { capacity: Number(form.capacity) } : {}),
      });
    },
    onSuccess: () => {
      setForm(emptyLocationForm());
      setShowCreate(false);
      void client.invalidateQueries({ queryKey: [kind === "campus" ? "campuses" : kind === "block" ? "blocks" : kind === "floor" ? "floors" : "rooms"] });
      void client.invalidateQueries({ queryKey: ["managed-locations"] });
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Location could not be created."),
  });

  const managedPlural = managedKind === "campus" ? "campuses" : `${managedKind}s`;
  const managed = useQuery({
    queryKey: ["managed-locations", managedKind, managedStatus],
    queryFn: () => api.get<ManagedLocation[]>(`/admin/${managedPlural}${managedStatus === "ALL" ? "" : `?status=${managedStatus}`}`),
  });
  const refreshManaged = () => client.invalidateQueries({ queryKey: ["managed-locations"] });
  const manage = useMutation({
    mutationFn: async ({ action, record }: { action: "archive" | "restore" | "test" | "dependencies" | "delete"; record: ManagedLocation }) => {
      if (action === "archive") return api.post(`/admin/${managedPlural}/${record.id}/archive`, { reason: window.prompt("Archive reason") || "Archived from Campus Setup" });
      if (action === "restore") return api.post(`/admin/${managedPlural}/${record.id}/restore`);
      if (action === "test") return api.patch(`/admin/${managedPlural}/${record.id}`, { isTestData: !record.isTestData });
      const report = await api.get<DependencyReport>(`/admin/${managedPlural}/${record.id}/dependencies`);
      if (action === "dependencies") return { report, record };
      if (!record.isTestData) throw new Error("Mark this record as Test Data before using Delete Test Data Safely.");
      if (!report.canDelete) return { report, record };
      if (!window.confirm(`Permanently delete test location ${record.name}? This cannot be undone.`)) return { report, record };
      return api.delete(`/admin/${managedPlural}/${record.id}`, { reason: "Permanently deleting verified test data.", confirmationPhrase: "PERMANENTLY DELETE LOCATION" });
    },
    onSuccess: (result) => {
      if (result && typeof result === "object" && "report" in result) setDependency(result as { record: ManagedLocation; report: DependencyReport });
      void refreshManaged();
    },
    onError: (caught: unknown) =>
      setError(caught instanceof Error ? caught.message : "Location action failed."),
  });

  function openCreate(nextKind: CreateKind, roomType = "CLASSROOM") {
    setKind(nextKind);
    setForm({ ...emptyLocationForm(), roomType });
    setError("");
    setShowCreate(true);
  }

  function submit(event: FormEvent) { event.preventDefault(); setError(""); create.mutate(); }

  // Build breadcrumb trail
  const selectedCampus = campuses.data?.find((c) => c.id === campusId);
  const selectedBlock = blocks.data?.find((b) => b.id === blockId);
  const selectedFloor = floors.data?.find((f) => f.id === floorId);

  const breadcrumbParts = [
    { label: "All Campuses", onClick: () => { setCampus(""); setBlock(""); setFloor(""); } },
    ...(selectedCampus ? [{ label: selectedCampus.name, onClick: () => { setBlock(""); setFloor(""); } }] : []),
    ...(selectedBlock ? [{ label: selectedBlock.name, onClick: () => { setFloor(""); } }] : []),
    ...(selectedFloor ? [{ label: selectedFloor.name }] : []),
  ];

  // Filter helper
  function filterBySearch<T extends SelectOption>(items: T[] | undefined): T[] {
    if (!items) return [];
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.code?.toLowerCase().includes(q) ?? false),
    );
  }

  // Determine what level to show
  const currentLevel = floorId ? "room" : blockId ? "floor" : campusId ? "block" : "campus";
  const createDisabled = kind === "campus" ? false : kind === "block" ? !campusId : kind === "floor" ? !blockId : !floorId;
  const createLabel = kind === "room" && form.roomType === "LABORATORY" ? "lab" : kind;

  if (campuses.isLoading) return <LoadingState />;
  if (campuses.isError) return <ErrorState />;

  return <>
    <PageHeader
      title="Campus Setup"
      description="Build and manage the campus -> block -> floor -> room and lab hierarchy."
      breadcrumbs={[{ label: "Admin" }, { label: "Campus Setup" }]}
      actions={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {floorId && <Link className="avs-btn avs-btn-secondary" href={`/admin/locations/qr-sheet?floorId=${floorId}`}><QrCode size={16} />Print QR Sheet</Link>}
          {currentLevel !== "campus" && <button className="avs-btn avs-btn-secondary" type="button" onClick={() => openCreate("campus")}><MapPin size={16} />Add Campus</button>}
          {currentLevel === "campus" && <button className="avs-btn avs-btn-primary" type="button" onClick={() => openCreate("campus")}><Plus size={16} />Add Campus</button>}
          {currentLevel === "block" && <button className="avs-btn avs-btn-primary" type="button" onClick={() => openCreate("block")}><Plus size={16} />Add Block</button>}
          {currentLevel === "floor" && <button className="avs-btn avs-btn-primary" type="button" onClick={() => openCreate("floor")}><Plus size={16} />Add Floor</button>}
          {currentLevel === "room" && <button className="avs-btn avs-btn-secondary" type="button" onClick={() => openCreate("room", "CLASSROOM")}><DoorOpen size={16} />Add Room</button>}
          {currentLevel === "room" && <button className="avs-btn avs-btn-primary" type="button" onClick={() => openCreate("room", "LABORATORY")}><FlaskConical size={16} />Add Lab</button>}
        </div>
      }
    />

    {/* Breadcrumb trail */}
    <nav className="avs-card" style={{ padding: "12px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: "0.9rem" }}>
      {breadcrumbParts.map((part, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {i > 0 && <ChevronRight size={14} style={{ color: "var(--muted)" }} />}
          {"onClick" in part ? (
            <button onClick={part.onClick} style={{ background: "none", border: "none", color: i === breadcrumbParts.length - 1 ? "var(--text)" : "var(--primary)", cursor: "pointer", fontWeight: i === breadcrumbParts.length - 1 ? 600 : 500, padding: 0 }}>
              {part.label}
            </button>
          ) : (
            <span style={{ fontWeight: 600 }}>{part.label}</span>
          )}
        </span>
      ))}
    </nav>

    {/* Search */}
    <div style={{ marginBottom: 16 }}>
      <SearchBar value={search} onChange={setSearch} placeholder={`Search ${currentLevel}s...`} />
    </div>

    {/* Hierarchy Cards Grid */}
    <section style={{ marginBottom: 24 }}>
      {currentLevel === "campus" && (
        <div className="grid grid-auto-fit gap-4">
          {filterBySearch(campuses.data).map((campus) => (
            <button key={campus.id} className="avs-card" onClick={() => setCampus(campus.id)} style={{ cursor: "pointer", padding: 20, textAlign: "left", border: "none", width: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: "var(--very-light-blue)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <MapPin size={22} />
                </div>
                <div>
                  <strong style={{ display: "block", fontSize: "1rem" }}>{campus.name}</strong>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>{campus.code}</span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: 12, color: "var(--primary)", fontSize: "0.85rem", fontWeight: 600, gap: 4 }}>
                View blocks <ChevronRight size={14} />
              </div>
            </button>
          ))}
          {!filterBySearch(campuses.data).length && <EmptyState title="No campuses" description={search ? "No campuses match your search." : "No campuses have been created yet."} />}
        </div>
      )}

      {currentLevel === "block" && (
        <div className="grid grid-auto-fit gap-4">
          {blocks.isLoading ? <LoadingState /> : filterBySearch(blocks.data).map((block) => (
            <button key={block.id} className="avs-card" onClick={() => setBlock(block.id)} style={{ cursor: "pointer", padding: 20, textAlign: "left", border: "none", width: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: "#fef3c7", color: "#d97706", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Building2 size={22} />
                </div>
                <div>
                  <strong style={{ display: "block", fontSize: "1rem" }}>{block.name}</strong>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>{block.code}</span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: 12, color: "var(--primary)", fontSize: "0.85rem", fontWeight: 600, gap: 4 }}>
                View floors <ChevronRight size={14} />
              </div>
            </button>
          ))}
          {!blocks.isLoading && !filterBySearch(blocks.data).length && <EmptyState title="No blocks" description={search ? "No blocks match your search." : "No blocks in this campus yet."} />}
        </div>
      )}

      {currentLevel === "floor" && (
        <div className="grid grid-auto-fit gap-4">
          {floors.isLoading ? <LoadingState /> : filterBySearch(floors.data).map((floor) => (
            <button key={floor.id} className="avs-card" onClick={() => setFloor(floor.id)} style={{ cursor: "pointer", padding: 20, textAlign: "left", border: "none", width: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: "#dbeafe", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Layers3 size={22} />
                </div>
                <div>
                  <strong style={{ display: "block", fontSize: "1rem" }}>{floor.name}</strong>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>{floor.code}</span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: 12, color: "var(--primary)", fontSize: "0.85rem", fontWeight: 600, gap: 4 }}>
                View rooms <ChevronRight size={14} />
              </div>
            </button>
          ))}
          {!floors.isLoading && !filterBySearch(floors.data).length && <EmptyState title="No floors" description={search ? "No floors match your search." : "No floors in this block yet."} />}
        </div>
      )}

      {currentLevel === "room" && (
        <div className="grid grid-auto-fit gap-4">
          {rooms.isLoading ? <LoadingState /> : filterBySearch(rooms.data)?.map((room) => (
            <div key={room.id} className="avs-card" style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: "#f0fdf4", color: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {room.roomType === "LABORATORY" ? <FlaskConical size={22} /> : <DoorOpen size={22} />}
                </div>
                <div>
                  <strong style={{ display: "block", fontSize: "1rem" }}>{room.name}</strong>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>{room.code}</span>
                </div>
              </div>
              <div style={{ marginTop: 12, padding: "8px 12px", background: "var(--page)", borderRadius: "var(--radius-md)", fontSize: "0.85rem" }}>
                <span className="muted">Type:</span> <strong>{room.roomType.replaceAll("_", " ")}</strong>
              </div>
            </div>
          ))}
          {!rooms.isLoading && !filterBySearch(rooms.data)?.length && <EmptyState title="No rooms" description={search ? "No rooms match your search." : "No rooms on this floor yet."} />}
        </div>
      )}
    </section>

    {/* Add Location Collapsible Form */}
    {showCreate && (
      <section className="avs-card avs-animate-slide-up" style={{ marginBottom: 24, padding: 24 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: "1.1rem" }}>Add New {createLabel[0]?.toUpperCase()}{createLabel.slice(1)}</h2>
        <form onSubmit={submit} style={{ display: "grid", gap: 14, maxWidth: 500 }}>
          {error && <div className="error-box">{error}</div>}
          <div className="field">
            <label>Location type</label>
            <select aria-label="Location type" className="input" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
              <option value="campus">Campus</option>
              <option value="block">Block</option>
              <option value="floor">Floor</option>
              <option value="room">Room</option>
            </select>
          </div>
          {kind !== "campus" && (
            <div className="field">
              <label>Parent</label>
              <input className="input" disabled value={
                kind === "block" ? selectedCampus?.name ?? "Select a campus first"
                  : kind === "floor" ? selectedBlock?.name ?? "Select a block first"
                    : selectedFloor?.name ?? "Select a floor first"
              } />
            </div>
          )}
          <div className="field">
            <label>Code</label>
            <input aria-label="Code" className="input" required maxLength={40} placeholder={kind === "campus" ? "e.g. MAIN" : "e.g. B1, F2, R101"} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </div>
          <div className="field">
            <label>Display name</label>
            <input aria-label="Display name" className="input" required placeholder={kind === "campus" ? "e.g. Main Campus" : "e.g. Main Block, Ground Floor"} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          {kind === "floor" && (
            <div className="field">
              <label>Level</label>
              <input aria-label="Level" className="input" type="number" value={form.level} onChange={(e) => setForm({ ...form, level: Number(e.target.value) })} />
            </div>
          )}
          {kind === "room" && (
            <>
              <div className="field">
                <label>Room type</label>
                <select aria-label="Room type" className="input" value={form.roomType} onChange={(e) => setForm({ ...form, roomType: e.target.value })}>
                  {ROOM_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll("_", " ")}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Room number</label>
                <input aria-label="Room number" className="input" maxLength={40} placeholder="e.g. 101" value={form.roomNumber} onChange={(e) => setForm({ ...form, roomNumber: e.target.value })} />
              </div>
              <div className="field">
                <label>Capacity</label>
                <input aria-label="Capacity" className="input" type="number" min={1} max={100000} placeholder={form.roomType === "LABORATORY" ? "e.g. 40" : "e.g. 60"} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
              </div>
            </>
          )}
          <button className="btn btn-primary" disabled={create.isPending || createDisabled} style={{ justifySelf: "start" }}>
            <Plus size={17} />{create.isPending ? "Creating..." : `Add ${createLabel}`}
          </button>
        </form>
      </section>
    )}

    {/* Safe Location Management */}
    <section className="avs-card" style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Location Management</h2>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.9rem" }}>Archive, restore, manage test data, and safely delete locations.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select className="input" aria-label="Location type" value={managedKind} onChange={(e) => { setManagedKind(e.target.value as ManagedKind); setDependency(null); }} style={{ minWidth: 120 }}>
            <option value="campus">Campuses</option><option value="block">Blocks</option><option value="floor">Floors</option><option value="room">Rooms</option>
          </select>
          <select className="input" aria-label="Status filter" value={managedStatus} onChange={(e) => setManagedStatus(e.target.value)} style={{ minWidth: 120 }}>
            <option value="ALL">All</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ARCHIVED">Archived</option><option value="TEST_DATA">Test Data</option>
          </select>
        </div>
      </div>

      {managed.isLoading ? <LoadingState /> : managed.isError ? <ErrorState /> : (
        <div style={{ display: "grid", gap: 8 }}>
          {managed.data?.map((record) => (
            <article key={record.id} style={{ padding: "14px 16px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div>
                  <strong>{record.name}</strong>
                  <div className="muted" style={{ fontSize: "0.85rem" }}>
                    {record.code}
                    {record.archivedAt ? " · Archived" : record.isActive ? " · Active" : " · Inactive"}
                    {record.isTestData && <span style={{ color: "var(--warning)", fontWeight: 600 }}> · Test Data</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <button className="btn btn-secondary" style={{ fontSize: "0.8rem", padding: "6px 10px" }} onClick={() => manage.mutate({ action: "dependencies", record })}><ShieldCheck size={14} />Dependencies</button>
                <button className="btn btn-secondary" style={{ fontSize: "0.8rem", padding: "6px 10px" }} onClick={() => manage.mutate({ action: "test", record })}><FlaskConical size={14} />{record.isTestData ? "Unmark" : "Test Data"}</button>
                {record.archivedAt
                  ? <button className="btn btn-secondary" style={{ fontSize: "0.8rem", padding: "6px 10px" }} onClick={() => manage.mutate({ action: "restore", record })}><RotateCcw size={14} />Restore</button>
                  : <button className="btn btn-secondary" style={{ fontSize: "0.8rem", padding: "6px 10px" }} onClick={() => manage.mutate({ action: "archive", record })}><Archive size={14} />Archive</button>
                }
                {record.isTestData && <button className="btn btn-danger" style={{ fontSize: "0.8rem", padding: "6px 10px" }} onClick={() => manage.mutate({ action: "delete", record })}><Trash2 size={14} />Delete</button>}
              </div>
            </article>
          ))}
          {!managed.data?.length && <EmptyState title="No locations" description="No locations match the selected filters." />}
        </div>
      )}

      {dependency && (
        <div className={`avs-animate-slide-up ${dependency.report.canDelete ? "avs-card" : "error-box"}`} style={{ padding: 16, marginTop: 16 }}>
          <strong>{dependency.record.name}: {dependency.report.message}</strong>
          <p className="muted" style={{ margin: "8px 0" }}>Total dependencies: {dependency.report.totalDependencies}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {Object.entries(dependency.report.dependencies).map(([label, count]) => (
              <span key={label} style={{ padding: "4px 10px", background: "var(--page)", borderRadius: "var(--radius-md)", fontSize: "0.85rem" }}>
                {label.replaceAll(/([A-Z])/g, " $1")}: <strong>{count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  </>;
}
