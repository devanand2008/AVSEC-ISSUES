"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Clipboard, ClipboardList, DoorOpen, Download, QrCode, RefreshCw, ShieldCheck, ShieldOff, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { useAuth } from "@/providers/auth-provider";
import { api, ApiError } from "@/lib/api";
import type { SelectOption } from "@/lib/types";

interface QrAnalytics {
  windowDays: number;
  activeRoomQrCodes: number;
  activeFeedbackQrCodes: number;
  activeGenericQrCodes: number;
  roomQrIssueReports: number;
  roomQrValidations: number;
  feedbackQrValidations: number;
  feedbackQrScans: number;
  feedbackQrFailures: number;
  genericQrScans: number;
  genericQrFailures: number;
}
interface GenericQrCode {
  id: string;
  qrType: string;
  label: string;
  destination: string;
  entityType: string | null;
  entityId: string | null;
  status: string;
  expiryDate: string | null;
  scanCount: number;
  lastScannedAt: string | null;
  qrUrl: string;
  createdAt: string;
}
interface GeneratedQrCode {
  id: string;
  qrType: string;
  label: string;
  destination: string;
  status: string;
  expiryDate: string | null;
  secureUrl: string;
  dataUrl: string;
}

const cards = [
  {
    href: "/scan-qr",
    title: "Mobile scanner",
    detail: "Validate room, block, floor, class, announcement, app and feedback QR codes from one camera screen.",
    icon: Camera,
  },
  {
    href: "/admin/locations",
    title: "Room QR sheets",
    detail: "Select a floor in Campus setup, then print issue-reporting room labels.",
    icon: DoorOpen,
  },
  {
    href: "/admin/feedback/qr-management",
    title: "Feedback QR codes",
    detail: "Generate, rotate, download and disable secure feedback QR codes.",
    icon: Star,
  },
  {
    href: "/admin/operations",
    title: "QR audit trail",
    detail: "Review validation events and other operational activity.",
    icon: ClipboardList,
  },
];

export default function AdminQrManagementPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const canViewAnalytics = ["locations.qr", "feedback.qr.manage", "announcements.publish_college", "settings.manage", "audit.read"].some((permission) =>
    permissions.includes(permission),
  );
  const canViewGenericQr = ["locations.qr", "announcements.publish_college", "settings.manage", "audit.read"].some((permission) =>
    permissions.includes(permission),
  );
  const canManageGenericQr = ["locations.qr", "announcements.publish_college", "settings.manage"].some((permission) =>
    permissions.includes(permission),
  );
  const [form, setForm] = useState({
    qrType: "APPLICATION",
    label: "",
    destination: "",
    campusId: "",
    blockId: "",
    floorId: "",
    entityId: "",
    expiryDate: "",
  });
  const [preview, setPreview] = useState<GeneratedQrCode | null>(null);
  const analytics = useQuery({
    queryKey: ["qr-analytics"],
    queryFn: () => api.get<QrAnalytics>("/qr/analytics"),
    enabled: canViewAnalytics,
  });
  const genericCodes = useQuery({
    queryKey: ["generic-qr-codes"],
    queryFn: () => api.get<GenericQrCode[]>("/qr/codes"),
    enabled: canViewGenericQr,
  });
  const campuses = useQuery({
    queryKey: ["qr-campuses"],
    queryFn: () => api.get<SelectOption[]>("/locations/campuses"),
    enabled: canManageGenericQr && ["BLOCK", "FLOOR"].includes(form.qrType),
  });
  const blocks = useQuery({
    queryKey: ["qr-blocks", form.campusId],
    queryFn: () => api.get<SelectOption[]>(`/locations/blocks?campusId=${form.campusId}`),
    enabled: canManageGenericQr && ["BLOCK", "FLOOR"].includes(form.qrType) && Boolean(form.campusId),
  });
  const floors = useQuery({
    queryKey: ["qr-floors", form.blockId],
    queryFn: () => api.get<SelectOption[]>(`/locations/floors?blockId=${form.blockId}`),
    enabled: canManageGenericQr && form.qrType === "FLOOR" && Boolean(form.blockId),
  });
  const createQr = useMutation({
    mutationFn: () =>
      api.post<GeneratedQrCode>("/qr/codes", {
        qrType: form.qrType,
        label: form.label,
        ...(form.destination.trim() ? { destination: form.destination.trim() } : {}),
        ...(selectedEntityId(form) ? { entityId: selectedEntityId(form) } : {}),
        ...(form.expiryDate ? { expiryDate: form.expiryDate } : {}),
      }),
    onSuccess: (created) => {
      setPreview(created);
      setForm((current) => ({ ...current, label: "", destination: "", entityId: "", expiryDate: "" }));
      void queryClient.invalidateQueries({ queryKey: ["generic-qr-codes"] });
      void queryClient.invalidateQueries({ queryKey: ["qr-analytics"] });
    },
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" | "REVOKED" }) =>
      api.patch<{ id: string; status: string }>(`/qr/codes/${id}/status`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["generic-qr-codes"] });
      void queryClient.invalidateQueries({ queryKey: ["qr-analytics"] });
    },
  });
  const regenerate = useMutation({
    mutationFn: (id: string) => api.post<GeneratedQrCode>(`/qr/codes/${id}/regenerate`, {}),
    onSuccess: (created) => {
      setPreview(created);
      void queryClient.invalidateQueries({ queryKey: ["generic-qr-codes"] });
      void queryClient.invalidateQueries({ queryKey: ["qr-analytics"] });
    },
  });
  const createDisabled =
    !form.label.trim() ||
    (form.qrType === "BLOCK" && !form.blockId) ||
    (form.qrType === "FLOOR" && !form.floorId) ||
    (["CLASS", "ANNOUNCEMENT"].includes(form.qrType) && !form.entityId.trim());

  const metrics = analytics.data
    ? [
        { label: "Active room QR", value: analytics.data.activeRoomQrCodes, icon: DoorOpen, color: "#0b3d91", bg: "#eff6ff" },
        { label: "Active feedback QR", value: analytics.data.activeFeedbackQrCodes, icon: Star, color: "#7c3aed", bg: "#f5f3ff" },
        { label: "Active generic QR", value: analytics.data.activeGenericQrCodes, icon: ShieldCheck, color: "#2563eb", bg: "#eff6ff" },
        { label: "Room QR reports", value: analytics.data.roomQrIssueReports, icon: QrCode, color: "#16a34a", bg: "#f0fdf4" },
      ]
    : [];

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            QR management
          </h1>
          <p className="page-subtitle">Manage campus issue-reporting labels, feedback QR codes and mobile scan validation.</p>
        </div>
        <Link href="/scan-qr" className="btn btn-primary">
          <QrCode size={18} />
          Scan QR
        </Link>
      </div>

      {analytics.isLoading ? (
        <LoadingState />
      ) : analytics.isError ? (
        <ErrorState message="QR analytics could not be loaded." />
      ) : (
        analytics.data && (
          <>
            <section className="metric-grid">
              {metrics.map(({ label, value, icon: Icon, color, bg }) => (
                <article className="card metric-card" key={label}>
                  <span className="metric-icon" style={{ color, background: bg }}>
                    <Icon size={21} />
                  </span>
                  <div>
                    <span className="muted">{label}</span>
                    <strong>{value}</strong>
                  </div>
                </article>
              ))}
            </section>
            <section className="card" style={{ padding: 18, marginTop: 18 }}>
              <div className="section-head">
                <div>
                  <h2>30-day scan activity</h2>
                  <p>Validated scans and downstream submissions for the current college.</p>
                </div>
              </div>
              <div className="form-grid">
                <div className="field">
                  <span>Room validations</span>
                  <strong>{analytics.data.roomQrValidations}</strong>
                </div>
                <div className="field">
                  <span>Feedback validations</span>
                  <strong>{analytics.data.feedbackQrValidations}</strong>
                </div>
                <div className="field">
                  <span>Feedback failures</span>
                  <strong>{analytics.data.feedbackQrFailures}</strong>
                </div>
                <div className="field">
                  <span>Generic QR scans</span>
                  <strong>{analytics.data.genericQrScans}</strong>
                </div>
                <div className="field">
                  <span>Generic QR failures</span>
                  <strong>{analytics.data.genericQrFailures}</strong>
                </div>
              </div>
            </section>
          </>
        )
      )}

      {canManageGenericQr && (
        <section className="card" style={{ padding: 18, marginTop: 18 }}>
          <div className="section-head">
            <div>
              <h2>Create secure QR code</h2>
              <p>Generate app, block, floor, class, announcement or internal-link QR codes with server validation.</p>
            </div>
          </div>
          {createQr.isError && <div className="error-box">{errorMessage(createQr.error)}</div>}
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              createQr.mutate();
            }}
          >
            <div className="field">
              <label htmlFor="qrType">QR type</label>
              <select
                id="qrType"
                className="input"
                value={form.qrType}
                onChange={(event) =>
                  setForm({
                    ...form,
                    qrType: event.target.value,
                    campusId: "",
                    blockId: "",
                    floorId: "",
                    entityId: "",
                  })
                }
              >
                {["APPLICATION", "BLOCK", "FLOOR", "CLASS", "ANNOUNCEMENT", "LINK"].map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="qrLabel">Label</label>
              <input
                id="qrLabel"
                className="input"
                maxLength={180}
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
                placeholder="e.g. CSE Block issue QR"
              />
            </div>
            {["BLOCK", "FLOOR"].includes(form.qrType) && (
              <>
                <SelectField
                  label="Campus"
                  value={form.campusId}
                  options={campuses.data}
                  onChange={(campusId) => setForm({ ...form, campusId, blockId: "", floorId: "" })}
                />
                <SelectField
                  label="Block"
                  value={form.blockId}
                  options={blocks.data}
                  disabled={!form.campusId}
                  onChange={(blockId) => setForm({ ...form, blockId, floorId: "" })}
                />
                {form.qrType === "FLOOR" && (
                  <SelectField
                    label="Floor"
                    value={form.floorId}
                    options={floors.data}
                    disabled={!form.blockId}
                    onChange={(floorId) => setForm({ ...form, floorId })}
                  />
                )}
              </>
            )}
            {["CLASS", "ANNOUNCEMENT"].includes(form.qrType) && (
              <div className="field">
                <label htmlFor="entityId">Linked entity ID</label>
                <input
                  id="entityId"
                  className="input"
                  value={form.entityId}
                  onChange={(event) => setForm({ ...form, entityId: event.target.value })}
                  placeholder={form.qrType === "CLASS" ? "Section UUID" : "Announcement UUID"}
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="destination">Destination path</label>
              <input
                id="destination"
                className="input"
                maxLength={500}
                value={form.destination}
                onChange={(event) => setForm({ ...form, destination: event.target.value })}
                placeholder={form.qrType === "BLOCK" || form.qrType === "FLOOR" ? "/report-issue" : "/"}
              />
            </div>
            <div className="field">
              <label htmlFor="expiryDate">Expiry date</label>
              <input
                id="expiryDate"
                className="input"
                type="datetime-local"
                value={form.expiryDate}
                onChange={(event) => setForm({ ...form, expiryDate: event.target.value })}
              />
            </div>
            <div className="field" style={{ justifyContent: "end" }}>
              <button className="btn btn-primary" disabled={createDisabled || createQr.isPending}>
                <QrCode size={17} />
                {createQr.isPending ? "Generating..." : "Generate QR"}
              </button>
            </div>
          </form>
        </section>
      )}

      {preview && (
        <section className="card" style={{ padding: 18, marginTop: 18 }}>
          <div className="section-head">
            <div>
              <h2>{preview.label}</h2>
              <p>{preview.qrType.replaceAll("_", " ")} QR is active and ready for printing.</p>
            </div>
            <button className="btn btn-secondary" onClick={() => downloadDataUrl(preview)}>
              <Download size={17} />
              Download PNG
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.dataUrl} alt={`${preview.label} QR code`} style={{ width: 220, maxWidth: "100%", borderRadius: 8, background: "#fff", border: "1px solid var(--border)", padding: 10 }} />
          <p className="muted" style={{ wordBreak: "break-all" }}>{preview.secureUrl}</p>
        </section>
      )}

      {canViewGenericQr && (
        <section className="card table-wrap qr-management-table" style={{ padding: 18, marginTop: 18 }}>
          <div className="section-head">
            <div>
              <h2>Generic QR codes</h2>
              <p>Server-validated QR codes for app entry, issue locations, class pages and announcements.</p>
            </div>
          </div>
          {genericCodes.isLoading ? (
            <LoadingState />
          ) : genericCodes.isError ? (
            <ErrorState message="Generic QR codes could not be loaded." />
          ) : genericCodes.data?.length ? (
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Scans</th>
                  <th>Destination</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {genericCodes.data.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.label}</strong>
                      <small className="muted" style={{ display: "block" }}>
                        {row.entityType ?? "No linked entity"} {row.entityId ? `- ${row.entityId}` : ""}
                      </small>
                    </td>
                    <td>{row.qrType.replaceAll("_", " ")}</td>
                    <td>{row.status}</td>
                    <td>{row.scanCount}</td>
                    <td style={{ wordBreak: "break-all" }}>{row.destination}</td>
                    <td>
                      <div className="photo-action-row">
                        <button type="button" className="btn btn-secondary" onClick={() => void navigator.clipboard?.writeText(row.qrUrl)}>
                          <Clipboard size={16} />
                          Copy
                        </button>
                        <button type="button" className="btn btn-secondary" disabled={regenerate.isPending} onClick={() => regenerate.mutate(row.id)}>
                          <RefreshCw size={16} />
                          Rotate
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={updateStatus.isPending || row.status === "REVOKED"}
                          onClick={() => updateStatus.mutate({ id: row.id, status: row.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}
                        >
                          <ShieldCheck size={16} />
                          {row.status === "ACTIVE" ? "Disable" : "Activate"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={updateStatus.isPending || row.status === "REVOKED"}
                          onClick={() => updateStatus.mutate({ id: row.id, status: "REVOKED" })}
                        >
                          <ShieldOff size={16} />
                          Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted" style={{ margin: 0 }}>No generic QR codes have been generated yet.</p>
          )}
        </section>
      )}

      <section className="dashboard-grid" style={{ marginTop: 18 }}>
        {cards.map(({ href, title, detail, icon: Icon }) => (
          <Link className="card" href={href} key={href} style={{ padding: 18, display: "grid", gap: 12 }}>
            <span className="metric-icon" style={{ color: "#0b3d91", background: "#eff6ff" }}>
              <Icon size={21} />
            </span>
            <div>
              <h2 style={{ margin: "0 0 6px" }}>{title}</h2>
              <p className="page-subtitle" style={{ margin: 0 }}>{detail}</p>
            </div>
          </Link>
        ))}
        <a className="card" href="/CAMERA_AND_HTTPS_SETUP.md" style={{ padding: 18, display: "grid", gap: 12 }}>
          <span className="metric-icon" style={{ color: "#16a34a", background: "#f0fdf4" }}>
            <ShieldCheck size={21} />
          </span>
          <div>
            <h2 style={{ margin: "0 0 6px" }}>Camera setup</h2>
            <p className="page-subtitle" style={{ margin: 0 }}>Open the HTTPS and mobile camera setup checklist.</p>
          </div>
        </a>
      </section>
    </>
  );
}

function selectedEntityId(form: { qrType: string; blockId: string; floorId: string; entityId: string }): string {
  if (form.qrType === "BLOCK") return form.blockId;
  if (form.qrType === "FLOOR") return form.floorId;
  if (["CLASS", "ANNOUNCEMENT"].includes(form.qrType)) return form.entityId.trim();
  return "";
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The QR code could not be generated.";
}

function downloadDataUrl(row: GeneratedQrCode): void {
  const anchor = document.createElement("a");
  anchor.href = row.dataUrl;
  anchor.download = `avs-${row.qrType.toLowerCase()}-${row.id}.png`;
  anchor.click();
}

function SelectField({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options?: SelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <select className="input" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select {label.toLowerCase()}</option>
        {options?.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
}
