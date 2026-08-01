import { Injectable } from "@nestjs/common";
import type {
  GoogleDriveFolderCacheRecord,
  GoogleDriveFolderCacheStore,
} from "./google-drive.types";

/**
 * In-memory Google Drive folder cache store.
 *
 * Caches the mapping from (parentId, name) → Google Drive folder ID so we
 * don't repeatedly search Drive for the same folder. Each entry is scoped
 * to a specific owner and connection to prevent cross-tenant leaks.
 *
 * For multi-instance deployments, this should be replaced with a Redis or
 * Prisma-backed implementation.
 */
@Injectable()
export class InMemoryFolderCacheStore implements GoogleDriveFolderCacheStore {
  private readonly cache = new Map<string, GoogleDriveFolderCacheRecord>();

  async getOwned(
    ownerId: string,
    connectionId: string,
    cacheKey: string,
  ): Promise<GoogleDriveFolderCacheRecord | null> {
    const key = this.compositeKey(ownerId, connectionId, cacheKey);
    const record = this.cache.get(key);
    if (!record) return null;
    if (record.ownerId !== ownerId || record.connectionId !== connectionId) {
      return null;
    }
    return { ...record };
  }

  async putOwned(
    record: GoogleDriveFolderCacheRecord,
  ): Promise<GoogleDriveFolderCacheRecord> {
    const key = this.compositeKey(
      record.ownerId,
      record.connectionId,
      record.cacheKey,
    );
    const saved = { ...record };
    this.cache.set(key, saved);
    return saved;
  }

  async deleteOwned(
    ownerId: string,
    connectionId: string,
    cacheKey: string,
  ): Promise<void> {
    const key = this.compositeKey(ownerId, connectionId, cacheKey);
    this.cache.delete(key);
  }

  private compositeKey(
    ownerId: string,
    connectionId: string,
    cacheKey: string,
  ): string {
    return `${ownerId}\0${connectionId}\0${cacheKey}`;
  }
}
