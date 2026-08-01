"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";

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
  icon,
}: ConfirmationDialogProps) {
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
      <div className="avs-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="avs-dialog-header">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            {icon ?? (variant !== "default" && <AlertTriangle size={20} style={{ color: iconColor }} />)}
            <h2 id="confirm-title">{title}</h2>
          </div>
          <button className="avs-btn avs-btn-ghost avs-btn-icon" onClick={onClose} aria-label="Close" type="button">
            <X size={16} />
          </button>
        </div>
        <div className="avs-dialog-body">
          {description && <p className="body-text-sm" style={{ margin: 0 }}>{description}</p>}
          {children}
        </div>
        <div className="avs-dialog-footer">
          <button className="avs-btn avs-btn-secondary" onClick={onClose} disabled={loading} type="button">
            {cancelLabel}
          </button>
          <button className={btnClass} onClick={onConfirm} disabled={loading} type="button">
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
}

export function ArchiveDialog({ open, onClose, onConfirm, userName, loading }: ArchiveDialogProps) {
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
