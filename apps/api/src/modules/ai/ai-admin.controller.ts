import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { AuditService } from "../audit/audit.service";
import { AiAdminService } from "./ai-admin.service";
import { AiKnowledgeService } from "./ai-knowledge.service";
import { AiUsageService } from "./ai-usage.service";
import {
  AiUsageQueryDto,
  CreateManualAiKnowledgeDto,
  UpdateAiBotSettingDto,
  UploadAiKnowledgeDto,
} from "./dto/ai.dto";

@ApiTags("AVS Bot Admin")
@ApiBearerAuth()
@Controller("ai/admin")
export class AiAdminController {
  constructor(
    private readonly admin: AiAdminService,
    private readonly knowledge: AiKnowledgeService,
    private readonly usage: AiUsageService,
    private readonly audit: AuditService,
  ) {}

  @Permissions("ai.admin")
  @Get("dashboard")
  dashboard(@CurrentUser() user: AuthPrincipal) {
    return this.admin.dashboard(user);
  }

  @Permissions("ai.admin")
  @Get("settings")
  settings(@CurrentUser() user: AuthPrincipal) {
    return this.admin.settings(user.collegeId);
  }

  @Permissions("ai.admin")
  @Patch("settings")
  updateSettings(
    @CurrentUser() user: AuthPrincipal,
    @Body() input: UpdateAiBotSettingDto,
    @CurrentRequestId() requestId: string,
  ) {
    return this.admin.updateSettings(user, input, requestId);
  }

  @Permissions("ai.admin")
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post("connection-test")
  testConnection(
    @CurrentUser() user: AuthPrincipal,
    @CurrentRequestId() requestId: string,
  ) {
    return this.admin.testConnection(user, requestId);
  }

  @Permissions("ai.usage.read")
  @Get("usage")
  usageSummary(
    @CurrentUser() user: AuthPrincipal,
    @Query() query: AiUsageQueryDto,
  ) {
    return this.usage.summary(user.collegeId, query);
  }

  @Permissions("ai.usage.read")
  @Get("safety-events")
  safetyEvents(@CurrentUser() user: AuthPrincipal) {
    return this.admin.safetyEvents(user);
  }

  @Permissions("ai.knowledge.manage")
  @Get("knowledge")
  knowledgeList(
    @CurrentUser() user: AuthPrincipal,
    @Query("includeArchived") includeArchived?: string,
  ) {
    return this.knowledge.list(user, includeArchived === "true");
  }

  @Permissions("ai.knowledge.manage")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { files: 1, fileSize: 15 * 1024 * 1024 },
    }),
  )
  @Post("knowledge/upload")
  async uploadKnowledge(
    @CurrentUser() user: AuthPrincipal,
    @Body() input: UploadAiKnowledgeDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentRequestId() requestId: string,
  ) {
    const document = await this.knowledge.upload(user, input, file);
    await this.audit.record({
      actorId: user.id,
      action: "ai.knowledge.uploaded",
      entityType: "AiKnowledgeDocument",
      entityId: document.id,
      afterValue: document,
      requestId,
    });
    return document;
  }

  @Permissions("ai.knowledge.manage")
  @Post("knowledge/manual")
  async manualKnowledge(
    @CurrentUser() user: AuthPrincipal,
    @Body() input: CreateManualAiKnowledgeDto,
    @CurrentRequestId() requestId: string,
  ) {
    const document = await this.knowledge.createManual(user, input);
    await this.audit.record({
      actorId: user.id,
      action: "ai.knowledge.created",
      entityType: "AiKnowledgeDocument",
      entityId: document.id,
      afterValue: document,
      requestId,
    });
    return document;
  }

  @Permissions("ai.knowledge.manage")
  @Patch("knowledge/:documentId/archive")
  async archiveKnowledge(
    @CurrentUser() user: AuthPrincipal,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @CurrentRequestId() requestId: string,
  ) {
    const document = await this.knowledge.archive(user, documentId);
    await this.audit.record({
      actorId: user.id,
      action: "ai.knowledge.archived",
      entityType: "AiKnowledgeDocument",
      entityId: documentId,
      afterValue: document,
      requestId,
    });
    return document;
  }
}

