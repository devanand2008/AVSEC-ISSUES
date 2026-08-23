"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  DoorOpen,
  FlaskConical,
  Layers3,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { api } from "@/lib/api";
import {
  roomTypeDisplayLabel,
  type LocationKind,
  type LocationRecord,
} from "@/features/locations/location-contract";

export interface HierarchyContext {
  campusId?: string;
  blockId?: string;
  floorId?: string;
}

interface LocationHierarchyProps {
  onCreate: (
    kind: LocationKind,
    context?: HierarchyContext,
    roomType?: string,
  ) => void;
  onEdit: (
    kind: LocationKind,
    record: LocationRecord,
    context?: HierarchyContext,
  ) => void;
}

export function LocationHierarchy({
  onCreate,
  onEdit,
}: LocationHierarchyProps) {
  const campuses = useQuery({
    queryKey: ["location-tree", "campuses"],
    queryFn: () => api.get<LocationRecord[]>("/locations/campuses"),
  });

  if (campuses.isLoading) return <TreeLoading label="Loading campuses" />;
  if (campuses.isError)
    return (
      <TreeError
        message="The campus hierarchy could not be loaded."
        onRetry={() => void campuses.refetch()}
      />
    );
  if (!campuses.data?.length)
    return (
      <EmptyState
        title="No campuses yet"
        description="Create a campus to begin the physical location hierarchy."
        action={
          <button
            className="avs-btn avs-btn-primary"
            type="button"
            onClick={() => onCreate("campus")}
          >
            <Plus size={16} /> Add Campus
          </button>
        }
      />
    );

  return (
    <ul aria-label="Campus hierarchy" style={treeListStyle}>
      {campuses.data.map((campus) => (
        <CampusNode
          key={campus.id}
          campus={campus}
          onCreate={onCreate}
          onEdit={onEdit}
        />
      ))}
    </ul>
  );
}

function CampusNode({
  campus,
  onCreate,
  onEdit,
}: {
  campus: LocationRecord;
  onCreate: LocationHierarchyProps["onCreate"];
  onEdit: LocationHierarchyProps["onEdit"];
}) {
  const [expanded, setExpanded] = useState(false);
  const blocks = useQuery({
    queryKey: ["location-tree", "blocks", campus.id],
    queryFn: () =>
      api.get<LocationRecord[]>(`/locations/blocks?campusId=${campus.id}`),
    enabled: expanded,
  });

  return (
    <li style={treeItemStyle}>
      <TreeRow
        record={campus}
        icon={<MapPin size={19} />}
        expanded={expanded}
        expandLabel={`${expanded ? "Collapse" : "Expand"} ${campus.name}`}
        onExpand={() => setExpanded((value) => !value)}
        onEdit={() => onEdit("campus", campus, { campusId: campus.id })}
        actions={
          <button
            className="avs-btn avs-btn-secondary"
            type="button"
            onClick={() => onCreate("block", { campusId: campus.id })}
          >
            <Plus size={14} /> Add Block
          </button>
        }
      />
      {expanded && (
        <TreeBranch>
          {blocks.isLoading ? (
            <TreeLoading label={`Loading blocks in ${campus.name}`} compact />
          ) : blocks.isError ? (
            <TreeError
              message={`Blocks in ${campus.name} could not be loaded.`}
              onRetry={() => void blocks.refetch()}
            />
          ) : blocks.data?.length ? (
            <ul style={treeListStyle}>
              {blocks.data.map((block) => (
                <BlockNode
                  key={block.id}
                  block={block}
                  campusId={campus.id}
                  onCreate={onCreate}
                  onEdit={onEdit}
                />
              ))}
            </ul>
          ) : (
            <TreeEmpty
              message="No blocks in this campus."
              actionLabel="Add block"
              onAction={() => onCreate("block", { campusId: campus.id })}
            />
          )}
        </TreeBranch>
      )}
    </li>
  );
}

function BlockNode({
  block,
  campusId,
  onCreate,
  onEdit,
}: {
  block: LocationRecord;
  campusId: string;
  onCreate: LocationHierarchyProps["onCreate"];
  onEdit: LocationHierarchyProps["onEdit"];
}) {
  const [expanded, setExpanded] = useState(false);
  const floors = useQuery({
    queryKey: ["location-tree", "floors", block.id],
    queryFn: () =>
      api.get<LocationRecord[]>(`/locations/floors?blockId=${block.id}`),
    enabled: expanded,
  });
  const context = { campusId, blockId: block.id };

  return (
    <li style={treeItemStyle}>
      <TreeRow
        record={block}
        icon={<Building2 size={19} />}
        expanded={expanded}
        expandLabel={`${expanded ? "Collapse" : "Expand"} ${block.name}`}
        onExpand={() => setExpanded((value) => !value)}
        onEdit={() => onEdit("block", block, context)}
        actions={
          <button
            className="avs-btn avs-btn-secondary"
            type="button"
            onClick={() => onCreate("floor", context)}
          >
            <Plus size={14} /> Add Floor
          </button>
        }
      />
      {expanded && (
        <TreeBranch>
          {floors.isLoading ? (
            <TreeLoading label={`Loading floors in ${block.name}`} compact />
          ) : floors.isError ? (
            <TreeError
              message={`Floors in ${block.name} could not be loaded.`}
              onRetry={() => void floors.refetch()}
            />
          ) : floors.data?.length ? (
            <ul style={treeListStyle}>
              {floors.data.map((floor) => (
                <FloorNode
                  key={floor.id}
                  floor={floor}
                  context={context}
                  onCreate={onCreate}
                  onEdit={onEdit}
                />
              ))}
            </ul>
          ) : (
            <TreeEmpty
              message="No floors in this block."
              actionLabel="Add floor"
              onAction={() => onCreate("floor", context)}
            />
          )}
        </TreeBranch>
      )}
    </li>
  );
}

function FloorNode({
  floor,
  context,
  onCreate,
  onEdit,
}: {
  floor: LocationRecord;
  context: Required<Pick<HierarchyContext, "campusId" | "blockId">>;
  onCreate: LocationHierarchyProps["onCreate"];
  onEdit: LocationHierarchyProps["onEdit"];
}) {
  const [expanded, setExpanded] = useState(false);
  const rooms = useQuery({
    queryKey: ["location-tree", "rooms", floor.id],
    queryFn: () =>
      api.get<LocationRecord[]>(`/locations/rooms?floorId=${floor.id}`),
    enabled: expanded,
  });
  const floorContext = { ...context, floorId: floor.id };

  return (
    <li style={treeItemStyle}>
      <TreeRow
        record={floor}
        icon={<Layers3 size={19} />}
        expanded={expanded}
        expandLabel={`${expanded ? "Collapse" : "Expand"} ${floor.name}`}
        onExpand={() => setExpanded((value) => !value)}
        onEdit={() => onEdit("floor", floor, floorContext)}
        detail={
          typeof floor.level === "number" ? `Floor level ${floor.level}` : undefined
        }
        actions={
          <>
            <button
              className="avs-btn avs-btn-secondary"
              type="button"
              aria-label={`Add Room to ${floor.name}`}
              onClick={() => onCreate("room", floorContext, "CLASSROOM")}
            >
              <DoorOpen size={14} /> Add Room
            </button>
            <button
              className="avs-btn avs-btn-primary"
              type="button"
              aria-label={`Add Lab to ${floor.name}`}
              onClick={() => onCreate("room", floorContext, "LABORATORY")}
            >
              <FlaskConical size={14} /> Add Lab
            </button>
          </>
        }
      />
      {expanded && (
        <TreeBranch>
          {rooms.isLoading ? (
            <TreeLoading label={`Loading rooms on ${floor.name}`} compact />
          ) : rooms.isError ? (
            <TreeError
              message={`Rooms on ${floor.name} could not be loaded.`}
              onRetry={() => void rooms.refetch()}
            />
          ) : rooms.data?.length ? (
            <ul style={treeListStyle}>
              {rooms.data.map((room) => (
                <li key={room.id} style={treeItemStyle}>
                  <TreeRow
                    record={room}
                    icon={
                      room.roomType === "LABORATORY" ? (
                        <FlaskConical size={19} />
                      ) : (
                        <DoorOpen size={19} />
                      )
                    }
                    onEdit={() => onEdit("room", room, floorContext)}
                    detail={[
                      room.roomNumber ? `Room ${room.roomNumber}` : "",
                      roomTypeDisplayLabel(room),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <TreeEmpty
              message="No rooms on this floor."
              actionLabel="Add room"
              onAction={() => onCreate("room", floorContext, "CLASSROOM")}
            />
          )}
        </TreeBranch>
      )}
    </li>
  );
}

function TreeRow({
  record,
  icon,
  expanded,
  expandLabel,
  onExpand,
  onEdit,
  actions,
  detail,
}: {
  record: LocationRecord;
  icon: ReactNode;
  expanded?: boolean;
  expandLabel?: string;
  onExpand?: () => void;
  onEdit: () => void;
  actions?: ReactNode;
  detail?: string;
}) {
  const copy = (
    <>
      <span
        aria-hidden
        style={{
          width: 38,
          height: 38,
          borderRadius: "var(--radius-md)",
          display: "grid",
          placeItems: "center",
          color: "var(--avs-primary)",
          background: "var(--avs-info-surface)",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <strong style={{ display: "block", overflowWrap: "anywhere" }}>
          {record.name}
        </strong>
        <span
          className="muted"
          style={{ display: "block", fontSize: "var(--text-xs)" }}
        >
          {[record.code, detail].filter(Boolean).join(" · ")}
        </span>
      </span>
      {onExpand &&
        (expanded ? (
          <ChevronDown size={18} aria-hidden />
        ) : (
          <ChevronRight size={18} aria-hidden />
        ))}
    </>
  );

  return (
    <div
      style={{
        border: "1px solid var(--avs-border)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-3)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        flexWrap: "wrap",
        minWidth: 0,
      }}
    >
      {onExpand ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expandLabel}
          onClick={onExpand}
          style={{
            appearance: "none",
            border: 0,
            padding: 0,
            background: "transparent",
            color: "inherit",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            flex: "1 1 260px",
            minWidth: 0,
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          {copy}
        </button>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            flex: "1 1 260px",
            minWidth: 0,
          }}
        >
          {copy}
        </div>
      )}
      <div
        style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}
      >
        <button
          className="avs-btn avs-btn-ghost"
          type="button"
          aria-label={`Edit ${record.name}`}
          onClick={onEdit}
        >
          <Pencil size={14} /> Edit
        </button>
        {actions}
      </div>
    </div>
  );
}

function TreeBranch({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        margin: "var(--space-2) 0 var(--space-2) clamp(10px, 3vw, 28px)",
        paddingLeft: "clamp(8px, 2vw, 18px)",
        borderLeft: "2px solid var(--avs-border-light)",
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

function TreeLoading({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div
      aria-label={label}
      role="status"
      style={{ display: "grid", gap: 8, padding: compact ? 8 : 16 }}
    >
      <span className="skeleton" style={{ height: compact ? 42 : 56 }} />
      {!compact && <span className="skeleton" style={{ height: 56 }} />}
    </div>
  );
}

function TreeError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-box" role="alert" style={{ margin: 8 }}>
      {message}{" "}
      <button className="avs-btn avs-btn-ghost" type="button" onClick={onRetry}>
        <RefreshCw size={14} /> Retry
      </button>
    </div>
  );
}

function TreeEmpty({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div
      className="muted"
      style={{
        padding: "var(--space-3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-3)",
        flexWrap: "wrap",
      }}
    >
      <span>{message}</span>
      <button className="avs-btn avs-btn-secondary" type="button" onClick={onAction}>
        <Plus size={14} /> {actionLabel}
      </button>
    </div>
  );
}

const treeListStyle = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gap: "var(--space-2)",
  minWidth: 0,
} as const;

const treeItemStyle = { minWidth: 0 } as const;
