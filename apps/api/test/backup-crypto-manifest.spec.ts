import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupCryptoService } from "../src/modules/backups/backup-crypto.service";
import { backupKeyId, decodeBackupKey } from "../src/modules/backups/backup-key";
import { BackupManifestService } from "../src/modules/backups/backup-manifest.service";
import type { BackupManifest } from "../src/modules/backups/backup.types";

describe("encrypted backup artifacts and manifests", () => {
  let directory: string;
  const crypto = new BackupCryptoService();
  const manifests = new BackupManifestService();
  const key = randomBytes(32);

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "avs-backup-test-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("round-trips an AES-256-GCM artifact and detects ciphertext tampering", async () => {
    const source = join(directory, "source.dump");
    const artifact = join(directory, "backup.avsbak");
    const restored = join(directory, "restored.dump");
    const plaintext = Buffer.concat([
      Buffer.from("PGDMP custom-format fixture\0", "utf8"),
      randomBytes(128 * 1024),
    ]);
    await writeFile(source, plaintext);

    const encrypted = await crypto.encryptFile(source, artifact, key);
    const decrypted = await crypto.decryptFile(artifact, restored, key, encrypted.artifactSha256);

    expect(await readFile(restored)).toEqual(plaintext);
    expect(decrypted.plaintextSha256).toBe(encrypted.plaintextSha256);
    expect(encrypted.keyId).toBe(backupKeyId(key));

    const tampered = await readFile(artifact);
    const tamperIndex = Math.floor(tampered.length / 2);
    tampered[tamperIndex] = tampered[tamperIndex]! ^ 0xff;
    await writeFile(artifact, tampered);
    await expect(crypto.decryptFile(artifact, join(directory, "tampered.dump"), key))
      .rejects.toThrow("authentication failed");
  });

  it("authenticates the complete manifest and rejects metadata changes", () => {
    const payload: Omit<BackupManifest, "manifestHmacSha256"> = {
      schemaVersion: 1,
      id: "backup-20260730T120000Z-abcdef123456",
      createdAt: "2026-07-30T12:00:00.000Z",
      artifact: {
        fileName: "backup-20260730T120000Z-abcdef123456.avsbak",
        format: "avs-aes-256-gcm-v1",
        bytes: 500,
        sha256: "a".repeat(64),
      },
      dump: {
        format: "postgresql-custom",
        bytes: 400,
        sha256: "b".repeat(64),
      },
      encryption: { algorithm: "aes-256-gcm", keyId: backupKeyId(key) },
      verification: {
        verifiedAt: "2026-07-30T12:01:00.000Z",
        pgRestoreList: true,
      },
    };
    const signed = manifests.sign(payload, key);
    expect(() => manifests.verify(signed, key)).not.toThrow();

    const changed: BackupManifest = {
      ...signed,
      artifact: { ...signed.artifact, bytes: signed.artifact.bytes + 1 },
    };
    expect(() => manifests.verify(changed, key)).toThrow("Manifest authentication failed");
  });

  it("requires exactly 32 bytes of canonical base64 key material", () => {
    const encoded = key.toString("base64");
    expect(decodeBackupKey(encoded)).toEqual(key);
    expect(() => decodeBackupKey("short")).toThrow("base64-encoded 32-byte key");
    expect(() => decodeBackupKey(` ${encoded}`)).toThrow("base64-encoded 32-byte key");
  });
});
