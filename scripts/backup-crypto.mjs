import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { open, stat } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("AVSBKP01", "ascii");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;
const INFO = Buffer.from("avs-college-database-backup-v1", "utf8");

const [mode, source, target] = process.argv.slice(2);
if (!["encrypt", "decrypt"].includes(mode) || !source || !target) {
  throw new Error("Usage: node scripts/backup-crypto.mjs encrypt|decrypt SOURCE TARGET");
}
const key = decodeKey(process.env.BACKUP_ENCRYPTION_KEY ?? "");
if (mode === "encrypt") await encrypt(source, target, key);
else await decrypt(source, target, key);

async function encrypt(sourcePath, targetPath, masterKey) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const cipher = createCipheriv("aes-256-gcm", derive(masterKey, salt), iv);
  cipher.setAAD(header);
  const target = await open(targetPath, "wx", 0o600);
  await target.writeFile(header);
  await target.close();
  await pipeline(
    createReadStream(sourcePath),
    cipher,
    createWriteStream(targetPath, { flags: "a", mode: 0o600 }),
  );
  const tag = cipher.getAuthTag();
  const handle = await open(targetPath, "a", 0o600);
  await handle.writeFile(tag);
  await handle.close();
  process.stdout.write(
    JSON.stringify({
      algorithm: "AES-256-GCM",
      keyId: createHash("sha256").update(masterKey).digest("hex").slice(0, 16),
      bytes: (await stat(targetPath)).size,
    }) + "\n",
  );
}

async function decrypt(sourcePath, targetPath, masterKey) {
  const details = await stat(sourcePath);
  if (details.size <= HEADER_BYTES + TAG_BYTES) throw new Error("Encrypted backup is truncated.");
  const source = await open(sourcePath, "r");
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  await source.read({ buffer: header, position: 0 });
  await source.read({ buffer: tag, position: details.size - TAG_BYTES });
  await source.close();
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Encrypted backup format is invalid.");
  }
  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
  const iv = header.subarray(MAGIC.length + SALT_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", derive(masterKey, salt), iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  await pipeline(
    createReadStream(sourcePath, {
      start: HEADER_BYTES,
      end: details.size - TAG_BYTES - 1,
    }),
    decipher,
    createWriteStream(targetPath, { flags: "wx", mode: 0o600 }),
  );
  process.stdout.write(JSON.stringify({ authenticated: true }) + "\n");
}

function derive(masterKey, salt) {
  return Buffer.from(hkdfSync("sha256", masterKey, salt, INFO, 32));
}

function decodeKey(value) {
  if (!value || value.trim() !== value) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  const key = Buffer.from(value, "base64");
  if (
    key.length !== 32 ||
    key.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")
  ) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}
