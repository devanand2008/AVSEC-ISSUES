import { describe, expect, it } from "vitest";
import {
  PEOPLE_BACKUPS_ENDPOINT,
  isRestoreTestedPreDeletionBackup,
} from "./people-api";

describe("People management API routes", () => {
  it("uses the canonical admin backups controller route", () => {
    expect(PEOPLE_BACKUPS_ENDPOINT).toBe("/admin/backups");
  });

  it("accepts only a passed restore-tested pre-deletion backup created after archive", () => {
    const archivedAt = "2026-08-12T10:00:00.000Z";
    expect(
      isRestoreTestedPreDeletionBackup(
        {
          status: "RESTORE_TESTED",
          backupType: "PRE_DELETION",
          completedAt: "2026-08-12T10:01:00.000Z",
          lastRestoreTest: { status: "PASSED" },
        },
        archivedAt,
      ),
    ).toBe(true);
    expect(
      isRestoreTestedPreDeletionBackup(
        {
          status: "COMPLETED",
          backupType: "PRE_DELETION",
          completedAt: "2026-08-12T10:01:00.000Z",
          lastRestoreTest: { status: "PASSED" },
        },
        archivedAt,
      ),
    ).toBe(false);
    expect(
      isRestoreTestedPreDeletionBackup(
        {
          status: "RESTORE_TESTED",
          backupType: "PRE_DELETION",
          completedAt: "2026-08-12T09:59:00.000Z",
          lastRestoreTest: { status: "PASSED" },
        },
        archivedAt,
      ),
    ).toBe(false);
  });
});
