import { createHash } from "node:crypto";
import {
  GoogleDriveApiClient,
  type GoogleDriveFile,
} from "../src/modules/google-drive/google-drive-api.client";
import type { GoogleDriveOAuthService } from "../src/modules/google-drive/google-drive-oauth.service";
import { GoogleDriveStorageService } from "../src/modules/google-drive/google-drive-storage.service";
import {
  GOOGLE_DRIVE_PROVIDER,
  type GoogleDriveConfig,
  type GoogleDriveConnectionRecord,
  type GoogleDriveFolderCacheRecord,
  type GoogleDriveFolderCacheStore,
} from "../src/modules/google-drive/google-drive.types";

const OWNER = "owner-1";
const NOW = new Date("2026-07-30T00:00:00.000Z");
const config: GoogleDriveConfig = {
  enabled: true,
  clientId: "google-client-id",
  clientSecret: "google-client-secret",
  redirectUri:
    "https://api.college.example/api/v1/admin/storage/google-drive/callback",
  tokenEncryptionKey: Buffer.alloc(32, 8).toString("base64"),
  ownerEmail: "owner@example.edu",
  maxAttempts: 2,
  requestTimeoutMs: 5_000,
};

const connection: GoogleDriveConnectionRecord = {
  id: "connection-1",
  ownerId: OWNER,
  provider: GOOGLE_DRIVE_PROVIDER,
  encryptedTokens: {
    version: 1,
    ciphertext: "not-used-by-storage-tests",
    expiresAt: new Date(NOW.getTime() + 3_600_000),
  },
  providerAccountId: "google-permission-id",
  providerAccountEmail: "owner@example.edu",
  connectedAt: NOW,
  revokedAt: null,
  lastErrorCode: null,
};

class MemoryFolderCache implements GoogleDriveFolderCacheStore {
  readonly records = new Map<string, GoogleDriveFolderCacheRecord>();

  async getOwned(
    ownerId: string,
    connectionId: string,
    cacheKey: string,
  ): Promise<GoogleDriveFolderCacheRecord | null> {
    const record = this.records.get(cacheKey);
    return record?.ownerId === ownerId &&
      record.connectionId === connectionId
      ? record
      : null;
  }

  async putOwned(
    record: GoogleDriveFolderCacheRecord,
  ): Promise<GoogleDriveFolderCacheRecord> {
    const existing = this.records.get(record.cacheKey);
    if (existing) return existing;
    this.records.set(record.cacheKey, record);
    return record;
  }

  async deleteOwned(
    ownerId: string,
    connectionId: string,
    cacheKey: string,
  ): Promise<void> {
    const record = this.records.get(cacheKey);
    if (record?.ownerId === ownerId && record.connectionId === connectionId) {
      this.records.delete(cacheKey);
    }
  }
}

function driveFile(
  overrides: Partial<GoogleDriveFile> = {},
): GoogleDriveFile {
  return {
    id: "drive-file-1",
    name: "report.csv",
    mimeType: "text/csv",
    parents: ["folder-1"],
    sizeBytes: 5,
    md5Checksum: createHash("md5").update("hello").digest("hex"),
    sha256Checksum: createHash("sha256").update("hello").digest("hex"),
    ...overrides,
  };
}

function setupStorage() {
  const oauth = {
    authorizedConnection: jest.fn().mockResolvedValue({
      connection,
      accessToken: "plain-access-token",
    }),
  } as unknown as jest.Mocked<GoogleDriveOAuthService>;
  const api = {
    checksum: jest.fn((content: Buffer, algorithm: "md5" | "sha256") =>
      createHash(algorithm).update(content).digest("hex"),
    ),
    findFolder: jest.fn(),
    createFolder: jest.fn(),
    uploadFile: jest.fn(),
    downloadFile: jest.fn(),
    fileExists: jest.fn(),
    getFile: jest.fn(),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<GoogleDriveApiClient>;
  const folders = new MemoryFolderCache();
  const service = new GoogleDriveStorageService(
    oauth,
    api,
    folders,
    config,
  );
  return { api, folders, oauth, service };
}

describe("GoogleDriveStorageService", () => {
  it("finds or creates a folder once and then uses the owner-scoped cache", async () => {
    const { api, service } = setupStorage();
    api.findFolder.mockResolvedValue(null);
    api.createFolder.mockResolvedValue(
      driveFile({
        id: "folder-1",
        name: "AVS Backups",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"],
        sizeBytes: 0,
        md5Checksum: null,
        sha256Checksum: null,
      }),
    );

    const first = await service.ensureFolder({
      ownerId: OWNER,
      name: "AVS Backups",
    });
    const second = await service.ensureFolder({
      ownerId: OWNER,
      name: "AVS Backups",
    });

    expect(first).toEqual({
      provider: GOOGLE_DRIVE_PROVIDER,
      id: "folder-1",
      name: "AVS Backups",
      parentId: "root",
    });
    expect(second).toEqual(first);
    expect(api.findFolder).toHaveBeenCalledTimes(1);
    expect(api.createFolder).toHaveBeenCalledTimes(1);
  });

  it("uploads through the authorized owner boundary and verifies checksums", async () => {
    const { api, oauth, service } = setupStorage();
    api.uploadFile.mockResolvedValue(driveFile());

    const result = await service.upload({
      ownerId: OWNER,
      folderId: "folder-1",
      name: "report.csv",
      mimeType: "text/csv",
      content: Buffer.from("hello"),
    });

    expect(oauth.authorizedConnection).toHaveBeenCalledWith(OWNER);
    expect(api.uploadFile).toHaveBeenCalledWith("plain-access-token", {
      parentId: "folder-1",
      name: "report.csv",
      mimeType: "text/csv",
      content: Buffer.from("hello"),
    });
    expect(result.checksums).toEqual([
      {
        algorithm: "md5",
        value: createHash("md5").update("hello").digest("hex"),
      },
      {
        algorithm: "sha256",
        value: createHash("sha256").update("hello").digest("hex"),
      },
    ]);
  });

  it("removes a corrupt upload when the provider checksum does not match", async () => {
    const { api, service } = setupStorage();
    api.uploadFile.mockResolvedValue(
      driveFile({ md5Checksum: "00000000000000000000000000000000" }),
    );

    await expect(
      service.upload({
        ownerId: OWNER,
        folderId: "folder-1",
        name: "report.csv",
        mimeType: "text/csv",
        content: Buffer.from("hello"),
      }),
    ).rejects.toMatchObject({ code: "STORAGE_CHECKSUM_MISMATCH" });
    expect(api.deleteFile).toHaveBeenCalledWith(
      "plain-access-token",
      "drive-file-1",
    );
  });

  it("downloads bytes and verifies both provider and caller checksums", async () => {
    const { api, service } = setupStorage();
    api.downloadFile.mockResolvedValue({
      file: driveFile(),
      content: Buffer.from("hello"),
    });
    const expected = createHash("sha256").update("hello").digest("hex");

    await expect(
      service.download({
        ownerId: OWNER,
        objectId: "drive-file-1",
        expectedChecksum: { algorithm: "sha256", value: expected },
      }),
    ).resolves.toMatchObject({
      id: "drive-file-1",
      content: Buffer.from("hello"),
    });
    await expect(
      service.download({
        ownerId: OWNER,
        objectId: "drive-file-1",
        expectedChecksum: {
          algorithm: "sha256",
          value: "0000000000000000000000000000000000000000000000000000000000000000",
        },
      }),
    ).rejects.toMatchObject({ code: "STORAGE_CHECKSUM_MISMATCH" });
  });

  it("checks existence and reads provider metadata inside the owner boundary", async () => {
    const { api, oauth, service } = setupStorage();
    api.fileExists.mockResolvedValue(true);
    api.getFile.mockResolvedValue(driveFile());

    await expect(
      service.exists({ ownerId: OWNER, objectId: "drive-file-1" }),
    ).resolves.toBe(true);
    await expect(
      service.getMetadata({ ownerId: OWNER, objectId: "drive-file-1" }),
    ).resolves.toMatchObject({
      provider: GOOGLE_DRIVE_PROVIDER,
      id: "drive-file-1",
      sizeBytes: 5,
    });
    expect(oauth.authorizedConnection).toHaveBeenCalledTimes(2);
    expect(api.fileExists).toHaveBeenCalledWith(
      "plain-access-token",
      "drive-file-1",
    );
    expect(api.getFile).toHaveBeenCalledWith(
      "plain-access-token",
      "drive-file-1",
    );
  });

  it("forwards resumable-upload progress without exposing provider tokens", async () => {
    const { api, service } = setupStorage();
    api.uploadFile.mockImplementation(async (_token, input) => {
      input.onProgress?.(0, input.content.length);
      input.onProgress?.(input.content.length, input.content.length);
      return driveFile();
    });
    const onProgress = jest.fn();

    await service.upload({
      ownerId: OWNER,
      folderId: "folder-1",
      name: "report.csv",
      mimeType: "text/csv",
      content: Buffer.from("hello"),
      onProgress,
    });

    expect(onProgress).toHaveBeenNthCalledWith(1, {
      uploadedBytes: 0,
      totalBytes: 5,
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      uploadedBytes: 5,
      totalBytes: 5,
    });
  });
});

describe("GoogleDriveApiClient retry and failure handling", () => {
  it("retries a transient Drive response with bounded backoff", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            files: [
              {
                id: "folder-1",
                name: "AVS Backups",
                mimeType: "application/vnd.google-apps.folder",
                parents: ["root"],
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    const sleep = jest.fn().mockResolvedValue(undefined);
    const api = new GoogleDriveApiClient(
      config,
      fetchMock,
      () => new Date(NOW),
      sleep,
    );

    await expect(
      api.findFolder("access-token", "root", "AVS Backups"),
    ).resolves.toMatchObject({ id: "folder-1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("retries a resumable upload PUT and returns verified metadata", async () => {
    const checksum = createHash("md5").update("hello").digest("hex");
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 200,
          headers: {
            location:
              "https://www.googleapis.com/upload/drive/v3/files?upload_id=safe",
          },
        }),
      )
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "drive-file-1",
            name: "report.csv",
            mimeType: "text/csv",
            parents: ["folder-1"],
            size: "5",
            md5Checksum: checksum,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    const sleep = jest.fn().mockResolvedValue(undefined);
    const api = new GoogleDriveApiClient(
      config,
      fetchMock,
      () => new Date(NOW),
      sleep,
    );

    await expect(
      api.uploadFile("access-token", {
        parentId: "folder-1",
        name: "report.csv",
        mimeType: "text/csv",
        content: Buffer.from("hello"),
      }),
    ).resolves.toMatchObject({
      id: "drive-file-1",
      md5Checksum: checksum,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual(
      expect.any(Headers),
    );
    expect(
      (fetchMock.mock.calls[1]?.[1]?.headers as Headers).get("content-range"),
    ).toBe("bytes 0-4/5");
  });

  it("honors cancellation before creating a resumable upload session", async () => {
    const fetchMock = jest.fn();
    const api = new GoogleDriveApiClient(
      config,
      fetchMock,
      () => new Date(NOW),
      jest.fn().mockResolvedValue(undefined),
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      api.uploadFile("access-token", {
        parentId: "folder-1",
        name: "report.csv",
        mimeType: "text/csv",
        content: Buffer.from("hello"),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_OPERATION_CANCELLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports whether a Drive object still exists without parsing error bodies", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "drive-file-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const api = new GoogleDriveApiClient(
      config,
      fetchMock,
      () => new Date(NOW),
      jest.fn().mockResolvedValue(undefined),
    );

    await expect(api.fileExists("access-token", "missing")).resolves.toBe(false);
    await expect(
      api.fileExists("access-token", "drive-file-1"),
    ).resolves.toBe(true);
  });

  it("does not leak bearer tokens or provider response bodies in failures", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message:
              "provider echoed plain-access-token and internal customer data",
          },
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const api = new GoogleDriveApiClient(
      config,
      fetchMock,
      () => new Date(NOW),
      jest.fn().mockResolvedValue(undefined),
    );

    const failure = await api
      .findFolder("plain-access-token", "root", "AVS Backups")
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "STORAGE_PROVIDER_FAILURE",
      status: 400,
    });
    expect(String(failure)).not.toContain("plain-access-token");
    expect(String(failure)).not.toContain("customer data");
  });
});
