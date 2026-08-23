"use client";

import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useDialogFocus } from "./use-dialog-focus";

interface ConfirmationDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger" | "warning";
  loading?: boolean;
  confirmDisabled?: boolean;
  icon?: ReactNode;
}

export function ConfirmationDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading = false,
  confirmDisabled = false,
  icon,
}: ConfirmationDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose, loading);
  if (!open) return null;

  const btnClass =
    variant === "danger"
      ? "avs-btn avs-btn-danger"
      : variant === "warning"
        ? "avs-btn avs-btn-danger-outline"
        : "avs-btn avs-btn-primary";

  const iconColor =
    variant === "danger" || variant === "warning"
      ? "var(--avs-error)"
      : "var(--avs-primary)";

  return (
    <div className="avs-dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        className="avs-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="avs-dialog-header">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            {icon ?? (variant !== "default" && <AlertTriangle size={20} style={{ color: iconColor }} />)}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button className="avs-btn avs-btn-ghost avs-btn-icon" onClick={onClose} aria-label="Close" type="button">
            <X size={16} />
          </button>
        </div>
        <div className="avs-dialog-body">
          {description && <p id={descriptionId} className="body-text-sm" style={{ margin: 0 }}>{description}</p>}
          {children}
        </div>
        <div className="avs-dialog-footer">
          <button className="avs-btn avs-btn-secondary" onClick={onClose} disabled={loading} type="button">
            {cancelLabel}
          </button>
          <button className={btnClass} onClick={onConfirm} disabled={loading || confirmDisabled} type="button">
            {loading ? "Processing…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Archive Dialog Variant ── */
interface ArchiveDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  userName: string;
  loading?: boolean;
  error?: string;
}

export function ArchiveDialog({ open, onClose, onConfirm, userName, loading, error }: ArchiveDialogProps) {
  const [reason, setReason] = useState("");

  if (!open) return null;

  return (
    <ConfirmationDialog
      open={open}
      onClose={onClose}
      onConfirm={() => onConfirm(reason)}
      title={`Archive ${userName}`}
      variant="warning"
      confirmLabel="Archive Student"
      loading={loading}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", marginTop: "var(--space-4)" }}>
        {error && <div className="error-box" role="alert">{error}</div>}
        <div
          style={{
            padding: "var(--space-3) var(--space-4)",
            background: "var(--avs-warning-surface)",
            borderRadius: "var(--radius-md)",
            fontSize: "var(--text-sm)",
            color: "var(--avs-warning-dark)",
          }}
        >
          <strong>Archiving will:</strong>
          <ul style={{ margin: "var(--space-2) 0 0", paddingLeft: "var(--space-5)" }}>
            <li>Set account status to ARCHIVED</li>
            <li>Revoke all active sessions</li>
            <li>Block future logins</li>
            <li>Preserve all academic records and history</li>
          </ul>
          <p style={{ margin: "var(--space-2) 0 0", fontWeight: 600 }}>
            This action can be reversed. The student can be restored later.
          </p>
        </div>
        <div>
          <label className="avs-label" htmlFor="archive-reason">Reason for archiving *</label>
          <textarea
            id="archive-reason"
            className="avs-input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g., Student graduated, transferred to another college"
            required
          />
        </div>
      </div>
    </ConfirmationDialog>
  );
}
