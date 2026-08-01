export type StorageProviderName = "google-drive";

export type StorageChecksum = {
  algorithm: "md5" | "sha256";
  value: string;
};

export type StorageFolder = {
  provider: StorageProviderName;
  id: string;
  name: string;
  parentId: string;
};

export type StoredObject = {
  provider: StorageProviderName;
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  parentId: string;
  checksums: StorageChecksum[];
};

export type DownloadedObject = StoredObject & {
  content: Buffer;
};

export type EnsureStorageFolderInput = {
  ownerId: string;
  name: string;
  parentId?: string;
};

export type UploadStorageObjectInput = {
  ownerId: string;
  folderId: string;
  name: string;
  mimeType: string;
  content: Buffer;
  signal?: AbortSignal;
  onProgress?: (progress: StorageUploadProgress) => void;
};

export type DownloadStorageObjectInput = {
  ownerId: string;
  objectId: string;
  expectedChecksum?: StorageChecksum;
};

export type StorageObjectReference = {
  ownerId: string;
  objectId: string;
};

export type StorageUploadProgress = {
  uploadedBytes: number;
  totalBytes: number;
};

export interface StorageProvider {
  readonly provider: StorageProviderName;
  ensureFolder(input: EnsureStorageFolderInput): Promise<StorageFolder>;
  upload(input: UploadStorageObjectInput): Promise<StoredObject>;
  download(input: DownloadStorageObjectInput): Promise<DownloadedObject>;
  delete(ownerId: string, objectId: string): Promise<void>;
  exists(input: StorageObjectReference): Promise<boolean>;
  getMetadata(input: StorageObjectReference): Promise<StoredObject>;
}

export type ProviderNeutralStorage = StorageProvider;

export type StorageProviderErrorCode =
  | "STORAGE_AUTH_REQUIRED"
  | "STORAGE_CHECKSUM_MISMATCH"
  | "STORAGE_CONFIGURATION_INVALID"
  | "STORAGE_FILE_TOO_LARGE"
  | "STORAGE_INPUT_INVALID"
  | "STORAGE_OPERATION_CANCELLED"
  | "STORAGE_OAUTH_STATE_INVALID"
  | "STORAGE_OWNER_MISMATCH"
  | "STORAGE_PROVIDER_FAILURE"
  | "STORAGE_SCOPE_DENIED";

export class StorageProviderError extends Error {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    readonly code: StorageProviderErrorCode,
    message: string,
    options: {
      cause?: unknown;
      retryable?: boolean;
      status?: number;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "StorageProviderError";
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}
