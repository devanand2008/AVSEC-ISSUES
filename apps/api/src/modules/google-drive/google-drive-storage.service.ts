import { Inject, Injectable } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import { GoogleDriveApiClient, type GoogleDriveFile } from "./google-drive-api.client";
import { GoogleDriveOAuthService } from "./google-drive-oauth.service";
import {
  type DownloadedObject,
  type DownloadStorageObjectInput,
  type EnsureStorageFolderInput,
  type ProviderNeutralStorage,
  type StorageChecksum,
  type StorageFolder,
  StorageProviderError,
  type StoredObject,
  type UploadStorageObjectInput,
} from "./storage-provider";
import {
  GOOGLE_DRIVE_CONFIG,
  GOOGLE_DRIVE_FOLDER_CACHE,
  GOOGLE_DRIVE_PROVIDER,
  type GoogleDriveConfig,
  type GoogleDriveFolderCacheStore,
} from "./google-drive.types";

@Injectable()
export class GoogleDriveStorageService implements ProviderNeutralStorage {
  readonly provider = GOOGLE_DRIVE_PROVIDER;
  private readonly maxUploadBytes: number;

  constructor(
    private readonly oauth: GoogleDriveOAuthService,
    private readonly api: GoogleDriveApiClient,
    @Inject(GOOGLE_DRIVE_FOLDER_CACHE)
    private readonly folders: GoogleDriveFolderCacheStore,
    @Inject(GOOGLE_DRIVE_CONFIG) config: GoogleDriveConfig,
  ) {
    this.maxUploadBytes = config.maxUploadBytes ?? 100 * 1024 * 1024;
    if (
      !Number.isSafeInteger(this.maxUploadBytes) ||
      this.maxUploadBytes < 1 ||
      this.maxUploadBytes > 500 * 1024 * 1024
    ) {
      throw new StorageProviderError(
        "STORAGE_CONFIGURATION_INVALID",
        "The Google Drive upload limit is invalid.",
      );
    }
  }

  async ensureFolder(
    input: EnsureStorageFolderInput,
  ): Promise<StorageFolder> {
    const name = this.safeName(input.name);
    const parentId = this.safeDriveId(input.parentId ?? "root", "parent");
    const { connection, accessToken } =
      await this.oauth.authorizedConnection(input.ownerId);
    const cacheKey = createHash("sha256")
      .update(`${parentId}\0${name}`, "utf8")
      .digest("hex");
    const cached = await this.folders.getOwned(
      input.ownerId,
      connection.id,
      cacheKey,
    );
    if (cached) {
      if (
        cached.ownerId !== input.ownerId ||
        cached.connectionId !== connection.id ||
        cached.parentId !== parentId ||
        cached.name !== name
      ) {
        throw new StorageProviderError(
          "STORAGE_OWNER_MISMATCH",
          "The cached Google Drive folder ownership is invalid.",
        );
      }
      return {
        provider: GOOGLE_DRIVE_PROVIDER,
        id: cached.folderId,
        name: cached.name,
        parentId: cached.parentId,
      };
    }

    const existing = await this.api.findFolder(accessToken, parentId, name);
    const folder =
      existing ??
      (await this.api.createFolder(accessToken, parentId, name));
    const saved = await this.folders.putOwned({
      ownerId: input.ownerId,
      connectionId: connection.id,
      cacheKey,
      folderId: folder.id,
      name,
      parentId,
    });
    if (
      saved.ownerId !== input.ownerId ||
      saved.connectionId !== connection.id
    ) {
      throw new StorageProviderError(
        "STORAGE_OWNER_MISMATCH",
        "The Google Drive folder cache rejected the account owner.",
      );
    }
    return {
      provider: GOOGLE_DRIVE_PROVIDER,
      id: saved.folderId,
      name: saved.name,
      parentId: saved.parentId,
    };
  }

  async upload(input: UploadStorageObjectInput): Promise<StoredObject> {
    const name = this.safeName(input.name);
    const parentId = this.safeDriveId(input.folderId, "folder");
    const mimeType = this.safeMimeType(input.mimeType);
    if (!Buffer.isBuffer(input.content)) {
      throw new StorageProviderError(
        "STORAGE_INPUT_INVALID",
        "Google Drive upload content must be a byte buffer.",
      );
    }
    if (input.content.length > this.maxUploadBytes) {
      throw new StorageProviderError(
        "STORAGE_FILE_TOO_LARGE",
        "The file exceeds the configured Google Drive upload limit.",
      );
    }
    const { accessToken } = await this.oauth.authorizedConnection(input.ownerId);
    const checksums = this.checksums(input.content);
    const file = await this.api.uploadFile(accessToken, {
      parentId,
      name,
      mimeType,
      content: input.content,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onProgress
        ? {
            onProgress: (uploadedBytes: number, totalBytes: number) =>
              input.onProgress?.({ uploadedBytes, totalBytes }),
          }
        : {}),
    });
    try {
      this.assertFileIntegrity(file, input.content, checksums);
    } catch (error) {
      await this.api.deleteFile(accessToken, file.id).catch(() => undefined);
      throw error;
    }
    return this.storedObject(file, parentId, checksums);
  }

  async download(
    input: DownloadStorageObjectInput,
  ): Promise<DownloadedObject> {
    const objectId = this.safeDriveId(input.objectId, "object");
    const { accessToken } = await this.oauth.authorizedConnection(input.ownerId);
    const { file, content } = await this.api.downloadFile(
      accessToken,
      objectId,
    );
    const checksums = this.checksums(content);
    this.assertFileIntegrity(file, content, checksums);
    if (input.expectedChecksum) {
      const actual = checksums.find(
        (checksum) => checksum.algorithm === input.expectedChecksum?.algorithm,
      );
      if (
        !actual ||
        !this.equalChecksum(actual.value, input.expectedChecksum.value)
      ) {
        throw this.checksumMismatch();
      }
    }
    return {
      ...this.storedObject(file, file.parents[0] ?? "root", checksums),
      content,
    };
  }

  async delete(ownerId: string, objectId: string): Promise<void> {
    const safeObjectId = this.safeDriveId(objectId, "object");
    const { accessToken } = await this.oauth.authorizedConnection(ownerId);
    await this.api.deleteFile(accessToken, safeObjectId);
  }

  async exists(input: {
    ownerId: string;
    objectId: string;
  }): Promise<boolean> {
    const objectId = this.safeDriveId(input.objectId, "object");
    const { accessToken } = await this.oauth.authorizedConnection(input.ownerId);
    return this.api.fileExists(accessToken, objectId);
  }

  async getMetadata(input: {
    ownerId: string;
    objectId: string;
  }): Promise<StoredObject> {
    const objectId = this.safeDriveId(input.objectId, "object");
    const { accessToken } = await this.oauth.authorizedConnection(input.ownerId);
    const file = await this.api.getFile(accessToken, objectId);
    return this.storedObject(
      file,
      file.parents[0] ?? "root",
      this.providerChecksums(file),
    );
  }

  private assertFileIntegrity(
    file: GoogleDriveFile,
    content: Buffer,
    checksums: StorageChecksum[],
  ): void {
    if (file.sizeBytes !== content.length) throw this.checksumMismatch();
    const md5 = checksums.find((checksum) => checksum.algorithm === "md5");
    const sha256 = checksums.find(
      (checksum) => checksum.algorithm === "sha256",
    );
    if (
      (file.md5Checksum &&
        (!md5 || !this.equalChecksum(file.md5Checksum, md5.value))) ||
      (file.sha256Checksum &&
        (!sha256 || !this.equalChecksum(file.sha256Checksum, sha256.value)))
    ) {
      throw this.checksumMismatch();
    }
  }

  private storedObject(
    file: GoogleDriveFile,
    fallbackParentId: string,
    checksums: StorageChecksum[],
  ): StoredObject {
    return {
      provider: GOOGLE_DRIVE_PROVIDER,
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      parentId: file.parents[0] ?? fallbackParentId,
      checksums,
    };
  }

  private checksums(content: Buffer): StorageChecksum[] {
    return [
      { algorithm: "md5", value: this.api.checksum(content, "md5") },
      { algorithm: "sha256", value: this.api.checksum(content, "sha256") },
    ];
  }

  private providerChecksums(file: GoogleDriveFile): StorageChecksum[] {
    return [
      ...(file.md5Checksum
        ? [{ algorithm: "md5" as const, value: file.md5Checksum }]
        : []),
      ...(file.sha256Checksum
        ? [{ algorithm: "sha256" as const, value: file.sha256Checksum }]
        : []),
    ];
  }

  private equalChecksum(left: string, right: string): boolean {
    const normalizedLeft = left.trim().toLowerCase();
    const normalizedRight = right.trim().toLowerCase();
    if (
      !/^[a-f0-9]+$/u.test(normalizedLeft) ||
      normalizedLeft.length !== normalizedRight.length
    ) {
      return false;
    }
    return timingSafeEqual(
      Buffer.from(normalizedLeft, "ascii"),
      Buffer.from(normalizedRight, "ascii"),
    );
  }

  private safeName(value: string): string {
    const name = value?.trim();
    if (
      !name ||
      name.length > 255 ||
      name === "." ||
      name === ".." ||
      [...name].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127;
      })
    ) {
      throw new StorageProviderError(
        "STORAGE_INPUT_INVALID",
        "The Google Drive file or folder name is invalid.",
      );
    }
    return name;
  }

  private safeDriveId(value: string, label: string): string {
    const id = value?.trim();
    if (!id || id.length > 256 || !/^[A-Za-z0-9_-]+$/u.test(id)) {
      throw new StorageProviderError(
        "STORAGE_INPUT_INVALID",
        `The Google Drive ${label} identifier is invalid.`,
      );
    }
    return id;
  }

  private safeMimeType(value: string): string {
    const mimeType = value?.trim().toLowerCase();
    if (
      !mimeType ||
      mimeType.length > 255 ||
      !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(
        mimeType,
      )
    ) {
      throw new StorageProviderError(
        "STORAGE_INPUT_INVALID",
        "The Google Drive MIME type is invalid.",
      );
    }
    return mimeType;
  }

  private checksumMismatch(): StorageProviderError {
    return new StorageProviderError(
      "STORAGE_CHECKSUM_MISMATCH",
      "Google Drive file integrity verification failed.",
    );
  }
}
