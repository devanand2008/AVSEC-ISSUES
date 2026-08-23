import { createHash } from "node:crypto";
import type { GoogleDriveApiClient } from "../src/modules/google-drive/google-drive-api.client";
import { GoogleDriveTokenCipher } from "../src/modules/google-drive/google-drive.crypto";
import { GoogleDriveOAuthService } from "../src/modules/google-drive/google-drive-oauth.service";
import { StorageProviderError } from "../src/modules/google-drive/storage-provider";
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_DRIVE_PROVIDER,
  type EncryptedGoogleDriveTokens,
  type GoogleDriveConfig,
  type GoogleDriveConnectionRecord,
  type GoogleDriveConnectionStore,
  type GoogleDriveOAuthStateRecord,
  type GoogleDriveOAuthStateStore,
  type GoogleDriveTokenSet,
  type SaveGoogleDriveConnection,
} from "../src/modules/google-drive/google-drive.types";

const NOW = new Date("2026-07-30T00:00:00.000Z");
const OWNER = "owner-1";
const OTHER_OWNER = "owner-2";

const config: GoogleDriveConfig = {
  enabled: true,
  clientId: "google-client-id",
  clientSecret: "google-client-secret",
  redirectUri:
    "https://api.college.example/api/v1/admin/storage/google-drive/callback",
  tokenEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
  ownerEmail: "owner@example.edu",
  maxAttempts: 2,
};

class MemoryStateStore implements GoogleDriveOAuthStateStore {
  readonly records = new Map<string, GoogleDriveOAuthStateRecord>();

  async save(record: GoogleDriveOAuthStateRecord): Promise<void> {
    this.records.set(record.stateHash, record);
  }

  async consumeOwned(
    stateHash: string,
    ownerId: string,
    now: Date,
  ): Promise<GoogleDriveOAuthStateRecord | null> {
    const record = this.records.get(stateHash);
    if (
      !record ||
      record.ownerId !== ownerId ||
      record.expiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }
    this.records.delete(stateHash);
    return record;
  }
}

class MemoryConnectionStore implements GoogleDriveConnectionStore {
  record: GoogleDriveConnectionRecord | null = null;
  readonly savedInputs: SaveGoogleDriveConnection[] = [];
  readonly failures: string[] = [];
  readonly updateTokensOwned = jest.fn(
    async (
      connectionId: string,
      ownerId: string,
      encryptedTokens: EncryptedGoogleDriveTokens,
    ) => {
      if (
        !this.record ||
        this.record.id !== connectionId ||
        this.record.ownerId !== ownerId
      ) {
        return false;
      }
      this.record = { ...this.record, encryptedTokens };
      return true;
    },
  );
  readonly markRevokedOwned = jest.fn(
    async (connectionId: string, ownerId: string, revokedAt: Date) => {
      if (
        !this.record ||
        this.record.id !== connectionId ||
        this.record.ownerId !== ownerId
      ) {
        return false;
      }
      this.record = { ...this.record, revokedAt };
      return true;
    },
  );

  async findActiveByOwner(
    ownerId: string,
  ): Promise<GoogleDriveConnectionRecord | null> {
    return this.record?.ownerId === ownerId && !this.record.revokedAt
      ? this.record
      : null;
  }

  async saveActive(
    ownerId: string,
    connection: SaveGoogleDriveConnection,
    now: Date,
  ): Promise<GoogleDriveConnectionRecord> {
    this.savedInputs.push(connection);
    this.record = {
      id: "connection-1",
      ownerId,
      provider: GOOGLE_DRIVE_PROVIDER,
      ...connection,
      connectedAt: now,
      revokedAt: null,
      lastErrorCode: null,
    };
    return this.record;
  }

  async recordFailureOwned(
    connectionId: string,
    ownerId: string,
    errorCode: string,
  ): Promise<void> {
    if (this.record?.id === connectionId && this.record.ownerId === ownerId) {
      this.failures.push(errorCode);
    }
  }
}

function tokens(overrides: Partial<GoogleDriveTokenSet> = {}): GoogleDriveTokenSet {
  return {
    accessToken: "plain-access-token",
    refreshToken: "plain-refresh-token",
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    scopes: [GOOGLE_DRIVE_FILE_SCOPE],
    tokenType: "Bearer",
    ...overrides,
  };
}

function setup() {
  const states = new MemoryStateStore();
  const connections = new MemoryConnectionStore();
  const cipher = new GoogleDriveTokenCipher(config);
  const api = {
    exchangeAuthorizationCode: jest.fn().mockResolvedValue(tokens()),
    profile: jest.fn().mockResolvedValue({
      id: "google-permission-id",
      email: "owner@example.edu",
    }),
    refreshAccessToken: jest.fn().mockResolvedValue(tokens()),
    revokeToken: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<GoogleDriveApiClient>;
  const service = new GoogleDriveOAuthService(
    config,
    states,
    connections,
    cipher,
    api,
    () => new Date(NOW),
  );
  return { api, cipher, connections, service, states };
}

describe("GoogleDriveOAuthService", () => {
  it("creates a least-privilege, owner-bound OAuth URL with PKCE", async () => {
    const { cipher, service, states } = setup();

    const result = await service.authorizationUrl(
      OWNER,
      "Owner@Example.edu",
    );
    const url = new URL(result.authorizationUrl);
    const state = url.searchParams.get("state");

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("scope")).toBe(GOOGLE_DRIVE_FILE_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("login_hint")).toBe("owner@example.edu");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const stored = [...states.records.values()][0];
    expect(stored).toBeDefined();
    expect(stored?.ownerId).toBe(OWNER);
    expect(stored?.stateHash).not.toBe(state);
    expect(stored?.stateHash).toBe(
      createHash("sha256").update(state ?? "").digest("hex"),
    );
    const verifier = cipher.openSecret(
      OWNER,
      "oauth-code-verifier",
      stored?.encryptedCodeVerifier ?? "",
    );
    expect(
      createHash("sha256").update(verifier, "ascii").digest("base64url"),
    ).toBe(url.searchParams.get("code_challenge"));
    expect(result.expiresAt).toBe("2026-07-30T00:10:00.000Z");
  });

  it("rejects the wrong owner without consuming the legitimate state", async () => {
    const { api, service } = setup();
    const authorization = await service.authorizationUrl(
      OWNER,
      "owner@example.edu",
    );
    const state = new URL(authorization.authorizationUrl).searchParams.get(
      "state",
    )!;

    await expect(
      service.completeAuthorization(OTHER_OWNER, {
        code: "authorization-code",
        state,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_OAUTH_STATE_INVALID" });
    expect(api.exchangeAuthorizationCode).not.toHaveBeenCalled();

    await expect(
      service.completeAuthorization(OWNER, {
        code: "authorization-code",
        state,
      }),
    ).resolves.toMatchObject({
      provider: GOOGLE_DRIVE_PROVIDER,
      connected: true,
      accountEmail: "owner@example.edu",
    });
    expect(api.exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
  });

  it("stores only encrypted tokens and rejects replayed OAuth state", async () => {
    const { cipher, connections, service } = setup();
    const authorization = await service.authorizationUrl(OWNER);
    const state = new URL(authorization.authorizationUrl).searchParams.get(
      "state",
    )!;

    await service.completeAuthorization(OWNER, {
      code: "authorization-code",
      state,
    });

    const persisted = JSON.stringify(connections.savedInputs);
    expect(persisted).not.toContain("plain-access-token");
    expect(persisted).not.toContain("plain-refresh-token");
    expect(connections.record?.encryptedTokens.ciphertext).toMatch(/^v1\./u);
    expect(
      cipher.openTokens(OWNER, connections.record!.encryptedTokens),
    ).toMatchObject({
      accessToken: "plain-access-token",
      refreshToken: "plain-refresh-token",
    });
    await expect(
      service.completeAuthorization(OWNER, {
        code: "authorization-code",
        state,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_OAUTH_STATE_INVALID" });
  });

  it("revokes and rejects OAuth tokens issued for the wrong Drive owner", async () => {
    const { api, connections, service } = setup();
    api.profile.mockResolvedValue({
      id: "attacker-permission-id",
      email: "attacker@example.edu",
    });
    const authorization = await service.authorizationUrl(OWNER);
    const state = new URL(authorization.authorizationUrl).searchParams.get(
      "state",
    )!;

    await expect(
      service.completeAuthorization(OWNER, {
        code: "authorization-code",
        state,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_OWNER_MISMATCH" });
    expect(api.revokeToken).toHaveBeenCalledWith("plain-refresh-token");
    expect(connections.savedInputs).toHaveLength(0);
  });

  it("can be constructed safely while the optional integration is disabled", async () => {
    const disabledConfig: GoogleDriveConfig = {
      enabled: false,
      clientId: "",
      clientSecret: "",
      redirectUri: "",
      tokenEncryptionKey: "",
    };
    const cipher = new GoogleDriveTokenCipher(disabledConfig);
    const service = new GoogleDriveOAuthService(
      disabledConfig,
      new MemoryStateStore(),
      new MemoryConnectionStore(),
      cipher,
      {} as GoogleDriveApiClient,
      () => new Date(NOW),
    );

    await expect(service.status(OWNER)).resolves.toEqual({
      provider: GOOGLE_DRIVE_PROVIDER,
      connected: false,
    });
    await expect(service.authorizationUrl(OWNER)).rejects.toMatchObject({
      code: "STORAGE_CONFIGURATION_INVALID",
    });
  });

  it("binds encrypted tokens to their owner and detects tampering", () => {
    const { cipher } = setup();
    const encrypted = cipher.sealTokens(OWNER, tokens());
    const payloadStart = encrypted.ciphertext.lastIndexOf(".") + 1;
    const payloadCharacter = encrypted.ciphertext[payloadStart];
    const tamperedPayloadCharacter = payloadCharacter === "x" ? "y" : "x";
    const tamperedCiphertext = `${encrypted.ciphertext.slice(0, payloadStart)}${tamperedPayloadCharacter}${encrypted.ciphertext.slice(payloadStart + 1)}`;

    expect(() => cipher.openTokens(OTHER_OWNER, encrypted)).toThrow(
      StorageProviderError,
    );
    expect(() =>
      cipher.openTokens(OWNER, {
        ...encrypted,
        ciphertext: tamperedCiphertext,
      }),
    ).toThrow(StorageProviderError);
  });

  it("refreshes an expired token without exposing plaintext to persistence", async () => {
    const { api, cipher, connections, service } = setup();
    connections.record = {
      id: "connection-1",
      ownerId: OWNER,
      provider: GOOGLE_DRIVE_PROVIDER,
      encryptedTokens: cipher.sealTokens(
        OWNER,
        tokens({ expiresAt: new Date(NOW.getTime() - 1_000) }),
      ),
      providerAccountId: "google-permission-id",
      providerAccountEmail: "owner@example.edu",
      connectedAt: NOW,
      revokedAt: null,
      lastErrorCode: null,
    };
    api.refreshAccessToken.mockResolvedValue(
      tokens({
        accessToken: "new-access-token",
        refreshToken: null,
      }),
    );

    await expect(service.authorizedConnection(OWNER)).resolves.toMatchObject({
      accessToken: "new-access-token",
    });
    expect(api.refreshAccessToken).toHaveBeenCalledWith("plain-refresh-token");
    expect(connections.updateTokensOwned).toHaveBeenCalledTimes(1);
    const updated = connections.updateTokensOwned.mock.calls[0]?.[2];
    expect(JSON.stringify(updated)).not.toContain("new-access-token");
    expect(cipher.openTokens(OWNER, updated!)).toMatchObject({
      accessToken: "new-access-token",
      refreshToken: "plain-refresh-token",
    });
  });

  it("marks a connection revoked only after Google accepts revocation", async () => {
    const { api, cipher, connections, service } = setup();
    connections.record = {
      id: "connection-1",
      ownerId: OWNER,
      provider: GOOGLE_DRIVE_PROVIDER,
      encryptedTokens: cipher.sealTokens(OWNER, tokens()),
      providerAccountId: "google-permission-id",
      providerAccountEmail: null,
      connectedAt: NOW,
      revokedAt: null,
      lastErrorCode: null,
    };

    await expect(service.revoke(OWNER)).resolves.toEqual({
      provider: GOOGLE_DRIVE_PROVIDER,
      connected: false,
      revoked: true,
    });
    expect(api.revokeToken).toHaveBeenCalledWith("plain-refresh-token");
    expect(connections.markRevokedOwned).toHaveBeenCalledTimes(1);
  });

  it("retains encrypted credentials and records a safe code on revoke failure", async () => {
    const { api, cipher, connections, service } = setup();
    const encryptedTokens = cipher.sealTokens(OWNER, tokens());
    connections.record = {
      id: "connection-1",
      ownerId: OWNER,
      provider: GOOGLE_DRIVE_PROVIDER,
      encryptedTokens,
      providerAccountId: "google-permission-id",
      providerAccountEmail: null,
      connectedAt: NOW,
      revokedAt: null,
      lastErrorCode: null,
    };
    api.revokeToken.mockRejectedValue(
      new StorageProviderError(
        "STORAGE_PROVIDER_FAILURE",
        "Google Drive token revocation failed.",
      ),
    );

    await expect(service.revoke(OWNER)).rejects.toMatchObject({
      code: "STORAGE_PROVIDER_FAILURE",
    });
    expect(connections.markRevokedOwned).not.toHaveBeenCalled();
    expect(connections.record?.encryptedTokens).toEqual(encryptedTokens);
    expect(connections.failures).toEqual(["STORAGE_PROVIDER_FAILURE"]);
  });
});
