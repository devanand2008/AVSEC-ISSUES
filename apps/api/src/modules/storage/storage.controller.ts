import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import { CompleteIssueAttachmentDto, CompleteModelQuestionPaperDto, CompleteSubjectResourceDto, PresignIssueAttachmentDto, PresignLearningFileDto } from "./dto/storage.dto";
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

@ApiTags("staff-learning-resources")
@Controller("staff/learn/subjects/:subjectId")
export class LearningStorageController {
  constructor(private readonly storage: StorageService) {}

  @Post("resources/presign")
  presignResource(
    @CurrentUser() user: AuthPrincipal,
    @Param("subjectId", ParseUUIDPipe) subjectId: string,
    @Body() input: PresignLearningFileDto,
    @Req() request: Request,
  ) {
    return this.storage.presignSubjectLearningFile(
      user,
      subjectId,
      input,
      "resources",
      publicStorageEndpoint(request),
    );
  }

  @Post("resources/complete")
  completeResource(
    @CurrentUser() user: AuthPrincipal,
    @Param("subjectId", ParseUUIDPipe) subjectId: string,
    @Body() input: CompleteSubjectResourceDto,
    @CurrentRequestId() requestId: string,
  ) {
    return this.storage.completeSubjectResource(
      user,
      subjectId,
      input,
      requestId,
    );
  }

  @Post("model-papers/presign")
  presignModelPaper(
    @CurrentUser() user: AuthPrincipal,
    @Param("subjectId", ParseUUIDPipe) subjectId: string,
    @Body() input: PresignLearningFileDto,
    @Req() request: Request,
  ) {
    return this.storage.presignSubjectLearningFile(
      user,
      subjectId,
      input,
      "model-papers",
      publicStorageEndpoint(request),
    );
  }

  @Post("model-papers/complete")
  completeModelPaper(
    @CurrentUser() user: AuthPrincipal,
    @Param("subjectId", ParseUUIDPipe) subjectId: string,
    @Body() input: CompleteModelQuestionPaperDto,
    @CurrentRequestId() requestId: string,
  ) {
    return this.storage.completeModelQuestionPaper(
      user,
      subjectId,
      input,
      requestId,
    );
  }
}

@ApiTags("learning-resources")
@Controller("learn")
export class LearningResourceDownloadController {
  constructor(private readonly storage: StorageService) {}

  @Get("resources/:resourceId/download")
  download(
    @CurrentUser() user: AuthPrincipal,
    @Param("resourceId", ParseUUIDPipe) resourceId: string,
    @Req() request: Request,
  ) {
    return this.storage.downloadSubjectResource(
      user,
      resourceId,
      publicStorageEndpoint(request),
    );
  }

  @Get("model-papers/:paperId/download")
  downloadModelPaper(
    @CurrentUser() user: AuthPrincipal,
    @Param("paperId", ParseUUIDPipe) paperId: string,
    @Req() request: Request,
  ) {
    return this.storage.downloadModelQuestionPaper(
      user,
      paperId,
      publicStorageEndpoint(request),
    );
  }
}

function publicStorageEndpoint(request: Request): string {
  const port = process.env.MINIO_API_HOST_PORT ?? "9000";
  return `${request.protocol}://${request.hostname}:${port}`;
}
