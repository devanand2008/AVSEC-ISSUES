import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import { CompleteIssueAttachmentDto, PresignIssueAttachmentDto } from "./dto/storage.dto";
import { StorageService } from "./storage.service";

@ApiTags("attachments")
@Controller("issues/:issueId/attachments")
export class StorageController {
  constructor(private readonly storage: StorageService) {}
  @Post("presign") presign(@CurrentUser() user: AuthPrincipal, @Param("issueId", ParseUUIDPipe) issueId: string, @Body() input: PresignIssueAttachmentDto, @Req() request: Request) { return this.storage.presign(user, issueId, input, publicStorageEndpoint(request)); }
  @Post("complete") complete(@CurrentUser() user: AuthPrincipal, @Param("issueId", ParseUUIDPipe) issueId: string, @Body() input: CompleteIssueAttachmentDto, @CurrentRequestId() requestId: string) { return this.storage.complete(user, issueId, input, requestId); }
  @Get(":attachmentId/download") download(@CurrentUser() user: AuthPrincipal, @Param("issueId", ParseUUIDPipe) issueId: string, @Param("attachmentId", ParseUUIDPipe) attachmentId: string, @Req() request: Request) { return this.storage.download(user, issueId, attachmentId, publicStorageEndpoint(request)); }
  @Delete(":attachmentId") remove(@CurrentUser() user: AuthPrincipal, @Param("issueId", ParseUUIDPipe) issueId: string, @Param("attachmentId", ParseUUIDPipe) attachmentId: string, @CurrentRequestId() requestId: string) { return this.storage.remove(user, issueId, attachmentId, requestId); }
}

function publicStorageEndpoint(request: Request): string {
  const port = process.env.MINIO_API_HOST_PORT ?? "9000";
  return `${request.protocol}://${request.hostname}:${port}`;
}
