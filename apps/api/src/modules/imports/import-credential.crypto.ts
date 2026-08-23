import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { CredentialExportRow } from "./import.types";

const VERSION = "v1";

function key(secret: string): Buffer {
  if (!secret) throw new Error("PASSWORD_PEPPER is required for credential escrow.");
  return createHash("sha256")
    .update("avs-import-credential-escrow-v1\0")
    .update(secret)
    .digest();
}

function aad(importJobId: string, rowNumber: number): Buffer {
  return Buffer.from(`${importJobId}:${rowNumber}`, "utf8");
}

export function encryptImportCredential(
  secret: string,
  importJobId: string,
  credential: CredentialExportRow,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(aad(importJobId, credential.rowNumber));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credential), "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptImportCredential(
  secret: string,
  importJobId: string,
  rowNumber: number,
  envelope: string,
): CredentialExportRow {
  const [version, ivValue, tagValue, ciphertextValue, ...extra] =
    envelope.split(".");
  if (
    version !== VERSION ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    extra.length
  ) {
    throw new Error("Stored credential escrow has an invalid envelope.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(secret),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAAD(aad(importJobId, rowNumber));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const parsed = JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  ) as Partial<CredentialExportRow>;
  if (
    parsed.rowNumber !== rowNumber ||
    typeof parsed.userId !== "string" ||
    typeof parsed.fullName !== "string" ||
    typeof parsed.role !== "string" ||
    typeof parsed.loginId !== "string" ||
    typeof parsed.temporaryPassword !== "string" ||
    parsed.firstLoginRequired !== true
  ) {
    throw new Error("Stored credential escrow failed validation.");
  }
  return parsed as CredentialExportRow;
}
