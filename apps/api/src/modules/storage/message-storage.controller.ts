import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { CompleteIssueAttachmentDto, CompleteMessageAttachmentUploadDto, PresignIssueAttachmentDto, PresignMessageAttachmentDto } from "./dto/storage.dto";
import { StorageService } from "./storage.service";

@ApiTags("message attachments")
@Controller("messages/:messageId/attachments")
export class MessageStorageController {
  constructor(private readonly storage: StorageService) {}
  @Permissions("messages.send") @Post("presign") presign(@CurrentUser() user: AuthPrincipal, @Param("messageId", ParseUUIDPipe) messageId: string, @Body() input: PresignIssueAttachmentDto, @Req() request: Request) { return this.storage.presignMessage(user, messageId, input, publicStorageEndpoint(request)); }
  @Permissions("messages.send") @Post("complete") complete(@CurrentUser() user: AuthPrincipal, @Param("messageId", ParseUUIDPipe) messageId: string, @Body() input: CompleteIssueAttachmentDto, @CurrentRequestId() requestId: string) { return this.storage.completeMessage(user, messageId, input, requestId); }
  @Permissions("conversations.read") @Get(":attachmentId/download") download(@CurrentUser() user: AuthPrincipal, @Param("messageId", ParseUUIDPipe) messageId: string, @Param("attachmentId", ParseUUIDPipe) attachmentId: string, @Req() request: Request) { return this.storage.downloadMessage(user, messageId, attachmentId, publicStorageEndpoint(request)); }
}

@ApiTags("message attachment uploads")
@Controller()
export class PendingMessageStorageController {
  constructor(private readonly storage: StorageService) {}

  @Permissions("messages.send")
  @Post("messages/attachments")
  presign(@CurrentUser() user: AuthPrincipal, @Body() input: PresignMessageAttachmentDto, @Req() request: Request) {
    return this.storage.presignPendingMessage(user, input, publicStorageEndpoint(request));
  }

  @Permissions("messages.send")
  @Post("messages/attachments/:uploadId/complete")
  complete(@CurrentUser() user: AuthPrincipal, @Param("uploadId", ParseUUIDPipe) uploadId: string, @Body() input: CompleteMessageAttachmentUploadDto, @CurrentRequestId() requestId: string) {
    return this.storage.completePendingMessage(user, uploadId, input, requestId);
  }
}

function publicStorageEndpoint(request: Request): string {
  const port = process.env.MINIO_API_HOST_PORT ?? "9000";
  return `${request.protocol}://${request.hostname}:${port}`;
}
