import type {
  FactoryProvider,
  ModuleMetadata,
  Provider,
} from "@nestjs/common";

export const GOOGLE_DRIVE_CONFIG = Symbol("GOOGLE_DRIVE_CONFIG");
export const GOOGLE_DRIVE_CONNECTION_STORE = Symbol(
  "GOOGLE_DRIVE_CONNECTION_STORE",
);
export const GOOGLE_DRIVE_FETCH = Symbol("GOOGLE_DRIVE_FETCH");
export const GOOGLE_DRIVE_FOLDER_CACHE = Symbol("GOOGLE_DRIVE_FOLDER_CACHE");
export const GOOGLE_DRIVE_OAUTH_STATE_STORE = Symbol(
  "GOOGLE_DRIVE_OAUTH_STATE_STORE",
);
export const GOOGLE_DRIVE_CLOCK = Symbol("GOOGLE_DRIVE_CLOCK");
export const GOOGLE_DRIVE_SLEEP = Symbol("GOOGLE_DRIVE_SLEEP");

export const GOOGLE_DRIVE_PROVIDER = "google-drive" as const;
export const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";

export type GoogleDriveConfig = {
  enabled?: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEncryptionKey: string;
  ownerEmail?: string;
  rootFolderId?: string;
  rootFolderName?: string;
  scopes?: readonly string[];
  oauthStateTtlMs?: number;
  requestTimeoutMs?: number;
  maxAttempts?: number;
  maxDownloadBytes?: number;
  maxUploadBytes?: number;
  uploadChunkSizeBytes?: number;
};

export type GoogleDriveOAuthStateRecord = {
  stateHash: string;
  ownerId: string;
  encryptedCodeVerifier: string;
  createdAt: Date;
  expiresAt: Date;
};

export interface GoogleDriveOAuthStateStore {
  save(record: GoogleDriveOAuthStateRecord): Promise<void>;

  /**
   * Must atomically consume only a live state owned by ownerId. A call from a
   * different owner must not consume the legitimate owner's state.
   */
  consumeOwned(
    stateHash: string,
    ownerId: string,
    now: Date,
  ): Promise<GoogleDriveOAuthStateRecord | null>;
}

export type EncryptedGoogleDriveTokens = {
  version: 1;
  ciphertext: string;
  expiresAt: Date;
};

export type GoogleDriveConnectionRecord = {
  id: string;
  ownerId: string;
  provider: typeof GOOGLE_DRIVE_PROVIDER;
  encryptedTokens: EncryptedGoogleDriveTokens;
  providerAccountId: string | null;
  providerAccountEmail: string | null;
  connectedAt: Date;
  revokedAt: Date | null;
  lastErrorCode: string | null;
};

export type SaveGoogleDriveConnection = Omit<
  GoogleDriveConnectionRecord,
  | "id"
  | "ownerId"
  | "connectedAt"
  | "revokedAt"
  | "lastErrorCode"
  | "provider"
>;

export interface GoogleDriveConnectionStore {
  findActiveByOwner(ownerId: string): Promise<GoogleDriveConnectionRecord | null>;
  saveActive(
    ownerId: string,
    connection: SaveGoogleDriveConnection,
    now: Date,
  ): Promise<GoogleDriveConnectionRecord>;
  updateTokensOwned(
    connectionId: string,
    ownerId: string,
    encryptedTokens: EncryptedGoogleDriveTokens,
  ): Promise<boolean>;
  markRevokedOwned(
    connectionId: string,
    ownerId: string,
    revokedAt: Date,
  ): Promise<boolean>;
  recordFailureOwned(
    connectionId: string,
    ownerId: string,
    errorCode: string,
  ): Promise<void>;
}

export type GoogleDriveFolderCacheRecord = {
  ownerId: string;
  connectionId: string;
  cacheKey: string;
  folderId: string;
  name: string;
  parentId: string;
};

export interface GoogleDriveFolderCacheStore {
  getOwned(
    ownerId: string,
    connectionId: string,
    cacheKey: string,
  ): Promise<GoogleDriveFolderCacheRecord | null>;
  putOwned(
    record: GoogleDriveFolderCacheRecord,
  ): Promise<GoogleDriveFolderCacheRecord>;
  deleteOwned(
    ownerId: string,
    connectionId: string,
    cacheKey: string,
  ): Promise<void>;
}

export type GoogleDriveTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
  tokenType: string;
};

export type GoogleDrivePublicConnection = {
  provider: typeof GOOGLE_DRIVE_PROVIDER;
  connected: boolean;
  accountEmail?: string;
  connectedAt?: string;
  lastError?: string;
};

export type GoogleDriveModuleAsyncOptions = {
  imports?: ModuleMetadata["imports"];
  inject?: FactoryProvider<GoogleDriveConfig>["inject"];
  useFactory: FactoryProvider<GoogleDriveConfig>["useFactory"];
  persistenceProviders: Provider[];
};

export type GoogleDriveFetch = typeof fetch;
export type GoogleDriveClock = () => Date;
export type GoogleDriveSleep = (milliseconds: number) => Promise<void>;
