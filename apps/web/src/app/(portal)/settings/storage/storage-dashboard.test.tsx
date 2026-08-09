import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backupRecords,
  BackupPanel,
  DriveConnectionPanel,
  formatStorageBytes,
  safeAuthorizationUrl,
  StorageSnapshot,
  type BackupRecord,
  type GoogleDriveStatus,
} from "./storage-dashboard";

const backup: BackupRecord = {
  id: "backup-12345678",
  status: "SUCCEEDED",
  createdAt: "2026-07-29T08:00:00.000Z",
  completedAt: "2026-07-29T08:02:00.000Z",
  sizeBytes: 1_572_864,
  restoreTest: {
    status: "PASSED",
    completedAt: "2026-07-29T09:00:00.000Z",
  },
};

afterEach(cleanup);

describe("storage dashboard helpers", () => {
  it("normalizes and orders supported backup-list response envelopes", () => {
    const older = {
      ...backup,
      id: "older",
      createdAt: "2026-07-28T08:00:00.000Z",
    };
    expect(
      backupRecords({ data: [older, backup] }).map((item) => item.id),
    ).toEqual([backup.id, older.id]);
    expect(backupRecords({ items: [backup] })).toEqual([backup]);
    expect(backupRecords({ backups: [backup] })).toEqual([backup]);
  });

  it("formats byte counts without exposing backend paths", () => {
    expect(formatStorageBytes(1_572_864)).toBe("1.5 MB");
    expect(formatStorageBytes(undefined)).toBe("Not reported");
  });

  it("accepts only HTTPS OAuth destinations", () => {
    expect(
      safeAuthorizationUrl(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=test",
      ),
    ).toContain("https://accounts.google.com/");
    expect(safeAuthorizationUrl("http://accounts.google.com/oauth")).toBeNull();
    expect(safeAuthorizationUrl("https://example.test/oauth")).toBeNull();
    expect(safeAuthorizationUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("storage dashboard states", () => {
  it("renders safe connection metadata and ignores secret-shaped properties", () => {
    const status = {
      connected: true,
      provider: "Google Drive",
      accountEmail: "backup-admin@college.test",
      folderName: "AVS protected backups",
      connectedAt: "2026-07-29T07:00:00.000Z",
      accessToken: "must-never-render",
      refreshToken: "must-never-render-either",
    } as GoogleDriveStatus & {
      accessToken: string;
      refreshToken: string;
    };
    render(
      <DriveConnectionPanel
        status={status}
        canManage={false}
        connecting={false}
        revoking={false}
        onConnect={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    expect(screen.getByText("backup-admin@college.test")).toBeVisible();
    expect(screen.getByText("AVS protected backups")).toBeVisible();
    expect(screen.queryByText("must-never-render")).not.toBeInTheDocument();
    expect(
      screen.queryByText("must-never-render-either"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/integrations management permission/i),
    ).toBeVisible();
  });

  it("renders loading-independent empty and populated backup states", () => {
    const { rerender } = render(
      <BackupPanel
        backups={[]}
        connected
        canManage
        backingUp={false}
        testingRestore={false}
        onBackup={vi.fn()}
        onRestoreTest={vi.fn()}
      />,
    );
    expect(screen.getByText("No backup history is available")).toBeVisible();

    rerender(
      <BackupPanel
        backups={[backup]}
        connected
        canManage
        backingUp={false}
        testingRestore={false}
        onBackup={vi.fn()}
        onRestoreTest={vi.fn()}
      />,
    );
    expect(screen.getByText(/Backup backup-1/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Back up now" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Test latest restore" }),
    ).toBeEnabled();
  });

  it("does not offer in-app recovery actions for external backup metadata", () => {
    const onRestoreTest = vi.fn();
    render(
      <BackupPanel
        backups={[
          {
            ...backup,
            recoveryMode: "EXTERNAL_MANUAL",
            inAppRecoveryAvailable: false,
            googleDriveStatus: "EXTERNAL",
          },
        ]}
        connected
        canManage
        backingUp={false}
        testingRestore={false}
        onBackup={vi.fn()}
        onRestoreTest={onRestoreTest}
        onVerify={vi.fn()}
        onDownloadSchema={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Test latest restore" }),
    ).toBeDisabled();
    expect(screen.getByText(/manual recovery only/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Verify" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Schema SQL" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Manifest" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete eligible" }),
    ).not.toBeInTheDocument();
  });

  it("summarizes connection, backup, and restore-test health", () => {
    render(<StorageSnapshot drive={{ connected: true }} backups={[backup]} />);
    const summary = within(
      screen.getByRole("region", { name: "Storage status summary" }),
    );
    expect(summary.getByText("Connected")).toBeVisible();
    expect(summary.getByText("succeeded")).toBeVisible();
    expect(summary.getByText("passed")).toBeVisible();
  });
});
