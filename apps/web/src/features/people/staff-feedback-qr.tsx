"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Download,
  Eye,
  FileText,
  QrCode,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface StaffFeedbackQrDepartment {
  id: string;
  code: string;
  name: string;
}

interface StaffFeedbackQrResponse {
  staff: {
    publicId: string;
    staffId: string;
    name: string;
    designation: string | null;
    department: StaffFeedbackQrDepartment | null;
    targetType: "STAFF" | "HOD" | "PRINCIPAL" | "VICE_PRINCIPAL";
  };
  target: {
    id: string;
    targetType: string;
    targetName: string;
    description: string | null;
    isActive: boolean;
  } | null;
  qr: {
    id: string;
    secureUrl: string;
    status: string;
    expiryDate: string | null;
    createdAt: string;
  } | null;
  created?: {
    target: boolean;
    qr: boolean;
  };
}

interface StaffFeedbackQrPanelProps {
  staffPublicId: string;
  staffName: string;
  accountStatus: string;
  hasStaffProfile: boolean;
  canManage: boolean;
  canDownload: boolean;
}

export function isStaffFeedbackQrEligible(hasStaffProfile: boolean): boolean {
  // The server performs the authoritative role and college-scope check.
  return hasStaffProfile;
}

export function StaffFeedbackQrPanel({
  staffPublicId,
  staffName,
  accountStatus,
  hasStaffProfile,
  canManage,
  canDownload,
}: StaffFeedbackQrPanelProps) {
  const queryClient = useQueryClient();
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const eligible = isStaffFeedbackQrEligible(hasStaffProfile);
  const activeStaff = accountStatus === "ACTIVE";
  const queryKey = ["staff-feedback-qr", staffPublicId] as const;
  const endpoint = `/admin/feedback/staff/${encodeURIComponent(staffPublicId)}/qr`;

  const record = useQuery({
    queryKey,
    queryFn: () => api.get<StaffFeedbackQrResponse>(endpoint),
    enabled: canManage && eligible && activeStaff,
  });

  const ensureQr = useMutation({
    mutationFn: () => api.post<StaffFeedbackQrResponse>(`${endpoint}/ensure`),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
      setActionError("");
      setActionMessage(
        result.created?.qr
          ? `Feedback QR generated for ${result.staff.name}.`
          : "The staff feedback QR is active and ready to use.",
      );
    },
    onError: (caught) => {
      setActionMessage("");
      setActionError(
        caught instanceof Error
          ? caught.message
          : "The staff feedback QR could not be generated.",
      );
    },
  });

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  if (!canManage || !eligible) return null;

  const qr = record.data?.qr ?? null;
  const target = record.data?.target ?? null;
  const qrExpired = Boolean(
    qr?.expiryDate && new Date(qr.expiryDate).getTime() <= record.dataUpdatedAt,
  );
  const targetTypeChanged = Boolean(
    target && record.data?.staff.targetType !== target.targetType,
  );
  const isActiveQr = Boolean(
    qr?.status === "ACTIVE" &&
      target?.isActive &&
      !qrExpired &&
      !targetTypeChanged,
  );
  const displayStatus = !target?.isActive
    ? "Target inactive"
    : targetTypeChanged
      ? "Role changed - activation required"
      : qrExpired
        ? "Expired"
        : (qr?.status ?? "Unavailable");

  async function copySecureUrl() {
    if (!qr?.secureUrl) return;
    setBusyAction("copy");
    setActionError("");
    try {
      await copyText(qr.secureUrl);
      setActionMessage("Secure staff feedback link copied.");
    } catch (caught) {
      setActionMessage("");
      setActionError(
        caught instanceof Error
          ? caught.message
          : "The secure feedback link could not be copied.",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function previewQr() {
    if (!qr) return;
    setBusyAction("preview");
    setActionError("");
    try {
      const blob = await api.blob(
        `/admin/feedback/qr/${encodeURIComponent(qr.id)}/download?format=png`,
      );
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
      setActionMessage("Secure QR preview loaded.");
    } catch (caught) {
      setActionMessage("");
      setActionError(
        caught instanceof Error
          ? caught.message
          : "The QR preview could not be loaded.",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function downloadQr(format: "png" | "pdf") {
    if (!qr) return;
    setBusyAction(format);
    setActionError("");
    try {
      await api.download(
        `/admin/feedback/qr/${encodeURIComponent(qr.id)}/download?format=${format}`,
        `staff-feedback-${qr.id}.${format}`,
      );
      setActionMessage(`${format.toUpperCase()} download prepared.`);
    } catch (caught) {
      setActionMessage("");
      setActionError(
        caught instanceof Error
          ? caught.message
          : `The ${format.toUpperCase()} file could not be downloaded.`,
      );
    } finally {
      setBusyAction("");
    }
  }

  return (
    <section
      className="avs-card staff-feedback-qr-panel"
      aria-labelledby="staff-feedback-qr-title"
    >
      <div className="staff-feedback-qr-heading">
        <span className="staff-feedback-qr-icon" aria-hidden="true">
          <QrCode size={24} />
        </span>
        <div>
          <h2 id="staff-feedback-qr-title">Staff feedback QR</h2>
          <p>
            Generate and manage the secure feedback code assigned to {staffName}
            .
          </p>
        </div>
      </div>

      {!activeStaff ? (
        <div className="staff-feedback-qr-notice" role="status">
          Feedback QR generation is unavailable while this staff account is{" "}
          {accountStatus.toLowerCase()}.
        </div>
      ) : record.isLoading ? (
        <div className="staff-feedback-qr-notice" role="status">
          Checking staff feedback QR status...
        </div>
      ) : record.isError ? (
        <div className="staff-feedback-qr-error" role="alert">
          <span>
            {record.error instanceof Error
              ? record.error.message
              : "The staff feedback QR status could not be loaded."}
          </span>
          <button
            type="button"
            className="avs-btn avs-btn-secondary avs-btn-sm"
            onClick={() => void record.refetch()}
          >
            <RefreshCw size={15} /> Retry
          </button>
        </div>
      ) : (
        <>
          {actionMessage && (
            <div className="staff-feedback-qr-success" role="status">
              <ShieldCheck size={17} aria-hidden="true" /> {actionMessage}
            </div>
          )}
          {actionError && (
            <div className="staff-feedback-qr-error" role="alert">
              {actionError}
            </div>
          )}

          {qr && target ? (
            <>
              <dl className="staff-feedback-qr-details">
                <div>
                  <dt>Target</dt>
                  <dd>{target.targetName}</dd>
                </div>
                <div>
                  <dt>Feedback type</dt>
                  <dd>{formatTargetType(target.targetType)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span
                      className={`avs-badge ${isActiveQr ? "avs-badge-success" : "avs-badge-warning"}`}
                    >
                      {formatTargetType(displayStatus)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Expiry</dt>
                  <dd>
                    {qr.expiryDate ? formatDate(qr.expiryDate) : "No expiry"}
                  </dd>
                </div>
              </dl>

              {previewUrl && (
                <div className="staff-feedback-qr-preview">
                  {/* The server creates this image from its protected token; no token hash is sent to the browser. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt={`Feedback QR code for ${staffName}`}
                  />
                  <button
                    type="button"
                    className="avs-btn avs-btn-ghost avs-btn-sm"
                    onClick={() => {
                      URL.revokeObjectURL(previewUrl);
                      setPreviewUrl(null);
                    }}
                  >
                    <X size={15} /> Close preview
                  </button>
                </div>
              )}

              <div className="staff-feedback-qr-actions">
                {!isActiveQr && (
                  <button
                    type="button"
                    className="avs-btn avs-btn-primary"
                    disabled={ensureQr.isPending}
                    onClick={() => ensureQr.mutate()}
                  >
                    <RefreshCw size={16} />
                    {ensureQr.isPending
                      ? "Activating..."
                      : "Activate feedback QR"}
                  </button>
                )}
                {isActiveQr && (
                  <button
                    type="button"
                    className="avs-btn avs-btn-secondary"
                    disabled={busyAction === "copy"}
                    onClick={() => void copySecureUrl()}
                  >
                    <Copy size={16} /> Copy secure link
                  </button>
                )}
                {isActiveQr && canDownload && (
                  <>
                    <button
                      type="button"
                      className="avs-btn avs-btn-secondary"
                      disabled={busyAction === "preview"}
                      onClick={() => void previewQr()}
                    >
                      <Eye size={16} /> Preview QR
                    </button>
                    <button
                      type="button"
                      className="avs-btn avs-btn-secondary"
                      disabled={busyAction === "png"}
                      onClick={() => void downloadQr("png")}
                    >
                      <Download size={16} /> PNG
                    </button>
                    <button
                      type="button"
                      className="avs-btn avs-btn-secondary"
                      disabled={busyAction === "pdf"}
                      onClick={() => void downloadQr("pdf")}
                    >
                      <FileText size={16} /> Poster PDF
                    </button>
                  </>
                )}
                <Link
                  className="avs-btn avs-btn-ghost"
                  href="/admin/feedback/qr-management"
                >
                  Open QR management
                </Link>
              </div>
            </>
          ) : (
            <div className="staff-feedback-qr-empty">
              <div>
                <strong>No staff feedback QR is active</strong>
                <p>
                  Generate one secure code for this profile. Repeated clicks
                  reuse the same active QR.
                </p>
              </div>
              <button
                type="button"
                className="avs-btn avs-btn-primary"
                disabled={ensureQr.isPending}
                onClick={() => ensureQr.mutate()}
              >
                <QrCode size={17} />
                {ensureQr.isPending
                  ? "Generating..."
                  : "Generate staff feedback QR"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function formatTargetType(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleDateString();
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied)
    throw new Error("Clipboard access is unavailable in this browser.");
}
