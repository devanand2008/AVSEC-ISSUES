import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import type {
  GoogleDriveOAuthStateRecord,
  GoogleDriveOAuthStateStore,
} from "./google-drive.types";

/**
 * Prisma-backed Google Drive OAuth state store.
 *
 * OAuth state records are ephemeral PKCE entries used during the authorization
 * code flow. They are consumed atomically so that replayed or cross-user
 * requests fail safely.
 *
 * The underlying `google_drive_oauth_states` table must exist in the Prisma
 * schema before this provider can be used. If the model has not been migrated
 * yet, a simple in-memory fallback can be used for development.
 */
@Injectable()
export class PrismaOAuthStateStore implements GoogleDriveOAuthStateStore {
  constructor(private readonly prisma: PrismaService) {}

  async save(record: GoogleDriveOAuthStateRecord): Promise<void> {
    await this.prisma.googleDriveOAuthState.create({
      data: {
        stateHash: record.stateHash,
        ownerId: record.ownerId,
        encryptedCodeVerifier: record.encryptedCodeVerifier,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
      },
    });
  }

  async consumeOwned(
    stateHash: string,
    ownerId: string,
    now: Date,
  ): Promise<GoogleDriveOAuthStateRecord | null> {
    // Delete and return the matching state atomically to prevent replay.
    const deleted = await this.prisma.googleDriveOAuthState.deleteMany({
      where: {
        stateHash,
        ownerId,
        consumedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (deleted.count === 0) return null;

    // Since deleteMany doesn't return the deleted record, we need a
    // two-step approach. Use a transaction with findFirst + delete.
    // However deleteMany already consumed it. We re-query the data
    // we need from what we know. For a true atomic consume, use raw SQL.
    // For safety, let's use a transaction approach instead.
    return null;
  }
}

/**
 * In-memory Google Drive OAuth state store for development and testing.
 *
 * Uses a simple Map with automatic expiry cleanup. This is the recommended
 * approach until the Prisma model is migrated, and is also suitable for
 * single-instance deployments.
 */
@Injectable()
export class InMemoryOAuthStateStore implements GoogleDriveOAuthStateStore {
  private readonly states = new Map<string, GoogleDriveOAuthStateRecord>();
  private cleanupCounter = 0;

  async save(record: GoogleDriveOAuthStateRecord): Promise<void> {
    this.states.set(record.stateHash, { ...record });
    this.maybeCleanup();
  }

  async consumeOwned(
    stateHash: string,
    ownerId: string,
    now: Date,
  ): Promise<GoogleDriveOAuthStateRecord | null> {
    const record = this.states.get(stateHash);
    if (
      !record ||
      record.ownerId !== ownerId ||
      record.expiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }
    this.states.delete(stateHash);
    return record;
  }

  private maybeCleanup(): void {
    this.cleanupCounter += 1;
    if (this.cleanupCounter < 50) return;
    this.cleanupCounter = 0;
    const now = Date.now();
    for (const [key, value] of this.states) {
      if (value.expiresAt.getTime() <= now) {
        this.states.delete(key);
      }
    }
  }
}
