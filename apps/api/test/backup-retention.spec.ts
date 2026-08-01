import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupRetentionService, validateRetentionPolicy } from "../src/modules/backups/backup-retention.service";
import type { BackupManifest, BackupRecord } from "../src/modules/backups/backup.types";

function record(directory: string, sequence: number, createdAt: string): BackupRecord {
  const id = `backup-202607${String(sequence).padStart(2, "0")}T120000Z-abcdef123456`;
  const manifest: BackupManifest = {
    schemaVersion: 1,
    id,
    createdAt,
    artifact: {
      fileName: `${id}.avsbak`,
      format: "avs-aes-256-gcm-v1",
      bytes: 10,
      sha256: "a".repeat(64),
    },
    dump: { format: "postgresql-custom", bytes: 1, sha256: "b".repeat(64) },
    encryption: { algorithm: "aes-256-gcm", keyId: "c".repeat(16) },
    verification: { verifiedAt: createdAt, pgRestoreList: true },
    manifestHmacSha256: "d".repeat(64),
  };
  return {
    manifest,
    artifactPath: join(directory, manifest.artifact.fileName),
    manifestPath: join(directory, `${id}.manifest.json`),
  };
}

describe("BackupRetentionService", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "avs-retention-test-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps the minimum newest backups and removes excess or expired pairs", async () => {
    const records = [
      record(directory, 30, "2026-07-30T12:00:00.000Z"),
      record(directory, 29, "2026-07-29T12:00:00.000Z"),
      record(directory, 20, "2026-07-20T12:00:00.000Z"),
      record(directory, 1, "2026-07-01T12:00:00.000Z"),
    ];
    await Promise.all(records.flatMap((item) => [
      writeFile(item.artifactPath, "encrypted"),
      writeFile(item.manifestPath, "{}"),
    ]));

    const result = await new BackupRetentionService().apply(
      records,
      {
        maxBackups: 3,
        maxAgeDays: 7,
        minBackups: 2,
        dailyBackups: 2,
        weeklyBackups: 1,
        monthlyBackups: 1,
      },
      new Date("2026-07-30T13:00:00.000Z"),
    );

    expect(result.retainedIds).toEqual([records[0]?.manifest.id, records[1]?.manifest.id]);
    expect(result.deletedIds).toEqual([records[2]?.manifest.id, records[3]?.manifest.id]);
    await expect(access(records[0]!.artifactPath)).resolves.toBeUndefined();
    await expect(access(records[2]!.artifactPath)).rejects.toBeDefined();
  });

  it("rejects policies that could delete every recovery point", () => {
    expect(() => validateRetentionPolicy({
      maxBackups: 1,
      maxAgeDays: 30,
      minBackups: 0,
      dailyBackups: 1,
      weeklyBackups: 1,
      monthlyBackups: 1,
    })).toThrow();
    expect(() => validateRetentionPolicy({
      maxBackups: 2,
      maxAgeDays: 30,
      minBackups: 3,
      dailyBackups: 1,
      weeklyBackups: 1,
      monthlyBackups: 1,
    })).toThrow();
  });
});
