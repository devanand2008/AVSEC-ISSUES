"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, DoorOpen, Layers3, Plus, QrCode } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { api, ApiError } from "@/lib/api";
import type { SelectOption } from "@/lib/types";

export default function LocationsAdminPage() {
  const client = useQueryClient();
  const [campusId, setCampus] = useState("");
  const [blockId, setBlock] = useState("");
  const [floorId, setFloor] = useState("");
  const [kind, setKind] = useState<"block" | "floor" | "room">("block");
  const [form, setForm] = useState({ code: "", name: "", level: 1, roomType: "CLASSROOM" });
  const [error, setError] = useState("");
  const campuses = useQuery({ queryKey: ["campuses"], queryFn: () => api.get<SelectOption[]>("/locations/campuses") });
  const blocks = useQuery({ queryKey: ["blocks", campusId], queryFn: () => api.get<SelectOption[]>(`/locations/blocks?campusId=${campusId}`), enabled: Boolean(campusId) });
  const floors = useQuery({ queryKey: ["floors", blockId], queryFn: () => api.get<SelectOption[]>(`/locations/floors?blockId=${blockId}`), enabled: Boolean(blockId) });
  const rooms = useQuery({ queryKey: ["rooms", floorId], queryFn: () => api.get<Array<SelectOption & { roomType: string }>>(`/locations/rooms?floorId=${floorId}`), enabled: Boolean(floorId) });
  const create = useMutation({
    mutationFn: () => kind === "block" ? api.post("/locations/blocks", { campusId, code: form.code, name: form.name })
      : kind === "floor" ? api.post("/locations/floors", { blockId, code: form.code, name: form.name, level: form.level })
        : api.post("/locations/rooms", { floorId, code: form.code, name: form.name, roomType: form.roomType }),
    onSuccess: () => { setForm({ code: "", name: "", level: 1, roomType: "CLASSROOM" }); void client.invalidateQueries({ queryKey: [kind === "block" ? "blocks" : kind === "floor" ? "floors" : "rooms"] }); },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Location could not be created."),
  });
  function submit(event: FormEvent) { event.preventDefault(); setError(""); create.mutate(); }
  const parentName = kind === "block" ? campuses.data?.find((item) => item.id === campusId)?.name
    : kind === "floor" ? blocks.data?.find((item) => item.id === blockId)?.name
      : floors.data?.find((item) => item.id === floorId)?.name;

  return <>
    <div className="page-heading"><div><span className="eyebrow">Campus setup</span><h1 className="page-title" style={{ marginTop: 6 }}>Locations</h1><p className="page-subtitle">Build the active campus › block › floor › room hierarchy.</p></div>{floorId && <Link className="btn btn-secondary" href={`/admin/locations/qr-sheet?floorId=${floorId}`}><QrCode size={17} />Print room QR sheet</Link>}</div>
    {campuses.isLoading ? <LoadingState /> : campuses.isError ? <ErrorState /> : <div className="location-admin">
      <section className="card location-browser">
        <div className="location-column"><header><Building2 />Campuses</header>{campuses.data?.map((item) => <button className={campusId === item.id ? "selected" : ""} key={item.id} onClick={() => { setCampus(item.id); setBlock(""); setFloor(""); }}>{item.name}<small>{item.code}</small></button>)}</div>
        <div className="location-column"><header><Building2 />Blocks</header>{blocks.data?.map((item) => <button className={blockId === item.id ? "selected" : ""} key={item.id} onClick={() => { setBlock(item.id); setFloor(""); }}>{item.name}<small>{item.code}</small></button>)}</div>
        <div className="location-column"><header><Layers3 />Floors</header>{floors.data?.map((item) => <button className={floorId === item.id ? "selected" : ""} key={item.id} onClick={() => setFloor(item.id)}>{item.name}<small>{item.code}</small></button>)}</div>
        <div className="location-column"><header><DoorOpen />Rooms</header>{rooms.data?.map((item) => <button key={item.id}>{item.name}<small>{item.code} · {item.roomType.replaceAll("_", " ")}</small></button>)}</div>
      </section>
      <form className="card location-form" onSubmit={submit}><div className="section-head"><div><h2>Add location</h2><p>New records become available to issue reporting immediately.</p></div></div><div style={{ padding: 18, display: "grid", gap: 15 }}>{error && <div className="error-box">{error}</div>}<div className="field"><label>Location type</label><select className="input" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="block">Block</option><option value="floor">Floor</option><option value="room">Room</option></select></div><div className="field"><label>Parent</label><input className="input" disabled value={parentName ?? `Select ${kind === "block" ? "campus" : kind === "floor" ? "block" : "floor"}`} /></div><div className="field"><label>Code</label><input className="input" required maxLength={40} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} /></div><div className="field"><label>Display name</label><input className="input" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>{kind === "floor" && <div className="field"><label>Level</label><input className="input" type="number" value={form.level} onChange={(event) => setForm({ ...form, level: Number(event.target.value) })} /></div>}{kind === "room" && <div className="field"><label>Room type</label><select className="input" value={form.roomType} onChange={(event) => setForm({ ...form, roomType: event.target.value })}>{["CLASSROOM", "LABORATORY", "SEMINAR_HALL", "AUDITORIUM", "STAFF_ROOM", "HOD_ROOM", "PRINCIPAL_OFFICE", "ADMINISTRATIVE_OFFICE", "LIBRARY", "WORKSHOP", "RESTROOM", "CANTEEN", "HOSTEL_ROOM", "CORRIDOR", "STAIRCASE", "PARKING_AREA", "PLAYGROUND", "OTHER"].map((item) => <option key={item}>{item.replaceAll("_", " ")}</option>)}</select></div>}<button className="btn btn-primary" disabled={create.isPending || (kind === "block" ? !campusId : kind === "floor" ? !blockId : !floorId)}><Plus size={17} />{create.isPending ? "Creating…" : `Add ${kind}`}</button></div></form>
    </div>}
  </>;
}
