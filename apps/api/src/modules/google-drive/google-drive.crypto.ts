import { Inject, Injectable } from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { StorageProviderError } from "./storage-provider";
import {
  GOOGLE_DRIVE_CONFIG,
  type EncryptedGoogleDriveTokens,
  type GoogleDriveConfig,
  type GoogleDriveTokenSet,
} from "./google-drive.types";

const FORMAT_VERSION = "v1";

@Injectable()
export class GoogleDriveTokenCipher {
  private parsedKey?: Buffer;

  constructor(
    @Inject(GOOGLE_DRIVE_CONFIG) private readonly config: GoogleDriveConfig,
  ) {}

  sealTokens(
    ownerId: string,
    tokens: GoogleDriveTokenSet,
  ): EncryptedGoogleDriveTokens {
    const payload = JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt.toISOString(),
      scopes: tokens.scopes,
      tokenType: tokens.tokenType,
    });
    return {
      version: 1,
      ciphertext: this.encrypt(ownerId, "tokens", payload),
      expiresAt: new Date(tokens.expiresAt),
    };
  }

  openTokens(
    ownerId: string,
    envelope: EncryptedGoogleDriveTokens,
  ): GoogleDriveTokenSet {
    if (envelope.version !== 1) {
      throw new StorageProviderError(
        "STORAGE_AUTH_REQUIRED",
        "The stored Google Drive authorization format is unsupported.",
      );
    }
    try {
      const parsed = JSON.parse(
        this.decrypt(ownerId, "tokens", envelope.ciphertext),
      ) as Record<string, unknown>;
      if (
        typeof parsed.accessToken !== "string" ||
        !parsed.accessToken ||
        (parsed.refreshToken !== null &&
          typeof parsed.refreshToken !== "string") ||
        typeof parsed.expiresAt !== "string" ||
        !Array.isArray(parsed.scopes) ||
        !parsed.scopes.every((scope) => typeof scope === "string") ||
        typeof parsed.tokenType !== "string"
      ) {
        throw new Error("Invalid token payload");
      }
      const expiresAt = new Date(parsed.expiresAt);
      if (!Number.isFinite(expiresAt.getTime())) {
        throw new Error("Invalid token expiry");
      }
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        expiresAt,
        scopes: parsed.scopes,
        tokenType: parsed.tokenType,
      };
    } catch (error) {
      if (error instanceof StorageProviderError) throw error;
      throw new StorageProviderError(
        "STORAGE_AUTH_REQUIRED",
        "The stored Google Drive authorization could not be decrypted.",
        { cause: error },
      );
    }
  }

  sealSecret(ownerId: string, purpose: string, value: string): string {
    return this.encrypt(ownerId, purpose, value);
  }

  openSecret(ownerId: string, purpose: string, value: string): string {
    try {
      return this.decrypt(ownerId, purpose, value);
    } catch (error) {
      throw new StorageProviderError(
        "STORAGE_OAUTH_STATE_INVALID",
        "The Google Drive authorization request is invalid or expired.",
        { cause: error },
      );
    }
  }

  hashOpaqueValue(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }

  private encrypt(ownerId: string, purpose: string, value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(this.additionalData(ownerId, purpose));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [
      FORMAT_VERSION,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  private decrypt(ownerId: string, purpose: string, value: string): string {
    const [version, ivValue, tagValue, ciphertextValue, extra] =
      value.split(".");
    if (
      version !== FORMAT_VERSION ||
      !ivValue ||
      !tagValue ||
      !ciphertextValue ||
      extra
    ) {
      throw new Error("Malformed encrypted value");
    }
    const iv = Buffer.from(ivValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    if (iv.length !== 12 || tag.length !== 16) {
      throw new Error("Malformed encrypted value");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key(), iv);
    decipher.setAAD(this.additionalData(ownerId, purpose));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  private additionalData(ownerId: string, purpose: string): Buffer {
    if (!ownerId || !purpose) {
      throw new StorageProviderError(
        "STORAGE_INPUT_INVALID",
        "An owner and encryption purpose are required.",
      );
    }
    return Buffer.from(`avs:google-drive:${purpose}:${ownerId}`, "utf8");
  }

  private key(): Buffer {
    if (this.parsedKey) return this.parsedKey;
    const value = this.config.tokenEncryptionKey;
    if (!value) {
      throw new StorageProviderError(
        "STORAGE_CONFIGURATION_INVALID",
        "Google Drive token encryption is not configured.",
      );
    }
    const key = Buffer.from(value, "base64");
    if (key.length !== 32 || key.toString("base64") !== value) {
      throw new StorageProviderError(
        "STORAGE_CONFIGURATION_INVALID",
        "Google Drive token encryption requires a canonical base64 32-byte key.",
      );
    }
    this.parsedKey = key;
    return this.parsedKey;
  }
}
