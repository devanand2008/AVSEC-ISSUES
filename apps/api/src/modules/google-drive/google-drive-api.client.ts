import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { StorageProviderError } from "./storage-provider";
import {
  GOOGLE_DRIVE_CLOCK,
  GOOGLE_DRIVE_CONFIG,
  GOOGLE_DRIVE_FETCH,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_DRIVE_SLEEP,
  type GoogleDriveClock,
  type GoogleDriveConfig,
  type GoogleDriveFetch,
  type GoogleDriveSleep,
  type GoogleDriveTokenSet,
} from "./google-drive.types";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const GOOGLE_TOKEN_API = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_API = "https://oauth2.googleapis.com/revoke";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const MIN_RESUMABLE_CHUNK_BYTES = 256 * 1024;

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

export type GoogleDriveProfile = {
  id: string;
  email: string | null;
};

export type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  sizeBytes: number;
  md5Checksum: string | null;
  sha256Checksum: string | null;
};

type DriveFileResponse = {
  id?: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  size?: string;
  md5Checksum?: string;
  sha256Checksum?: string;
};

@Injectable()
export class GoogleDriveApiClient {
  private readonly maxAttempts: number;
  private readonly requestTimeoutMs: number;
  private readonly maxDownloadBytes: number;
  private readonly uploadChunkSizeBytes: number;

  constructor(
    @Inject(GOOGLE_DRIVE_CONFIG) private readonly config: GoogleDriveConfig,
    @Inject(GOOGLE_DRIVE_FETCH) private readonly fetchImpl: GoogleDriveFetch,
    @Inject(GOOGLE_DRIVE_CLOCK) private readonly clock: GoogleDriveClock,
    @Inject(GOOGLE_DRIVE_SLEEP) private readonly sleep: GoogleDriveSleep,
  ) {
    this.maxAttempts = this.integerOption(config.maxAttempts, 3, 1, 5);
    this.requestTimeoutMs = this.integerOption(
      config.requestTimeoutMs,
      15_000,
      1_000,
      60_000,
    );
    this.maxDownloadBytes = this.integerOption(
      config.maxDownloadBytes,
      100 * 1024 * 1024,
      1,
      500 * 1024 * 1024,
    );
    this.uploadChunkSizeBytes = this.integerOption(
      config.uploadChunkSizeBytes,
      8 * 1024 * 1024,
      MIN_RESUMABLE_CHUNK_BYTES,
      256 * 1024 * 1024,
    );
    if (this.uploadChunkSizeBytes % MIN_RESUMABLE_CHUNK_BYTES !== 0) {
      throw new StorageProviderError(
        "STORAGE_CONFIGURATION_INVALID",
        "The Google Drive upload chunk size must be a multiple of 256 KiB.",
      );
    }
  }

  async exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
  ): Promise<GoogleDriveTokenSet> {
    const response = await this.request(
      GOOGLE_TOKEN_API,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
          code_verifier: codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: this.config.redirectUri,
        }),
      },
      "authorization exchange",
      "STORAGE_AUTH_REQUIRED",
    );
    return this.parseTokenResponse(
      await this.json<GoogleTokenResponse>(response, "authorization exchange"),
      null,
    );
  }

  async refreshAccessToken(refreshToken: string): Promise<GoogleDriveTokenSet> {
    const response = await this.request(
      GOOGLE_TOKEN_API,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      },
      "token refresh",
      "STORAGE_AUTH_REQUIRED",
    );
    return this.parseTokenResponse(
      await this.json<GoogleTokenResponse>(response, "token refresh"),
      refreshToken,
    );
  }

  async revokeToken(token: string): Promise<void> {
    await this.request(
      GOOGLE_REVOKE_API,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token }),
      },
      "token revocation",
      "STORAGE_PROVIDER_FAILURE",
      [200],
    );
  }

  async profile(accessToken: string): Promise<GoogleDriveProfile> {
    const url = new URL(`${DRIVE_API}/about`);
    url.searchParams.set("fields", "user(permissionId,emailAddress)");
    const response = await this.authorizedRequest(
      url,
      accessToken,
      { method: "GET" },
      "account lookup",
    );
    const profile = await this.json<Record<string, unknown>>(
      response,
      "account lookup",
    );
    const user =
      profile.user && typeof profile.user === "object"
        ? (profile.user as Record<string, unknown>)
        : null;
    if (!user || typeof user.permissionId !== "string" || !user.permissionId) {
      throw this.providerFailure("account lookup");
    }
    return {
      id: user.permissionId,
      email:
        typeof user.emailAddress === "string" ? user.emailAddress : null,
    };
  }

  async findFolder(
    accessToken: string,
    parentId: string,
    name: string,
  ): Promise<GoogleDriveFile | null> {
    const url = new URL(`${DRIVE_API}/files`);
    url.searchParams.set(
      "q",
      `'${this.escapeQuery(parentId)}' in parents and name = '${this.escapeQuery(name)}' and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`,
    );
    url.searchParams.set("spaces", "drive");
    url.searchParams.set("pageSize", "2");
    url.searchParams.set(
      "fields",
      "files(id,name,mimeType,parents,size,md5Checksum,sha256Checksum)",
    );
    const response = await this.authorizedRequest(
      url,
      accessToken,
      { method: "GET" },
      "folder lookup",
    );
    const body = await this.json<{ files?: DriveFileResponse[] }>(
      response,
      "folder lookup",
    );
    const file = body.files?.[0];
    return file ? this.file(file, "folder lookup") : null;
  }

  async createFolder(
    accessToken: string,
    parentId: string,
    name: string,
  ): Promise<GoogleDriveFile> {
    const url = new URL(`${DRIVE_API}/files`);
    url.searchParams.set(
      "fields",
      "id,name,mimeType,parents,size,md5Checksum,sha256Checksum",
    );
    const response = await this.authorizedRequest(
      url,
      accessToken,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          mimeType: FOLDER_MIME_TYPE,
          parents: [parentId],
        }),
      },
      "folder creation",
    );
    return this.file(
      await this.json<DriveFileResponse>(response, "folder creation"),
      "folder creation",
    );
  }

  async uploadFile(
    accessToken: string,
    input: {
      parentId: string;
      name: string;
      mimeType: string;
      content: Buffer;
      signal?: AbortSignal;
      onProgress?: (uploadedBytes: number, totalBytes: number) => void;
    },
  ): Promise<GoogleDriveFile> {
    this.throwIfAborted(input.signal);
    const url = new URL(`${DRIVE_UPLOAD_API}/files`);
    url.searchParams.set("uploadType", "resumable");
    url.searchParams.set(
      "fields",
      "id,name,mimeType,parents,size,md5Checksum,sha256Checksum",
    );
    const session = await this.authorizedRequest(
      url,
      accessToken,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-upload-content-length": String(input.content.length),
          "x-upload-content-type": input.mimeType,
        },
        body: JSON.stringify({
          name: input.name,
          mimeType: input.mimeType,
          parents: [input.parentId],
        }),
        signal: input.signal,
      },
      "upload initialization",
    );
    const sessionUrl = this.safeUploadSession(session.headers.get("location"));

    let offset = 0;
    input.onProgress?.(offset, input.content.length);
    while (offset < input.content.length || input.content.length === 0) {
      this.throwIfAborted(input.signal);
      const end =
        input.content.length === 0
          ? -1
          : Math.min(
              offset + this.uploadChunkSizeBytes,
              input.content.length,
            ) - 1;
      const chunk = input.content.subarray(offset, end + 1);
      const response = await this.authorizedRequest(
        sessionUrl,
        accessToken,
        {
          method: "PUT",
          headers: {
            "content-length": String(chunk.length),
            "content-type": input.mimeType,
            ...(input.content.length
              ? {
                  "content-range": `bytes ${offset}-${end}/${input.content.length}`,
                }
              : {}),
          },
          body: Uint8Array.from(chunk).buffer,
          signal: input.signal,
        },
        "file upload",
        [200, 201, 308],
      );
      if (response.status !== 308) {
        input.onProgress?.(input.content.length, input.content.length);
        return this.file(
          await this.json<DriveFileResponse>(response, "file upload"),
          "file upload",
        );
      }
      const nextOffset = this.nextUploadOffset(response.headers.get("range"));
      if (nextOffset <= offset || nextOffset >= input.content.length) {
        throw this.providerFailure("file upload");
      }
      offset = nextOffset;
      input.onProgress?.(offset, input.content.length);
    }
    throw this.providerFailure("file upload");
  }

  async downloadFile(
    accessToken: string,
    objectId: string,
  ): Promise<{ file: GoogleDriveFile; content: Buffer }> {
    const file = await this.getFile(accessToken, objectId);
    const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(objectId)}`);
    url.searchParams.set("alt", "media");
    const response = await this.authorizedRequest(
      url,
      accessToken,
      { method: "GET" },
      "file download",
    );
    const advertisedLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(advertisedLength) &&
      advertisedLength > this.maxDownloadBytes
    ) {
      throw new StorageProviderError(
        "STORAGE_FILE_TOO_LARGE",
        "The Google Drive file exceeds the configured download limit.",
      );
    }
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length > this.maxDownloadBytes) {
      throw new StorageProviderError(
        "STORAGE_FILE_TOO_LARGE",
        "The Google Drive file exceeds the configured download limit.",
      );
    }
    return { file, content };
  }

  async deleteFile(accessToken: string, objectId: string): Promise<void> {
    await this.authorizedRequest(
      `${DRIVE_API}/files/${encodeURIComponent(objectId)}`,
      accessToken,
      { method: "DELETE" },
      "file deletion",
      [204, 404],
    );
  }

  checksum(content: Buffer, algorithm: "md5" | "sha256"): string {
    return createHash(algorithm).update(content).digest("hex");
  }

  async getFile(
    accessToken: string,
    objectId: string,
  ): Promise<GoogleDriveFile> {
    const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(objectId)}`);
    url.searchParams.set(
      "fields",
      "id,name,mimeType,parents,size,md5Checksum,sha256Checksum",
    );
    const response = await this.authorizedRequest(
      url,
      accessToken,
      { method: "GET" },
      "file metadata lookup",
    );
    return this.file(
      await this.json<DriveFileResponse>(response, "file metadata lookup"),
      "file metadata lookup",
    );
  }

  async fileExists(accessToken: string, objectId: string): Promise<boolean> {
    const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(objectId)}`);
    url.searchParams.set("fields", "id");
    const response = await this.authorizedRequest(
      url,
      accessToken,
      { method: "GET" },
      "file existence lookup",
      [200, 404],
    );
    if (response.status === 404) {
      await response.body?.cancel();
      return false;
    }
    await response.body?.cancel();
    return true;
  }

  private async authorizedRequest(
    url: string | URL,
    accessToken: string,
    init: RequestInit,
    operation: string,
    acceptedStatuses?: number[],
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("authorization", `Bearer ${accessToken}`);
    return this.request(
      url,
      { ...init, headers },
      operation,
      "STORAGE_PROVIDER_FAILURE",
      acceptedStatuses,
    );
  }

  private async request(
    url: string | URL,
    init: RequestInit,
    operation: string,
    errorCode:
      | "STORAGE_AUTH_REQUIRED"
      | "STORAGE_PROVIDER_FAILURE",
    acceptedStatuses?: number[],
  ): Promise<Response> {
    this.assertConfiguration();
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
        const signal = init.signal
          ? AbortSignal.any([init.signal, timeoutSignal])
          : timeoutSignal;
        const response = await this.fetchImpl(url, {
          ...init,
          redirect: "error",
          signal,
        });
        const accepted = acceptedStatuses
          ? acceptedStatuses.includes(response.status)
          : response.ok;
        if (accepted) return response;
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < this.maxAttempts) {
          const delay = this.retryDelay(response, attempt);
          await response.body?.cancel();
          await this.sleep(delay);
          continue;
        }
        throw new StorageProviderError(
          errorCode,
          `Google Drive ${operation} failed (HTTP ${response.status}).`,
          { retryable, status: response.status },
        );
      } catch (error) {
        if (error instanceof StorageProviderError) throw error;
        if (init.signal?.aborted) {
          throw new StorageProviderError(
            "STORAGE_OPERATION_CANCELLED",
            `Google Drive ${operation} was cancelled.`,
          );
        }
        lastError = error;
        if (attempt < this.maxAttempts) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
      }
    }
    throw new StorageProviderError(
      errorCode,
      `Google Drive ${operation} failed.`,
      { cause: lastError, retryable: true },
    );
  }

  private throwIfAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) return;
    throw new StorageProviderError(
      "STORAGE_OPERATION_CANCELLED",
      "The Google Drive operation was cancelled.",
    );
  }

  private parseTokenResponse(
    response: GoogleTokenResponse,
    retainedRefreshToken: string | null,
  ): GoogleDriveTokenSet {
    if (
      typeof response.access_token !== "string" ||
      !response.access_token ||
      typeof response.expires_in !== "number" ||
      !Number.isFinite(response.expires_in) ||
      response.expires_in <= 0
    ) {
      throw new StorageProviderError(
        "STORAGE_AUTH_REQUIRED",
        "Google returned an invalid authorization response.",
      );
    }
    return {
      accessToken: response.access_token,
      refreshToken:
        typeof response.refresh_token === "string" && response.refresh_token
          ? response.refresh_token
          : retainedRefreshToken,
      expiresAt: new Date(
        this.clock().getTime() + Math.floor(response.expires_in * 1000),
      ),
      scopes:
        typeof response.scope === "string"
          ? response.scope.split(/\s+/u).filter(Boolean)
          : [],
      tokenType:
        typeof response.token_type === "string" && response.token_type
          ? response.token_type
          : "Bearer",
    };
  }

  private file(value: DriveFileResponse, operation: string): GoogleDriveFile {
    if (
      typeof value.id !== "string" ||
      !value.id ||
      typeof value.name !== "string" ||
      typeof value.mimeType !== "string"
    ) {
      throw this.providerFailure(operation);
    }
    const sizeBytes = value.size === undefined ? 0 : Number(value.size);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw this.providerFailure(operation);
    }
    return {
      id: value.id,
      name: value.name,
      mimeType: value.mimeType,
      parents: Array.isArray(value.parents)
        ? value.parents.filter((parent): parent is string => typeof parent === "string")
        : [],
      sizeBytes,
      md5Checksum:
        typeof value.md5Checksum === "string" ? value.md5Checksum : null,
      sha256Checksum:
        typeof value.sha256Checksum === "string"
          ? value.sha256Checksum
          : null,
    };
  }

  private async json<T>(response: Response, operation: string): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new StorageProviderError(
        "STORAGE_PROVIDER_FAILURE",
        `Google Drive ${operation} returned an invalid response.`,
        { cause: error, status: response.status },
      );
    }
  }

  private safeUploadSession(value: string | null): URL {
    if (!value) throw this.providerFailure("upload initialization");
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      throw new StorageProviderError(
        "STORAGE_PROVIDER_FAILURE",
        "Google Drive upload initialization returned an invalid session.",
        { cause: error },
      );
    }
    const allowed =
      url.protocol === "https:" &&
      (url.hostname === "www.googleapis.com" ||
        url.hostname.endsWith(".googleapis.com"));
    if (!allowed) throw this.providerFailure("upload initialization");
    return url;
  }

  private nextUploadOffset(value: string | null): number {
    const match = /^bytes=0-(\d+)$/u.exec(value ?? "");
    return match?.[1] ? Number(match[1]) + 1 : 0;
  }

  private escapeQuery(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  }

  private retryDelay(response: Response, attempt: number): number {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter && /^\d+$/u.test(retryAfter)) {
      return Math.min(Number(retryAfter) * 1000, 10_000);
    }
    return this.backoff(attempt);
  }

  private backoff(attempt: number): number {
    return Math.min(250 * 2 ** (attempt - 1), 2_000);
  }

  private providerFailure(operation: string): StorageProviderError {
    return new StorageProviderError(
      "STORAGE_PROVIDER_FAILURE",
      `Google Drive ${operation} returned an invalid response.`,
    );
  }

  private integerOption(
    value: number | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const selected = value ?? fallback;
    if (
      !Number.isSafeInteger(selected) ||
      selected < minimum ||
      selected > maximum
    ) {
      throw new StorageProviderError(
        "STORAGE_CONFIGURATION_INVALID",
        "A Google Drive numeric configuration value is invalid.",
      );
    }
    return selected;
  }

  private assertConfiguration(): void {
    const enabled =
      this.config.enabled ??
      Boolean(
        this.config.clientId &&
          this.config.clientSecret &&
          this.config.redirectUri,
      );
    if (!enabled) {
      throw new StorageProviderError(
        "STORAGE_CONFIGURATION_INVALID",
        "Google Drive storage is not enabled.",
      );
    }
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new StorageProviderError(
        "STORAGE_CONFIGURATION_INVALID",
        "Google Drive OAuth credentials are not configured.",
      );
    }
    let redirectUri: URL;
    try {
      redirectUri = new URL(this.config.redirectUri);
    } catch (error) {
      throw new StorageProviderError(
        "STORAGE_CONFIGURATION_INVALID",
        "The Google Drive OAuth redirect URI is invalid.",
        { cause: error },
      );
    }
    if (
      redirectUri.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "::1"].includes(redirectUri.hostname)
    ) {
      throw new StorageProviderError(
        "STORAGE_CONFIGURATION_INVALID",
        "The Google Drive OAuth redirect URI must use HTTPS.",
      );
    }
    const scopes = this.config.scopes ?? [GOOGLE_DRIVE_FILE_SCOPE];
    if (
      scopes.length !== 1 ||
      !scopes.includes(GOOGLE_DRIVE_FILE_SCOPE)
    ) {
      throw new StorageProviderError(
        "STORAGE_CONFIGURATION_INVALID",
        "Google Drive must use only the least-privilege drive.file scope.",
      );
    }
  }
}
