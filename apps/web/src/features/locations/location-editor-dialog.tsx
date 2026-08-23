"use client";

import { useQuery } from "@tanstack/react-query";
import { ImageIcon, Trash2, Upload, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { api } from "@/lib/api";
import {
  ROOM_TYPES,
  type LocationImageResponse,
  type LocationKind,
  type LocationRecord,
} from "@/features/locations/location-contract";

export interface LocationDraft {
  code: string;
  name: string;
  description: string;
  address: string;
  contactNumber: string;
  campusId: string;
  blockId: string;
  floorId: string;
  level: string;
  roomNumber: string;
  roomType: string;
  customRoomTypeLabel: string;
  capacity: string;
  departmentId: string;
  isActive: boolean;
}

export interface LocationEditorState {
  mode: "create" | "edit";
  kind: LocationKind;
  record?: LocationRecord;
}

interface DepartmentOption {
  id: string;
  code: string;
  name: string;
}

interface LocationEditorDialogProps {
  editor: LocationEditorState;
  draft: LocationDraft;
  setDraft: Dispatch<SetStateAction<LocationDraft>>;
  campuses: LocationRecord[];
  departments: DepartmentOption[];
  departmentsLoading?: boolean;
  imageFile: File | null;
  onImageFile: (file: File | null) => void;
  existingImage?: LocationImageResponse;
  imageLoading?: boolean;
  imageError?: string;
  error?: string;
  pending?: boolean;
  removeImagePending?: boolean;
  onRemoveImage?: () => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function blankLocationDraft(): LocationDraft {
  return {
    code: "",
    name: "",
    description: "",
    address: "",
    contactNumber: "",
    campusId: "",
    blockId: "",
    floorId: "",
    level: "0",
    roomNumber: "",
    roomType: "CLASSROOM",
    customRoomTypeLabel: "",
    capacity: "",
    departmentId: "",
    isActive: true,
  };
}

export function LocationEditorDialog({
  editor,
  draft,
  setDraft,
  campuses,
  departments,
  departmentsLoading,
  imageFile,
  onImageFile,
  existingImage,
  imageLoading,
  imageError,
  error,
  pending,
  removeImagePending,
  onRemoveImage,
  onClose,
  onSubmit,
}: LocationEditorDialogProps) {
  const filePreview = useObjectUrl(imageFile);
  const needsCampus = editor.kind !== "campus";
  const needsBlock = editor.kind === "floor" || editor.kind === "room";
  const needsFloor = editor.kind === "room";
  const blocks = useQuery({
    queryKey: ["location-form", "blocks", draft.campusId],
    queryFn: () =>
      api.get<LocationRecord[]>(`/locations/blocks?campusId=${draft.campusId}`),
    enabled: needsBlock && Boolean(draft.campusId),
  });
  const floors = useQuery({
    queryKey: ["location-form", "floors", draft.blockId],
    queryFn: () =>
      api.get<LocationRecord[]>(`/locations/floors?blockId=${draft.blockId}`),
    enabled: needsFloor && Boolean(draft.blockId),
  });
  const title = `${editor.mode === "create" ? "Add" : "Edit"} ${labelKind(editor.kind)}`;
  const previewUrl = filePreview || existingImage?.imageUrl || "";

  return (
    <div
      className="avs-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <form
        className="avs-dialog avs-dialog-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-editor-title"
        onSubmit={onSubmit}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !pending) onClose();
        }}
        style={{ maxHeight: "min(92dvh, 920px)", overflow: "hidden" }}
      >
        <header className="avs-dialog-header">
          <div>
            <h2 id="location-editor-title">{title}</h2>
            <p className="muted" style={{ margin: "2px 0 0" }}>
              {editor.mode === "create"
                ? "Create a relational campus location record."
                : `Update ${editor.record?.name ?? "this location"}.`}
            </p>
          </div>
          <button
            className="avs-btn avs-btn-ghost avs-btn-icon"
            type="button"
            aria-label="Close location editor"
            disabled={pending}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>

        <div className="avs-dialog-body" style={{ overflowY: "auto" }}>
          {error && (
            <div className="error-box" role="alert" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
              gap: "var(--space-4)",
            }}
          >
            {needsCampus && (
              <Field label="Campus" htmlFor="location-campus">
                <select
                  id="location-campus"
                  className="input"
                  required
                  value={draft.campusId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      campusId: event.target.value,
                      blockId: "",
                      floorId: "",
                    }))
                  }
                >
                  <option value="">Select campus</option>
                  {campuses.map((campus) => (
                    <option key={campus.id} value={campus.id}>
                      {campus.code} - {campus.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {needsBlock && (
              <Field label="Block" htmlFor="location-block">
                <select
                  id="location-block"
                  className="input"
                  required
                  disabled={!draft.campusId || blocks.isLoading}
                  value={draft.blockId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      blockId: event.target.value,
                      floorId: "",
                    }))
                  }
                >
                  <option value="">
                    {blocks.isLoading ? "Loading blocks..." : "Select block"}
                  </option>
                  {blocks.data?.map((block) => (
                    <option key={block.id} value={block.id}>
                      {block.code} - {block.name}
                    </option>
                  ))}
                </select>
                {blocks.isError && (
                  <small className="avs-field-error">Blocks could not be loaded.</small>
                )}
              </Field>
            )}

            {needsFloor && (
              <Field label="Floor" htmlFor="location-floor">
                <select
                  id="location-floor"
                  className="input"
                  required
                  disabled={!draft.blockId || floors.isLoading}
                  value={draft.floorId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      floorId: event.target.value,
                    }))
                  }
                >
                  <option value="">
                    {floors.isLoading ? "Loading floors..." : "Select floor"}
                  </option>
                  {floors.data?.map((floor) => (
                    <option key={floor.id} value={floor.id}>
                      {floor.code} - {floor.name}
                    </option>
                  ))}
                </select>
                {floors.isError && (
                  <small className="avs-field-error">Floors could not be loaded.</small>
                )}
              </Field>
            )}

            <Field label={`${labelKind(editor.kind)} code`} htmlFor="location-code">
              <input
                id="location-code"
                aria-label="Code"
                className="input"
                required
                minLength={1}
                maxLength={editor.kind === "room" ? 40 : 30}
                value={draft.code}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    code: event.target.value.toUpperCase(),
                  }))
                }
              />
            </Field>

            <Field label={`${labelKind(editor.kind)} name`} htmlFor="location-name">
              <input
                id="location-name"
                aria-label="Display name"
                className="input"
                required
                minLength={2}
                maxLength={editor.kind === "campus" ? 160 : 140}
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </Field>

            {editor.kind === "campus" && (
              <>
                <Field label="Location / address" htmlFor="location-address">
                  <input
                    id="location-address"
                    className="input"
                    maxLength={2000}
                    value={draft.address}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        address: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Contact number" htmlFor="location-contact">
                  <input
                    id="location-contact"
                    className="input"
                    type="tel"
                    maxLength={30}
                    value={draft.contactNumber}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        contactNumber: event.target.value,
                      }))
                    }
                  />
                </Field>
              </>
            )}

            {editor.kind === "floor" && (
              <Field label="Floor number / level" htmlFor="location-level">
                <input
                  id="location-level"
                  aria-label="Floor number / level"
                  className="input"
                  type="number"
                  min={-10}
                  max={200}
                  required
                  value={draft.level}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, level: event.target.value }))
                  }
                />
              </Field>
            )}

            {editor.kind === "room" && (
              <>
                <Field label="Room number" htmlFor="location-room-number">
                  <input
                    id="location-room-number"
                    aria-label="Room number"
                    className="input"
                    maxLength={40}
                    value={draft.roomNumber}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        roomNumber: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Room type" htmlFor="location-room-type">
                  <select
                    id="location-room-type"
                    aria-label="Room type"
                    className="input"
                    required
                    value={draft.roomType}
                    onChange={(event) =>
                      setDraft((current) => {
                        const roomType = event.target.value;
                        return {
                          ...current,
                          roomType,
                          customRoomTypeLabel:
                            roomType === "OTHER"
                              ? current.customRoomTypeLabel
                              : "",
                        };
                      })
                    }
                  >
                    {ROOM_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </Field>
                {draft.roomType === "OTHER" && (
                  <Field
                    label="Custom room type label"
                    htmlFor="location-custom-room-type-label"
                  >
                    <input
                      id="location-custom-room-type-label"
                      aria-label="Custom room type label"
                      className="input"
                      required
                      minLength={2}
                      maxLength={80}
                      value={draft.customRoomTypeLabel}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          customRoomTypeLabel: event.target.value,
                        }))
                      }
                    />
                  </Field>
                )}
                <Field label="Capacity" htmlFor="location-capacity">
                  <input
                    id="location-capacity"
                    aria-label="Capacity"
                    className="input"
                    type="number"
                    min={1}
                    max={100000}
                    value={draft.capacity}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        capacity: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Department" htmlFor="location-department">
                  <select
                    id="location-department"
                    className="input"
                    disabled={departmentsLoading}
                    value={draft.departmentId}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        departmentId: event.target.value,
                      }))
                    }
                  >
                    <option value="">No department</option>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.code} - {department.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}

            <Field label="Status" htmlFor="location-status">
              <select
                id="location-status"
                className="input"
                value={draft.isActive ? "ACTIVE" : "INACTIVE"}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    isActive: event.target.value === "ACTIVE",
                  }))
                }
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </Field>
          </div>

          <Field label="Description" htmlFor="location-description" full>
            <textarea
              id="location-description"
              className="input"
              rows={4}
              maxLength={2000}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              style={{ resize: "vertical" }}
            />
          </Field>

          <section
            aria-labelledby="location-image-heading"
            style={{
              marginTop: "var(--space-5)",
              border: "1px solid var(--avs-border)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-4)",
              display: "grid",
              gap: "var(--space-3)",
            }}
          >
            <div>
              <h3 id="location-image-heading" style={{ margin: 0, fontSize: "var(--text-base)" }}>
                Optional image
              </h3>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: "var(--text-sm)" }}>
                JPG, PNG or WEBP, up to 10 MB. Images are loaded only when this editor is open.
              </p>
            </div>
            {imageLoading ? (
              <div className="skeleton" aria-label="Loading location image" style={{ height: 180 }} />
            ) : previewUrl ? (
              // Signed storage URLs are dynamic and cannot use Next Image's static host allow-list.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={`${draft.name || labelKind(editor.kind)} preview`}
                style={{
                  width: "100%",
                  maxHeight: 260,
                  objectFit: "cover",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--avs-border)",
                }}
              />
            ) : (
              <div
                className="muted"
                style={{
                  minHeight: 120,
                  display: "grid",
                  placeItems: "center",
                  border: "1px dashed var(--avs-border)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <span style={{ textAlign: "center" }}>
                  <ImageIcon size={28} style={{ display: "block", margin: "0 auto 8px" }} />
                  No image added
                </span>
              </div>
            )}
            {imageError && <small className="avs-field-error">{imageError}</small>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <label className="avs-btn avs-btn-secondary" htmlFor="location-image-file">
                <Upload size={15} /> {previewUrl ? "Replace image" : "Choose image"}
              </label>
              <input
                id="location-image-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                hidden
                disabled={pending}
                onChange={(event) => onImageFile(event.target.files?.[0] ?? null)}
              />
              {imageFile && (
                <button
                  className="avs-btn avs-btn-ghost"
                  type="button"
                  onClick={() => onImageFile(null)}
                >
                  Clear selected image
                </button>
              )}
              {!imageFile && existingImage?.imageUrl && onRemoveImage && (
                <button
                  className="avs-btn avs-btn-danger-outline"
                  type="button"
                  disabled={removeImagePending}
                  onClick={onRemoveImage}
                >
                  <Trash2 size={15} /> Remove image
                </button>
              )}
            </div>
          </section>
        </div>

        <footer className="avs-dialog-footer">
          <button
            className="avs-btn avs-btn-secondary"
            type="button"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="avs-btn avs-btn-primary" disabled={pending}>
            {pending
              ? "Saving..."
              : editor.mode === "create"
                ? `Add ${labelKind(editor.kind).toLowerCase()}`
                : "Save changes"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
  full,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className="field" style={full ? { marginTop: "var(--space-4)" } : undefined}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

function labelKind(kind: LocationKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function useObjectUrl(file: File | null): string {
  const url = useMemo(
    () =>
      file && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : "",
    [file],
  );
  useEffect(() => {
    return () => {
      if (url && typeof URL.revokeObjectURL === "function")
        URL.revokeObjectURL(url);
    };
  }, [url]);
  return url;
}
