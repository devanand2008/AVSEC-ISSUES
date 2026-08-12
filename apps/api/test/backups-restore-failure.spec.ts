import type { ConfigService } from "@nestjs/config";
import { resolve } from "node:path";
import type { AuthPrincipal } from "../src/common/http/request-context";
import type { PrismaService } from "../src/database/prisma.service";
import type { AuditService } from "../src/modules/audit/audit.service";
import type { BackupCryptoService } from "../src/modules/backups/backup-crypto.service";
import type { BackupManifestService } from "../src/modules/backups/backup-manifest.service";
import type { BackupRetentionService } from "../src/modules/backups/backup-retention.service";
import { BackupsService } from "../src/modules/backups/backups.service";
import type { PostgresToolsService } from "../src/modules/backups/postgres-tools.service";
import type { GoogleDriveHierarchyService } from "../src/modules/google-drive/google-drive-hierarchy.service";
import type { GoogleDriveStorageService } from "../src/modules/google-drive/google-drive-storage.service";

const backupId = "4ad711b7-ae94-4dad-9ca7-c823eb1e1ef5";
const actor = {
  id: "admin-id",
  collegeId: "college-id",
} as AuthPrincipal;

describe("BackupsService restore-test failure safety", () => {
  it("records the failure and demotes a previously restore-tested backup", async () => {
    const transaction = {
      backupRestoreTest: {
        create: jest.fn().mockResolvedValue({ id: "restore-test-id" }),
        update: jest.fn().mockResolvedValue({}),
      },
      databaseBackup: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      databaseBackup: {
        findFirst: jest.fn().mockResolvedValue({
          id: backupId,
          collegeId: actor.collegeId,
          status: "RESTORE_TESTED",
          fileName: "backup-20260812T120000Z-abcdef123456.avsbak",
          providerFileId: null,
          storageConnectionId: null,
          storageConnection: null,
          encryptedChecksumSha256: "a".repeat(64),
          plainChecksumSha256: "b".repeat(64),
          encryptedSizeBytes: 1n,
          plainSizeBytes: 1n,
          recordCounts: { _prisma_migrations: 1 },
        }),
      },
      $transaction: jest.fn((work: (client: typeof transaction) => unknown) =>
        work(transaction),
      ),
    };
    const values: Record<string, unknown> = {
      BACKUP_DIRECTORY: resolve(
        process.cwd(),
        ".codex-run",
        "missing-restore-artifacts",
      ),
      BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      DATABASE_URL: "postgresql://restore-test.invalid/avs",
    };
    const config = {
      get: jest.fn((key: string, fallback?: unknown) =>
        Object.hasOwn(values, key) ? values[key] : fallback,
      ),
    };
    const service = new BackupsService(
      config as unknown as ConfigService,
      {} as BackupCryptoService,
      {} as BackupManifestService,
      {} as BackupRetentionService,
      {} as PostgresToolsService,
      {} as AuditService,
      prisma as unknown as PrismaService,
      {} as GoogleDriveStorageService,
      {} as GoogleDriveHierarchyService,
    );

    await expect(
      service.restoreTest(actor, backupId, "request-id"),
    ).rejects.toThrow("Backup artifact is unavailable");

    expect(transaction.backupRestoreTest.create).toHaveBeenCalledWith({
      data: {
        collegeId: actor.collegeId,
        backupId,
        requestedById: actor.id,
        status: "PENDING",
        startedAt: expect.any(Date),
      },
    });
    expect(transaction.backupRestoreTest.update).toHaveBeenCalledWith({
      where: { id: "restore-test-id" },
      data: {
        status: "FAILED",
        failureCode: "BACKUP_OPERATION_FAILED",
        failureMessage:
          "The isolated restore test failed. Review the protected server logs using the request ID.",
        completedAt: expect.any(Date),
      },
    });
    expect(transaction.databaseBackup.updateMany).toHaveBeenCalledWith({
      where: { id: backupId, status: "RESTORE_TESTED" },
      data: { status: "COMPLETED" },
    });
    expect(transaction.databaseBackup.updateMany).toHaveBeenCalledTimes(2);
  });
});
