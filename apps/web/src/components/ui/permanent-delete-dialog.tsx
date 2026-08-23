"use client";

import { useId, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Database,
  Lock,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { useDialogFocus } from "./use-dialog-focus";

type Step = "review" | "backup" | "reason" | "confirm";

interface PermanentDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onDelete: (data: {
    reason: string;
    confirmationPhrase: string;
    backupReference: string;
  }) => void;
  userName: string;
  collegeIdentityId: string;
  accountStatus: string;
  backupStatus?: { available: boolean; reference?: string; createdAt?: string };
  dependencyCount: number;
  loading?: boolean;
  error?: string;
}

export function PermanentDeleteDialog({
  open,
  onClose,
  onDelete,
  userName,
  collegeIdentityId,
  accountStatus,
  backupStatus,
  dependencyCount,
  loading = false,
  error,
}: PermanentDeleteDialogProps) {
  const [step, setStep] = useState<Step>("review");
  const [reason, setReason] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const titleId = useId();

  const handleClose = () => {
    setStep("review");
    setReason("");
    setConfirmPhrase("");
    onClose();
  };
  const dialogRef = useDialogFocus<HTMLDivElement>(open, handleClose, loading);

  if (!open) return null;

  const expectedPhrase = `DELETE STUDENT ${collegeIdentityId}`;
  const isConfirmValid = confirmPhrase === expectedPhrase;
  const isArchived = accountStatus === "ARCHIVED";
  const hasBackup = backupStatus?.available ?? false;

  const steps: { key: Step; label: string }[] = [
    { key: "review", label: "Review" },
    { key: "backup", label: "Backup" },
    { key: "reason", label: "Reason" },
    { key: "confirm", label: "Confirm" },
  ];

  const stepIndex = steps.findIndex((s) => s.key === step);

  return (
    <div
      className="avs-dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        ref={dialogRef}
        className="avs-dialog avs-dialog-lg"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div
          className="avs-dialog-header"
          style={{ borderBottom: "none", paddingBottom: 0 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "var(--radius-md)",
                background: "var(--avs-error-surface)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Trash2 size={18} style={{ color: "var(--avs-error)" }} />
            </div>
            <div>
              <h2
                id={titleId}
                style={{ fontSize: "var(--text-lg)", margin: 0 }}
              >
                Permanently Delete Student
              </h2>
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--avs-text-muted)",
                  margin: 0,
                }}
              >
                {userName}
              </p>
            </div>
          </div>
          <button
            className="avs-btn avs-btn-ghost avs-btn-icon"
            onClick={handleClose}
            aria-label="Close"
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step Indicator */}
        <div
          style={{
            display: "flex",
            gap: "var(--space-1)",
            padding: "var(--space-3) var(--space-6)",
            borderBottom: "1px solid var(--avs-border-light)",
          }}
        >
          {steps.map((s, i) => (
            <div
              key={s.key}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                background:
                  i <= stepIndex ? "var(--avs-error)" : "var(--avs-border)",
                transition: "background var(--duration-normal)",
              }}
            />
          ))}
        </div>

        <div className="avs-dialog-body">
          {error && (
            <div className="error-box" role="alert" style={{ marginBottom: "var(--space-4)" }}>
              {error}
            </div>
          )}
          {/* ── Step 1: Review ── */}
          {step === "review" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-4)",
              }}
            >
              <div
                style={{
                  padding: "var(--space-4)",
                  background: "var(--avs-error-surface)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid rgba(220, 38, 38, 0.2)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: "var(--space-3)",
                    alignItems: "flex-start",
                  }}
                >
                  <AlertTriangle
                    size={20}
                    style={{
                      color: "var(--avs-error)",
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  />
                  <div style={{ fontSize: "var(--text-sm)" }}>
                    <p
                      style={{
                        fontWeight: 600,
                        margin: 0,
                        color: "var(--avs-error-dark)",
                      }}
                    >
                      This action is permanent and cannot be undone.
                    </p>
                    <p
                      style={{
                        margin: "var(--space-2) 0 0",
                        color: "var(--avs-error-dark)",
                      }}
                    >
                      All personal data will be anonymised or deleted. Academic
                      records will be preserved with anonymised references.
                    </p>
                  </div>
                </div>
              </div>

              {/* Checklist */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-3)",
                }}
              >
                <CheckItem
                  ok={isArchived}
                  label="Student account is archived"
                  detail={
                    isArchived
                      ? "Archived"
                      : `Current: ${accountStatus}. Must be ARCHIVED first.`
                  }
                />
                <CheckItem
                  ok={hasBackup}
                  label="Restore-tested pre-deletion backup exists"
                  detail={
                    hasBackup
                      ? `Backup: ${backupStatus?.reference}`
                      : "No eligible restore-tested pre-deletion backup found"
                  }
                />
                <CheckItem
                  ok={dependencyCount > 0}
                  label="Dependencies have been analysed"
                  detail={`${dependencyCount} related records found`}
                />
              </div>
            </div>
          )}

          {/* ── Step 2: Backup ── */}
          {step === "backup" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-4)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                }}
              >
                <Database size={20} style={{ color: "var(--avs-info)" }} />
                <span className="heading-5">Backup Verification</span>
              </div>

              {hasBackup ? (
                <div
                  style={{
                    padding: "var(--space-4)",
                    background: "var(--avs-success-surface)",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                    }}
                  >
                    <CheckCircle
                      size={16}
                      style={{ color: "var(--avs-success)" }}
                    />
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--avs-success-dark)",
                      }}
                    >
                      Restore-tested backup verified
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "var(--text-sm)",
                      marginTop: "var(--space-2)",
                      color: "var(--avs-text-secondary)",
                    }}
                  >
                    <p style={{ margin: 0 }}>
                      Reference: {backupStatus?.reference}
                    </p>
                    {backupStatus?.createdAt && (
                      <p style={{ margin: "2px 0 0" }}>
                        Created:{" "}
                        {new Date(backupStatus.createdAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    padding: "var(--space-4)",
                    background: "var(--avs-error-surface)",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                    }}
                  >
                    <AlertTriangle
                      size={16}
                      style={{ color: "var(--avs-error)" }}
                    />
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--avs-error-dark)",
                      }}
                    >
                      No backup found
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: "var(--text-sm)",
                      margin: "var(--space-2) 0 0",
                      color: "var(--avs-error-dark)",
                    }}
                  >
                    An operator must run the protected PRE_DELETION backup
                    workflow after this student was archived, and its latest
                    isolated restore test must pass. An ordinary manual backup
                    from Settings does not qualify.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Reason ── */}
          {step === "reason" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-4)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                }}
              >
                <Shield size={20} style={{ color: "var(--avs-warning)" }} />
                <span className="heading-5">Provide Reason for Deletion</span>
              </div>
              <div>
                <label className="avs-label" htmlFor="delete-reason">
                  Reason *
                </label>
                <textarea
                  id="delete-reason"
                  className="avs-input"
                  rows={4}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Provide a detailed reason for permanently deleting this student's data. This will be recorded in the audit log."
                  required
                />
              </div>
              <div
                style={{
                  padding: "var(--space-3)",
                  background: "var(--avs-page-alt)",
                  borderRadius: "var(--radius-md)",
                  fontSize: "var(--text-xs)",
                  color: "var(--avs-text-muted)",
                }}
              >
                <Lock
                  size={14}
                  style={{
                    display: "inline-block",
                    verticalAlign: "middle",
                    marginRight: 4,
                  }}
                />
                This reason will be permanently recorded in the audit log and
                cannot be changed.
              </div>
            </div>
          )}

          {/* ── Step 4: Confirm ── */}
          {step === "confirm" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-4)",
              }}
            >
              <div
                style={{
                  padding: "var(--space-4)",
                  background: "var(--avs-error-surface)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid rgba(220, 38, 38, 0.2)",
                }}
              >
                <p
                  style={{
                    fontWeight: 600,
                    margin: 0,
                    color: "var(--avs-error-dark)",
                    fontSize: "var(--text-sm)",
                  }}
                >
                  Type the following phrase exactly to confirm permanent
                  deletion:
                </p>
                <code
                  style={{
                    display: "block",
                    marginTop: "var(--space-3)",
                    padding: "var(--space-3)",
                    background: "var(--avs-card)",
                    borderRadius: "var(--radius-sm)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-base)",
                    fontWeight: 600,
                    color: "var(--avs-error)",
                    letterSpacing: "0.02em",
                    border: "1px solid var(--avs-border)",
                  }}
                >
                  {expectedPhrase}
                </code>
              </div>

              <div>
                <label className="avs-label" htmlFor="confirm-phrase">
                  Confirmation phrase *
                </label>
                <input
                  id="confirm-phrase"
                  className="avs-input avs-confirm-input"
                  type="text"
                  value={confirmPhrase}
                  onChange={(e) => setConfirmPhrase(e.target.value)}
                  placeholder={expectedPhrase}
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    borderColor:
                      confirmPhrase && !isConfirmValid
                        ? "var(--avs-error)"
                        : undefined,
                  }}
                />
                {confirmPhrase && !isConfirmValid && (
                  <p className="avs-field-error">
                    Phrase does not match exactly
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="avs-dialog-footer">
          {step === "review" && (
            <>
              <button
                className="avs-btn avs-btn-secondary"
                onClick={handleClose}
                type="button"
              >
                Cancel
              </button>
              <button
                className="avs-btn avs-btn-danger-outline"
                onClick={() => setStep("backup")}
                disabled={!isArchived}
                type="button"
              >
                Continue
              </button>
            </>
          )}
          {step === "backup" && (
            <>
              <button
                className="avs-btn avs-btn-secondary"
                onClick={() => setStep("review")}
                type="button"
              >
                Back
              </button>
              <button
                className="avs-btn avs-btn-danger-outline"
                onClick={() => setStep("reason")}
                disabled={!hasBackup}
                type="button"
              >
                Continue
              </button>
            </>
          )}
          {step === "reason" && (
            <>
              <button
                className="avs-btn avs-btn-secondary"
                onClick={() => setStep("backup")}
                type="button"
              >
                Back
              </button>
              <button
                className="avs-btn avs-btn-danger-outline"
                onClick={() => setStep("confirm")}
                disabled={reason.length < 10}
                type="button"
              >
                Continue
              </button>
            </>
          )}
          {step === "confirm" && (
            <>
              <button
                className="avs-btn avs-btn-secondary"
                onClick={() => setStep("reason")}
                disabled={loading}
                type="button"
              >
                Back
              </button>
              <button
                className="avs-btn avs-btn-danger"
                onClick={() =>
                  onDelete({
                    reason,
                    confirmationPhrase: confirmPhrase,
                    backupReference: backupStatus?.reference ?? "",
                  })
                }
                disabled={!isConfirmValid || loading}
                type="button"
              >
                {loading ? "Deleting…" : "Permanently Delete Student"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CheckItem({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "var(--space-3)",
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: "var(--radius-full)",
          flexShrink: 0,
          background: ok
            ? "var(--avs-success-surface)"
            : "var(--avs-error-surface)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {ok ? (
          <CheckCircle size={14} style={{ color: "var(--avs-success)" }} />
        ) : (
          <AlertTriangle size={14} style={{ color: "var(--avs-error)" }} />
        )}
      </div>
      <div>
        <div style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>
          {label}
        </div>
        <div
          style={{
            fontSize: "var(--text-xs)",
            color: ok ? "var(--avs-text-muted)" : "var(--avs-error)",
          }}
        >
          {detail}
        </div>
      </div>
    </div>
  );
}
