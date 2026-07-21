"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  RefreshCw,
  RotateCcw,
  Upload,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { StatusBadge } from "@/components/status-badge";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

const importTypes = [
  { value: "USERS", label: "Combined users (all roles)", permission: "users.import" },
  { value: "STUDENTS", label: "Students", permission: "users.import" },
  { value: "STAFF", label: "Staff - Faculty, HOD, CC, Maintenance, Admin", permission: "users.import" },
  { value: "DEPARTMENTS", label: "Departments", permission: "academic.manage" },
  { value: "PROGRAMMES", label: "Programmes", permission: "academic.manage" },
  {
    value: "CLASSES",
    label: "Classes / sections",
    permission: "academic.manage",
  },
  {
    value: "ATTENDANCE",
    label: "Attendance history (legacy migration)",
    permission: "attendance.import",
  },
  { value: "BLOCKS", label: "Campus blocks", permission: "locations.import" },
  { value: "FLOORS", label: "Floors", permission: "locations.import" },
  { value: "ROOMS", label: "Rooms and areas", permission: "locations.import" },
  { value: "ASSETS", label: "Room assets", permission: "assets.import" },
  {
    value: "RESPONSIBLE_PERSONS",
    label: "Responsible persons (maintenance teams)",
    permission: "routing.manage",
  },
  {
    value: "ASSIGNMENT_RULES",
    label: "Issue assignment rules",
    permission: "routing.manage",
  },
];

const importModes = [
  { value: "VALIDATE_ONLY", label: "Validate only" },
  { value: "CREATE_ONLY", label: "Create new users only" },
  { value: "CREATE_AND_UPDATE", label: "Create and update existing users" },
  { value: "UPDATE_ONLY", label: "Update existing users only" },
];

const systemFields = [
  "__IGNORE__",
  "college_identity_id",
  "college_id",
  "user_id",
  "employee_or_student_id",
  "student_id",
  "employee_id",
  "full_name",
  "email",
  "mobile",
  "whatsapp_number",
  "role_codes",
  "department_code",
  "programme_code",
  "academic_year",
  "year",
  "semester_number",
  "section_code",
  "admission_number",
  "admission_year",
  "gender",
  "date_of_birth",
  "temporary_password",
  "account_status",
  "parent_name",
  "parent_mobile_number",
  "blood_group",
  "address",
  "profile_photo_url",
  "roll_number",
  "batch",
  "designation",
  "campus_scope",
  "assigned_year",
  "assigned_semester",
  "assigned_section",
  "assigned_block",
  "assigned_floor",
  "assigned_room",
  "specialization",
  "assigned_issue_category",
  "shift",
  "subject_code",
  "scope_type",
  "scope_code",
  "code",
  "name",
  "campus_code",
  "block_code",
  "floor_code",
  "room_code",
  "room_type",
  "category_name",
  "category_code",
  "issue_type_code",
  "team_code",
  "priority",
];

interface ImportJob {
  id: string;
  entityType: string;
  importMode: string;
  selectedSheetName: string | null;
  status: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  resultAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}
interface RowError {
  rowNumber: number;
  field?: string;
  message: string;
}
interface Preview {
  job: ImportJob;
  rawHeaders: string[];
  headers: string[];
  columnMapping: Record<string, string>;
  sheetNames: string[];
  selectedSheetName?: string;
  previewRows: Array<{ rowNumber: number; values: Record<string, string> }>;
  errors: RowError[];
  errorsTruncated: boolean;
}
interface JobDetail extends ImportJob {
  credentialsAvailable?: boolean;
  result?: {
    completedAt: string;
    successful: Array<{
      rowNumber: number;
      model: string;
      id: string;
      label: string;
    }>;
    errors: RowError[];
  };
}

export default function ImportsPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const allowed = importTypes.filter((item) =>
    user?.permissions.includes(item.permission),
  );
  const [entityType, setEntityType] = useState(allowed[0]?.value ?? "");
  const [importMode, setImportMode] = useState("VALIDATE_ONLY");
  const [sheetName, setSheetName] = useState("");
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>(
    {},
  );
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [dragActive, setDragActive] = useState(false);

  const jobs = useQuery({
    queryKey: ["imports"],
    queryFn: () => api.get<ImportJob[]>("/imports"),
    refetchInterval: (query) =>
      query.state.data?.some((job) =>
        ["QUEUED", "PROCESSING"].includes(job.status),
      )
        ? 2500
        : false,
  });
  const detail = useQuery({
    queryKey: ["imports", selectedId],
    queryFn: () => api.get<JobDetail>(`/imports/${selectedId}`),
    enabled: Boolean(selectedId),
    refetchInterval: (query) =>
      ["QUEUED", "PROCESSING"].includes(query.state.data?.status ?? "")
        ? 2500
        : false,
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file || !entityType)
        throw new Error("Choose an import type and file.");
      const body = new FormData();
      body.append("entityType", entityType);
      body.append(
        "importMode",
        ["USERS", "STUDENTS", "STAFF"].includes(entityType)
          ? importMode
          : "CREATE_ONLY",
      );
      if (sheetName) body.append("sheetName", sheetName);
      if (Object.keys(columnMapping).length)
        body.append("columnMapping", JSON.stringify(columnMapping));
      body.append("file", file);
      return api.postForm<Preview>("/imports/preview", body);
    },
    onSuccess: (data) => {
      setPreview(data);
      setSelectedId(data.job.id);
      setSheetName(data.selectedSheetName ?? "");
      setColumnMapping(data.columnMapping);
      setMessage(
        "Validation complete. Review the preview and row errors before confirming.",
      );
      void client.invalidateQueries({ queryKey: ["imports"] });
    },
  });
  const confirmMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<{ id: string; status: string }>(`/imports/${id}/confirm`),
    onSuccess: (_, id) => {
      setPreview(null);
      setSelectedId(id);
      setMessage("Import queued. Progress will update automatically.");
      void client.invalidateQueries({ queryKey: ["imports"] });
    },
  });
  const rollbackMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<{ recordsRemoved: number }>(`/imports/${id}/rollback`),
    onSuccess: (data) => {
      setMessage(
        `Rollback complete. ${data.recordsRemoved} imported records were removed.`,
      );
      void client.invalidateQueries({ queryKey: ["imports"] });
      void client.invalidateQueries({ queryKey: ["imports", selectedId] });
    },
  });
  const credentialsMutation = useMutation({
    mutationFn: (id: string) =>
      api.download(
        `/imports/${id}/credentials`,
        `import-${id.slice(0, 8)}-credentials.xlsx`,
      ),
    onSuccess: () => {
      setMessage(
        "Credential file downloaded. It cannot be downloaded again from this import.",
      );
      void client.invalidateQueries({ queryKey: ["imports", selectedId] });
    },
  });
  const actionError =
    previewMutation.error ??
    confirmMutation.error ??
    rollbackMutation.error ??
    credentialsMutation.error;

  function chooseFile(nextFile?: File | null) {
    setFile(nextFile ?? null);
    setPreview(null);
    setSheetName("");
    setColumnMapping({});
    setMessage("");
  }

  if (!allowed.length)
    return (
      <ErrorState message="You do not have permission to run bulk imports." />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            Bulk imports
          </h1>
          <p className="page-subtitle">
            Validate, preview and safely import structured college data.
          </p>
        </div>
      </div>

      {message && (
        <div className="card" style={{ padding: 12, marginBottom: 16 }}>
          {message}
        </div>
      )}
      {actionError && (
        <div className="error-box" style={{ marginBottom: 16 }}>
          {actionError instanceof ApiError
            ? actionError.message
            : actionError.message}
        </div>
      )}

      <section className="card" style={{ padding: 20 }}>
        <div className="section-head">
          <div>
            <h2>1. Prepare and validate</h2>
            <p>
              Use a current template, or upload a CSV/XLSX file with
              recognizable column names.
            </p>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Import type</span>
            <select
              value={entityType}
              onChange={(event) => {
                const next = event.target.value;
                setEntityType(next);
                if (!["USERS", "STUDENTS", "STAFF"].includes(next))
                  setImportMode("CREATE_ONLY");
                setPreview(null);
                setSheetName("");
                setColumnMapping({});
              }}
            >
              {allowed.map((item) => (
                <option value={item.value} key={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Import mode</span>
            <select
              className="input"
              value={importMode}
              disabled={!["USERS", "STUDENTS", "STAFF"].includes(entityType)}
              onChange={(event) => {
                setImportMode(event.target.value);
                setPreview(null);
              }}
            >
              {importModes.map((item) => (
                <option value={item.value} key={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Upload file</span>
            <div
              className={`import-dropzone ${dragActive ? "drag-active" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                chooseFile(event.dataTransfer.files.item(0));
              }}
            >
              <FileSpreadsheet size={24} />
              <strong>{file ? file.name : "Drop CSV or Excel here"}</strong>
              <small>
                {file
                  ? `${(file.size / 1024).toFixed(1)} KB selected`
                  : "Supports .csv and .xlsx. Save legacy .xls files as .xlsx before upload."}
              </small>
              <input
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) =>
                  chooseFile(event.target.files?.[0] ?? null)
                }
              />
            </div>
          </label>
        </div>
        <div className="button-row" style={{ marginTop: 14 }}>
          <button
            className="btn"
            type="button"
            onClick={() =>
              void api.download(
                `/imports/templates/${entityType}`,
                `${entityType.toLowerCase()}-template.xlsx`,
              )
            }
          >
            <Download size={17} />
            Download template
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!file || previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            <Upload size={17} />
            {previewMutation.isPending
              ? "Validating..."
              : "Validate and preview"}
          </button>
        </div>
      </section>

      {preview && (
        <section className="card" style={{ padding: 20, marginTop: 18 }}>
          <div className="section-head">
            <div>
              <h2>2. Review preview</h2>
              <p>
                {preview.job.validRows} valid rows; {preview.job.errorRows} rows
                need correction. Only valid rows will be imported.
              </p>
            </div>
            <StatusBadge value={preview.job.status} />
          </div>
          {preview.sheetNames.length > 0 && (
            <div className="import-sheet-strip">
              <span>Workbook sheet</span>
              <select
                className="input"
                style={{ width: "auto", minWidth: 180 }}
                value={
                  sheetName ||
                  preview.selectedSheetName ||
                  preview.sheetNames[0]
                }
                onChange={(event) => setSheetName(event.target.value)}
              >
                {preview.sheetNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {preview.sheetNames.length > 1 && (
                <small>
                  {preview.sheetNames.length} sheets found. The first sheet with
                  data was validated.
                </small>
              )}
              <button
                className="btn btn-secondary"
                type="button"
                disabled={previewMutation.isPending}
                onClick={() => previewMutation.mutate()}
              >
                <RefreshCw size={16} />
                Revalidate sheet
              </button>
            </div>
          )}
          {preview.rawHeaders.length > 0 && (
            <div className="column-map-panel">
              <div className="section-title" style={{ margin: "0 0 12px" }}>
                <h3>Column mapping</h3>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={previewMutation.isPending}
                  onClick={() => previewMutation.mutate()}
                >
                  <RefreshCw size={16} />
                  Apply mapping
                </button>
              </div>
              <div className="column-map-grid">
                {preview.rawHeaders.map((rawHeader) => (
                  <label className="field" key={rawHeader}>
                    <span>{rawHeader}</span>
                    <select
                      className="input"
                      value={columnMapping[rawHeader] ?? ""}
                      onChange={(event) =>
                        setColumnMapping({
                          ...columnMapping,
                          [rawHeader]: event.target.value,
                        })
                      }
                    >
                      <option value="">Auto detect</option>
                      {systemFields.map((field) => (
                        <option key={field} value={field}>
                          {field === "__IGNORE__"
                            ? "Do not import"
                            : field.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  {preview.headers.map((header) => (
                    <th key={header}>{header.replaceAll("_", " ")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.previewRows.map((row) => {
                  const invalid = preview.errors.some(
                    (error) => error.rowNumber === row.rowNumber,
                  );
                  return (
                    <tr
                      className={invalid ? "import-row-error" : "import-row-ok"}
                      key={row.rowNumber}
                    >
                      <td>{row.rowNumber}</td>
                      {preview.headers.map((header) => (
                        <td key={header}>
                          {row.values[header] || (
                            <span className="muted">-</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.errors.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="section-title" style={{ margin: "0 0 12px" }}>
                <h3>Validation errors</h3>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => downloadErrorReport(preview.errors)}
                >
                  <Download size={16} />
                  Download error report
                </button>
              </div>
              <div className="issue-list">
                {preview.errors.map((error, index) => (
                  <div key={`${error.rowNumber}-${error.field}-${index}`}>
                    <span className="list-icon" style={{ color: "#dc2626" }}>
                      <XCircle size={18} />
                    </span>
                    <span className="list-copy">
                      <strong>
                        Row {error.rowNumber}
                        {error.field ? ` - ${error.field}` : ""}
                      </strong>
                      <small>{error.message}</small>
                    </span>
                  </div>
                ))}
              </div>
              {preview.errorsTruncated && (
                <p className="muted">Only the first 250 errors are shown.</p>
              )}
            </div>
          )}
          <div className="button-row" style={{ marginTop: 18 }}>
            {preview.job.importMode === "VALIDATE_ONLY" ? (
              <span className="muted">Validate-only mode finished. Choose a create/update mode and revalidate before importing.</span>
            ) : (
              <button
                className="btn btn-primary"
                type="button"
                disabled={
                  preview.job.validRows === 0 || confirmMutation.isPending
                }
                onClick={() => confirmMutation.mutate(preview.job.id)}
              >
                <CheckCircle2 size={17} />
                {confirmMutation.isPending
                  ? "Queuing..."
                  : `Confirm ${preview.job.validRows} valid rows`}
              </button>
            )}
          </div>
        </section>
      )}

      <div className="dashboard-grid" style={{ marginTop: 18 }}>
        <section className="card" style={{ padding: 20 }}>
          <div className="section-head">
            <div>
              <h2>Import jobs</h2>
              <p>Recent jobs and background progress</p>
            </div>
            <button
              className="icon-button"
              aria-label="Refresh imports"
              onClick={() => void jobs.refetch()}
            >
              <RefreshCw size={18} />
            </button>
          </div>
          {jobs.isLoading ? (
            <LoadingState />
          ) : jobs.data?.length ? (
            <div className="issue-list">
              {jobs.data.map((job) => (
                <button
                  key={job.id}
                  onClick={() => setSelectedId(job.id)}
                  style={{ width: "100%", textAlign: "left" }}
                  aria-current={selectedId === job.id ? "true" : undefined}
                >
                  <span className="list-icon">
                    <FileSpreadsheet size={18} />
                  </span>
                  <span className="list-copy">
                    <strong>{job.entityType.replaceAll("_", " ")}</strong>
                    <small>
                      {["QUEUED", "PROCESSING"].includes(job.status)
                        ? `Processing... ${job.validRows}/${job.totalRows} rows`
                        : `${job.validRows}/${job.totalRows} rows - ${job.errorRows} error${job.errorRows !== 1 ? "s" : ""}`}
                      {" - "}
                      {new Date(job.createdAt).toLocaleString()}
                    </small>
                    {["QUEUED", "PROCESSING"].includes(job.status) && job.totalRows > 0 && (
                      <div className="import-progress-bar">
                        <div
                          className="import-progress-fill"
                          style={{ width: `${Math.min(100, Math.round((job.validRows / job.totalRows) * 100))}%` }}
                        />
                      </div>
                    )}
                  </span>
                  <StatusBadge value={job.status} />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">No imports have been created yet.</div>
          )}
        </section>

        <aside className="card" style={{ padding: 20 }}>
          <div className="section-head">
            <div>
              <h2>Result report</h2>
              <p>Selected import details</p>
            </div>
          </div>
          {!selectedId ? (
            <div className="empty">Select an import job.</div>
          ) : detail.isLoading ? (
            <LoadingState />
          ) : detail.isError || !detail.data ? (
            <ErrorState />
          ) : (
            <>
              <StatusBadge value={detail.data.status} />
              <p style={{ marginTop: 12 }}>
                {detail.data.validRows} successful - {detail.data.errorRows}{" "}
                error rows
              </p>
              {detail.data.result && (
                <>
                  <p className="muted">
                    Completed{" "}
                    {new Date(detail.data.result.completedAt).toLocaleString()}
                  </p>
                  {detail.data.credentialsAvailable && (
                    <>
                      <div className="import-credential-notice">
                        <strong>One-time credential download</strong><br />
                        <small>This file contains temporary passwords. Download it once, store it securely, and delete after distributing to users. This button becomes unavailable after the first download.</small>
                      </div>
                      <button
                        className="btn btn-primary"
                        style={{ marginTop: 8 }}
                        type="button"
                        disabled={credentialsMutation.isPending}
                        onClick={() =>
                          credentialsMutation.mutate(detail.data!.id)
                        }
                      >
                        <Download size={16} />
                        {credentialsMutation.isPending
                          ? "Preparing..."
                          : "Download credentials (one-time)"}
                      </button>
                    </>
                  )}
                  {detail.data.result.errors.length ? (
                    <>
                      <button
                        className="btn btn-secondary"
                        style={{ marginTop: 12 }}
                        type="button"
                        onClick={() =>
                          downloadErrorReport(
                            detail.data?.result?.errors ?? [],
                            "completed-import-error-report.csv",
                          )
                        }
                      >
                        <Download size={16} />
                        Download errors
                      </button>
                      <div className="issue-list" style={{ marginTop: 12 }}>
                        {detail.data.result.errors
                          .slice(0, 25)
                          .map((error, index) => (
                            <div key={`${error.rowNumber}-${index}`}>
                              <span
                                className="list-icon"
                                style={{ color: "#dc2626" }}
                              >
                                <XCircle size={16} />
                              </span>
                              <span className="list-copy">
                                <strong>Row {error.rowNumber}</strong>
                                <small>{error.message}</small>
                              </span>
                            </div>
                          ))}
                      </div>
                    </>
                  ) : (
                    <p>
                      <CheckCircle2 size={16} /> No row errors.
                    </p>
                  )}
                </>
              )}
              {detail.data.status === "COMPLETED" &&
                detail.data.validRows > 0 && (
                  <button
                    className="btn"
                    style={{ marginTop: 16 }}
                    disabled={rollbackMutation.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Rollback every record created by this import? This only succeeds while no later data references those records.",
                        )
                      )
                        rollbackMutation.mutate(detail.data.id);
                    }}
                  >
                    <RotateCcw size={17} />
                    Safe rollback
                  </button>
                )}
            </>
          )}
        </aside>
      </div>
    </>
  );
}

function downloadErrorReport(
  errors: RowError[],
  filename = "import-error-report.csv",
) {
  const rows = [
    ["row_number", "field", "message"],
    ...errors.map((error) => [
      String(error.rowNumber),
      error.field ?? "",
      error.message,
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
