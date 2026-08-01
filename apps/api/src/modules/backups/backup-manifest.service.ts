import { Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { chmod, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { BACKUP_ID_PATTERN, type BackupInventory, type BackupManifest, type BackupRecord } from "./backup.types";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const KEY_ID_PATTERN = /^[a-f0-9]{16}$/;
const MAX_MANIFEST_BYTES = 64 * 1024;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function unsigned(manifest: BackupManifest): Omit<BackupManifest, "manifestHmacSha256"> {
  const { manifestHmacSha256: _signature, ...payload } = manifest;
  return payload;
}

function hmac(payload: Omit<BackupManifest, "manifestHmacSha256">, key: Buffer): string {
  return createHmac("sha256", key).update(canonicalJson(payload), "utf8").digest("hex");
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseManifest(value: unknown): BackupManifest {
  if (!value || typeof value !== "object") throw new Error("Manifest must be an object.");
  const item = value as Partial<BackupManifest>;
  if (
    item.schemaVersion !== 1
    || typeof item.id !== "string"
    || !BACKUP_ID_PATTERN.test(item.id)
    || typeof item.createdAt !== "string"
    || Number.isNaN(Date.parse(item.createdAt))
    || item.artifact?.fileName !== `${item.id}.avsbak`
    || item.artifact.format !== "avs-aes-256-gcm-v1"
    || !isFiniteNonNegative(item.artifact.bytes)
    || !HASH_PATTERN.test(item.artifact.sha256 ?? "")
    || item.dump?.format !== "postgresql-custom"
    || !isFiniteNonNegative(item.dump.bytes)
    || !HASH_PATTERN.test(item.dump.sha256 ?? "")
    || item.encryption?.algorithm !== "aes-256-gcm"
    || !KEY_ID_PATTERN.test(item.encryption.keyId ?? "")
    || typeof item.verification?.verifiedAt !== "string"
    || Number.isNaN(Date.parse(item.verification.verifiedAt))
    || item.verification.pgRestoreList !== true
    || !HASH_PATTERN.test(item.manifestHmacSha256 ?? "")
  ) {
    throw new Error("Manifest structure is invalid.");
  }
  return item as BackupManifest;
}

@Injectable()
export class BackupManifestService {
  sign(payload: Omit<BackupManifest, "manifestHmacSha256">, key: Buffer): BackupManifest {
    return { ...payload, manifestHmacSha256: hmac(payload, key) };
  }

  verify(manifest: BackupManifest, key: Buffer): void {
    const supplied = Buffer.from(manifest.manifestHmacSha256, "hex");
    const expected = Buffer.from(hmac(unsigned(manifest), key), "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new Error("Manifest authentication failed.");
    }
  }

  async write(path: string, manifest: BackupManifest): Promise<void> {
    const temporary = `${path}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${canonicalJson(manifest)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, path);
      await chmod(path, 0o600);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async load(path: string, key: Buffer): Promise<BackupManifest> {
    const content = await readFile(path);
    if (content.length > MAX_MANIFEST_BYTES) throw new Error("Manifest is too large.");
    const manifest = parseManifest(JSON.parse(content.toString("utf8")) as unknown);
    this.verify(manifest, key);
    return manifest;
  }

  async inventory(directory: string, key: Buffer): Promise<BackupInventory> {
    const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const backups: BackupRecord[] = [];
    const invalid: BackupInventory["invalid"] = [];
    const root = resolve(directory);

    for (const fileName of names.filter((name) => name.endsWith(".manifest.json")).sort()) {
      const manifestPath = join(root, fileName);
      try {
        const manifest = await this.load(manifestPath, key);
        const expectedName = `${manifest.id}.manifest.json`;
        if (basename(manifestPath) !== expectedName) throw new Error("Manifest filename does not match its id.");
        backups.push({
          manifest,
          manifestPath,
          artifactPath: join(root, manifest.artifact.fileName),
        });
      } catch (error) {
        invalid.push({
          fileName,
          reason: error instanceof Error ? error.message : "Manifest could not be read.",
        });
      }
    }

    backups.sort((left, right) => right.manifest.createdAt.localeCompare(left.manifest.createdAt));
    return { backups, invalid };
  }
}
