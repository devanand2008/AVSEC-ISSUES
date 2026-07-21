"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { api } from "@/lib/api";
import type { SelectOption } from "@/lib/types";

interface QrRoom {
  id: string;
  code: string;
  name: string;
  roomNumber: string | null;
  roomType: string;
  reportUrl: string;
  dataUrl: string;
}

interface QrSheet {
  floor: { name: string; block: { name: string; campus: { name: string } } };
  rooms: QrRoom[];
}

export default function QrSheetPage() {
  const [initialFloorId] = useState(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("floorId") ?? "",
  );
  const [campusId, setCampusId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [selectedFloorId, setSelectedFloorId] = useState(initialFloorId);

  const campuses = useQuery({
    queryKey: ["campuses"],
    queryFn: () => api.get<SelectOption[]>("/locations/campuses"),
  });
  const effectiveCampusId = campusId || (!initialFloorId ? campuses.data?.[0]?.id ?? "" : "");
  const blocks = useQuery({
    queryKey: ["blocks", effectiveCampusId],
    queryFn: () => api.get<SelectOption[]>(`/locations/blocks?campusId=${effectiveCampusId}`),
    enabled: Boolean(effectiveCampusId),
  });
  const effectiveBlockId = blockId || (!initialFloorId || campusId ? blocks.data?.[0]?.id ?? "" : "");
  const floors = useQuery({
    queryKey: ["floors", effectiveBlockId],
    queryFn: () => api.get<SelectOption[]>(`/locations/floors?blockId=${effectiveBlockId}`),
    enabled: Boolean(effectiveBlockId),
  });
  const floorId = selectedFloorId || (!initialFloorId || campusId || blockId ? floors.data?.[0]?.id ?? "" : "");
  const query = useQuery({
    queryKey: ["qr-sheet", floorId],
    queryFn: () => api.get<QrSheet>(`/locations/qr-sheet?floorId=${floorId}`),
    enabled: Boolean(floorId),
  });

  return (
    <>
      <div className="page-heading no-print">
        <div>
          <Link href="/admin/locations" className="btn btn-secondary">
            <ArrowLeft size={17} />
            Locations
          </Link>
          <h1 className="page-title" style={{ marginTop: 12 }}>
            Room QR sheet
          </h1>
          <p className="page-subtitle">
            {query.data
              ? `${query.data.floor.block.campus.name} - ${query.data.floor.block.name} - ${query.data.floor.name}`
              : "Select a floor to print room issue-reporting QR codes."}
          </p>
        </div>
        <button className="btn btn-primary" disabled={!query.data} onClick={() => window.print()}>
          <Printer size={18} />
          Print sheet
        </button>
      </div>

      <section className="card no-print" style={{ marginBottom: 18, padding: 18 }}>
        <div className="form-grid">
          <label className="field">
            <span>Campus</span>
            <select
              className="input"
              value={effectiveCampusId}
              onChange={(event) => {
                setCampusId(event.target.value);
                setBlockId("");
                setSelectedFloorId("");
              }}
            >
              <option value="">Select campus</option>
              {campuses.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Block</span>
            <select
              className="input"
              value={effectiveBlockId}
              disabled={!effectiveCampusId}
              onChange={(event) => {
                setBlockId(event.target.value);
                setSelectedFloorId("");
              }}
            >
              <option value="">Select block</option>
              {blocks.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Floor</span>
            <select className="input" value={floorId} disabled={!effectiveBlockId} onChange={(event) => setSelectedFloorId(event.target.value)}>
              <option value="">Select floor</option>
              {floors.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {query.isLoading || campuses.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message="Room QR sheet could not be loaded for this floor." />
      ) : !query.data ? (
        <ErrorState message="No active floor is available for QR printing." />
      ) : (
        <div className="qr-sheet">
          {query.data.rooms.map((room) => (
            <article className="card qr-label" key={room.id}>
              <Image unoptimized width={128} height={128} src={room.dataUrl} alt={`Issue-reporting QR code for ${room.name}`} />
              <div>
                <strong>{room.name}</strong>
                <span>
                  {room.code}
                  {room.roomNumber ? ` - ${room.roomNumber}` : ""}
                </span>
                <small>Scan to report a campus issue</small>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
