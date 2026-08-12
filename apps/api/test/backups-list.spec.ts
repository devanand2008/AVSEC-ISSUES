import type { ConfigService } from "@nestjs/config";
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

const user = { collegeId: "college-1" } as AuthPrincipal;

function createHarness(
  values: Record<string, unknown>,
  records: object[] = [],
) {
  const configGet = jest.fn((key: string, fallback?: unknown) =>
    Object.hasOwn(values, key) ? values[key] : fallback,
  );
  const config = { get: configGet } as unknown as ConfigService;
  const inventory = jest.fn().mockResolvedValue({ backups: [], invalid: [] });
  const manifests = { inventory } as unknown as BackupManifestService;
  const findMany = jest.fn().mockResolvedValue(records);
  const prisma = {
    databaseBackup: { findMany },
  } as unknown as PrismaService;
  const service = new BackupsService(
    config,
    {} as BackupCryptoService,
    manifests,
    {} as BackupRetentionService,
    {} as PostgresToolsService,
    {} as AuditService,
    prisma,
    {} as GoogleDriveStorageService,
    {} as GoogleDriveHierarchyService,
  );

  return { configGet, findMany, inventory, service };
}

describe("BackupsService list", () => {
  it("returns a degraded empty external inventory without requiring local backup settings", async () => {
    const values: Record<string, unknown> = {
      NODE_ENV: "production",
      DATABASE_MODE: "EXTERNAL_PERSISTENT",
      GOOGLE_DRIVE_ENABLED: false,
      BACKUP_SCHEDULE_ENABLED: false,
    };
    const { configGet, findMany, inventory, service } = createHarness(values);

    const result = await service.list(user);

    expect(result).toMatchObject({
      backups: [],
      invalid: [],
      database: {
        status: "CONNECTED",
        mode: "EXTERNAL_PERSISTENT",
      },
      schedule: {
        enabled: false,
        scheduler: "DISABLED",
      },
      backupReadiness: {
        status: "DEGRADED",
        code: "OFF_HOST_BACKUP_DISABLED",
        offHostStatus: "DISABLED",
        inventorySource: "DATABASE_METADATA",
      },
    });
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(findMany).toHaveBeenCalledWith({
      where: { collegeId: "college-1", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        restoreTests: {
          orderBy: [
            { completedAt: "desc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
          take: 1,
        },
      },
    });
    expect(inventory).not.toHaveBeenCalled();
    expect(configGet).not.toHaveBeenCalledWith("BACKUP_DIRECTORY");
    expect(configGet).not.toHaveBeenCalledWith("BACKUP_ENCRYPTION_KEY");
  });

  it("keeps database-backed inventory behavior when records exist", async () => {
    const createdAt = new Date("2026-08-09T02:00:00.000Z");
    const completedAt = new Date("2026-08-09T02:05:00.000Z");
    const record = {
      id: "backup-1",
      status: "COMPLETED",
      backupType: "MANUAL",
      fileName: "avs_portal_full.sql.gz.enc",
      storageConnectionId: null,
      providerFileId: null,
      encryptedSizeBytes: 128n,
      encryptedChecksumSha256: "a".repeat(64),
      createdAt,
      completedAt,
      failureCode: null,
      failureMessage: null,
      restoreTests: [],
    };
    const { configGet, inventory, service } = createHarness(
      {
        NODE_ENV: "production",
        DATABASE_MODE: "EXTERNAL_PERSISTENT",
      },
      [record],
    );

    const result = await service.list(user);

    expect(result).toMatchObject({
      backups: [
        {
          id: "backup-1",
          status: "COMPLETED",
          backupType: "MANUAL",
          createdAt: createdAt.toISOString(),
          completedAt: completedAt.toISOString(),
          artifactBytes: "128",
          recoveryMode: "EXTERNAL_MANUAL",
          inAppRecoveryAvailable: false,
        },
      ],
      invalid: [],
      schedule: { scheduler: "GITHUB_ACTIONS" },
      retention: { daily: 30, weekly: 12, monthly: 12 },
    });
    expect(inventory).not.toHaveBeenCalled();
    expect(configGet).not.toHaveBeenCalledWith("BACKUP_ENCRYPTION_KEY");
  });

  it("keeps the local manifest fallback outside external production mode", async () => {
    const backupKey = Buffer.alloc(32, 7);
    const { configGet, inventory, service } = createHarness({
      NODE_ENV: "production",
      DATABASE_MODE: "RENDER_FREE_PILOT",
      BACKUP_DIRECTORY: process.cwd(),
      BACKUP_ENCRYPTION_KEY: backupKey.toString("base64"),
      DATABASE_URL: "postgresql://unused-by-list",
    });

    const result = await service.list(user);

    expect(inventory).toHaveBeenCalledWith(process.cwd(), backupKey);
    expect(configGet).toHaveBeenCalledWith("BACKUP_ENCRYPTION_KEY");
    expect(result).toMatchObject({
      backups: [],
      invalid: [],
      database: {
        status: "CONNECTED",
        mode: "RENDER_FREE_PILOT",
        warning: expect.any(String),
      },
      schedule: { scheduler: "GITHUB_ACTIONS" },
      retention: { daily: 30, weekly: 12, monthly: 12 },
    });
  });
});
