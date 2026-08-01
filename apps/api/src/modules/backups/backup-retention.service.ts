import { Injectable } from "@nestjs/common";
import { unlink } from "node:fs/promises";
import type { BackupRecord, RetentionPolicy, RetentionResult } from "./backup.types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function validateRetentionPolicy(policy: RetentionPolicy): RetentionPolicy {
  if (
    !Number.isSafeInteger(policy.maxBackups)
    || !Number.isSafeInteger(policy.maxAgeDays)
    || !Number.isSafeInteger(policy.minBackups)
    || !Number.isSafeInteger(policy.dailyBackups)
    || !Number.isSafeInteger(policy.weeklyBackups)
    || !Number.isSafeInteger(policy.monthlyBackups)
    || policy.maxBackups < 1
    || policy.maxAgeDays < 1
    || policy.minBackups < 1
    || policy.dailyBackups < 1
    || policy.weeklyBackups < 1
    || policy.monthlyBackups < 1
    || policy.minBackups > policy.maxBackups
  ) {
    throw new Error("Backup retention policy is invalid.");
  }
  return policy;
}

function isoWeek(date: Date): string {
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((current.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);
  return `${current.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function tierIds(
  records: BackupRecord[],
  limit: number,
  bucketFor: (date: Date) => string,
): Set<string> {
  const buckets = new Set<string>();
  const selected = new Set<string>();
  for (const record of records) {
    const date = new Date(record.manifest.createdAt);
    const bucket = bucketFor(date);
    if (buckets.has(bucket)) continue;
    if (buckets.size >= limit) break;
    buckets.add(bucket);
    selected.add(record.manifest.id);
  }
  return selected;
}

@Injectable()
export class BackupRetentionService {
  async apply(records: BackupRecord[], input: RetentionPolicy, now = new Date()): Promise<RetentionResult> {
    const policy = validateRetentionPolicy(input);
    const sorted = [...records].sort((left, right) => right.manifest.createdAt.localeCompare(left.manifest.createdAt));
    const protectedIds = new Set(sorted.slice(0, policy.minBackups).map((record) => record.manifest.id));
    const tiers = [
      tierIds(sorted, policy.dailyBackups, (date) => date.toISOString().slice(0, 10)),
      tierIds(sorted, policy.weeklyBackups, isoWeek),
      tierIds(sorted, policy.monthlyBackups, (date) => date.toISOString().slice(0, 7)),
    ];
    for (const tier of tiers) {
      for (const id of tier) protectedIds.add(id);
    }
    const deletedIds: string[] = [];
    const retainedIds: string[] = [];
    const errors: RetentionResult["errors"] = [];

    for (const [index, record] of sorted.entries()) {
      const ageMs = now.getTime() - Date.parse(record.manifest.createdAt);
      const protectedByTier = protectedIds.has(record.manifest.id);
      const overCount = index >= policy.maxBackups;
      const overAge = ageMs > policy.maxAgeDays * DAY_MS;
      if (protectedByTier || (!overCount && !overAge)) {
        retainedIds.push(record.manifest.id);
        continue;
      }

      try {
        await unlink(record.artifactPath);
        try {
          await unlink(record.manifestPath);
        } catch (error) {
          errors.push({
            id: record.manifest.id,
            reason: error instanceof Error ? error.message : "Manifest could not be removed.",
          });
          continue;
        }
        deletedIds.push(record.manifest.id);
      } catch (error) {
        errors.push({
          id: record.manifest.id,
          reason: error instanceof Error ? error.message : "Backup could not be removed.",
        });
      }
    }
    return { deletedIds, retainedIds, errors };
  }
}
