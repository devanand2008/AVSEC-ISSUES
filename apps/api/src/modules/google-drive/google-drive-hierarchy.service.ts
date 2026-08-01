import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { GoogleDriveStorageService } from "./google-drive-storage.service";
import {
  GOOGLE_DRIVE_CONFIG,
  type GoogleDriveConfig,
} from "./google-drive.types";
import { StorageProviderError } from "./storage-provider";

const ROOT_FOLDER_NAME = "AVS_COLLEGE_MANAGEMENT_SYSTEM";
const BACKUP_FOLDER_NAME = "database-backups";
const FILES_FOLDER_NAME = "application-files";

const FOLDER_TREE = {
  [BACKUP_FOLDER_NAME]: ["daily", "weekly", "monthly", "manual"],
  [FILES_FOLDER_NAME]: [
    "profiles",
    "announcements",
    "messenger",
    "issues",
    "maintenance",
    "feedback",
    "avs-learn",
    "avs-skill",
    "certificates",
    "reports",
  ],
  imports: ["source-archives", "result-reports"],
  exports: ["attendance", "people", "issues", "feedback", "audit"],
  "disaster-recovery": ["manifests", "checksums", "restore-instructions"],
} as const;

export type GoogleDriveHierarchyStatus = {
  foldersConfigured: boolean;
  rootFolder?: string;
  folderName?: string;
  filesFolder?: string;
};

@Injectable()
export class GoogleDriveHierarchyService {
  constructor(
    private readonly storage: GoogleDriveStorageService,
    private readonly prisma: PrismaService,
    @Inject(GOOGLE_DRIVE_CONFIG)
    private readonly config: GoogleDriveConfig,
  ) {}

  async status(ownerId: string): Promise<GoogleDriveHierarchyStatus> {
    const connection = await this.prisma.storageConnection.findFirst({
      where: {
        createdById: ownerId,
        provider: "GOOGLE_DRIVE",
        status: "CONNECTED",
        revokedAt: null,
      },
      select: {
        rootFolderId: true,
        filesFolderId: true,
        backupFolderId: true,
      },
    });
    if (!connection) return { foldersConfigured: false };
    return {
      foldersConfigured: Boolean(
        connection.rootFolderId &&
          connection.filesFolderId &&
          connection.backupFolderId,
      ),
      ...(connection.rootFolderId ? { rootFolder: ROOT_FOLDER_NAME } : {}),
      ...(connection.backupFolderId
        ? { folderName: BACKUP_FOLDER_NAME }
        : {}),
      ...(connection.filesFolderId ? { filesFolder: FILES_FOLDER_NAME } : {}),
    };
  }

  async ensure(ownerId: string): Promise<GoogleDriveHierarchyStatus> {
    const connection = await this.prisma.storageConnection.findFirst({
      where: {
        createdById: ownerId,
        provider: "GOOGLE_DRIVE",
        status: "CONNECTED",
        revokedAt: null,
      },
      select: {
        id: true,
        rootFolderId: true,
        filesFolderId: true,
        backupFolderId: true,
      },
    });
    if (!connection) {
      throw new StorageProviderError(
        "STORAGE_AUTH_REQUIRED",
        "Google Drive must be connected before folders can be configured.",
      );
    }

    let rootFolderId =
      connection.rootFolderId ?? this.config.rootFolderId?.trim();
    if (!rootFolderId) {
      rootFolderId = (
        await this.storage.ensureFolder({
          ownerId,
          name: ROOT_FOLDER_NAME,
          parentId: "root",
        })
      ).id;
    }

    const topLevel = new Map<string, string>();
    for (const folderName of Object.keys(FOLDER_TREE)) {
      const configuredId =
        folderName === BACKUP_FOLDER_NAME
          ? connection.backupFolderId
          : folderName === FILES_FOLDER_NAME
            ? connection.filesFolderId
            : null;
      const folderId =
        configuredId ??
        (
          await this.storage.ensureFolder({
            ownerId,
            name: folderName,
            parentId: rootFolderId,
          })
        ).id;
      topLevel.set(folderName, folderId);
    }

    for (const [parentName, childNames] of Object.entries(FOLDER_TREE)) {
      const parentId = topLevel.get(parentName);
      if (!parentId) {
        throw new StorageProviderError(
          "STORAGE_PROVIDER_FAILURE",
          "Google Drive folder configuration is incomplete.",
        );
      }
      await Promise.all(
        childNames.map((name) =>
          this.storage.ensureFolder({ ownerId, name, parentId }),
        ),
      );
    }

    await this.prisma.storageConnection.update({
      where: { id: connection.id },
      data: {
        rootFolderId,
        backupFolderId: topLevel.get(BACKUP_FOLDER_NAME),
        filesFolderId: topLevel.get(FILES_FOLDER_NAME),
        status: "CONNECTED",
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });

    return {
      foldersConfigured: true,
      rootFolder: ROOT_FOLDER_NAME,
      folderName: BACKUP_FOLDER_NAME,
      filesFolder: FILES_FOLDER_NAME,
    };
  }
}
