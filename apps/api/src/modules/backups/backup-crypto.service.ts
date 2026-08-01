import { Injectable } from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import {
  appendFile,
  chmod,
  open,
  stat,
  unlink,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { backupKeyId } from "./backup-key";
import type { DecryptionResult, EncryptionResult } from "./backup.types";

const MAGIC = Buffer.from("AVSBKP01", "ascii");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;
const HKDF_INFO = Buffer.from("avs-college-database-backup-v1", "utf8");

function hashingTransform(hash: ReturnType<typeof createHash>): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
}

function dataKey(masterKey: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey, salt, HKDF_INFO, 32));
}

async function removePartial(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}

@Injectable()
export class BackupCryptoService {
  async encryptFile(sourcePath: string, targetPath: string, masterKey: Buffer): Promise<EncryptionResult> {
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const header = Buffer.concat([MAGIC, salt, iv]);
    const cipher = createCipheriv("aes-256-gcm", dataKey(masterKey, salt), iv);
    cipher.setAAD(header);

    const plaintextHash = createHash("sha256");
    const artifactHash = createHash("sha256");
    artifactHash.update(header);

    try {
      const handle = await open(targetPath, "wx", 0o600);
      try {
        await handle.writeFile(header);
      } finally {
        await handle.close();
      }

      await pipeline(
        createReadStream(sourcePath),
        hashingTransform(plaintextHash),
        cipher,
        hashingTransform(artifactHash),
        createWriteStream(targetPath, { flags: "a", mode: 0o600 }),
      );

      const authTag = cipher.getAuthTag();
      await appendFile(targetPath, authTag);
      artifactHash.update(authTag);
      await chmod(targetPath, 0o600);

      const [source, artifact] = await Promise.all([stat(sourcePath), stat(targetPath)]);
      return {
        artifactBytes: artifact.size,
        artifactSha256: artifactHash.digest("hex"),
        plaintextBytes: source.size,
        plaintextSha256: plaintextHash.digest("hex"),
        keyId: backupKeyId(masterKey),
        nonceBase64: iv.toString("base64"),
      };
    } catch (error) {
      await removePartial(targetPath);
      throw error;
    }
  }

  async decryptFile(
    sourcePath: string,
    targetPath: string,
    masterKey: Buffer,
    expectedArtifactSha256?: string,
  ): Promise<DecryptionResult> {
    const source = await stat(sourcePath);
    if (source.size <= HEADER_BYTES + TAG_BYTES) {
      throw new Error("Backup artifact is truncated.");
    }

    if (expectedArtifactSha256) {
      const actual = await this.sha256File(sourcePath);
      if (actual !== expectedArtifactSha256) {
        throw new Error("Backup artifact checksum does not match its manifest.");
      }
    }

    const handle = await open(sourcePath, "r");
    let header: Buffer;
    let authTag: Buffer;
    try {
      header = Buffer.alloc(HEADER_BYTES);
      authTag = Buffer.alloc(TAG_BYTES);
      await handle.read({ buffer: header, position: 0 });
      await handle.read({ buffer: authTag, position: source.size - TAG_BYTES });
    } finally {
      await handle.close();
    }

    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("Backup artifact has an unsupported format.");
    }

    const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
    const iv = header.subarray(MAGIC.length + SALT_BYTES, HEADER_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", dataKey(masterKey, salt), iv);
    decipher.setAAD(header);
    decipher.setAuthTag(authTag);
    const plaintextHash = createHash("sha256");

    try {
      await pipeline(
        createReadStream(sourcePath, {
          start: HEADER_BYTES,
          end: source.size - TAG_BYTES - 1,
        }),
        decipher,
        hashingTransform(plaintextHash),
        createWriteStream(targetPath, { flags: "wx", mode: 0o600 }),
      );
      await chmod(targetPath, 0o600);
      const plaintext = await stat(targetPath);
      return {
        plaintextBytes: plaintext.size,
        plaintextSha256: plaintextHash.digest("hex"),
      };
    } catch {
      await removePartial(targetPath);
      throw new Error("Backup artifact authentication failed.");
    }
  }

  async sha256File(path: string): Promise<string> {
    const hash = createHash("sha256");
    await pipeline(createReadStream(path), hashingTransform(hash), new Transform({
      transform(_chunk: Buffer, _encoding, callback) {
        callback();
      },
    }));
    return hash.digest("hex");
  }

  async assertAuthenticatedArtifact(path: string, masterKey: Buffer): Promise<void> {
    const probePath = `${path}.${randomBytes(8).toString("hex")}.probe`;
    try {
      await this.decryptFile(path, probePath, masterKey);
    } finally {
      await removePartial(probePath);
    }
  }
}
