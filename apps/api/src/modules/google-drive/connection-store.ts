import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import type {
  EncryptedGoogleDriveTokens,
  GoogleDriveConnectionRecord,
  GoogleDriveConnectionStore,
  SaveGoogleDriveConnection,
} from "./google-drive.types";
import { GOOGLE_DRIVE_PROVIDER } from "./google-drive.types";

/**
 * Prisma-backed Google Drive connection store.
 *
 * Persists OAuth connection state using the `StorageConnection` and
 * `GoogleDriveConnection` Prisma models. The `ownerId` is the admin
 * user's UUID who authorized the Google Drive connection for their college.
 */
@Injectable()
export class PrismaConnectionStore implements GoogleDriveConnectionStore {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveByOwner(
    ownerId: string,
  ): Promise<GoogleDriveConnectionRecord | null> {
    const connection = await this.prisma.storageConnection.findFirst({
      where: {
        createdById: ownerId,
        provider: "GOOGLE_DRIVE",
        revokedAt: null,
        status: { not: "REVOKED" },
      },
      include: { googleDrive: true },
      orderBy: { createdAt: "desc" },
    });
    if (!connection?.googleDrive) return null;
    return this.toRecord(connection, connection.googleDrive);
  }

  async saveActive(
    ownerId: string,
    input: SaveGoogleDriveConnection,
    now: Date,
  ): Promise<GoogleDriveConnectionRecord> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ownerId },
      select: { collegeId: true },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.storageConnection.findUnique({
        where: {
          collegeId_provider: {
            collegeId: user.collegeId,
            provider: "GOOGLE_DRIVE",
          },
        },
        include: { googleDrive: true },
      });

      if (existing) {
        return tx.storageConnection.update({
          where: { id: existing.id },
          data: {
            status: "CONNECTED",
            ownerEmail: input.providerAccountEmail,
            createdById: ownerId,
            createdAt: now,
            revokedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            googleDrive: existing.googleDrive
              ? {
                  update: {
                    accountEmail: input.providerAccountEmail ?? "",
                    accountSubject: input.providerAccountId,
                    encryptedRefreshToken: input.encryptedTokens.ciphertext,
                    encryptionKeyVersion: input.encryptedTokens.version,
                    tokenExpiresAt: input.encryptedTokens.expiresAt,
                    revokedAt: null,
                  },
                }
              : {
                  create: {
                    accountEmail: input.providerAccountEmail ?? "",
                    accountSubject: input.providerAccountId,
                    encryptedRefreshToken: input.encryptedTokens.ciphertext,
                    encryptionKeyVersion: input.encryptedTokens.version,
                    tokenExpiresAt: input.encryptedTokens.expiresAt,
                    grantedScopes: [],
                  },
                },
          },
          include: { googleDrive: true },
        });
      }

      const storageConnection = await tx.storageConnection.create({
        data: {
          collegeId: user.collegeId,
          provider: "GOOGLE_DRIVE",
          status: "CONNECTED",
          ownerEmail: input.providerAccountEmail,
          createdById: ownerId,
          googleDrive: {
            create: {
              accountEmail: input.providerAccountEmail ?? "",
              accountSubject: input.providerAccountId,
              encryptedRefreshToken: input.encryptedTokens.ciphertext,
              encryptionKeyVersion: input.encryptedTokens.version,
              tokenExpiresAt: input.encryptedTokens.expiresAt,
              grantedScopes: [],
            },
          },
        },
        include: { googleDrive: true },
      });
      return storageConnection;
    });

    return this.toRecord(result, result.googleDrive!);
  }

  async updateTokensOwned(
    connectionId: string,
    ownerId: string,
    encryptedTokens: EncryptedGoogleDriveTokens,
  ): Promise<boolean> {
    const connection = await this.prisma.storageConnection.findFirst({
      where: {
        id: connectionId,
        createdById: ownerId,
        provider: "GOOGLE_DRIVE",
        revokedAt: null,
      },
      include: { googleDrive: true },
    });
    if (!connection?.googleDrive) return false;

    await this.prisma.googleDriveConnection.update({
      where: { id: connection.googleDrive.id },
      data: {
        encryptedRefreshToken: encryptedTokens.ciphertext,
        encryptionKeyVersion: encryptedTokens.version,
        tokenExpiresAt: encryptedTokens.expiresAt,
      },
    });
    return true;
  }

  async markRevokedOwned(
    connectionId: string,
    ownerId: string,
    revokedAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.storageConnection.updateMany({
      where: {
        id: connectionId,
        createdById: ownerId,
        provider: "GOOGLE_DRIVE",
        revokedAt: null,
      },
      data: {
        status: "REVOKED",
        revokedAt,
      },
    });
    if (result.count === 0) return false;

    // Also mark the GoogleDriveConnection as revoked
    const connection = await this.prisma.storageConnection.findUnique({
      where: { id: connectionId },
      include: { googleDrive: true },
    });
    if (connection?.googleDrive) {
      await this.prisma.googleDriveConnection.update({
        where: { id: connection.googleDrive.id },
        data: { revokedAt },
      });
    }
    return true;
  }

  async recordFailureOwned(
    connectionId: string,
    ownerId: string,
    errorCode: string,
  ): Promise<void> {
    await this.prisma.storageConnection.updateMany({
      where: {
        id: connectionId,
        createdById: ownerId,
        provider: "GOOGLE_DRIVE",
      },
      data: {
        status: "ERROR",
        lastErrorCode: errorCode,
        lastErrorMessage: `Storage error: ${errorCode}`,
      },
    });
  }

  private toRecord(
    connection: {
      id: string;
      createdById: string | null;
      createdAt: Date;
      revokedAt: Date | null;
      lastErrorCode: string | null;
    },
    googleDrive: {
      accountEmail: string;
      accountSubject: string | null;
      encryptedRefreshToken: string;
      encryptionKeyVersion: number;
      tokenExpiresAt: Date | null;
    },
  ): GoogleDriveConnectionRecord {
    return {
      id: connection.id,
      ownerId: connection.createdById ?? "",
      provider: GOOGLE_DRIVE_PROVIDER,
      encryptedTokens: {
        version: 1,
        ciphertext: googleDrive.encryptedRefreshToken,
        expiresAt: googleDrive.tokenExpiresAt ?? new Date(0),
      },
      providerAccountId: googleDrive.accountSubject,
      providerAccountEmail: googleDrive.accountEmail,
      connectedAt: connection.createdAt,
      revokedAt: connection.revokedAt,
      lastErrorCode: connection.lastErrorCode,
    };
  }
}
