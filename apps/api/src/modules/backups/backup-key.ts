import { createHash } from "node:crypto";

const KEY_BYTES = 32;

export function decodeBackupKey(encoded: string): Buffer {
  if (!encoded || encoded.trim() !== encoded) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }

  const key = Buffer.from(encoded, "base64");
  const normalized = key.toString("base64").replace(/=+$/u, "");
  const supplied = encoded.replace(/=+$/u, "");
  if (key.length !== KEY_BYTES || normalized !== supplied) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function backupKeyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
