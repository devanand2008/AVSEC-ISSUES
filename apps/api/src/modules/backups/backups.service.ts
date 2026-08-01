import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
import { BACKUP_ID_PATTERN, type BackupManifest, type BackupRecord, type RetentionPolicy } from "./backup.types";
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
  encryptedSizeBytes: bigint | null;
  encryptedChecksumSha256: string | null;
  createdAt: Date;
  completedAt: Date | null;
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
      return {
        backups: records.map(publicDatabaseBackup),
        invalid: [],
      };
    }

    const { directory, key } = await this.settings();
    const inventory = await this.manifests.inventory(directory, key);
    return {
      backups: inventory.backups.map(publicLocalBackup),
      invalid: inventory.invalid,
    };
  }

  async createManual(user: AuthPrincipal, requestId: string) {
    return this.createBackup(user, requestId, "MANUAL");
  }

  async createScheduled(
    user: BackupActor,
    requestId: string,
    backupType: Extract<
      BackupCreationType,
      "DAILY" | "WEEKLY" | "MONTHLY"
    >,
  ) {
    return this.createBackup(user, requestId, backupType);
  }

  private async createBackup(
    user: BackupActor,
    requestId: string,
    backupType: BackupCreationType,
  ) {
    const {
      directory,
      key,
      keyVersion,
      databaseUrl,
      driveEnabled,
      retention,
    } = await this.settings();
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
      if (dumpStat.size === 0) throw new Error("pg_dump produced an empty backup.");

      await this.prisma.databaseBackup.update({
        where: { id: databaseRecord.id },
        data: { status: "ENCRYPTING" },
      });
      const encrypted = await this.crypto.encryptFile(dumpPath, artifactPath, key);
      const decrypted = await this.crypto.decryptFile(artifactPath, verificationPath, key, encrypted.artifactSha256);
      if (
        decrypted.plaintextSha256 !== encrypted.plaintextSha256
        || decrypted.plaintextBytes !== encrypted.plaintextBytes
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
          this.recordCounts(),
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
      const retentionResult = await this.retention.apply(inventory.backups, retention);
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
        if (
          !record.providerFileId ||
          !record.storageConnection?.createdById
        ) {
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
        throw new Error("Decrypted backup checksum does not match its authenticated manifest.");
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

  private async settings(): Promise<{
    directory: string;
    key: Buffer;
    keyVersion: number;
    databaseUrl: string;
    driveEnabled: boolean;
    retention: RetentionPolicy;
  }> {
    const directory = resolve(this.config.get<string>("BACKUP_DIRECTORY") ?? resolve(process.cwd(), "backups"));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const key = decodeBackupKey(this.config.get<string>("BACKUP_ENCRYPTION_KEY") ?? "");
    const databaseUrl = this.config.get<string>("DATABASE_URL") ?? "";
    if (!databaseUrl) throw new Error("DATABASE_URL is required for database backups.");
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
        maxBackups: positiveInteger(this.config.get("BACKUP_RETENTION_MAX_COUNT"), 30),
        maxAgeDays: positiveInteger(this.config.get("BACKUP_RETENTION_MAX_AGE_DAYS"), 90),
        minBackups: positiveInteger(this.config.get("BACKUP_RETENTION_MIN_COUNT"), 3),
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

  private async findRecord(directory: string, key: Buffer, id: string): Promise<BackupRecord> {
    if (!BACKUP_ID_PATTERN.test(id)) throw new Error("Backup id is invalid.");
    const manifestPath = join(directory, `${id}.manifest.json`);
    const manifest = await this.manifests.load(manifestPath, key);
    return { manifest, manifestPath, artifactPath: join(directory, manifest.artifact.fileName) };
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

  private async driveDestination(collegeId: string): Promise<{
    ownerId: string;
    storageConnectionId: string;
    folderId: string;
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
    const manualFolder = await this.drive.ensureFolder({
      ownerId: connection.createdById,
      parentId: connection.backupFolderId,
      name: "manual",
    });
    return {
      ownerId: connection.createdById,
      storageConnectionId: connection.id,
      folderId: manualFolder.id,
    };
  }

  private async recordCounts() {
    const [users, campuses, attendanceRecords, issues, auditLogs, files] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.campus.count(),
        this.prisma.attendanceRecord.count(),
        this.prisma.issue.count(),
        this.prisma.auditLog.count(),
        this.prisma.fileRecord.count(),
      ]);
    return { users, campuses, attendanceRecords, issues, auditLogs, files };
  }

  private async schemaVersion(): Promise<string | null> {
    const migrations = await this.prisma.$queryRaw<
      Array<{ migration_name: string }>
    >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`;
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
    const timestamp = new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
    return `backup-${timestamp}-${randomBytes(6).toString("hex")}`;
  }
}
