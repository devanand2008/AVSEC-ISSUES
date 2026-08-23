"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Building2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { PageHeader } from "@/components/ui/page-header";
import {
  adminLocationListPath,
  locationContext,
  normalizeDependencyReport,
  normalizeLocationList,
  pluralLocationKind,
  roomTypeDisplayLabel,
  ROOM_TYPES,
  type LocationDependencyReport,
  type LocationImageResponse,
  type LocationKind,
  type LocationListResponse,
  type LocationRecord,
} from "@/features/locations/location-contract";
import {
  blankLocationDraft,
  LocationEditorDialog,
  type LocationDraft,
  type LocationEditorState,
} from "@/features/locations/location-editor-dialog";
import {
  LocationHierarchy,
  type HierarchyContext,
} from "@/features/locations/location-hierarchy";
import { api, ApiError } from "@/lib/api";

const PAGE_SIZE = 20;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DELETE_PHRASE = "PERMANENTLY DELETE LOCATION";

interface DepartmentOption {
  id: string;
  code: string;
  name: string;
}

interface PresignedImage {
  storageKey: string;
  uploadUrl: string;
  requiredHeaders?: Record<string, string>;
}

interface CompleteImageResponse {
  record: LocationRecord;
  image: LocationImageResponse;
}

type LocationAction =
  | { type: "archive"; kind: LocationKind; record: LocationRecord }
  | { type: "restore"; kind: LocationKind; record: LocationRecord }
  | {
      type: "delete";
      kind: LocationKind;
      record: LocationRecord;
      report: LocationDependencyReport;
    }
  | { type: "remove-image"; kind: LocationKind; record: LocationRecord };

class SavedLocationImageError extends Error {
  constructor(
    readonly record: LocationRecord,
    readonly causeError: unknown,
  ) {
    super("The location was saved, but its image could not be uploaded.");
  }
}

export default function LocationsAdminPage() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<LocationKind>("campus");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [campusId, setCampusId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [roomType, setRoomType] = useState("ALL");
  const [departmentId, setDepartmentId] = useState("");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<LocationEditorState | null>(null);
  const [draft, setDraft] = useState<LocationDraft>(blankLocationDraft);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageError, setImageError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [action, setAction] = useState<LocationAction | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [actionError, setActionError] = useState("");
  const [dependencyLoadingId, setDependencyLoadingId] = useState("");
  const [viewer, setViewer] = useState<{
    kind: LocationKind;
    record: LocationRecord;
  } | null>(null);

  const campuses = useQuery({
    queryKey: ["location-options", "campuses"],
    queryFn: () => api.get<LocationRecord[]>("/locations/campuses"),
  });
  const departments = useQuery({
    queryKey: ["location-options", "departments"],
    queryFn: () =>
      api.get<DepartmentOption[]>("/academic/departments"),
  });
  const filterBlocks = useQuery({
    queryKey: ["location-options", "blocks", campusId],
    queryFn: () =>
      api.get<LocationRecord[]>(`/locations/blocks?campusId=${campusId}`),
    enabled: kind !== "campus" && kind !== "block" && Boolean(campusId),
  });
  const filterFloors = useQuery({
    queryKey: ["location-options", "floors", blockId],
    queryFn: () =>
      api.get<LocationRecord[]>(`/locations/floors?blockId=${blockId}`),
    enabled: kind === "room" && Boolean(blockId),
  });

  const listPath = adminLocationListPath(kind, {
    search,
    status,
    campusId,
    blockId,
    floorId,
    roomType,
    departmentId,
    page,
    pageSize: PAGE_SIZE,
  });
  const listQuery = useQuery({
    queryKey: [
      "admin-location-list",
      kind,
      search,
      status,
      campusId,
      blockId,
      floorId,
      roomType,
      departmentId,
      page,
    ],
    queryFn: () => api.get<LocationListResponse>(listPath),
  });
  const list = normalizeLocationList(listQuery.data, page, PAGE_SIZE);

  const editorImage = useQuery({
    queryKey: ["location-image", editor?.kind, editor?.record?.id],
    queryFn: async () => {
      try {
        return await api.get<LocationImageResponse>(
          `/admin/${editor!.kind}/${editor!.record!.id}/image`,
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 404)
          return { imageUrl: null };
        throw error;
      }
    },
    enabled:
      editor?.mode === "edit" &&
      Boolean(editor.record?.id) &&
      editor.record?.imageStorageKey !== null,
    retry: false,
  });

  const viewerImage = useQuery({
    queryKey: ["location-image-viewer", viewer?.kind, viewer?.record.id],
    queryFn: () =>
      api.get<LocationImageResponse>(
        `/admin/${viewer!.kind}/${viewer!.record.id}/image`,
      ),
    enabled: Boolean(viewer),
    retry: false,
  });

  async function invalidateLocations() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-location-list"] }),
      queryClient.invalidateQueries({ queryKey: ["location-tree"] }),
      queryClient.invalidateQueries({ queryKey: ["location-form"] }),
      queryClient.invalidateQueries({ queryKey: ["location-options"] }),
    ]);
  }

  async function uploadLocationImage(
    targetKind: LocationKind,
    target: LocationRecord,
    file: File,
  ): Promise<LocationRecord> {
    const metadata = {
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const presigned = await api.post<PresignedImage>(
      `/admin/${targetKind}/${target.id}/image/presign`,
      metadata,
    );
    await api.upload(presigned.uploadUrl, file, presigned.requiredHeaders);
    const completed = await api.post<CompleteImageResponse>(
      `/admin/${targetKind}/${target.id}/image/complete`,
      { ...metadata, storageKey: presigned.storageKey },
    );
    return {
      ...(completed.record ?? target),
      imageStorageKey: presigned.storageKey,
    };
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editor) throw new Error("Location editor is not open.");
      const payload = locationPayload(editor, draft);
      const endpoint = `/admin/${pluralLocationKind(editor.kind)}`;
      const record =
        editor.mode === "create"
          ? await api.post<LocationRecord>(endpoint, payload)
          : await api.patch<LocationRecord>(
              `${endpoint}/${editor.record!.id}`,
              payload,
            );
      if (!imageFile) return record;
      try {
        return await uploadLocationImage(editor.kind, record, imageFile);
      } catch (error) {
        throw new SavedLocationImageError(record, error);
      }
    },
    onSuccess: async () => {
      const savedKind = editor?.kind ?? "campus";
      setSuccess(`${labelKind(savedKind)} saved successfully.`);
      closeEditor();
      await invalidateLocations();
    },
    onError: (error) => {
      if (error instanceof SavedLocationImageError && editor) {
        setEditor({ mode: "edit", kind: editor.kind, record: error.record });
        setImageFile(null);
        setFormError(
          `The ${labelKind(editor.kind).toLowerCase()} was saved, but the image upload failed. ${errorMessage(error.causeError, "Choose the image again and retry.")}`,
        );
        void invalidateLocations();
        return;
      }
      setFormError(errorMessage(error, "The location could not be saved."));
    },
  });

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!action) throw new Error("No location action is selected.");
      const base = `/admin/${action.kind}/${action.record.id}`;
      if (action.type === "archive")
        return api.post(`${base}/archive`, { reason: actionReason.trim() });
      if (action.type === "restore") return api.post(`${base}/restore`);
      if (action.type === "remove-image") return api.delete(`${base}/image`);
      return api.delete(base, {
        reason: actionReason.trim(),
        confirmationPhrase,
      });
    },
    onSuccess: async () => {
      if (!action) return;
      const message =
        action.type === "archive"
          ? `${labelKind(action.kind)} archived.`
          : action.type === "restore"
            ? `${labelKind(action.kind)} restored.`
            : action.type === "delete"
              ? `${labelKind(action.kind)} permanently deleted.`
              : "Location image removed.";
      if (action.type === "remove-image" && editor?.record?.id === action.record.id) {
        setEditor({
          ...editor,
          record: { ...editor.record, imageStorageKey: null },
        });
        queryClient.setQueryData(
          ["location-image", editor.kind, editor.record.id],
          { imageUrl: null },
        );
      }
      setSuccess(message);
      closeAction();
      await invalidateLocations();
    },
    onError: (error) =>
      setActionError(errorMessage(error, "The requested action failed.")),
  });

  function openCreate(
    nextKind: LocationKind,
    context: HierarchyContext = {},
    nextRoomType = "CLASSROOM",
  ) {
    setSuccess("");
    setFormError("");
    setImageError("");
    setImageFile(null);
    setDraft({
      ...blankLocationDraft(),
      campusId: context.campusId ?? "",
      blockId: context.blockId ?? "",
      floorId: context.floorId ?? "",
      roomType: nextRoomType,
    });
    setEditor({ mode: "create", kind: nextKind });
  }

  function openEdit(
    nextKind: LocationKind,
    record: LocationRecord,
    suppliedContext: HierarchyContext = {},
  ) {
    const context = { ...locationContext(record), ...suppliedContext };
    setSuccess("");
    setFormError("");
    setImageError("");
    setImageFile(null);
    setDraft({
      ...blankLocationDraft(),
      code: record.code,
      name: record.name,
      description: record.description ?? "",
      address: record.address ?? "",
      contactNumber: record.contactNumber ?? "",
      campusId: context.campusId ?? "",
      blockId: context.blockId ?? "",
      floorId: context.floorId ?? "",
      level: String(record.level ?? 0),
      roomNumber: record.roomNumber ?? "",
      roomType: record.roomType ?? "CLASSROOM",
      customRoomTypeLabel: record.customRoomTypeLabel ?? "",
      capacity: record.capacity ? String(record.capacity) : "",
      departmentId: record.departmentId ?? "",
      isActive: record.isActive !== false,
    });
    setEditor({ mode: "edit", kind: nextKind, record });
  }

  function closeEditor() {
    if (saveMutation.isPending) return;
    setEditor(null);
    setDraft(blankLocationDraft());
    setImageFile(null);
    setImageError("");
    setFormError("");
  }

  function selectImage(file: File | null) {
    setImageError("");
    if (!file) {
      setImageFile(null);
      return;
    }
    if (!IMAGE_TYPES.has(file.type)) {
      setImageFile(null);
      setImageError("Select a JPG, PNG or WEBP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setImageFile(null);
      setImageError("The image must be 10 MB or smaller.");
      return;
    }
    setImageFile(file);
  }

  function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    if (!editor) return;
    if (!draft.code.trim() || draft.name.trim().length < 2) {
      setFormError("Code and name are required.");
      return;
    }
    saveMutation.mutate();
  }

  function closeAction() {
    if (actionMutation.isPending) return;
    setAction(null);
    setActionReason("");
    setConfirmationPhrase("");
    setActionError("");
  }

  async function openDelete(nextKind: LocationKind, record: LocationRecord) {
    setDependencyLoadingId(record.id);
    setActionError("");
    try {
      const raw = await api.get<unknown>(
        `/admin/${nextKind}/${record.id}/dependencies`,
      );
      setAction({
        type: "delete",
        kind: nextKind,
        record,
        report: normalizeDependencyReport(raw),
      });
    } catch (error) {
      setSuccess("");
      setActionError(
        errorMessage(error, "Dependencies could not be checked."),
      );
    } finally {
      setDependencyLoadingId("");
    }
  }

  function confirmAction() {
    if (!action) return;
    setActionError("");
    if (action.type === "archive" && actionReason.trim().length < 3) {
      setActionError("Enter an archive reason of at least 3 characters.");
      return;
    }
    if (action.type === "delete") {
      if (!action.report.canDelete) {
        closeAction();
        return;
      }
      if (actionReason.trim().length < 3) {
        setActionError("Enter a deletion reason of at least 3 characters.");
        return;
      }
      if (confirmationPhrase !== DELETE_PHRASE) {
        setActionError("The confirmation phrase does not match exactly.");
        return;
      }
    }
    actionMutation.mutate();
  }

  function changeKind(nextKind: LocationKind) {
    setKind(nextKind);
    setPage(1);
    setCampusId("");
    setBlockId("");
    setFloorId("");
    setRoomType("ALL");
    setDepartmentId("");
  }

  function resetFilters() {
    setSearchText("");
    setSearch("");
    setStatus("ALL");
    setCampusId("");
    setBlockId("");
    setFloorId("");
    setRoomType("ALL");
    setDepartmentId("");
    setPage(1);
  }

  return (
    <div className="page-container main-with-bottom-nav">
      <PageHeader
        title="Campus Setup"
        description="Manage the Campus → Block → Floor → Room hierarchy, room and lab metadata, and private location images."
        breadcrumbs={[{ label: "Admin" }, { label: "Campus Setup" }]}
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="avs-btn avs-btn-secondary" href="/admin/locations/qr-sheet">
              Room QR sheets
            </Link>
            <button
              className="avs-btn avs-btn-primary"
              type="button"
              aria-label="Add Campus"
              onClick={() => openCreate("campus")}
            >
              <Plus size={16} /> Add Campus
            </button>
          </div>
        }
      />

      {success && (
        <div className="success-box" role="status" style={{ marginBottom: 16 }}>
          {success}
        </div>
      )}
      {!action && actionError && (
        <div className="error-box" role="alert" style={{ marginBottom: 16 }}>
          {actionError}
        </div>
      )}

      <section className="card" aria-labelledby="campus-hierarchy-title" style={{ padding: 20, marginBottom: 20 }}>
        <SectionHeading
          icon={<Building2 size={19} />}
          title="Campus hierarchy"
          description="Expand only the branch you need. Child locations are fetched lazily."
        />
        <div style={{ marginTop: 16 }}>
          <LocationHierarchy onCreate={openCreate} onEdit={openEdit} />
        </div>
      </section>

      <section className="card" aria-labelledby="location-management-title" style={{ padding: 20 }}>
        <SectionHeading
          icon={<Search size={19} />}
          title="Location management"
          description="Search, filter, edit, archive, restore, and safely remove records."
          action={
            <button
              className="avs-btn avs-btn-primary"
              type="button"
              onClick={() => openCreate(kind)}
            >
              <Plus size={15} /> Add {labelKind(kind)}
            </button>
          }
        />

        <div
          role="tablist"
          aria-label="Location type"
          style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}
        >
          {(["campus", "block", "floor", "room"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={kind === item}
              className={kind === item ? "avs-btn avs-btn-primary" : "avs-btn avs-btn-secondary"}
              onClick={() => changeKind(item)}
            >
              {pluralLabel(item)}
            </button>
          ))}
        </div>

        <form
          aria-label="Location filters"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(searchText.trim());
            setPage(1);
          }}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
            gap: 12,
            marginTop: 16,
            alignItems: "end",
          }}
        >
          <FilterField label="Search" htmlFor="location-search">
            <input
              id="location-search"
              className="input"
              value={searchText}
              maxLength={160}
              placeholder="Name, code, room number…"
              onChange={(event) => setSearchText(event.target.value)}
            />
          </FilterField>
          <FilterField label="Status" htmlFor="location-status-filter">
            <select
              id="location-status-filter"
              className="input"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="ARCHIVED">Archived</option>
              <option value="TEST_DATA">Test data</option>
            </select>
          </FilterField>
          {kind !== "campus" && (
            <FilterField label="Campus" htmlFor="location-campus-filter">
              <select
                id="location-campus-filter"
                className="input"
                value={campusId}
                disabled={campuses.isLoading}
                onChange={(event) => {
                  setCampusId(event.target.value);
                  setBlockId("");
                  setFloorId("");
                  setPage(1);
                }}
              >
                <option value="">All campuses</option>
                {campuses.data?.map((campus) => (
                  <option key={campus.id} value={campus.id}>
                    {campus.code} - {campus.name}
                  </option>
                ))}
              </select>
            </FilterField>
          )}
          {(kind === "floor" || kind === "room") && (
            <FilterField label="Block" htmlFor="location-block-filter">
              <select
                id="location-block-filter"
                className="input"
                value={blockId}
                disabled={!campusId || filterBlocks.isLoading}
                onChange={(event) => {
                  setBlockId(event.target.value);
                  setFloorId("");
                  setPage(1);
                }}
              >
                <option value="">All blocks</option>
                {filterBlocks.data?.map((block) => (
                  <option key={block.id} value={block.id}>
                    {block.code} - {block.name}
                  </option>
                ))}
              </select>
            </FilterField>
          )}
          {kind === "room" && (
            <>
              <FilterField label="Floor" htmlFor="location-floor-filter">
                <select
                  id="location-floor-filter"
                  className="input"
                  value={floorId}
                  disabled={!blockId || filterFloors.isLoading}
                  onChange={(event) => {
                    setFloorId(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All floors</option>
                  {filterFloors.data?.map((floor) => (
                    <option key={floor.id} value={floor.id}>
                      {floor.code} - {floor.name}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Room type" htmlFor="location-room-type-filter">
                <select
                  id="location-room-type-filter"
                  className="input"
                  value={roomType}
                  onChange={(event) => {
                    setRoomType(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="ALL">All room types</option>
                  {ROOM_TYPES.map((item) => (
                    <option key={item} value={item}>
                      {item.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Department" htmlFor="location-department-filter">
                <select
                  id="location-department-filter"
                  className="input"
                  value={departmentId}
                  disabled={departments.isLoading}
                  onChange={(event) => {
                    setDepartmentId(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All departments</option>
                  {departments.data?.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.code} - {department.name}
                    </option>
                  ))}
                </select>
              </FilterField>
            </>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="avs-btn avs-btn-primary" type="submit">
              <Search size={15} /> Search
            </button>
            <button className="avs-btn avs-btn-ghost" type="button" onClick={resetFilters}>
              Reset
            </button>
          </div>
        </form>

        <div style={{ marginTop: 18 }}>
          {listQuery.isLoading ? (
            <ListLoading />
          ) : listQuery.isError ? (
            <div className="error-box" role="alert">
              {errorMessage(listQuery.error, "Locations could not be loaded.")} {" "}
              <button className="avs-btn avs-btn-ghost" type="button" onClick={() => void listQuery.refetch()}>
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          ) : list.records.length === 0 ? (
            <div className="muted" style={{ padding: "32px 12px", textAlign: "center" }}>
              No {pluralLabel(kind).toLowerCase()} match these filters.
            </div>
          ) : (
            <LocationTable
              kind={kind}
              records={list.records}
              dependencyLoadingId={dependencyLoadingId}
              onEdit={openEdit}
              onArchive={(record) => {
                setActionError("");
                setAction({ type: "archive", kind, record });
              }}
              onRestore={(record) => {
                setActionError("");
                setAction({ type: "restore", kind, record });
              }}
              onDelete={(record) => void openDelete(kind, record)}
              onViewImage={(record) => setViewer({ kind, record })}
            />
          )}
        </div>

        <div
          aria-label="Location pagination"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            marginTop: 16,
          }}
        >
          <span className="muted" style={{ fontSize: "var(--text-sm)" }}>
            {list.meta.total === 0
              ? "0 records"
              : `Page ${list.meta.page} of ${list.meta.pageCount} · ${list.meta.total} records`}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="avs-btn avs-btn-secondary"
              type="button"
              aria-label="Previous page"
              disabled={page <= 1 || listQuery.isFetching}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft size={15} /> Previous
            </button>
            <button
              className="avs-btn avs-btn-secondary"
              type="button"
              aria-label="Next page"
              disabled={page >= list.meta.pageCount || listQuery.isFetching}
              onClick={() => setPage((current) => current + 1)}
            >
              Next <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </section>

      {editor && (
        <LocationEditorDialog
          editor={editor}
          draft={draft}
          setDraft={setDraft}
          campuses={campuses.data ?? []}
          departments={departments.data ?? []}
          departmentsLoading={departments.isLoading}
          imageFile={imageFile}
          onImageFile={selectImage}
          existingImage={editorImage.data}
          imageLoading={editorImage.isLoading}
          imageError={
            imageError ||
            (editorImage.isError
              ? errorMessage(editorImage.error, "The saved image could not be loaded.")
              : "")
          }
          error={formError}
          pending={saveMutation.isPending}
          removeImagePending={actionMutation.isPending}
          onRemoveImage={
            editorImage.data?.imageUrl && editor.record
              ? () =>
                  setAction({
                    type: "remove-image",
                    kind: editor.kind,
                    record: editor.record!,
                  })
              : undefined
          }
          onClose={closeEditor}
          onSubmit={submitEditor}
        />
      )}

      <LocationActionDialog
        action={action}
        reason={actionReason}
        confirmationPhrase={confirmationPhrase}
        error={actionError}
        loading={actionMutation.isPending}
        onReason={setActionReason}
        onConfirmationPhrase={setConfirmationPhrase}
        onClose={closeAction}
        onConfirm={confirmAction}
      />

      <LocationImageViewer
        viewer={viewer}
        image={viewerImage.data}
        loading={viewerImage.isLoading}
        error={viewerImage.isError ? errorMessage(viewerImage.error, "The image could not be loaded.") : ""}
        onClose={() => setViewer(null)}
      />
    </div>
  );
}

function LocationTable({
  kind,
  records,
  dependencyLoadingId,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
  onViewImage,
}: {
  kind: LocationKind;
  records: LocationRecord[];
  dependencyLoadingId: string;
  onEdit: (kind: LocationKind, record: LocationRecord) => void;
  onArchive: (record: LocationRecord) => void;
  onRestore: (record: LocationRecord) => void;
  onDelete: (record: LocationRecord) => void;
  onViewImage: (record: LocationRecord) => void;
}) {
  return (
    <>
    <div className="avs-table-responsive" style={{ overflowX: "auto" }}>
      <table className="table" style={{ minWidth: 840, width: "100%" }}>
        <thead>
          <tr>
            <th>Name and code</th>
            <th>Location details</th>
            <th>Status</th>
            <th>Linked records</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>
                <strong>{record.name}</strong>
                <div className="muted" style={{ fontSize: "var(--text-xs)", marginTop: 3 }}>
                  {record.code}
                  {record.isTestData ? " · Test data" : ""}
                </div>
              </td>
              <td>{recordDetails(kind, record)}</td>
              <td>
                <span className={`badge ${record.archivedAt ? "" : record.isActive === false ? "badge-warning" : "badge-success"}`}>
                  {record.archivedAt ? "Archived" : record.isActive === false ? "Inactive" : "Active"}
                </span>
              </td>
              <td>
                <span className="muted" style={{ fontSize: "var(--text-sm)" }}>
                  {countSummary(record._count)}
                </span>
              </td>
              <td>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {record.imageStorageKey && (
                    <button
                      className="avs-btn avs-btn-ghost"
                      type="button"
                      aria-label={`View image for ${record.name}`}
                      onClick={() => onViewImage(record)}
                    >
                      <Eye size={14} /> Image
                    </button>
                  )}
                  {!record.archivedAt && (
                    <>
                      <button
                        className="avs-btn avs-btn-ghost"
                        type="button"
                        aria-label={`Edit ${record.name}`}
                        onClick={() => onEdit(kind, record)}
                      >
                        <Pencil size={14} /> Edit
                      </button>
                      <button
                        className="avs-btn avs-btn-danger-outline"
                        type="button"
                        aria-label={`Archive ${record.name}`}
                        onClick={() => onArchive(record)}
                      >
                        <Archive size={14} /> Archive
                      </button>
                    </>
                  )}
                  {record.archivedAt && (
                    <>
                      <button
                        className="avs-btn avs-btn-secondary"
                        type="button"
                        aria-label={`Restore ${record.name}`}
                        onClick={() => onRestore(record)}
                      >
                        <RotateCcw size={14} /> Restore
                      </button>
                      <button
                        className="avs-btn avs-btn-danger"
                        type="button"
                        aria-label={`Permanently delete ${record.name}`}
                        disabled={dependencyLoadingId === record.id}
                        onClick={() => onDelete(record)}
                      >
                        <Trash2 size={14} />
                        {dependencyLoadingId === record.id ? "Checking…" : "Delete"}
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="avs-cards-responsive" aria-label={`${pluralLabel(kind)} mobile list`}>
      {records.map((record) => (
        <article key={record.id} className="avs-entity-card" style={{ alignItems: "stretch" }}>
          <div className="avs-entity-card-body">
            <div className="avs-entity-card-name">{record.name}</div>
            <div className="avs-entity-card-meta">
              <span>{record.code}</span>
              {record.isTestData && <span>Test data</span>}
            </div>
            <div className="body-text-sm">{recordDetails(kind, record)}</div>
            <div className="avs-entity-card-meta">
              <span className={`badge ${record.archivedAt ? "" : record.isActive === false ? "badge-warning" : "badge-success"}`}>
                {record.archivedAt ? "Archived" : record.isActive === false ? "Inactive" : "Active"}
              </span>
              <span>{countSummary(record._count)}</span>
            </div>
            <div className="avs-entity-card-actions" style={{ marginTop: 6, flexWrap: "wrap" }}>
              {record.imageStorageKey && (
                <button
                  className="avs-btn avs-btn-ghost"
                  type="button"
                  aria-label={`View image for ${record.name}`}
                  onClick={() => onViewImage(record)}
                >
                  <Eye size={14} /> Image
                </button>
              )}
              {!record.archivedAt ? (
                <>
                  <button
                    className="avs-btn avs-btn-ghost"
                    type="button"
                    aria-label={`Edit ${record.name}`}
                    onClick={() => onEdit(kind, record)}
                  >
                    <Pencil size={14} /> Edit
                  </button>
                  <button
                    className="avs-btn avs-btn-danger-outline"
                    type="button"
                    aria-label={`Archive ${record.name}`}
                    onClick={() => onArchive(record)}
                  >
                    <Archive size={14} /> Archive
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="avs-btn avs-btn-secondary"
                    type="button"
                    aria-label={`Restore ${record.name}`}
                    onClick={() => onRestore(record)}
                  >
                    <RotateCcw size={14} /> Restore
                  </button>
                  <button
                    className="avs-btn avs-btn-danger"
                    type="button"
                    aria-label={`Permanently delete ${record.name}`}
                    disabled={dependencyLoadingId === record.id}
                    onClick={() => onDelete(record)}
                  >
                    <Trash2 size={14} />
                    {dependencyLoadingId === record.id ? "Checking..." : "Delete"}
                  </button>
                </>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
    </>
  );
}

function LocationActionDialog({
  action,
  reason,
  confirmationPhrase,
  error,
  loading,
  onReason,
  onConfirmationPhrase,
  onClose,
  onConfirm,
}: {
  action: LocationAction | null;
  reason: string;
  confirmationPhrase: string;
  error: string;
  loading: boolean;
  onReason: (value: string) => void;
  onConfirmationPhrase: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!action) return null;
  const blockedDelete = action.type === "delete" && !action.report.canDelete;
  const title =
    action.type === "archive"
      ? `Archive ${action.record.name}`
      : action.type === "restore"
        ? `Restore ${action.record.name}`
        : action.type === "remove-image"
          ? `Remove image from ${action.record.name}`
          : blockedDelete
            ? `Cannot delete ${action.record.name}`
            : `Permanently delete ${action.record.name}`;
  const description =
    action.type === "archive"
      ? "This hides the location from active hierarchy choices while preserving linked records."
      : action.type === "restore"
        ? "The parent location must be active before this record can be restored."
        : action.type === "remove-image"
          ? "The private image and its thumbnail will be removed from storage."
          : action.report.message;

  return (
    <ConfirmationDialog
      open
      title={title}
      description={description}
      variant={action.type === "restore" ? "default" : "danger"}
      confirmLabel={
        blockedDelete
          ? "Close"
          : action.type === "archive"
            ? "Archive location"
            : action.type === "restore"
              ? "Restore location"
              : action.type === "remove-image"
                ? "Remove image"
                : "Permanently delete"
      }
      loading={loading}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      {error && <div className="error-box" role="alert" style={{ marginTop: 14 }}>{error}</div>}
      {action.type === "archive" && (
        <FilterField label="Reason for archiving" htmlFor="location-archive-reason">
          <textarea
            id="location-archive-reason"
            className="input"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => onReason(event.target.value)}
          />
        </FilterField>
      )}
      {action.type === "delete" && (
        <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
          <DependencySummary report={action.report} />
          {action.report.canDelete && (
            <>
              <FilterField label="Reason for permanent deletion" htmlFor="location-delete-reason">
                <textarea
                  id="location-delete-reason"
                  className="input"
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => onReason(event.target.value)}
                />
              </FilterField>
              <div>
                <p className="muted" style={{ margin: "0 0 8px", fontSize: "var(--text-sm)" }}>
                  Type <code>{DELETE_PHRASE}</code> exactly.
                </p>
                <label className="avs-label" htmlFor="location-delete-phrase">Confirmation phrase</label>
                <input
                  id="location-delete-phrase"
                  className="input"
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmationPhrase}
                  onChange={(event) => onConfirmationPhrase(event.target.value)}
                />
              </div>
            </>
          )}
        </div>
      )}
    </ConfirmationDialog>
  );
}

function DependencySummary({ report }: { report: LocationDependencyReport }) {
  const linked = Object.entries(report.dependencies).filter(([, count]) => count > 0);
  return (
    <div
      style={{
        padding: 12,
        borderRadius: "var(--radius-md)",
        background: report.canDelete ? "var(--avs-success-surface)" : "var(--avs-error-surface)",
      }}
    >
      <strong>{report.totalDependencies} linked records found</strong>
      {linked.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          {linked.map(([name, count]) => (
            <li key={name}>{readableCountName(name)}: {count}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LocationImageViewer({
  viewer,
  image,
  loading,
  error,
  onClose,
}: {
  viewer: { kind: LocationKind; record: LocationRecord } | null;
  image?: LocationImageResponse;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  if (!viewer) return null;
  return (
    <div className="avs-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="avs-dialog avs-dialog-lg" role="dialog" aria-modal="true" aria-labelledby="location-image-view-title">
        <header className="avs-dialog-header">
          <div>
            <h2 id="location-image-view-title">{viewer.record.name}</h2>
            <p className="muted" style={{ margin: "2px 0 0" }}>{labelKind(viewer.kind)} image</p>
          </div>
          <button className="avs-btn avs-btn-ghost avs-btn-icon" type="button" aria-label="Close image viewer" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="avs-dialog-body">
          {loading ? (
            <div className="skeleton" aria-label="Loading location image" style={{ height: 320 }} />
          ) : error ? (
            <div className="error-box" role="alert">{error}</div>
          ) : image?.imageUrl ? (
            // Signed private-storage URLs are dynamic and cannot use Next Image's host allow-list.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.imageUrl} alt={`${viewer.record.name} location`} style={{ display: "block", width: "100%", maxHeight: "70dvh", objectFit: "contain", borderRadius: "var(--radius-md)" }} />
          ) : (
            <div className="muted" style={{ textAlign: "center", padding: 32 }}>No image is available.</div>
          )}
        </div>
        <footer className="avs-dialog-footer">
          <button className="avs-btn avs-btn-primary" type="button" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span aria-hidden style={{ color: "var(--avs-primary)", marginTop: 2 }}>{icon}</span>
        <div>
          <h2 id={title === "Campus hierarchy" ? "campus-hierarchy-title" : "location-management-title"} style={{ margin: 0, fontSize: "var(--text-lg)" }}>{title}</h2>
          <p className="muted" style={{ margin: "4px 0 0" }}>{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

function FilterField({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="field" style={{ marginTop: 12 }}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

function ListLoading() {
  return (
    <div role="status" aria-label="Loading location records" style={{ display: "grid", gap: 8 }}>
      <span className="skeleton" style={{ height: 54 }} />
      <span className="skeleton" style={{ height: 54 }} />
      <span className="skeleton" style={{ height: 54 }} />
    </div>
  );
}

function locationPayload(editor: LocationEditorState, draft: LocationDraft): Record<string, unknown> {
  const creating = editor.mode === "create";
  const payload: Record<string, unknown> = {
    code: draft.code.trim().toUpperCase(),
    name: draft.name.trim(),
  };
  if (creating) {
    if (draft.description.trim()) payload.description = draft.description.trim();
    if (!draft.isActive) payload.isActive = false;
  } else {
    payload.description = draft.description.trim() || null;
    payload.isActive = draft.isActive;
  }
  if (editor.kind === "campus") {
    if (creating) {
      if (draft.address.trim()) payload.address = draft.address.trim();
      if (draft.contactNumber.trim()) payload.contactNumber = draft.contactNumber.trim();
    } else {
      payload.address = draft.address.trim() || null;
      payload.contactNumber = draft.contactNumber.trim() || null;
    }
  } else if (editor.kind === "block") {
    payload.campusId = draft.campusId;
  } else if (editor.kind === "floor") {
    payload.blockId = draft.blockId;
    payload.level = Number(draft.level);
  } else {
    payload.floorId = draft.floorId;
    payload.roomType = draft.roomType;
    if (draft.roomType === "OTHER") {
      payload.customRoomTypeLabel = draft.customRoomTypeLabel.trim();
    }
    if (creating) {
      if (draft.roomNumber.trim()) payload.roomNumber = draft.roomNumber.trim();
      if (draft.capacity) payload.capacity = Number(draft.capacity);
      if (draft.departmentId) payload.departmentId = draft.departmentId;
    } else {
      payload.roomNumber = draft.roomNumber.trim() || null;
      payload.capacity = draft.capacity ? Number(draft.capacity) : null;
      payload.departmentId = draft.departmentId || null;
    }
  }
  return payload;
}

function recordDetails(kind: LocationKind, record: LocationRecord): string {
  if (kind === "campus") return record.address || record.description || "No address added";
  if (kind === "block") return record.campus?.name ?? "Campus unavailable";
  if (kind === "floor") {
    return [record.block?.campus?.name, record.block?.name, typeof record.level === "number" ? `Level ${record.level}` : ""]
      .filter(Boolean)
      .join(" · ");
  }
  return [
    record.floor?.block?.campus?.name,
    record.floor?.block?.name,
    record.floor?.name,
    record.roomNumber ? `Room ${record.roomNumber}` : "",
    roomTypeDisplayLabel(record),
  ]
    .filter(Boolean)
    .join(" · ");
}

function countSummary(counts?: Record<string, number>): string {
  if (!counts) return "None";
  const nonzero = Object.entries(counts).filter(([, count]) => count > 0);
  if (!nonzero.length) return "None";
  return nonzero
    .slice(0, 3)
    .map(([name, count]) => `${count} ${readableCountName(name)}`)
    .join(" · ");
}

function readableCountName(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function labelKind(kind: LocationKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function pluralLabel(kind: LocationKind): string {
  return kind === "campus" ? "Campuses" : `${labelKind(kind)}s`;
}
