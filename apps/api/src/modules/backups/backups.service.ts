import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { AuditService } from "../audit/audit.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { GoogleDriveHierarchyService } from "../google-drive/google-drive-hierarchy.service";
import { GoogleDriveStorageService } from "../google-drive/google-drive-storage.service";
import { StorageProviderError } from "../google-drive/storage-provider";
import { BackupCryptoService } from "./backup-crypto.service";
import { decodeBackupKey } from "./backup-key";
import { BackupManifestService } from "./backup-manifest.service";
import { BackupRetentionService } from "./backup-retention.service";
import {
  BACKUP_ID_PATTERN,
  type BackupManifest,
  type BackupRecord,
  type RetentionPolicy,
} from "./backup.types";
import { PostgresToolsService } from "./postgres-tools.service";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type BackupCreationType =
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "MANUAL"
  | "PRE_MIGRATION"
  | "PRE_DELETION"
  | "ACADEMIC_YEAR_TRANSITION";

type BackupActor = Pick<AuthPrincipal, "id" | "collegeId">;

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function verifiedRecordCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Backup table-count metadata is incomplete.");
  }
  const entries = Object.entries(value);
  if (
    entries.length === 0 ||
    !("_prisma_migrations" in value) ||
    entries.some(
      ([table, count]) =>
        !table ||
        typeof count !== "number" ||
        !Number.isSafeInteger(count) ||
        count < 0,
    )
  ) {
    throw new Error("Backup table-count metadata is incomplete.");
  }
  return Object.fromEntries(entries);
}

function publicLocalBackup(record: BackupRecord) {
  return {
    id: record.manifest.id,
    status: "COMPLETED",
    createdAt: record.manifest.createdAt,
    completedAt: record.manifest.verification.verifiedAt,
    artifactBytes: record.manifest.artifact.bytes,
    sizeBytes: record.manifest.artifact.bytes,
    artifactSha256: record.manifest.artifact.sha256,
    verifiedAt: record.manifest.verification.verifiedAt,
    format: record.manifest.dump.format,
  };
}

type DatabaseBackupView = {
  id: string;
  status: string;
  backupType: string;
  fileName: string;
  storageConnectionId?: string | null;
  providerFileId?: string | null;
  encryptedSizeBytes: bigint | null;
  encryptedChecksumSha256: string | null;
  createdAt: Date;
  completedAt: Date | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  restoreTests: Array<{
    id: string;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
    recordCountComparison: unknown;
    schemaComparison: unknown;
  }>;
};

function publicDatabaseBackup(record: DatabaseBackupView) {
  const restore = record.restoreTests[0];
  const inAppRecoveryAvailable = Boolean(
    record.storageConnectionId && record.providerFileId,
  );
  return {
    id: record.id,
    status: record.status,
    backupType: record.backupType,
    fileName: record.fileName,
    createdAt: record.createdAt.toISOString(),
    ...(record.completedAt
      ? { completedAt: record.completedAt.toISOString() }
      : {}),
    ...(record.encryptedSizeBytes !== null
      ? {
          artifactBytes: record.encryptedSizeBytes.toString(),
          sizeBytes: record.encryptedSizeBytes.toString(),
        }
      : {}),
    ...(record.encryptedChecksumSha256
      ? { artifactSha256: record.encryptedChecksumSha256 }
      : {}),
    sqlFormat: record.fileName.endsWith(".sql.gz.enc") ? "PLAIN" : "CUSTOM",
    encrypted: true,
    checksumStatus: record.encryptedChecksumSha256 ? "RECORDED" : "PENDING",
    googleDriveStatus: record.completedAt
      ? inAppRecoveryAvailable
        ? "UPLOADED"
        : "EXTERNAL"
      : "PENDING",
    recoveryMode: inAppRecoveryAvailable ? "IN_APP" : "EXTERNAL_MANUAL",
    inAppRecoveryAvailable,
    ...(record.failureCode
      ? {
          failure: {
            code: record.failureCode,
            message: record.failureMessage ?? "Backup operation failed.",
          },
        }
      : {}),
    ...(restore
      ? {
          lastRestoreTest: {
            id: restore.id,
            status: restore.status,
            requestedAt: restore.startedAt.toISOString(),
            ...(restore.completedAt
              ? { completedAt: restore.completedAt.toISOString() }
              : {}),
            recordCountComparison: restore.recordCountComparison,
            schemaComparison: restore.schemaComparison,
          },
        }
      : {}),
  };
}

@Injectable()
export class BackupsService {
  constructor(
    private readonly config: ConfigService,
    private readonly crypto: BackupCryptoService,
    private readonly manifests: BackupManifestService,
    private readonly retention: BackupRetentionService,
    private readonly postgres: PostgresToolsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly drive: GoogleDriveStorageService,
    private readonly driveHierarchy: GoogleDriveHierarchyService,
  ) {}

  async list(user: AuthPrincipal) {
    const records = await this.prisma.databaseBackup.findMany({
      where: { collegeId: user.collegeId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        restoreTests: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (records.length) {
      const databaseMode = this.config.get<string>(
        "DATABASE_MODE",
        "EXTERNAL_PERSISTENT",
      );
      return {
        backups: records.map(publicDatabaseBackup),
        invalid: [],
        database: {
          status: "CONNECTED",
          mode: databaseMode,
          warning:
            databaseMode === "RENDER_FREE_PILOT"
              ? "Pilot Database: This free database is temporary and must not be treated as permanent college storage. Verify daily external SQL backups and migrate to a persistent PostgreSQL service before expiry."
              : null,
        },
        schedule: {
          timezone: "Asia/Kolkata",
          dailyTime: "02:00",
          githubActionsCron: "30 20 * * *",
          scheduler: "GITHUB_ACTIONS",
        },
        retention: { daily: 30, weekly: 12, monthly: 12 },
      };
    }

    const databaseMode = this.config.get<string>(
      "DATABASE_MODE",
      "EXTERNAL_PERSISTENT",
    );
    const usesExternalProductionInventory =
      this.config.get<string>("NODE_ENV") === "production" &&
      databaseMode === "EXTERNAL_PERSISTENT";
    if (usesExternalProductionInventory) {
      const driveEnabled = this.config.get<boolean>(
        "GOOGLE_DRIVE_ENABLED",
        false,
      );
      const scheduleEnabled = this.config.get<boolean>(
        "BACKUP_SCHEDULE_ENABLED",
        false,
      );
      const offHostEnabled = driveEnabled && scheduleEnabled;
      return {
        backups: [],
        invalid: [],
        database: {
          status: "CONNECTED",
          mode: databaseMode,
          warning: null,
        },
        schedule: {
          timezone: "Asia/Kolkata",
          dailyTime: "02:00",
          githubActionsCron: "30 20 * * *",
          enabled: scheduleEnabled,
          scheduler: scheduleEnabled ? "GITHUB_ACTIONS" : "DISABLED",
        },
        retention: { daily: 30, weekly: 12, monthly: 12 },
        backupReadiness: {
          status: "DEGRADED",
          code: offHostEnabled
            ? "NO_ACTIVE_BACKUP_METADATA"
            : "OFF_HOST_BACKUP_DISABLED",
          offHostStatus: offHostEnabled ? "ENABLED" : "DISABLED",
          inventorySource: "DATABASE_METADATA",
          message: offHostEnabled
            ? "No active backup metadata is currently available."
            : "Scheduled off-host backups are disabled. Recovery currently depends on externally managed verified archives.",
        },
      };
    }

    const { directory, key } = await this.settings();
    const inventory = await this.manifests.inventory(directory, key);
    return {
      backups: inventory.backups.map(publicLocalBackup),
      invalid: inventory.invalid,
      database: {
        status: "CONNECTED",
        mode: this.config.get<string>("DATABASE_MODE", "EXTERNAL_PERSISTENT"),
        warning:
          this.config.get<string>("DATABASE_MODE") === "RENDER_FREE_PILOT"
            ? "Pilot Database: This free database is temporary and must not be treated as permanent college storage. Verify daily external SQL backups and migrate to a persistent PostgreSQL service before expiry."
            : null,
      },
      schedule: {
        timezone: "Asia/Kolkata",
        dailyTime: "02:00",
        githubActionsCron: "30 20 * * *",
        scheduler: "GITHUB_ACTIONS",
      },
      retention: { daily: 30, weekly: 12, monthly: 12 },
    };
  }

  async createManual(
    user: AuthPrincipal,
    requestId: string,
    reason = "Manual backup requested by an administrator",
  ) {
    return this.createPlainSqlBackup(user, requestId, "MANUAL", reason);
  }

  async createScheduled(
    user: BackupActor,
    requestId: string,
    backupType: Extract<BackupCreationType, "DAILY" | "WEEKLY" | "MONTHLY">,
  ) {
    return this.createPlainSqlBackup(user, requestId, backupType);
  }

  private async createPlainSqlBackup(
    user: BackupActor,
    requestId: string,
    backupType: BackupCreationType,
    reason?: string,
  ) {
    const { directory, key, keyVersion, databaseUrl, driveEnabled } =
      await this.settings();
    if (this.config.get<string>("NODE_ENV") === "production" && !driveEnabled) {
      throw new Error(
        "Production backups require private persistent Google Drive storage.",
      );
    }
    const createdAt = new Date();
    const timestamp = istFileTimestamp(createdAt);
    const localId = this.newId();
    const fullSqlFileName = `avs_portal_full_${timestamp}_IST.sql`;
    const artifactFileName = `${fullSqlFileName}.gz.enc`;
    const schemaFileName = `avs_portal_schema_${timestamp}_IST.sql`;
    const manifestFileName = `avs_portal_manifest_${timestamp}_IST.json`;
    const checksumFileName = `avs_portal_checksum_${timestamp}_IST.sha256`;
    const suffix = randomBytes(8).toString("hex");
    const fullSqlPath = join(directory, `.${localId}.${suffix}.sql`);
    const gzipPath = join(directory, `.${localId}.${suffix}.sql.gz`);
    const verificationGzipPath = join(
      directory,
      `.${localId}.${suffix}.verify.sql.gz`,
    );
    const verificationSqlPath = join(
      directory,
      `.${localId}.${suffix}.verify.sql`,
    );
    const artifactPath = join(directory, artifactFileName);
    const schemaPath = join(directory, schemaFileName);
    const manifestPath = join(directory, manifestFileName);
    const checksumPath = join(directory, checksumFileName);
    const databaseRecord = await this.prisma.databaseBackup.create({
      data: {
        collegeId: user.collegeId,
        backupType,
        status: "CREATING",
        fileName: artifactFileName,
        encryptionKeyVersion: keyVersion,
        createdById: user.id,
      },
    });
    const uploadedObjectIds: string[] = [];
    let driveOwnerId: string | undefined;
    let completed = false;

    try {
      await this.postgres.dumpPlain(databaseUrl, fullSqlPath);
      await this.postgres.inspectSql(fullSqlPath);
      await this.postgres.dumpSchema(databaseUrl, schemaPath);
      await this.postgres.inspectSql(schemaPath);
      const [fullStat, schemaStat, fullChecksum, schemaChecksum] =
        await Promise.all([
          stat(fullSqlPath),
          stat(schemaPath),
          this.crypto.sha256File(fullSqlPath),
          this.crypto.sha256File(schemaPath),
        ]);
      if (fullStat.size === 0 || schemaStat.size === 0) {
        throw new Error("pg_dump produced an empty SQL backup.");
      }

      await this.prisma.databaseBackup.update({
        where: { id: databaseRecord.id },
        data: { status: "ENCRYPTING" },
      });
      await pipeline(
        createReadStream(fullSqlPath),
        createGzip({ level: 9 }),
        createWriteStream(gzipPath, { flags: "wx", mode: 0o600 }),
      );
      const gzipStat = await stat(gzipPath);
      const gzipChecksum = await this.crypto.sha256File(gzipPath);
      const encrypted = await this.crypto.encryptFile(
        gzipPath,
        artifactPath,
        key,
      );
      await this.crypto.decryptFile(
        artifactPath,
        verificationGzipPath,
        key,
        encrypted.artifactSha256,
      );
      await pipeline(
        createReadStream(verificationGzipPath),
        createGunzip(),
        createWriteStream(verificationSqlPath, { flags: "wx", mode: 0o600 }),
      );
      await this.postgres.inspectSql(verificationSqlPath);
      if (
        (await this.crypto.sha256File(verificationSqlPath)) !== fullChecksum
      ) {
        throw new Error(
          "Backup encryption round-trip checksum verification failed.",
        );
      }

      const [recordCounts, schemaVersion] = await Promise.all([
        this.recordCounts(databaseUrl),
        this.schemaVersion(),
      ]);
      const databaseIdentity = safeDatabaseIdentity(databaseUrl);
      let manifest = this.manifests.sign(
        {
          schemaVersion: 1,
          id: localId,
          createdAt: createdAt.toISOString(),
          artifact: {
            fileName: artifactFileName,
            format: "avs-aes-256-gcm-v1",
            bytes: encrypted.artifactBytes,
            sha256: encrypted.artifactSha256,
          },
          dump: {
            format: "postgresql-plain-sql",
            bytes: fullStat.size,
            sha256: fullChecksum,
          },
          compression: {
            format: "gzip",
            bytes: gzipStat.size,
            sha256: gzipChecksum,
          },
          schema: {
            fileName: schemaFileName,
            format: "postgresql-plain-sql",
            bytes: schemaStat.size,
            sha256: schemaChecksum,
          },
          database: {
            mode: this.config.get<"EXTERNAL_PERSISTENT" | "RENDER_FREE_PILOT">(
              "DATABASE_MODE",
              "EXTERNAL_PERSISTENT",
            ),
            ...databaseIdentity,
          },
          application: {
            commit: this.applicationCommit(),
            prismaMigration: schemaVersion,
          },
          tableCounts: recordCounts,
          encryption: {
            algorithm: "aes-256-gcm",
            keyId: encrypted.keyId,
          },
          verification: {
            verifiedAt: new Date().toISOString(),
            sqlReadable: true,
            uploadStatus: driveEnabled ? "pending" : "completed",
            restoreTestStatus: "not_tested",
          },
        },
        key,
      );
      const checksumContent = [
        `${fullChecksum}  ${fullSqlFileName}`,
        `${encrypted.artifactSha256}  ${artifactFileName}`,
        `${schemaChecksum}  ${schemaFileName}`,
      ].join("\n");
      await writeFile(checksumPath, `${checksumContent}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      const checksumFileSha256 = await this.crypto.sha256File(checksumPath);
      const { manifestHmacSha256: _signature, ...unsignedManifest } = manifest;
      manifest = this.manifests.sign(
        {
          ...unsignedManifest,
          checksumFile: {
            fileName: checksumFileName,
            sha256: checksumFileSha256,
          },
        },
        key,
      );
      await this.manifests.write(manifestPath, manifest);
      const manifestChecksumSha256 = await this.crypto.sha256File(manifestPath);

      let storageConnectionId: string | null = null;
      let providerFileId: string | null = null;
      let providerFolderId: string | null = null;
      const uploads: Array<{
        category: string;
        fileName: string;
        mimeType: string;
        checksum: string;
        folderId: string;
        object: Awaited<ReturnType<GoogleDriveStorageService["upload"]>>;
      }> = [];
      if (driveEnabled) {
        await this.prisma.databaseBackup.update({
          where: { id: databaseRecord.id },
          data: { status: "UPLOADING" },
        });
        const destination = await this.driveDestination(
          user.collegeId,
          backupType,
        );
        driveOwnerId = destination.ownerId;
        storageConnectionId = destination.storageConnectionId;
        providerFolderId = destination.folderId;
        const files = [
          {
            category: "DATABASE_BACKUP",
            path: artifactPath,
            fileName: artifactFileName,
            mimeType: "application/octet-stream",
            checksum: encrypted.artifactSha256,
            folderId: destination.folderId,
          },
          {
            category: "BACKUP_SCHEMA",
            path: schemaPath,
            fileName: schemaFileName,
            mimeType: "application/sql",
            checksum: schemaChecksum,
            folderId: destination.schemaFolderId,
          },
          {
            category: "BACKUP_CHECKSUM",
            path: checksumPath,
            fileName: checksumFileName,
            mimeType: "text/plain",
            checksum: checksumFileSha256,
            folderId: destination.manifestFolderId,
          },
          {
            category: "BACKUP_MANIFEST",
            path: manifestPath,
            fileName: manifestFileName,
            mimeType: "application/json",
            checksum: manifestChecksumSha256,
            folderId: destination.manifestFolderId,
          },
        ];
        for (const file of files) {
          const object = await this.drive.upload({
            ownerId: destination.ownerId,
            folderId: file.folderId,
            name: file.fileName,
            mimeType: file.mimeType,
            content: await readFile(file.path),
          });
          uploadedObjectIds.push(object.id);
          await this.drive.getMetadata({
            ownerId: destination.ownerId,
            objectId: object.id,
          });
          uploads.push({ ...file, object });
        }
        providerFileId = uploads[0]?.object.id ?? null;
        await this.prisma.databaseBackup.update({
          where: { id: databaseRecord.id },
          data: { status: "VERIFYING" },
        });
      }

      const completedAt = new Date();
      const updated = await this.prisma.$transaction(async (tx) => {
        const backup = await tx.databaseBackup.update({
          where: { id: databaseRecord.id },
          data: {
            storageConnectionId,
            status: "COMPLETED",
            providerFileId,
            providerFolderId,
            plainSizeBytes: BigInt(fullStat.size),
            encryptedSizeBytes: BigInt(encrypted.artifactBytes),
            plainChecksumSha256: fullChecksum,
            encryptedChecksumSha256: encrypted.artifactSha256,
            manifestChecksumSha256,
            schemaVersion,
            applicationCommit: this.applicationCommit(),
            recordCounts,
            completedAt,
          },
          include: { restoreTests: true },
        });
        await tx.backupManifest.create({
          data: {
            backupId: databaseRecord.id,
            formatVersion: 1,
            archiveFormat: "postgresql_plain_sql_gzip",
            encryptionAlgorithm: "AES-256-GCM",
            encryptionKeyVersion: keyVersion,
            nonceBase64: encrypted.nonceBase64,
            databaseSchemaVersion: schemaVersion,
            applicationCommit: this.applicationCommit(),
            backupTimestamp: createdAt,
            recordCounts,
            plainChecksumSha256: fullChecksum,
            encryptedChecksumSha256: encrypted.artifactSha256,
            plainSizeBytes: BigInt(fullStat.size),
            encryptedSizeBytes: BigInt(encrypted.artifactBytes),
          },
        });
        if (storageConnectionId && uploads.length) {
          await tx.fileRecord.createMany({
            data: uploads.map((upload) => ({
              collegeId: user.collegeId,
              storageConnectionId,
              provider: "GOOGLE_DRIVE" as const,
              providerFileId: upload.object.id,
              providerFolderId: upload.folderId,
              originalFileName: upload.fileName,
              safeFileName: upload.fileName,
              mimeType: upload.mimeType,
              fileSize: BigInt(upload.object.sizeBytes),
              checksumSha256: upload.checksum,
              category: upload.category,
              uploadedById: user.id,
              relatedEntityType: "DatabaseBackup",
              relatedEntityId: databaseRecord.id,
              status: "READY" as const,
            })),
          });
        }
        await this.audit.record(
          {
            actorId: user.id,
            collegeId: user.collegeId,
            action: "database_backup.created",
            entityType: "DatabaseBackup",
            entityId: databaseRecord.id,
            afterValue: {
              backupType,
              sqlFormat: "PLAIN",
              fullBackupFileName: artifactFileName,
              schemaBackupFileName: schemaFileName,
              checksum: fullChecksum,
              encrypted: true,
              storageProvider: driveEnabled ? "GOOGLE_DRIVE" : "LOCAL",
            },
            ...(reason ? { reason } : {}),
            requestId,
          },
          tx,
        );
        return backup;
      });
      completed = true;
      return {
        ...publicDatabaseBackup(updated),
        sqlFormat: "PLAIN",
        fullBackupFileName: artifactFileName,
        schemaBackupFileName: schemaFileName,
        manifestFileName,
        checksumFileName,
        encrypted: true,
        timezone: "Asia/Kolkata",
      };
    } catch (error) {
      if (driveOwnerId) {
        await Promise.all(
          uploadedObjectIds.map((objectId) =>
            this.drive.delete(driveOwnerId!, objectId).catch(() => undefined),
          ),
        );
      }
      await this.prisma.databaseBackup
        .update({
          where: { id: databaseRecord.id },
          data: {
            status: "FAILED",
            failureCode: this.failureCode(error),
            failureMessage:
              "The backup did not complete. Review protected logs using the request ID.",
            completedAt: new Date(),
          },
        })
        .catch(() => undefined);
      throw error;
    } finally {
      await Promise.all(
        [
          fullSqlPath,
          gzipPath,
          verificationGzipPath,
          verificationSqlPath,
          ...(driveEnabled || !completed
            ? [artifactPath, schemaPath, manifestPath, checksumPath]
            : []),
        ].map((path) => unlink(path).catch(() => undefined)),
      );
    }
  }

  async get(user: AuthPrincipal, id: string) {
    if (!UUID_PATTERN.test(id)) throw new Error("Backup id is invalid.");
    const backup = await this.prisma.databaseBackup.findFirst({
      where: { id, collegeId: user.collegeId, deletedAt: null },
      include: {
        manifest: true,
        restoreTests: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    if (!backup) throw new Error("Backup was not found.");
    const files = await this.prisma.fileRecord.findMany({
      where: {
        collegeId: user.collegeId,
        relatedEntityType: "DatabaseBackup",
        relatedEntityId: id,
        deletedAt: null,
      },
      select: {
        category: true,
        originalFileName: true,
        mimeType: true,
        fileSize: true,
        checksumSha256: true,
        status: true,
      },
      orderBy: { category: "asc" },
    });
    return {
      ...publicDatabaseBackup(backup),
      sqlFormat: backup.manifest?.archiveFormat.includes("plain_sql")
        ? "PLAIN"
        : "CUSTOM",
      encryption: backup.encryptionAlgorithm,
      applicationCommit: backup.applicationCommit,
      prismaMigration: backup.schemaVersion,
      recordCounts: backup.recordCounts,
      files: files.map((file) => ({
        ...file,
        fileSize: file.fileSize.toString(),
      })),
      failure:
        backup.status === "FAILED"
          ? {
              code: backup.failureCode,
              message: backup.failureMessage,
            }
          : null,
    };
  }

  async manifest(user: AuthPrincipal, id: string) {
    if (!UUID_PATTERN.test(id)) throw new Error("Backup id is invalid.");
    const backup = await this.prisma.databaseBackup.findFirst({
      where: { id, collegeId: user.collegeId, deletedAt: null },
      include: { manifest: true },
    });
    if (!backup?.manifest) throw new Error("Backup manifest was not found.");
    return {
      backupId: backup.id,
      backupType: backup.backupType,
      status: backup.status,
      backupTimestamp: backup.manifest.backupTimestamp,
      timezone: "Asia/Kolkata",
      sqlFormat: backup.manifest.archiveFormat,
      encryptionAlgorithm: backup.manifest.encryptionAlgorithm,
      encryptionKeyVersion: backup.manifest.encryptionKeyVersion,
      applicationCommit: backup.manifest.applicationCommit,
      prismaMigration: backup.manifest.databaseSchemaVersion,
      recordCounts: backup.manifest.recordCounts,
      plainChecksumSha256: backup.manifest.plainChecksumSha256,
      encryptedChecksumSha256: backup.manifest.encryptedChecksumSha256,
      plainSizeBytes: backup.manifest.plainSizeBytes.toString(),
      encryptedSizeBytes: backup.manifest.encryptedSizeBytes.toString(),
      completedAt: backup.completedAt,
    };
  }

  async downloadSchema(user: AuthPrincipal, id: string) {
    const file = await this.authorizedBackupFile(user, id, "BACKUP_SCHEMA");
    const object = await this.drive.download({
      ownerId: file.storageConnection.createdById,
      objectId: file.providerFileId,
      expectedChecksum: {
        algorithm: "sha256",
        value: file.checksumSha256,
      },
    });
    return {
      fileName: file.safeFileName,
      content: object.content,
      mimeType: "application/sql; charset=utf-8",
    };
  }

  async verify(user: AuthPrincipal, id: string, requestId: string) {
    if (!UUID_PATTERN.test(id)) throw new Error("Backup id is invalid.");
    const backup = await this.prisma.databaseBackup.findFirst({
      where: { id, collegeId: user.collegeId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!backup) throw new Error("Backup was not found.");
    const files = await this.prisma.fileRecord.findMany({
      where: {
        collegeId: user.collegeId,
        relatedEntityType: "DatabaseBackup",
        relatedEntityId: id,
        status: "READY",
        deletedAt: null,
        storageConnection: { createdById: { not: null } },
      },
      include: { storageConnection: true },
    });
    if (files.length < 4) throw new Error("Backup file set is incomplete.");
    try {
      for (const file of files) {
        if (!file.storageConnection?.createdById) {
          throw new Error("Backup storage owner is unavailable.");
        }
        await this.drive.download({
          ownerId: file.storageConnection.createdById,
          objectId: file.providerFileId,
          expectedChecksum: {
            algorithm: "sha256",
            value: file.checksumSha256,
          },
        });
      }
      await this.audit.record({
        actorId: user.id,
        collegeId: user.collegeId,
        action: "database_backup.verified",
        entityType: "DatabaseBackup",
        entityId: id,
        afterValue: { fileCount: files.length, checksumStatus: "PASSED" },
        requestId,
      });
      return {
        backupId: id,
        status: "VERIFIED",
        fileCount: files.length,
        verifiedAt: new Date().toISOString(),
      };
    } catch (error) {
      await this.prisma.databaseBackup.update({
        where: { id },
        data: { status: "CORRUPTED" },
      });
      throw error;
    }
  }

  async deleteEligible(
    user: AuthPrincipal,
    id: string,
    reason: string,
    requestId: string,
  ) {
    if (!UUID_PATTERN.test(id)) throw new Error("Backup id is invalid.");
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 10 || normalizedReason.length > 500) {
      throw new Error(
        "A deletion reason between 10 and 500 characters is required.",
      );
    }
    const record = await this.prisma.databaseBackup.findFirst({
      where: { id, collegeId: user.collegeId, deletedAt: null },
    });
    if (!record) throw new Error("Backup was not found.");
    const [latestCompleted, latestRestoreTested, newerCompleted] =
      await Promise.all([
        this.prisma.databaseBackup.findFirst({
          where: {
            collegeId: user.collegeId,
            status: { in: ["COMPLETED", "RESTORE_TESTED"] },
            deletedAt: null,
          },
          orderBy: { completedAt: "desc" },
          select: { id: true },
        }),
        this.prisma.databaseBackup.findFirst({
          where: {
            collegeId: user.collegeId,
            status: "RESTORE_TESTED",
            deletedAt: null,
          },
          orderBy: { completedAt: "desc" },
          select: { id: true },
        }),
        this.prisma.databaseBackup.findFirst({
          where: {
            collegeId: user.collegeId,
            status: { in: ["COMPLETED", "RESTORE_TESTED"] },
            completedAt: { gt: record.completedAt ?? record.createdAt },
            deletedAt: null,
          },
          orderBy: { completedAt: "desc" },
          select: { id: true },
        }),
      ]);
    if (
      latestCompleted?.id === id ||
      latestRestoreTested?.id === id ||
      !newerCompleted
    ) {
      throw new Error(
        "This backup is protected by retention policy and cannot be deleted.",
      );
    }
    await this.verify(user, newerCompleted.id, requestId);
    const files = await this.prisma.fileRecord.findMany({
      where: {
        collegeId: user.collegeId,
        relatedEntityType: "DatabaseBackup",
        relatedEntityId: id,
        deletedAt: null,
      },
      include: { storageConnection: true },
    });
    for (const file of files) {
      if (file.storageConnection?.createdById) {
        await this.drive.delete(
          file.storageConnection.createdById,
          file.providerFileId,
        );
      }
    }
    const deletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.fileRecord.updateMany({
        where: { id: { in: files.map((file) => file.id) } },
        data: { status: "DELETED", deletedAt },
      });
      await tx.databaseBackup.update({
        where: { id },
        data: { status: "DELETED", deletedAt },
      });
      await this.audit.record(
        {
          actorId: user.id,
          collegeId: user.collegeId,
          action: "database_backup.retention_deleted",
          entityType: "DatabaseBackup",
          entityId: id,
          beforeValue: { status: record.status, fileCount: files.length },
          afterValue: { status: "DELETED", reason: normalizedReason },
          reason: normalizedReason,
          requestId,
        },
        tx,
      );
    });
    return { backupId: id, status: "DELETED", deletedAt };
  }

  private async authorizedBackupFile(
    user: AuthPrincipal,
    backupId: string,
    category: string,
  ) {
    if (!UUID_PATTERN.test(backupId)) throw new Error("Backup id is invalid.");
    const file = await this.prisma.fileRecord.findFirst({
      where: {
        collegeId: user.collegeId,
        relatedEntityType: "DatabaseBackup",
        relatedEntityId: backupId,
        category,
        status: "READY",
        deletedAt: null,
      },
      include: { storageConnection: true },
    });
    if (!file?.storageConnection?.createdById) {
      throw new Error("Backup file was not found in private storage.");
    }
    return file as typeof file & {
      storageConnection: NonNullable<typeof file.storageConnection> & {
        createdById: string;
      };
    };
  }

  private async createBackup(
    user: BackupActor,
    requestId: string,
    backupType: BackupCreationType,
  ) {
    const { directory, key, keyVersion, databaseUrl, driveEnabled, retention } =
      await this.settings();
    const localId = this.newId();
    const artifactFileName = `${localId}.avsbak`;
    const manifestFileName = `${localId}.manifest.json`;
    const artifactPath = join(directory, artifactFileName);
    const manifestPath = join(directory, manifestFileName);
    const dumpPath = join(
      directory,
      `.${localId}.${randomBytes(8).toString("hex")}.dump`,
    );
    const verificationPath = join(
      directory,
      `.${localId}.${randomBytes(8).toString("hex")}.verify.dump`,
    );
    const databaseRecord = await this.prisma.databaseBackup.create({
      data: {
        collegeId: user.collegeId,
        backupType,
        status: "CREATING",
        fileName: artifactFileName,
        encryptionKeyVersion: keyVersion,
        createdById: user.id,
      },
    });
    const uploadedObjectIds: string[] = [];
    let driveOwnerId: string | undefined;

    try {
      const handle = await open(dumpPath, "wx", 0o600);
      await handle.close();
      await this.postgres.dump(databaseUrl, dumpPath);
      const dumpStat = await stat(dumpPath);
      if (dumpStat.size === 0)
        throw new Error("pg_dump produced an empty backup.");

      await this.prisma.databaseBackup.update({
        where: { id: databaseRecord.id },
        data: { status: "ENCRYPTING" },
      });
      const encrypted = await this.crypto.encryptFile(
        dumpPath,
        artifactPath,
        key,
      );
      const decrypted = await this.crypto.decryptFile(
        artifactPath,
        verificationPath,
        key,
        encrypted.artifactSha256,
      );
      if (
        decrypted.plaintextSha256 !== encrypted.plaintextSha256 ||
        decrypted.plaintextBytes !== encrypted.plaintextBytes
      ) {
        throw new Error("Backup round-trip checksum verification failed.");
      }
      await this.postgres.inspectDump(verificationPath);

      const createdAt = new Date().toISOString();
      const payload: Omit<BackupManifest, "manifestHmacSha256"> = {
        schemaVersion: 1,
        id: localId,
        createdAt,
        artifact: {
          fileName: artifactFileName,
          format: "avs-aes-256-gcm-v1",
          bytes: encrypted.artifactBytes,
          sha256: encrypted.artifactSha256,
        },
        dump: {
          format: "postgresql-custom",
          bytes: encrypted.plaintextBytes,
          sha256: encrypted.plaintextSha256,
        },
        encryption: {
          algorithm: "aes-256-gcm",
          keyId: encrypted.keyId,
        },
        verification: {
          verifiedAt: new Date().toISOString(),
          pgRestoreList: true,
        },
      };
      const manifest = this.manifests.sign(payload, key);
      await this.manifests.write(manifestPath, manifest);
      const [manifestChecksumSha256, recordCounts, schemaVersion] =
        await Promise.all([
          this.crypto.sha256File(manifestPath),
          this.recordCounts(databaseUrl),
          this.schemaVersion(),
        ]);

      let storageConnectionId: string | null = null;
      let providerFileId: string | null = null;
      let providerFolderId: string | null = null;
      let artifactUpload:
        | Awaited<ReturnType<GoogleDriveStorageService["upload"]>>
        | undefined;
      let manifestUpload:
        | Awaited<ReturnType<GoogleDriveStorageService["upload"]>>
        | undefined;
      if (driveEnabled) {
        await this.prisma.databaseBackup.update({
          where: { id: databaseRecord.id },
          data: { status: "UPLOADING" },
        });
        const destination = await this.driveDestination(user.collegeId);
        driveOwnerId = destination.ownerId;
        storageConnectionId = destination.storageConnectionId;
        providerFolderId = destination.folderId;
        const [artifactContent, manifestContent] = await Promise.all([
          readFile(artifactPath),
          readFile(manifestPath),
        ]);
        artifactUpload = await this.drive.upload({
          ownerId: destination.ownerId,
          folderId: destination.folderId,
          name: artifactFileName,
          mimeType: "application/octet-stream",
          content: artifactContent,
        });
        uploadedObjectIds.push(artifactUpload.id);
        manifestUpload = await this.drive.upload({
          ownerId: destination.ownerId,
          folderId: destination.folderId,
          name: manifestFileName,
          mimeType: "application/json",
          content: manifestContent,
        });
        uploadedObjectIds.push(manifestUpload.id);
        providerFileId = artifactUpload.id;

        await this.prisma.databaseBackup.update({
          where: { id: databaseRecord.id },
          data: { status: "VERIFYING" },
        });
        await this.drive.download({
          ownerId: destination.ownerId,
          objectId: artifactUpload.id,
          expectedChecksum: {
            algorithm: "sha256",
            value: encrypted.artifactSha256,
          },
        });
      }

      const inventory = await this.manifests.inventory(directory, key);
      const retentionResult = await this.retention.apply(
        inventory.backups,
        retention,
      );
      const completedAt = new Date();
      const completed = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.databaseBackup.update({
          where: { id: databaseRecord.id },
          data: {
            storageConnectionId,
            status: "COMPLETED",
            providerFileId,
            providerFolderId,
            plainSizeBytes: BigInt(encrypted.plaintextBytes),
            encryptedSizeBytes: BigInt(encrypted.artifactBytes),
            plainChecksumSha256: encrypted.plaintextSha256,
            encryptedChecksumSha256: encrypted.artifactSha256,
            manifestChecksumSha256,
            schemaVersion,
            applicationCommit: this.applicationCommit(),
            recordCounts,
            completedAt,
          },
          include: { restoreTests: true },
        });
        await tx.backupManifest.create({
          data: {
            backupId: databaseRecord.id,
            formatVersion: 1,
            archiveFormat: "pg_dump_custom",
            encryptionAlgorithm: "AES-256-GCM",
            encryptionKeyVersion: keyVersion,
            nonceBase64: encrypted.nonceBase64,
            databaseSchemaVersion: schemaVersion,
            applicationCommit: this.applicationCommit(),
            backupTimestamp: new Date(createdAt),
            recordCounts,
            plainChecksumSha256: encrypted.plaintextSha256,
            encryptedChecksumSha256: encrypted.artifactSha256,
            plainSizeBytes: BigInt(encrypted.plaintextBytes),
            encryptedSizeBytes: BigInt(encrypted.artifactBytes),
          },
        });
        if (
          artifactUpload &&
          manifestUpload &&
          storageConnectionId &&
          providerFolderId
        ) {
          await tx.fileRecord.createMany({
            data: [
              {
                collegeId: user.collegeId,
                storageConnectionId,
                provider: "GOOGLE_DRIVE",
                providerFileId: artifactUpload.id,
                providerFolderId,
                originalFileName: artifactFileName,
                safeFileName: artifactFileName,
                mimeType: "application/octet-stream",
                fileSize: BigInt(artifactUpload.sizeBytes),
                checksumSha256: encrypted.artifactSha256,
                category: "DATABASE_BACKUP",
                uploadedById: user.id,
                relatedEntityType: "DatabaseBackup",
                relatedEntityId: databaseRecord.id,
                status: "READY",
              },
              {
                collegeId: user.collegeId,
                storageConnectionId,
                provider: "GOOGLE_DRIVE",
                providerFileId: manifestUpload.id,
                providerFolderId,
                originalFileName: manifestFileName,
                safeFileName: manifestFileName,
                mimeType: "application/json",
                fileSize: BigInt(manifestUpload.sizeBytes),
                checksumSha256: manifestChecksumSha256,
                category: "BACKUP_MANIFEST",
                uploadedById: user.id,
                relatedEntityType: "DatabaseBackup",
                relatedEntityId: databaseRecord.id,
                status: "READY",
              },
            ],
          });
          await tx.storageConnection.update({
            where: { id: storageConnectionId },
            data: {
              lastSuccessfulUploadAt: completedAt,
              lastSuccessfulBackupAt: completedAt,
              lastErrorCode: null,
              lastErrorMessage: null,
            },
          });
        }
        await this.audit.record(
          {
            actorId: user.id,
            collegeId: user.collegeId,
            action: "database_backup.created",
            entityType: "DatabaseBackup",
            entityId: databaseRecord.id,
            afterValue: {
              id: databaseRecord.id,
              backupType,
              artifactBytes: encrypted.artifactBytes,
              artifactSha256: encrypted.artifactSha256,
              storageProvider: artifactUpload ? "GOOGLE_DRIVE" : "LOCAL",
              retentionDeletedIds: retentionResult.deletedIds,
            },
            requestId,
          },
          tx,
        );
        return updated;
      });
      return {
        ...publicDatabaseBackup(completed),
        retention: retentionResult,
      };
    } catch (error) {
      if (driveOwnerId) {
        await Promise.all(
          uploadedObjectIds.map((objectId) =>
            this.drive.delete(driveOwnerId!, objectId).catch(() => undefined),
          ),
        );
      }
      await this.prisma.databaseBackup
        .update({
          where: { id: databaseRecord.id },
          data: {
            status: "FAILED",
            failureCode: this.failureCode(error),
            failureMessage:
              "The backup did not complete. Review the protected server logs using the request ID.",
            completedAt: new Date(),
          },
        })
        .catch(() => undefined);
      await Promise.all([
        unlink(artifactPath).catch(() => undefined),
        unlink(manifestPath).catch(() => undefined),
      ]);
      throw error;
    } finally {
      await Promise.all([
        unlink(dumpPath).catch(() => undefined),
        unlink(verificationPath).catch(() => undefined),
      ]);
    }
  }

  async restoreTest(user: AuthPrincipal, id: string, requestId: string) {
    if (BACKUP_ID_PATTERN.test(id)) {
      return this.restoreLegacyBackup(user, id, requestId);
    }
    if (!UUID_PATTERN.test(id)) throw new Error("Backup id is invalid.");
    const { directory, key, databaseUrl } = await this.settings();
    const record = await this.prisma.databaseBackup.findFirst({
      where: { id, collegeId: user.collegeId, deletedAt: null },
      include: { storageConnection: true },
    });
    if (!record) throw new Error("Backup was not found.");
    if (record.fileName.endsWith(".sql.gz.enc")) {
      return this.restorePlainBackup(user, id, requestId);
    }
    if (
      !record.encryptedChecksumSha256 ||
      !record.plainChecksumSha256 ||
      record.encryptedSizeBytes === null ||
      record.plainSizeBytes === null
    ) {
      throw new Error("Backup metadata is incomplete.");
    }
    const localId = record.fileName.replace(/\.avsbak$/u, "");
    if (
      !BACKUP_ID_PATTERN.test(localId) ||
      record.fileName !== `${localId}.avsbak`
    ) {
      throw new Error("Backup filename is invalid.");
    }
    const localArtifactPath = join(directory, record.fileName);
    const downloadedArtifactPath = join(
      directory,
      `.${localId}.${randomBytes(8).toString("hex")}.download.avsbak`,
    );
    const temporaryDump = join(
      directory,
      `.${localId}.${randomBytes(8).toString("hex")}.restore-test.dump`,
    );
    const sourceRecordCounts = verifiedRecordCounts(record.recordCounts);
    const startedAt = new Date();
    const restoreRecord = await this.prisma.backupRestoreTest.create({
      data: {
        collegeId: user.collegeId,
        backupId: record.id,
        requestedById: user.id,
        status: "PENDING",
        startedAt,
      },
    });
    let artifactPath = localArtifactPath;
    let downloaded = false;
    try {
      const localExists = await stat(localArtifactPath)
        .then((value) => value.isFile())
        .catch(() => false);
      if (!localExists) {
        if (!record.providerFileId || !record.storageConnection?.createdById) {
          throw new Error("Backup artifact is unavailable.");
        }
        await this.prisma.backupRestoreTest.update({
          where: { id: restoreRecord.id },
          data: { status: "DOWNLOADING" },
        });
        const object = await this.drive.download({
          ownerId: record.storageConnection.createdById,
          objectId: record.providerFileId,
          expectedChecksum: {
            algorithm: "sha256",
            value: record.encryptedChecksumSha256,
          },
        });
        await writeFile(downloadedArtifactPath, object.content, {
          flag: "wx",
          mode: 0o600,
        });
        artifactPath = downloadedArtifactPath;
        downloaded = true;
      }
      await this.prisma.backupRestoreTest.update({
        where: { id: restoreRecord.id },
        data: { status: "VERIFYING" },
      });
      const decrypted = await this.crypto.decryptFile(
        artifactPath,
        temporaryDump,
        key,
        record.encryptedChecksumSha256,
      );
      if (
        decrypted.plaintextSha256 !== record.plainChecksumSha256 ||
        BigInt(decrypted.plaintextBytes) !== record.plainSizeBytes
      ) {
        throw new Error(
          "Decrypted backup checksum does not match its authenticated manifest.",
        );
      }
      await this.postgres.inspectDump(temporaryDump);
      await this.prisma.backupRestoreTest.update({
        where: { id: restoreRecord.id },
        data: { status: "RESTORING" },
      });
      const verification =
        await this.postgres.restoreAndVerifyInTemporaryDatabase(
          databaseUrl,
          temporaryDump,
          sourceRecordCounts,
        );
      const completedAt = new Date();
      const result = {
        id: restoreRecord.id,
        backupId: id,
        status: "PASSED" as const,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        ...verification,
      };
      await this.prisma.$transaction(async (tx) => {
        await tx.backupRestoreTest.update({
          where: { id: restoreRecord.id },
          data: {
            status: "PASSED",
            temporaryDatabaseHash: verification.temporaryDatabaseHash,
            recordCountComparison: verification.recordCountComparison,
            schemaComparison: verification.schemaComparison,
            completedAt,
          },
        });
        await tx.databaseBackup.update({
          where: { id: record.id },
          data: { status: "RESTORE_TESTED" },
        });
        if (record.storageConnectionId) {
          await tx.storageConnection.update({
            where: { id: record.storageConnectionId },
            data: { lastRestoreTestAt: completedAt },
          });
        }
        await this.audit.record(
          {
            actorId: user.id,
            collegeId: user.collegeId,
            action: "database_backup.restore_test_passed",
            entityType: "DatabaseBackup",
            entityId: id,
            afterValue: result,
            requestId,
          },
          tx,
        );
      });
      return result;
    } catch (error) {
      await this.prisma.backupRestoreTest
        .update({
          where: { id: restoreRecord.id },
          data: {
            status: "FAILED",
            failureCode: this.failureCode(error),
            failureMessage:
              "The isolated restore test failed. Review the protected server logs using the request ID.",
            completedAt: new Date(),
          },
        })
        .catch(() => undefined);
      throw error;
    } finally {
      await Promise.all([
        unlink(temporaryDump).catch(() => undefined),
        ...(downloaded
          ? [unlink(downloadedArtifactPath).catch(() => undefined)]
          : []),
      ]);
    }
  }

  private async restorePlainBackup(
    user: AuthPrincipal,
    id: string,
    requestId: string,
  ) {
    const { directory, key, databaseUrl } = await this.settings();
    const record = await this.prisma.databaseBackup.findFirst({
      where: { id, collegeId: user.collegeId, deletedAt: null },
      include: { storageConnection: true },
    });
    if (!record) throw new Error("Backup was not found.");
    if (
      !/^avs_portal_full_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_IST\.sql\.gz\.enc$/u.test(
        record.fileName,
      ) ||
      !record.encryptedChecksumSha256 ||
      !record.plainChecksumSha256
    ) {
      throw new Error("Plain SQL backup metadata is incomplete.");
    }
    const suffix = randomBytes(8).toString("hex");
    const localArtifactPath = join(directory, record.fileName);
    const downloadedArtifactPath = join(
      directory,
      `.${id}.${suffix}.download.sql.gz.enc`,
    );
    const temporaryGzip = join(directory, `.${id}.${suffix}.restore.sql.gz`);
    const temporarySql = join(directory, `.${id}.${suffix}.restore.sql`);
    const sourceRecordCounts = verifiedRecordCounts(record.recordCounts);
    const startedAt = new Date();
    const restoreRecord = await this.prisma.backupRestoreTest.create({
      data: {
        collegeId: user.collegeId,
        backupId: record.id,
        requestedById: user.id,
        status: "PENDING",
        startedAt,
      },
    });
    let artifactPath = localArtifactPath;
    let downloaded = false;
    try {
      const localExists = await stat(localArtifactPath)
        .then((value) => value.isFile())
        .catch(() => false);
      if (!localExists) {
        if (!record.providerFileId || !record.storageConnection?.createdById) {
          throw new Error("Backup artifact is unavailable.");
        }
        await this.prisma.backupRestoreTest.update({
          where: { id: restoreRecord.id },
          data: { status: "DOWNLOADING" },
        });
        const object = await this.drive.download({
          ownerId: record.storageConnection.createdById,
          objectId: record.providerFileId,
          expectedChecksum: {
            algorithm: "sha256",
            value: record.encryptedChecksumSha256,
          },
        });
        await writeFile(downloadedArtifactPath, object.content, {
          flag: "wx",
          mode: 0o600,
        });
        artifactPath = downloadedArtifactPath;
        downloaded = true;
      }
      await this.prisma.backupRestoreTest.update({
        where: { id: restoreRecord.id },
        data: { status: "VERIFYING" },
      });
      await this.crypto.decryptFile(
        artifactPath,
        temporaryGzip,
        key,
        record.encryptedChecksumSha256,
      );
      await pipeline(
        createReadStream(temporaryGzip),
        createGunzip(),
        createWriteStream(temporarySql, { flags: "wx", mode: 0o600 }),
      );
      if (
        (await this.crypto.sha256File(temporarySql)) !==
        record.plainChecksumSha256
      ) {
        throw new Error(
          "Decrypted SQL checksum does not match backup metadata.",
        );
      }
      await this.postgres.inspectSql(temporarySql);
      await this.prisma.backupRestoreTest.update({
        where: { id: restoreRecord.id },
        data: { status: "RESTORING" },
      });
      const verification =
        await this.postgres.restorePlainAndVerifyInTemporaryDatabase(
          databaseUrl,
          temporarySql,
          sourceRecordCounts,
        );
      const completedAt = new Date();
      const result = {
        id: restoreRecord.id,
        backupId: id,
        status: "PASSED" as const,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        ...verification,
      };
      await this.prisma.$transaction(async (tx) => {
        await tx.backupRestoreTest.update({
          where: { id: restoreRecord.id },
          data: {
            status: "PASSED",
            temporaryDatabaseHash: verification.temporaryDatabaseHash,
            recordCountComparison: verification.recordCountComparison,
            schemaComparison: verification.schemaComparison,
            completedAt,
          },
        });
        await tx.databaseBackup.update({
          where: { id: record.id },
          data: { status: "RESTORE_TESTED" },
        });
        await this.audit.record(
          {
            actorId: user.id,
            collegeId: user.collegeId,
            action: "database_backup.restore_test_passed",
            entityType: "DatabaseBackup",
            entityId: id,
            afterValue: result,
            requestId,
          },
          tx,
        );
      });
      return result;
    } catch (error) {
      await this.prisma.backupRestoreTest
        .update({
          where: { id: restoreRecord.id },
          data: {
            status: "FAILED",
            failureCode: this.failureCode(error),
            failureMessage:
              "The isolated restore test failed. Review protected logs using the request ID.",
            completedAt: new Date(),
          },
        })
        .catch(() => undefined);
      throw error;
    } finally {
      await Promise.all(
        [
          temporaryGzip,
          temporarySql,
          ...(downloaded ? [downloadedArtifactPath] : []),
        ].map((path) => unlink(path).catch(() => undefined)),
      );
    }
  }

  private async settings(): Promise<{
    directory: string;
    key: Buffer;
    keyVersion: number;
    databaseUrl: string;
    driveEnabled: boolean;
    retention: RetentionPolicy;
  }> {
    const directory = resolve(
      this.config.get<string>("BACKUP_DIRECTORY") ??
        resolve(process.cwd(), "backups"),
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const key = decodeBackupKey(
      this.config.get<string>("BACKUP_ENCRYPTION_KEY") ?? "",
    );
    const databaseUrl = this.config.get<string>("DATABASE_URL") ?? "";
    if (!databaseUrl)
      throw new Error("DATABASE_URL is required for database backups.");
    return {
      directory,
      key,
      keyVersion: positiveInteger(
        this.config.get("BACKUP_ENCRYPTION_KEY_VERSION"),
        1,
      ),
      databaseUrl,
      driveEnabled: this.config.get<boolean>("GOOGLE_DRIVE_ENABLED", false),
      retention: {
        maxBackups: positiveInteger(
          this.config.get("BACKUP_RETENTION_MAX_COUNT"),
          30,
        ),
        maxAgeDays: positiveInteger(
          this.config.get("BACKUP_RETENTION_MAX_AGE_DAYS"),
          90,
        ),
        minBackups: positiveInteger(
          this.config.get("BACKUP_RETENTION_MIN_COUNT"),
          3,
        ),
        dailyBackups: positiveInteger(
          this.config.get("BACKUP_DAILY_RETENTION"),
          14,
        ),
        weeklyBackups: positiveInteger(
          this.config.get("BACKUP_WEEKLY_RETENTION"),
          12,
        ),
        monthlyBackups: positiveInteger(
          this.config.get("BACKUP_MONTHLY_RETENTION"),
          24,
        ),
      },
    };
  }

  private async findRecord(
    directory: string,
    key: Buffer,
    id: string,
  ): Promise<BackupRecord> {
    if (!BACKUP_ID_PATTERN.test(id)) throw new Error("Backup id is invalid.");
    const manifestPath = join(directory, `${id}.manifest.json`);
    const manifest = await this.manifests.load(manifestPath, key);
    return {
      manifest,
      manifestPath,
      artifactPath: join(directory, manifest.artifact.fileName),
    };
  }

  private async restoreLegacyBackup(
    user: AuthPrincipal,
    id: string,
    requestId: string,
  ) {
    const { directory, key, databaseUrl } = await this.settings();
    const record = await this.findRecord(directory, key, id);
    const temporaryDump = join(
      directory,
      `.${id}.${randomBytes(8).toString("hex")}.restore-test.dump`,
    );
    const startedAt = new Date();
    try {
      const decrypted = await this.crypto.decryptFile(
        record.artifactPath,
        temporaryDump,
        key,
        record.manifest.artifact.sha256,
      );
      if (
        decrypted.plaintextSha256 !== record.manifest.dump.sha256 ||
        decrypted.plaintextBytes !== record.manifest.dump.bytes
      ) {
        throw new Error(
          "Decrypted backup checksum does not match its authenticated manifest.",
        );
      }
      await this.postgres.inspectDump(temporaryDump);
      const verification =
        await this.postgres.restoreAndVerifyInTemporaryDatabase(
          databaseUrl,
          temporaryDump,
        );
      const completedAt = new Date();
      const result = {
        id,
        status: "PASSED" as const,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        ...verification,
      };
      await this.audit.record({
        actorId: user.id,
        collegeId: user.collegeId,
        action: "database_backup.restore_test_passed",
        entityType: "DatabaseBackup",
        entityId: id,
        afterValue: result,
        requestId,
      });
      return result;
    } finally {
      await unlink(temporaryDump).catch(() => undefined);
    }
  }

  private async driveDestination(
    collegeId: string,
    backupType: BackupCreationType = "MANUAL",
  ): Promise<{
    ownerId: string;
    storageConnectionId: string;
    folderId: string;
    schemaFolderId: string;
    manifestFolderId: string;
  }> {
    let connection = await this.prisma.storageConnection.findFirst({
      where: {
        collegeId,
        provider: "GOOGLE_DRIVE",
        status: "CONNECTED",
        revokedAt: null,
      },
      select: { id: true, createdById: true, backupFolderId: true },
    });
    if (!connection?.createdById) {
      throw new StorageProviderError(
        "STORAGE_AUTH_REQUIRED",
        "Google Drive is not connected for this college.",
      );
    }
    if (!connection.backupFolderId) {
      await this.driveHierarchy.ensure(connection.createdById);
      connection = await this.prisma.storageConnection.findFirst({
        where: {
          id: connection.id,
          status: "CONNECTED",
          revokedAt: null,
        },
        select: { id: true, createdById: true, backupFolderId: true },
      });
    }
    if (!connection?.createdById || !connection.backupFolderId) {
      throw new StorageProviderError(
        "STORAGE_CONFIGURATION_INVALID",
        "The Google Drive backup folder is not configured.",
      );
    }
    const tierName =
      backupType === "DAILY"
        ? "daily"
        : backupType === "WEEKLY"
          ? "weekly"
          : backupType === "MONTHLY"
            ? "monthly"
            : "manual";
    const [tierFolder, schemaFolder, manifestFolder] = await Promise.all([
      this.drive.ensureFolder({
        ownerId: connection.createdById,
        parentId: connection.backupFolderId,
        name: tierName,
      }),
      this.drive.ensureFolder({
        ownerId: connection.createdById,
        parentId: connection.backupFolderId,
        name: "schema",
      }),
      this.drive.ensureFolder({
        ownerId: connection.createdById,
        parentId: connection.backupFolderId,
        name: "manifests",
      }),
    ]);
    return {
      ownerId: connection.createdById,
      storageConnectionId: connection.id,
      folderId: tierFolder.id,
      schemaFolderId: schemaFolder.id,
      manifestFolderId: manifestFolder.id,
    };
  }

  private async recordCounts(databaseUrl: string) {
    return this.postgres.tableRecordCounts(databaseUrl);
  }

  private async schemaVersion(): Promise<string | null> {
    const migrations = await this.prisma.$queryRaw<
      Array<{ migration_name: string }>
    >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1`;
    return migrations[0]?.migration_name ?? null;
  }

  private applicationCommit(): string | null {
    const value = (
      this.config.get<string>("RENDER_GIT_COMMIT") ??
      this.config.get<string>("GIT_COMMIT_SHA") ??
      ""
    ).trim();
    return /^[A-Za-z0-9._-]{7,80}$/u.test(value) ? value : null;
  }

  private failureCode(error: unknown): string {
    if (error instanceof StorageProviderError) return error.code;
    return "BACKUP_OPERATION_FAILED";
  }

  private newId(): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/gu, "")
      .replace(/\.\d{3}Z$/u, "Z");
    return `backup-${timestamp}-${randomBytes(6).toString("hex")}`;
  }
}

export function istFileTimestamp(value: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}`;
}

function safeDatabaseIdentity(databaseUrl: string): {
  hostHash: string;
  name: string;
} {
  const url = new URL(databaseUrl);
  return {
    hostHash: createHash("sha256")
      .update(url.hostname.toLowerCase(), "utf8")
      .digest("hex"),
    name: decodeURIComponent(url.pathname.replace(/^\/+/, "")),
  };
}
