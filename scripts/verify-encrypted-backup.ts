import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { config as loadEnvironment } from "dotenv";
import { readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AuthPrincipal } from "../apps/api/src/common/http/request-context";
import { PrismaService } from "../apps/api/src/database/prisma.service";
import { AuditService } from "../apps/api/src/modules/audit/audit.service";
import { BackupCryptoService } from "../apps/api/src/modules/backups/backup-crypto.service";
import { BackupManifestService } from "../apps/api/src/modules/backups/backup-manifest.service";
import { BackupRetentionService } from "../apps/api/src/modules/backups/backup-retention.service";
import { BackupsService } from "../apps/api/src/modules/backups/backups.service";
import { PostgresToolsService } from "../apps/api/src/modules/backups/postgres-tools.service";
import { SafeProcessRunner } from "../apps/api/src/modules/backups/safe-process-runner.service";
import { GoogleDriveHierarchyService } from "../apps/api/src/modules/google-drive/google-drive-hierarchy.service";
import { GoogleDriveStorageService } from "../apps/api/src/modules/google-drive/google-drive-storage.service";

const repositoryRoot = resolve(__dirname, "..");
loadEnvironment({ path: join(repositoryRoot, ".env") });

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for backup verification.`);
  return value;
}

async function main(): Promise<void> {
  const backupDirectory = resolve(
    process.env.BACKUP_DIRECTORY ?? join(repositoryRoot, "backups"),
  );
  const keepArtifacts =
    process.env.BACKUP_VERIFY_KEEP_ARTIFACTS?.trim().toLowerCase() === "true";
  requiredEnvironment("DATABASE_URL");
  requiredEnvironment("BACKUP_ENCRYPTION_KEY");
  const config = new ConfigService({
    ...process.env,
    BACKUP_DIRECTORY: backupDirectory,
    GOOGLE_DRIVE_ENABLED: false,
  });
  const prisma = new PrismaService(config);
  const audit = new AuditService(prisma);
  const backups = new BackupsService(
    config,
    new BackupCryptoService(),
    new BackupManifestService(),
    new BackupRetentionService(),
    new PostgresToolsService(new SafeProcessRunner()),
    audit,
    prisma,
    Object.create(
      GoogleDriveStorageService.prototype,
    ) as GoogleDriveStorageService,
    Object.create(
      GoogleDriveHierarchyService.prototype,
    ) as GoogleDriveHierarchyService,
  );
  const filesBefore = new Set(
    await readdir(backupDirectory).catch(() => [] as string[]),
  );
  let backupId: string | undefined;
  let principal: AuthPrincipal | undefined;

  try {
    await prisma.$connect();
    const administrator = await prisma.user.findFirst({
      where: {
        status: "ACTIVE",
        archivedAt: null,
        roles: {
          some: {
            role: {
              code: { in: ["MAIN_ADMIN", "SUPER_ADMIN"] },
            },
          },
        },
      },
      select: {
        id: true,
        publicId: true,
        collegeId: true,
        fullName: true,
        email: true,
        status: true,
        mustChangePassword: true,
      },
    });
    if (!administrator) {
      throw new Error(
        "An active Main Admin or Super Admin is required for backup verification.",
      );
    }
    principal = {
      ...administrator,
      sessionId: `backup-verification-${randomUUID()}`,
      roles: ["MAIN_ADMIN"],
      permissions: ["backups.manage"],
      scopes: [],
    };
    const backup = await backups.createManual(
      principal,
      `backup-create-verification-${randomUUID()}`,
    );
    backupId = backup.id;
    const restore = await backups.restoreTest(
      principal,
      backup.id,
      `backup-restore-verification-${randomUUID()}`,
    );

    if (!keepArtifacts) {
      await prisma.databaseBackup.update({
        where: { id: backup.id },
        data: { status: "DELETED", deletedAt: new Date() },
      });
      await audit.record({
        actorId: principal.id,
        collegeId: principal.collegeId,
        action: "database_backup.verification_artifacts_removed",
        entityType: "DatabaseBackup",
        entityId: backup.id,
        requestId: `backup-cleanup-verification-${randomUUID()}`,
      });
    }

    process.stdout.write(
      `${JSON.stringify({
        backupId: backup.id,
        backupStatus: backup.status,
        backupType: backup.backupType,
        encryptedSizeBytes: backup.sizeBytes,
        encryptedChecksumSha256: backup.artifactSha256,
        restoreStatus: restore.status,
        recordCountComparison: restore.recordCountComparison,
        schemaComparison: restore.schemaComparison,
        artifactsRetained: keepArtifacts,
      })}\n`,
    );
  } finally {
    if (!keepArtifacts) {
      const filesAfter = await readdir(backupDirectory).catch(
        () => [] as string[],
      );
      await Promise.all(
        filesAfter
          .filter(
            (fileName) =>
              !filesBefore.has(fileName) &&
              (fileName.endsWith(".avsbak") ||
                fileName.endsWith(".manifest.json")),
          )
          .map((fileName) =>
            unlink(join(backupDirectory, fileName)).catch(() => undefined),
          ),
      );
      if (backupId && principal) {
        await prisma.databaseBackup
          .updateMany({
            where: { id: backupId, deletedAt: null },
            data: { status: "DELETED", deletedAt: new Date() },
          })
          .catch(() => undefined);
      }
    }
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Backup verification failed."}\n`,
  );
  process.exitCode = 1;
});
