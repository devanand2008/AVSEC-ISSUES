"use client";

import { Download, FileSpreadsheet, FileText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

interface ExportOption {
  key: string;
  label: string;
  description: string;
  icon: typeof FileSpreadsheet;
  path: string;
  fileName: string;
  permission?: string;
}

export const EXPORTS: ExportOption[] = [
  {
    key: "attendance",
    label: "Attendance records",
    description:
      "Export attendance session records as CSV. Includes student name, date, status, and remarks.",
    icon: FileSpreadsheet,
    path: "/reports/attendance/export.csv",
    fileName: "attendance-export.csv",
    permission: "attendance.export",
  },
  {
    key: "issues",
    label: "Issue reports",
    description:
      "Export all issue reports with status, priority, assignment, and resolution details.",
    icon: FileText,
    path: "/reports/issues/export.csv",
    fileName: "issues-export.csv",
    permission: "issues.export",
  },
];

export default function ExportsPage() {
  const { user } = useAuth();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState("");

  const available = EXPORTS.filter(
    (exp) => !exp.permission || user?.permissions.includes(exp.permission),
  );
  const canBulkImport = user?.permissions.some((permission) =>
    [
      "users.import",
      "locations.import",
      "assets.import",
      "academic.manage",
      "attendance.import",
      "routing.manage",
    ].includes(permission),
  );

  async function handleExport(exp: ExportOption) {
    setDownloading(exp.key);
    setError("");
    try {
      await api.download(exp.path, exp.fileName);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Export failed.");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Data management</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            Exports
          </h1>
          <p className="page-subtitle">
            Download data exports in CSV format for reporting and analysis.
          </p>
        </div>
      </div>

      {error && (
        <div className="error-box" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 18,
        }}
      >
        {available.map((exp) => {
          const Icon = exp.icon;
          const isDownloading = downloading === exp.key;
          return (
            <article key={exp.key} className="card" style={{ padding: 24 }}>
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "flex-start",
                  marginBottom: 16,
                }}
              >
                <span
                  className="metric-icon"
                  style={{
                    color: "#6366f1",
                    background: "#eef2ff",
                    flexShrink: 0,
                  }}
                >
                  <Icon size={21} />
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{exp.label}</h3>
                  <p
                    className="muted"
                    style={{
                      margin: "6px 0 0",
                      fontSize: 13,
                      lineHeight: 1.55,
                    }}
                  >
                    {exp.description}
                  </p>
                </div>
              </div>
              <button
                className="btn btn-secondary"
                style={{ width: "100%" }}
                onClick={() => handleExport(exp)}
                disabled={isDownloading}
              >
                <Download size={16} />
                {isDownloading ? "Generating…" : "Download CSV"}
              </button>
            </article>
          );
        })}
      </div>

      {available.length === 0 && (
        <div className="card">
          <div className="empty" style={{ padding: 40 }}>
            You do not have permission to export any data. Contact your
            administrator to request export access.
          </div>
        </div>
      )}

      <section className="card" style={{ marginTop: 24, padding: 20 }}>
        <h3 style={{ margin: "0 0 8px" }}>Export guidelines</h3>
        <ul
          className="muted"
          style={{ paddingLeft: 20, lineHeight: 1.7, margin: 0 }}
        >
          <li>
            Exported files are generated in real-time from the current database
            state
          </li>
          <li>
            Large datasets may take a few seconds to generate — please wait for
            the download to start
          </li>
          <li>
            All exports respect your role-based access scope and only include
            data you are authorized to view
          </li>
          {canBulkImport && (
            <li>
              For bulk data imports, use the{" "}
              <Link href="/admin/imports" style={{ color: "var(--primary)" }}>
                Bulk imports
              </Link>{" "}
              page
            </li>
          )}
        </ul>
      </section>
    </>
  );
}
