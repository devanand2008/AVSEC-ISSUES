"use client";

import { AlertCircle, Database, FileText, MessageSquare, Users, BookOpen, Bell, Shield, X } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useDialogFocus } from "./use-dialog-focus";

type DependencyAction = "cascade" | "anonymise" | "preserve" | "delete";

export interface DependencyCategory {
  category: string;
  icon: ReactNode;
  items: { label: string; count: number; action: DependencyAction }[];
}

export interface DependencyReport {
  userId: string;
  userName: string;
  collegeIdentityId: string;
  totalRecords: number;
  blockingCount: number;
  categories: DependencyCategory[];
}

const actionColors: Record<DependencyAction, { bg: string; color: string; label: string }> = {
  cascade: { bg: "var(--avs-error-surface)", color: "var(--avs-error-dark)", label: "Will be deleted" },
  anonymise: { bg: "var(--avs-warning-surface)", color: "var(--avs-warning-dark)", label: "Will be anonymised" },
  preserve: { bg: "var(--avs-success-surface)", color: "var(--avs-success-dark)", label: "Will be preserved" },
  delete: { bg: "var(--avs-error-surface)", color: "var(--avs-error-dark)", label: "Will be deleted" },
};

interface DependencyDialogProps {
  open: boolean;
  onClose: () => void;
  onProceed: () => void;
  report: DependencyReport | null;
  loading?: boolean;
  error?: string;
}

export function DependencyDialog({ open, onClose, onProceed, report, loading, error }: DependencyDialogProps) {
  const titleId = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose);
  if (!open) return null;

  return (
    <div className="avs-dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="avs-dialog avs-dialog-lg" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="avs-dialog-header">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <Database size={20} style={{ color: "var(--avs-warning)" }} />
            <h2 id={titleId}>Dependency Analysis</h2>
          </div>
          <button className="avs-btn avs-btn-ghost avs-btn-icon" onClick={onClose} aria-label="Close" type="button">
            <X size={16} />
          </button>
        </div>

        <div className="avs-dialog-body">
          {loading && (
            <div className="avs-empty-state" style={{ padding: "var(--space-8)" }}>
              <div className="avs-skeleton avs-skeleton-card" style={{ width: "100%" }} />
              <p className="body-text-sm">Analysing dependencies…</p>
            </div>
          )}

          {error && (
            <div className="avs-error-state">
              <AlertCircle size={32} />
              <p className="body-text-sm" style={{ color: "var(--avs-error)" }}>{error}</p>
            </div>
          )}

          {report && !loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
              {/* Summary */}
              <div
                style={{
                  padding: "var(--space-4)",
                  background: report.blockingCount > 0 ? "var(--avs-warning-surface)" : "var(--avs-info-surface)",
                  borderRadius: "var(--radius-md)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-2)",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "var(--text-base)" }}>
                  {report.userName} ({report.collegeIdentityId})
                </div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--avs-text-secondary)" }}>
                  <strong>{report.totalRecords}</strong> related records found across {report.categories.length} categories
                </div>
              </div>

              {/* Categories */}
              {report.categories.map((cat, ci) => (
                <div key={ci}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
                    {cat.icon}
                    <span className="heading-5">{cat.category}</span>
                  </div>
                  <div className="avs-table-wrap">
                    <table className="avs-table" style={{ fontSize: "var(--text-sm)" }}>
                      <thead>
                        <tr>
                          <th>Record Type</th>
                          <th style={{ textAlign: "right" }}>Count</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cat.items.map((item, ii) => (
                          <tr key={ii}>
                            <td>{item.label}</td>
                            <td style={{ textAlign: "right", fontWeight: 600 }}>{item.count}</td>
                            <td>
                              <span
                                className="avs-badge"
                                style={{
                                  background: actionColors[item.action].bg,
                                  color: actionColors[item.action].color,
                                }}
                              >
                                {actionColors[item.action].label}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {/* Legend */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", fontSize: "var(--text-xs)" }}>
                {Object.entries(actionColors).map(([key, val]) => (
                  <span key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: val.color }} />
                    {val.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="avs-dialog-footer">
          <button className="avs-btn avs-btn-secondary" onClick={onClose} type="button">Cancel</button>
          {report && !loading && (
            <button className="avs-btn avs-btn-danger-outline" onClick={onProceed} type="button">
              Proceed to Permanent Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Build default dependency report icon mapping */
export function depIcon(category: string): ReactNode {
  switch (category.toLowerCase()) {
    case "authentication": return <Shield size={16} style={{ color: "var(--avs-text-muted)" }} />;
    case "academic": return <BookOpen size={16} style={{ color: "var(--avs-text-muted)" }} />;
    case "attendance": return <Users size={16} style={{ color: "var(--avs-text-muted)" }} />;
    case "issues": return <AlertCircle size={16} style={{ color: "var(--avs-text-muted)" }} />;
    case "messaging": return <MessageSquare size={16} style={{ color: "var(--avs-text-muted)" }} />;
    case "feedback": return <FileText size={16} style={{ color: "var(--avs-text-muted)" }} />;
    case "notifications": return <Bell size={16} style={{ color: "var(--avs-text-muted)" }} />;
    default: return <Database size={16} style={{ color: "var(--avs-text-muted)" }} />;
  }
}
