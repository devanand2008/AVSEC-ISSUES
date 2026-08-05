import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";

const paths = process.argv.slice(2);
if (paths.length !== 4) {
  throw new Error(
    "Usage: node scripts/google-drive-backup.mjs ENCRYPTED SCHEMA CHECKSUM MANIFEST",
  );
}
const required = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_DRIVE_BACKUP_FOLDER_ID",
  "GOOGLE_DRIVE_OWNER_EMAIL",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

const accessToken = await refreshAccessToken();
await verifyOwner(accessToken);
const rootId = safeId(process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID);
const [dailyId, schemaId, manifestsId] = await Promise.all([
  ensureFolder(accessToken, rootId, "daily"),
  ensureFolder(accessToken, rootId, "schema"),
  ensureFolder(accessToken, rootId, "manifests"),
]);
const backupId = process.env.BACKUP_ID ?? "unknown";
const commonProperties = {
  avsBackupId: backupId,
  avsBackupTier: "daily",
  avsBackupStatus: "completed",
};
const destinations = [dailyId, schemaId, manifestsId];
const kinds = ["encrypted-full", "schema", "checksum"];

for (let index = 0; index < 3; index += 1) {
  await uploadAndVerify(
    accessToken,
    paths[index],
    destinations[index],
    { ...commonProperties, avsArtifactKind: kinds[index] },
  );
}

const manifest = JSON.parse(await readFile(paths[3], "utf8"));
manifest.uploadStatus = "COMPLETED";
manifest.driveMetadataVerified = true;
manifest.uploadedAt = new Date().toISOString();
await writeFile(paths[3], `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o600,
});
await uploadAndVerify(accessToken, paths[3], manifestsId, {
  ...commonProperties,
  avsArtifactKind: "manifest",
});
process.stdout.write("Google Drive backup upload and metadata verification passed.\n");

async function refreshAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json();
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error("Google OAuth token refresh failed.");
  }
  return payload.access_token;
}

async function verifyOwner(token) {
  const response = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { authorization: `Bearer ${token}` } },
  );
  const payload = await response.json();
  if (
    !response.ok ||
    payload.email_verified !== true ||
    String(payload.email).toLowerCase() !==
      process.env.GOOGLE_DRIVE_OWNER_EMAIL.toLowerCase()
  ) {
    throw new Error("The authorized Google account does not match the configured backup owner.");
  }
}

async function ensureFolder(token, parentId, name) {
  const escapedName = name.replace(/'/g, "\\'");
  const query = encodeURIComponent(
    `'${parentId}' in parents and name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const found = await driveJson(
    token,
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=10`,
  );
  if (found.files?.[0]?.id) return safeId(found.files[0].id);
  const created = await driveJson(
    token,
    "https://www.googleapis.com/drive/v3/files?fields=id,name",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    },
  );
  return safeId(created.id);
}

async function uploadAndVerify(token, path, parentId, appProperties) {
  const details = await stat(path);
  if (!details.isFile() || details.size < 1) throw new Error("Backup artifact is empty.");
  const name = path.split(/[\\/]/).pop();
  const mimeType = name.endsWith(".json")
    ? "application/json"
    : name.endsWith(".sql")
      ? "application/sql"
      : name.endsWith(".sha256")
        ? "text/plain"
        : "application/octet-stream";
  const session = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,md5Checksum,parents",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": mimeType,
        "x-upload-content-length": String(details.size),
      },
      body: JSON.stringify({ name, parents: [parentId], appProperties }),
    },
  );
  const location = session.headers.get("location");
  if (!session.ok || !location) throw new Error(`Google Drive upload session failed for ${name}.`);
  const uploaded = await fetch(location, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": mimeType,
      "content-length": String(details.size),
    },
    body: createReadStream(path),
    duplex: "half",
  });
  const metadata = await uploaded.json();
  if (!uploaded.ok || metadata.name !== name || Number(metadata.size) !== details.size) {
    throw new Error(`Google Drive size/name verification failed for ${name}.`);
  }
  const localMd5 = await hashFile(path, "md5");
  if (metadata.md5Checksum && metadata.md5Checksum !== localMd5) {
    throw new Error(`Google Drive checksum verification failed for ${name}.`);
  }
  const verified = await driveJson(
    token,
    `https://www.googleapis.com/drive/v3/files/${safeId(metadata.id)}?fields=id,name,size,md5Checksum,trashed,parents`,
  );
  if (
    verified.trashed ||
    verified.name !== name ||
    Number(verified.size) !== details.size ||
    !verified.parents?.includes(parentId)
  ) {
    throw new Error(`Google Drive metadata verification failed for ${name}.`);
  }
}

async function driveJson(token, url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error("Google Drive API request failed.");
  return payload;
}

async function hashFile(path, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function safeId(value) {
  const id = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{3,256}$/.test(id)) throw new Error("Google Drive id is invalid.");
  return id;
}
