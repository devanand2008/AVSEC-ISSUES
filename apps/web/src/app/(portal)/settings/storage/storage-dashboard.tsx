"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Cloud,
  Database,
  FileUp,
  FlaskConical,
  Link2,
  RefreshCw,
  ShieldCheck,
  Unlink,
} from "lucide-react";
import { useCallback, useState } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";
import styles from "./storage-dashboard.module.css";

const DRIVE_STATUS_ENDPOINT = "/admin/storage/google-drive/status";
const DRIVE_AUTHORIZE_ENDPOINT = "/admin/storage/google-drive/authorize";
const DRIVE_CONNECTION_ENDPOINT = "/admin/storage/google-drive";
const BACKUPS_ENDPOINT = "/admin/storage/backups";

const readablePermissions = [
  "settings.read",
  "integrations.manage",
  "backups.manage",
] as const;

export interface GoogleDriveStatus {
  provider?: string;
  connected: boolean;
  accountEmail?: string | null;
  folderName?: string | null;
  connectedAt?: string | null;
  lastCheckedAt?: string | null;
  health?: string | null;
}

export interface RestoreTestRecord {
  id?: string;
  status: string;
  requestedAt?: string | null;
  completedAt?: string | null;
}

export interface BackupRecord {
  id: string;
  status: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  sizeBytes?: number | string | null;
  restoreTest?: RestoreTestRecord | null;
  lastRestoreTest?: RestoreTestRecord | null;
}

export type BackupListResponse =
  | BackupRecord[]
  | {
      data?: BackupRecord[];
      items?: BackupRecord[];
      backups?: BackupRecord[];
    };

interface AuthorizationResponse {
  authorizationUrl: string;
  expiresAt?: string;
}

function dateValue(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function backupRecords(response: BackupListResponse | undefined) {
  const records = Array.isArray(response)
    ? response
    : (response?.data ?? response?.items ?? response?.backups ?? []);
  return [...records].sort(
    (left, right) => dateValue(right.createdAt) - dateValue(left.createdAt),
  );
}

export function isSuccessfulStatus(status: string | null | undefined) {
  return ["SUCCESS", "SUCCEEDED", "COMPLETED", "PASSED"].includes(
    status?.toUpperCase() ?? "",
  );
}

export function formatStorageDate(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Not available";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatStorageBytes(value: number | string | null | undefined) {
  const bytes = typeof value === "string" ? Number(value) : value;
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes))
    return "Not reported";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index]!;
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`;
}

export function safeAuthorizationUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "accounts.google.com"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function statusLabel(status: string | null | undefined) {
  if (!status) return "Not available";
  return status.replaceAll("_", " ").toLowerCase();
}

function statusClass(status: string | null | undefined) {
  const normalized = status?.toUpperCase() ?? "";
  if (isSuccessfulStatus(normalized) || normalized === "CONNECTED")
    return "badge badge-success";
  if (
    ["FAILED", "ERROR", "REVOKED", "DISCONNECTED", "UNAVAILABLE"].includes(
      normalized,
    )
  )
    return "badge badge-danger";
  return "badge badge-warning";
}

function latestRestoreTest(records: BackupRecord[]) {
  const candidates = records
    .flatMap((record) => {
      const test = record.lastRestoreTest ?? record.restoreTest;
      return test ? [test] : [];
    })
    .sort(
      (left, right) =>
        dateValue(right.completedAt ?? right.requestedAt) -
        dateValue(left.completedAt ?? left.requestedAt),
    );
  return candidates[0] ?? null;
}

function actionErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "The storage request could not be completed. Please try again.";
}

export function StorageSnapshot({
  drive,
  backups,
}: {
  drive: GoogleDriveStatus | null;
  backups: BackupRecord[];
}) {
  const latestBackup = backups[0] ?? null;
  const restoreTest = latestRestoreTest(backups);
  return (
    <section className={styles.summaryGrid} aria-label="Storage status summary">
      <article className={`card ${styles.summaryCard}`}>
        <span className={styles.summaryIcon}>
          <Cloud size={21} aria-hidden />
        </span>
        <div>
          <span className="muted">Google Drive</span>
          <strong>{drive?.connected ? "Connected" : "Not connected"}</strong>
          <small>
            {drive?.connectedAt
              ? `Since ${formatStorageDate(drive.connectedAt)}`
              : "No active cloud connection"}
          </small>
        </div>
      </article>
      <article className={`card ${styles.summaryCard}`}>
        <span className={styles.summaryIcon}>
          <Database size={21} aria-hidden />
        </span>
        <div>
          <span className="muted">Latest backup</span>
          <strong>{statusLabel(latestBackup?.status)}</strong>
          <small>
            {formatStorageDate(
              latestBackup?.completedAt ?? latestBackup?.createdAt,
            )}
          </small>
        </div>
      </article>
      <article className={`card ${styles.summaryCard}`}>
        <span className={styles.summaryIcon}>
          <FlaskConical size={21} aria-hidden />
        </span>
        <div>
          <span className="muted">Latest restore test</span>
          <strong>{statusLabel(restoreTest?.status)}</strong>
          <small>
            {formatStorageDate(
              restoreTest?.completedAt ?? restoreTest?.requestedAt,
            )}
          </small>
        </div>
      </article>
    </section>
  );
}

export function DriveConnectionPanel({
  status,
  canManage,
  connecting,
  revoking,
  onConnect,
  onRevoke,
}: {
  status: GoogleDriveStatus | null;
  canManage: boolean;
  connecting: boolean;
  revoking: boolean;
  onConnect: () => void;
  onRevoke: () => void;
}) {
  return (
    <section className={`card ${styles.panel}`}>
      <div className={styles.panelHeading}>
        <div>
          <span className="eyebrow">Cloud destination</span>
          <h2>Google Drive connection</h2>
          <p>
            OAuth credentials stay on the server. This page only shows
            non-sensitive connection metadata.
          </p>
        </div>
        <span
          className={
            status?.connected
              ? "badge badge-success"
              : "badge badge-warning"
          }
        >
          {status?.connected ? "Connected" : "Not connected"}
        </span>
      </div>

      {status?.connected ? (
        <dl className={styles.detailList}>
          <div>
            <dt>Provider</dt>
            <dd>{status.provider || "Google Drive"}</dd>
          </div>
          <div>
            <dt>Account</dt>
            <dd>{status.accountEmail || "Connected account"}</dd>
          </div>
          <div>
            <dt>Backup folder</dt>
            <dd>{status.folderName || "Managed by the backup service"}</dd>
          </div>
          <div>
            <dt>Connected</dt>
            <dd>{formatStorageDate(status.connectedAt)}</dd>
          </div>
        </dl>
      ) : (
        <div className={styles.emptyPanel}>
          <Cloud size={34} aria-hidden />
          <strong>No Drive account is connected</strong>
          <p>
            Connect an approved administrative account before requesting cloud
            backups.
          </p>
        </div>
      )}

      {canManage ? (
        <div className={styles.actions}>
          {status?.connected ? (
            <button
              type="button"
              className="btn"
              disabled={revoking}
              onClick={onRevoke}
            >
              <Unlink size={17} aria-hidden />
              {revoking ? "Revoking…" : "Revoke access"}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={connecting}
              onClick={onConnect}
            >
              <Link2 size={17} aria-hidden />
              {connecting ? "Preparing secure sign-in…" : "Connect Google Drive"}
            </button>
          )}
        </div>
      ) : (
        <p className={styles.readOnlyNote}>
          Connection changes require the integrations management permission.
        </p>
      )}
    </section>
  );
}

export function BackupPanel({
  backups,
  connected,
  canManage,
  backingUp,
  testingRestore,
  onBackup,
  onRestoreTest,
}: {
  backups: BackupRecord[];
  connected: boolean;
  canManage: boolean;
  backingUp: boolean;
  testingRestore: boolean;
  onBackup: () => void;
  onRestoreTest: (backupId: string) => void;
}) {
  const restorable = backups.find((backup) =>
    isSuccessfulStatus(backup.status),
  );
  return (
    <section className={`card ${styles.panel}`}>
      <div className={styles.panelHeading}>
        <div>
          <span className="eyebrow">Recovery readiness</span>
          <h2>Backups and restore tests</h2>
          <p>
            Manual requests run asynchronously. A restore test validates a
            backup without replacing live college data.
          </p>
        </div>
        {canManage && (
          <div className={styles.actions}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!connected || backingUp}
              onClick={onBackup}
              title={
                connected
                  ? "Request a new backup"
                  : "Connect Google Drive before requesting a backup"
              }
            >
              <FileUp size={17} aria-hidden />
              {backingUp ? "Requesting…" : "Back up now"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!restorable || testingRestore}
              onClick={() => restorable && onRestoreTest(restorable.id)}
              title={
                restorable
                  ? "Request an isolated restore test"
                  : "A successful backup is required first"
              }
            >
              <FlaskConical size={17} aria-hidden />
              {testingRestore ? "Requesting…" : "Test latest restore"}
            </button>
          </div>
        )}
      </div>

      {!canManage && (
        <p className={styles.readOnlyNote}>
          Backup and restore-test requests require the backups management
          permission.
        </p>
      )}

      {backups.length === 0 ? (
        <div className={styles.emptyPanel}>
          <Database size={34} aria-hidden />
          <strong>No backup history is available</strong>
          <p>
            Completed and in-progress backup requests will appear here without
            exposing file paths or provider credentials.
          </p>
        </div>
      ) : (
        <ol className={styles.backupList} aria-label="Recent backups">
          {backups.map((backup) => {
            const restore = backup.lastRestoreTest ?? backup.restoreTest;
            return (
              <li key={backup.id} className={styles.backupItem}>
                <span className={styles.backupIcon}>
                  {isSuccessfulStatus(backup.status) ? (
                    <CheckCircle2 size={20} aria-hidden />
                  ) : backup.status.toUpperCase() === "FAILED" ? (
                    <AlertCircle size={20} aria-hidden />
                  ) : (
                    <Clock3 size={20} aria-hidden />
                  )}
                </span>
                <div className={styles.backupCopy}>
                  <div className={styles.backupTitle}>
                    <strong>Backup {backup.id.slice(0, 8)}</strong>
                    <span className={statusClass(backup.status)}>
                      {statusLabel(backup.status)}
                    </span>
                  </div>
                  <span>
                    Requested {formatStorageDate(backup.createdAt)} ·{" "}
                    {formatStorageBytes(backup.sizeBytes)}
                  </span>
                  {restore && (
                    <small>
                      Restore test: {statusLabel(restore.status)} ·{" "}
                      {formatStorageDate(
                        restore.completedAt ?? restore.requestedAt,
                      )}
                    </small>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function StorageDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const permissions = user?.permissions ?? [];
  const canRead = readablePermissions.some((permission) =>
    permissions.includes(permission),
  );
  const canManageDrive = permissions.includes("integrations.manage");
  const canManageBackups = permissions.includes("backups.manage");
  const [notice, setNotice] = useStateMessage();

  const drive = useQuery({
    queryKey: ["storage-admin", "google-drive"],
    queryFn: () => api.get<GoogleDriveStatus>(DRIVE_STATUS_ENDPOINT),
    enabled: canRead,
  });
  const backups = useQuery({
    queryKey: ["storage-admin", "backups"],
    queryFn: () => api.get<BackupListResponse>(BACKUPS_ENDPOINT),
    enabled: canRead,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["storage-admin"] });
  };

  const authorize = useMutation({
    mutationFn: async () => {
      const response = await api.post<AuthorizationResponse>(
        DRIVE_AUTHORIZE_ENDPOINT,
      );
      const target = safeAuthorizationUrl(response.authorizationUrl);
      if (!target)
        throw new Error("The server returned an invalid authorization URL.");
      return target;
    },
    onSuccess: (target) => window.location.assign(target),
  });
  const revoke = useMutation({
    mutationFn: () => api.delete(DRIVE_CONNECTION_ENDPOINT),
    onSuccess: async () => {
      setNotice("Google Drive access was revoked.");
      await refresh();
    },
  });
  const manualBackup = useMutation({
    mutationFn: () => api.post<BackupRecord>(BACKUPS_ENDPOINT),
    onSuccess: async () => {
      setNotice("The manual backup request was queued.");
      await refresh();
    },
  });
  const restoreTest = useMutation({
    mutationFn: (backupId: string) =>
      api.post<RestoreTestRecord>(
        `${BACKUPS_ENDPOINT}/${encodeURIComponent(backupId)}/restore-test`,
      ),
    onSuccess: async () => {
      setNotice("The isolated restore-test request was queued.");
      await refresh();
    },
  });

  if (!user) return <LoadingState />;
  if (!canRead)
    return (
      <ErrorState message="You do not have permission to view storage and backup settings." />
    );

  const records = backupRecords(backups.data);
  const actionError =
    authorize.error ??
    revoke.error ??
    manualBackup.error ??
    restoreTest.error ??
    null;

  return (
    <div className={styles.page}>
      <div className={`page-heading ${styles.pageHeading}`}>
        <div>
          <span className="eyebrow">Administration</span>
          <h1 className="page-title">Storage and backups</h1>
          <p className="page-subtitle">
            Monitor the protected Google Drive destination, request database
            backups, and verify recovery readiness.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={drive.isFetching || backups.isFetching}
          onClick={() => void refresh()}
        >
          <RefreshCw
            size={17}
            aria-hidden
            className={
              drive.isFetching || backups.isFetching ? styles.spinning : ""
            }
          />
          Refresh status
        </button>
      </div>

      <div className={styles.securityNote}>
        <ShieldCheck size={19} aria-hidden />
        <p>
          Access tokens, refresh tokens, storage keys, file paths, and OAuth
          client secrets are never displayed in this interface.
        </p>
      </div>

      {notice && (
        <div className="success-box" role="status" aria-live="polite">
          {notice}
        </div>
      )}
      {actionError && (
        <div className="error-box" role="alert">
          {actionErrorMessage(actionError)}
        </div>
      )}

      {drive.isLoading && backups.isLoading ? (
        <LoadingState rows={3} />
      ) : (
        <StorageSnapshot drive={drive.data ?? null} backups={records} />
      )}

      <div className={styles.contentGrid}>
        {drive.isLoading ? (
          <LoadingState rows={3} />
        ) : drive.isError ? (
          <section className={`card ${styles.statePanel}`}>
            <ErrorState message="Google Drive connection status could not be loaded." />
            <button
              type="button"
              className="btn"
              onClick={() => void drive.refetch()}
            >
              Try again
            </button>
          </section>
        ) : (
          <DriveConnectionPanel
            status={drive.data ?? null}
            canManage={canManageDrive}
            connecting={authorize.isPending}
            revoking={revoke.isPending}
            onConnect={() => authorize.mutate()}
            onRevoke={() => {
              if (
                window.confirm(
                  "Revoke Google Drive access? Scheduled and manual backups will stop until another account is connected.",
                )
              )
                revoke.mutate();
            }}
          />
        )}

        {backups.isLoading ? (
          <LoadingState rows={4} />
        ) : backups.isError ? (
          <section className={`card ${styles.statePanel}`}>
            <ErrorState message="Backup history could not be loaded." />
            <button
              type="button"
              className="btn"
              onClick={() => void backups.refetch()}
            >
              Try again
            </button>
          </section>
        ) : (
          <BackupPanel
            backups={records}
            connected={Boolean(drive.data?.connected)}
            canManage={canManageBackups}
            backingUp={manualBackup.isPending}
            testingRestore={restoreTest.isPending}
            onBackup={() => manualBackup.mutate()}
            onRestoreTest={(backupId) => restoreTest.mutate(backupId)}
          />
        )}
      </div>
    </div>
  );
}

function useStateMessage() {
  const [message, setMessage] = useState<string | null>(null);
  const setTimedMessage = useCallback((value: string) => {
    setMessage(value);
    window.setTimeout(() => setMessage(null), 6_000);
  }, []);
  return [message, setTimedMessage] as const;
}
