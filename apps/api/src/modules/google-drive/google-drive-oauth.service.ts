import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { GoogleDriveApiClient } from "./google-drive-api.client";
import { GoogleDriveTokenCipher } from "./google-drive.crypto";
import { StorageProviderError } from "./storage-provider";
import {
  GOOGLE_DRIVE_CLOCK,
  GOOGLE_DRIVE_CONFIG,
  GOOGLE_DRIVE_CONNECTION_STORE,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_DRIVE_OAUTH_STATE_STORE,
  GOOGLE_DRIVE_PROVIDER,
  type GoogleDriveClock,
  type GoogleDriveConfig,
  type GoogleDriveConnectionRecord,
  type GoogleDriveConnectionStore,
  type GoogleDriveOAuthStateStore,
  type GoogleDrivePublicConnection,
} from "./google-drive.types";

@Injectable()
export class GoogleDriveOAuthService {
  private readonly scopes: string[];
  private readonly stateTtlMs: number;

  constructor(
    @Inject(GOOGLE_DRIVE_CONFIG) private readonly config: GoogleDriveConfig,
    @Inject(GOOGLE_DRIVE_OAUTH_STATE_STORE)
    private readonly states: GoogleDriveOAuthStateStore,
    @Inject(GOOGLE_DRIVE_CONNECTION_STORE)
    private readonly connections: GoogleDriveConnectionStore,
    private readonly cipher: GoogleDriveTokenCipher,
    private readonly api: GoogleDriveApiClient,
    @Inject(GOOGLE_DRIVE_CLOCK) private readonly clock: GoogleDriveClock,
  ) {
    this.scopes = [
      ...new Set(
        config.scopes ?? [GOOGLE_DRIVE_FILE_SCOPE],
      ),
    ];
    this.stateTtlMs = config.oauthStateTtlMs ?? 10 * 60 * 1000;
    if (
      !Number.isSafeInteger(this.stateTtlMs) ||
      this.stateTtlMs < 60_000 ||
      this.stateTtlMs > 30 * 60 * 1000
    ) {
      throw new StorageProviderError(
        "STORAGE_CONFIGURATION_INVALID",
        "The Google Drive OAuth state lifetime is invalid.",
      );
    }
  }

  async authorizationUrl(
    ownerId: string,
    loginHint?: string | null,
  ): Promise<{ authorizationUrl: string; expiresAt: string }> {
    this.assertAvailable();
    this.assertOwner(ownerId);
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(64).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier, "ascii")
      .digest("base64url");
    const createdAt = this.clock();
    const expiresAt = new Date(createdAt.getTime() + this.stateTtlMs);
    await this.states.save({
      stateHash: this.cipher.hashOpaqueValue(state),
      ownerId,
      encryptedCodeVerifier: this.cipher.sealSecret(
        ownerId,
        "oauth-code-verifier",
        codeVerifier,
      ),
      createdAt,
      expiresAt,
    });

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("include_granted_scopes", "true");
    const selectedLoginHint = this.config.ownerEmail ?? loginHint;
    if (selectedLoginHint?.trim()) {
      const normalizedHint = selectedLoginHint.trim().toLowerCase();
      if (
        normalizedHint.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedHint)
      ) {
        throw new StorageProviderError(
          "STORAGE_INPUT_INVALID",
          "The Google Drive login hint is invalid.",
        );
      }
      url.searchParams.set("login_hint", normalizedHint);
    }
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.scopes.join(" "));
    url.searchParams.set("state", state);
    return {
      authorizationUrl: url.toString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async completeAuthorization(
    ownerId: string,
    input: { code: string; state: string },
  ): Promise<GoogleDrivePublicConnection> {
    this.assertAvailable();
    this.assertOwner(ownerId);
    const code = input.code?.trim();
    const state = input.state?.trim();
    if (
      !code ||
      !state ||
      !/^[A-Za-z0-9_-]{32,256}$/u.test(state) ||
      code.length > 4096
    ) {
      throw this.invalidState();
    }
    const now = this.clock();
    const record = await this.states.consumeOwned(
      this.cipher.hashOpaqueValue(state),
      ownerId,
      now,
    );
    if (
      !record ||
      record.ownerId !== ownerId ||
      record.expiresAt.getTime() <= now.getTime()
    ) {
      throw this.invalidState();
    }

    const codeVerifier = this.cipher.openSecret(
      ownerId,
      "oauth-code-verifier",
      record.encryptedCodeVerifier,
    );
    let tokens = await this.api.exchangeAuthorizationCode(code, codeVerifier);
    if (
      tokens.scopes.length > 0 &&
      !tokens.scopes.includes(GOOGLE_DRIVE_FILE_SCOPE)
    ) {
      throw new StorageProviderError(
        "STORAGE_SCOPE_DENIED",
        "Google Drive file access was not granted.",
      );
    }

    const existing = await this.connections.findActiveByOwner(ownerId);
    if (!tokens.refreshToken && existing) {
      const previous = this.cipher.openTokens(
        ownerId,
        existing.encryptedTokens,
      );
      tokens = { ...tokens, refreshToken: previous.refreshToken };
    }
    if (!tokens.refreshToken) {
      throw new StorageProviderError(
        "STORAGE_AUTH_REQUIRED",
        "Google did not grant offline access. Reconnect and approve access.",
      );
    }

    const profile = await this.api.profile(tokens.accessToken);
    const expectedOwner = this.config.ownerEmail?.trim().toLowerCase();
    const actualOwner = profile.email?.trim().toLowerCase();
    if (!expectedOwner || !actualOwner || actualOwner !== expectedOwner) {
      await this.api
        .revokeToken(tokens.refreshToken ?? tokens.accessToken)
        .catch(() => undefined);
      throw new StorageProviderError(
        "STORAGE_OWNER_MISMATCH",
        "The authorized Google Drive account is not the configured storage owner.",
      );
    }
    const connection = await this.connections.saveActive(
      ownerId,
      {
        encryptedTokens: this.cipher.sealTokens(ownerId, tokens),
        providerAccountId: profile.id,
        providerAccountEmail: profile.email,
      },
      now,
    );
    return this.publicConnection(connection);
  }

  async status(ownerId: string): Promise<GoogleDrivePublicConnection> {
    this.assertOwner(ownerId);
    if (!this.enabled()) {
      return { provider: GOOGLE_DRIVE_PROVIDER, connected: false };
    }
    const connection = await this.connections.findActiveByOwner(ownerId);
    return connection
      ? this.publicConnection(connection)
      : { provider: GOOGLE_DRIVE_PROVIDER, connected: false };
  }

  async authorizedConnection(
    ownerId: string,
  ): Promise<{ connection: GoogleDriveConnectionRecord; accessToken: string }> {
    this.assertAvailable();
    this.assertOwner(ownerId);
    const connection = await this.connections.findActiveByOwner(ownerId);
    if (
      !connection ||
      connection.ownerId !== ownerId ||
      connection.revokedAt
    ) {
      throw new StorageProviderError(
        "STORAGE_AUTH_REQUIRED",
        "Google Drive is not connected for this account.",
      );
    }

    let tokens = this.cipher.openTokens(ownerId, connection.encryptedTokens);
    if (tokens.expiresAt.getTime() <= this.clock().getTime() + 60_000) {
      if (!tokens.refreshToken) {
        throw new StorageProviderError(
          "STORAGE_AUTH_REQUIRED",
          "Google Drive authorization must be renewed.",
        );
      }
      try {
        const refreshed = await this.api.refreshAccessToken(tokens.refreshToken);
        tokens = {
          ...refreshed,
          refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
          scopes: refreshed.scopes.length ? refreshed.scopes : tokens.scopes,
        };
        const updated = await this.connections.updateTokensOwned(
          connection.id,
          ownerId,
          this.cipher.sealTokens(ownerId, tokens),
        );
        if (!updated) throw this.ownerMismatch();
      } catch (error) {
        await this.connections.recordFailureOwned(
          connection.id,
          ownerId,
          error instanceof StorageProviderError
            ? error.code
            : "STORAGE_AUTH_REQUIRED",
        );
        throw error;
      }
    }
    return { connection, accessToken: tokens.accessToken };
  }

  async revoke(
    ownerId: string,
  ): Promise<{ provider: typeof GOOGLE_DRIVE_PROVIDER; connected: false; revoked: true }> {
    this.assertAvailable();
    this.assertOwner(ownerId);
    const connection = await this.connections.findActiveByOwner(ownerId);
    if (!connection || connection.ownerId !== ownerId) {
      throw new StorageProviderError(
        "STORAGE_AUTH_REQUIRED",
        "Google Drive is not connected for this account.",
      );
    }
    const tokens = this.cipher.openTokens(ownerId, connection.encryptedTokens);
    try {
      await this.api.revokeToken(tokens.refreshToken ?? tokens.accessToken);
      const revoked = await this.connections.markRevokedOwned(
        connection.id,
        ownerId,
        this.clock(),
      );
      if (!revoked) throw this.ownerMismatch();
      return {
        provider: GOOGLE_DRIVE_PROVIDER,
        connected: false,
        revoked: true,
      };
    } catch (error) {
      await this.connections.recordFailureOwned(
        connection.id,
        ownerId,
        error instanceof StorageProviderError
          ? error.code
          : "STORAGE_PROVIDER_FAILURE",
      );
      throw error;
    }
  }

  private publicConnection(
    connection: GoogleDriveConnectionRecord,
  ): GoogleDrivePublicConnection {
    return {
      provider: GOOGLE_DRIVE_PROVIDER,
      connected: true,
      ...(connection.providerAccountEmail
        ? { accountEmail: connection.providerAccountEmail }
        : {}),
      connectedAt: connection.connectedAt.toISOString(),
      ...(connection.lastErrorCode
        ? { lastError: connection.lastErrorCode }
        : {}),
    };
  }

  private assertOwner(ownerId: string): void {
    if (!ownerId?.trim()) throw this.ownerMismatch();
  }

  private enabled(): boolean {
    return (
      this.config.enabled ??
      Boolean(
        this.config.clientId &&
          this.config.clientSecret &&
          this.config.redirectUri &&
          this.config.tokenEncryptionKey,
      )
    );
  }

  private assertAvailable(): void {
    if (
      !this.enabled() ||
      !this.config.clientId ||
      !this.config.clientSecret ||
      !this.config.redirectUri ||
      !this.config.tokenEncryptionKey ||
      !this.config.ownerEmail?.trim()
    ) {
      throw new StorageProviderError(
        "STORAGE_CONFIGURATION_INVALID",
        "Google Drive storage is not enabled or fully configured.",
      );
    }
  }

  private invalidState(): StorageProviderError {
    return new StorageProviderError(
      "STORAGE_OAUTH_STATE_INVALID",
      "The Google Drive authorization request is invalid or expired.",
    );
  }

  private ownerMismatch(): StorageProviderError {
    return new StorageProviderError(
      "STORAGE_OWNER_MISMATCH",
      "The Google Drive connection does not belong to this account.",
    );
  }
}
