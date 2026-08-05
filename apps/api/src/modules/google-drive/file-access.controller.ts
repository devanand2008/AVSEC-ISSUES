import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  StreamableFile,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { GoogleDriveStorageService } from "./google-drive-storage.service";

@Controller("files")
export class FileAccessController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: GoogleDriveStorageService,
  ) {}

  @Get(":fileId")
  async download(
    @CurrentUser() user: AuthPrincipal,
    @Param("fileId", ParseUUIDPipe) fileId: string,
  ) {
    const file = await this.prisma.fileRecord.findFirst({
      where: {
        id: fileId,
        collegeId: user.collegeId,
        status: "READY",
        deletedAt: null,
      },
      include: { storageConnection: true },
    });
    if (!file) throw new NotFoundException("File was not found.");
    const isBackup = file.category.startsWith("BACKUP_") ||
      file.category === "DATABASE_BACKUP";
    const mayRead =
      file.uploadedById === user.id ||
      (isBackup && user.permissions.includes("backups.manage")) ||
      user.permissions.includes("settings.manage");
    if (!mayRead) {
      throw new ForbiddenException("You are not authorized to access this file.");
    }
    if (file.provider !== "GOOGLE_DRIVE" || !file.storageConnection?.createdById) {
      throw new NotFoundException("The private file provider is unavailable.");
    }
    const object = await this.drive.download({
      ownerId: file.storageConnection.createdById,
      objectId: file.providerFileId,
      expectedChecksum: {
        algorithm: "sha256",
        value: file.checksumSha256,
      },
    });
    return new StreamableFile(object.content, {
      type: file.mimeType,
      disposition: `attachment; filename="${file.safeFileName}"`,
      length: object.content.length,
    });
  }
}
