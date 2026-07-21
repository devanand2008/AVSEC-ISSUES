import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, StreamableFile } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import {
  AssignFeedbackDto,
  BulkGenerateQrDto,
  CreateFeedbackCycleDto,
  CreateFeedbackQrDto,
  CreateFeedbackQuestionDto,
  CreateFeedbackTargetDto,
  FeedbackCycleQueryDto,
  FeedbackCycleStatusDto,
  FeedbackDashboardQueryDto,
  FeedbackQrQueryDto,
  FeedbackQrStatusDto,
  FeedbackQuestionQueryDto,
  FeedbackQuestionStatusDto,
  FeedbackSettingsDto,
  FeedbackSubmissionQueryDto,
  FeedbackSubmissionStatusDto,
  ReopenFeedbackDto,
  UpdateFeedbackCycleDto,
  UpdateFeedbackQuestionDto,
  UpdateFeedbackTargetDto,
} from "./dto/feedback.dto";
import { FeedbackService } from "./feedback.service";

@ApiTags("admin-feedback")
@Controller("admin/feedback")
export class AdminFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get("dashboard")
  dashboard(@CurrentUser() user: AuthPrincipal, @Query() query: FeedbackDashboardQueryDto) {
    return this.feedback.dashboard(user, query);
  }

  @Permissions("feedback.targets.manage")
  @Post("targets")
  createTarget(@CurrentUser() user: AuthPrincipal, @Body() input: CreateFeedbackTargetDto, @CurrentRequestId() requestId: string) {
    return this.feedback.createTarget(user, input, requestId);
  }

  @Permissions("feedback.targets.manage")
  @Patch("targets/:id")
  updateTarget(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateFeedbackTargetDto, @CurrentRequestId() requestId: string) {
    return this.feedback.updateTarget(user, id, input, requestId);
  }

  @Permissions("feedback.qr.manage")
  @Get("qr")
  qr(
    @CurrentUser() user: AuthPrincipal,
    @Query() query: FeedbackQrQueryDto,
  ) {
    return this.feedback.listQr(user, query);
  }

  @Permissions("feedback.qr.manage")
  @Post("qr")
  createQr(@CurrentUser() user: AuthPrincipal, @Body() input: CreateFeedbackQrDto, @CurrentRequestId() requestId: string) {
    return this.feedback.createQr(user, input, requestId);
  }

  @Permissions("feedback.qr.manage")
  @Post("qr/bulk-generate")
  bulkGenerate(@CurrentUser() user: AuthPrincipal, @Body() input: BulkGenerateQrDto, @CurrentRequestId() requestId: string) {
    return this.feedback.bulkGenerate(user, input, requestId);
  }

  @Permissions("feedback.qr.download")
  @Get("qr/:id/download")
  async downloadQr(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Query("format") format: string | undefined, @CurrentRequestId() requestId: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.feedback.downloadQr(user, id, format ?? "png", requestId);
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    return new StreamableFile(file.body);
  }

  @Permissions("feedback.qr.manage")
  @Patch("qr/:id/status")
  updateQrStatus(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: FeedbackQrStatusDto, @CurrentRequestId() requestId: string) {
    return this.feedback.setQrStatus(user, id, input.status, requestId);
  }

  @Permissions("feedback.qr.manage")
  @Post("qr/:id/regenerate")
  regenerateQr(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    return this.feedback.regenerateQr(user, id, requestId);
  }

  @Get("submissions")
  submissions(
    @CurrentUser() user: AuthPrincipal,
    @Query() query: FeedbackSubmissionQueryDto,
  ) {
    return this.feedback.listSubmissions(user, query);
  }

  @Get("submissions/:id")
  submission(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.feedback.submissionDetail(user, id);
  }

  @Permissions("feedback.actions.manage")
  @Patch("submissions/:id/status")
  updateSubmissionStatus(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: FeedbackSubmissionStatusDto, @CurrentRequestId() requestId: string) {
    return this.feedback.updateSubmissionStatus(user, id, input, requestId);
  }

  @Permissions("feedback.actions.manage")
  @Post("submissions/:id/assign")
  assign(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: AssignFeedbackDto, @CurrentRequestId() requestId: string) {
    return this.feedback.assignSubmission(user, id, input, requestId);
  }

  @Permissions("feedback.actions.manage")
  @Post("submissions/:id/resolve")
  resolve(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: FeedbackSubmissionStatusDto, @CurrentRequestId() requestId: string) {
    return this.feedback.resolveSubmission(user, id, input, requestId);
  }

  @Permissions("feedback.actions.manage")
  @Post("submissions/:id/reopen")
  reopen(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: ReopenFeedbackDto, @CurrentRequestId() requestId: string) {
    return this.feedback.reopenSubmission(user, id, input, requestId);
  }

  @Permissions("feedback.cycles.manage")
  @Get("cycles")
  cycles(@CurrentUser() user: AuthPrincipal, @Query() query: FeedbackCycleQueryDto) {
    return this.feedback.listCycles(user, query);
  }

  @Permissions("feedback.cycles.manage")
  @Post("cycles")
  createCycle(@CurrentUser() user: AuthPrincipal, @Body() input: CreateFeedbackCycleDto, @CurrentRequestId() requestId: string) {
    return this.feedback.createCycle(user, input, requestId);
  }

  @Permissions("feedback.cycles.manage")
  @Patch("cycles/:id")
  updateCycle(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateFeedbackCycleDto, @CurrentRequestId() requestId: string) {
    return this.feedback.updateCycle(user, id, input, requestId);
  }

  @Permissions("feedback.cycles.manage")
  @Patch("cycles/:id/status")
  updateCycleStatus(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: FeedbackCycleStatusDto, @CurrentRequestId() requestId: string) {
    return this.feedback.updateCycle(user, id, { status: input.status }, requestId);
  }

  @Permissions("feedback.questions.manage")
  @Get("questions")
  questions(@CurrentUser() user: AuthPrincipal, @Query() query: FeedbackQuestionQueryDto) {
    return this.feedback.listQuestions(user, query);
  }

  @Permissions("feedback.questions.manage")
  @Post("questions")
  createQuestion(@CurrentUser() user: AuthPrincipal, @Body() input: CreateFeedbackQuestionDto, @CurrentRequestId() requestId: string) {
    return this.feedback.createQuestion(user, input, requestId);
  }

  @Permissions("feedback.questions.manage")
  @Patch("questions/:id")
  updateQuestion(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateFeedbackQuestionDto, @CurrentRequestId() requestId: string) {
    return this.feedback.updateQuestion(user, id, input, requestId);
  }

  @Permissions("feedback.questions.manage")
  @Patch("questions/:id/status")
  updateQuestionStatus(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: FeedbackQuestionStatusDto, @CurrentRequestId() requestId: string) {
    return this.feedback.updateQuestion(user, id, { isActive: input.isActive }, requestId);
  }

  @Permissions("feedback.settings.manage")
  @Get("settings")
  settings(@CurrentUser() user: AuthPrincipal) {
    return this.feedback.settings(user);
  }

  @Permissions("feedback.settings.manage")
  @Put("settings")
  updateSettings(@CurrentUser() user: AuthPrincipal, @Body() input: FeedbackSettingsDto, @CurrentRequestId() requestId: string) {
    return this.feedback.updateSettings(user, input, requestId);
  }

  @Permissions("feedback.export")
  @Get("reports/export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=feedback-report.csv")
  async export(@CurrentUser() user: AuthPrincipal, @CurrentRequestId() requestId: string, @Query() query: FeedbackSubmissionQueryDto) {
    return new StreamableFile(await this.feedback.exportCsv(user, requestId, query));
  }

  @Permissions("feedback.export")
  @Get("reports/export.xlsx")
  @Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  @Header("Content-Disposition", "attachment; filename=feedback-report.xlsx")
  async exportXlsx(@CurrentUser() user: AuthPrincipal, @CurrentRequestId() requestId: string, @Query() query: FeedbackSubmissionQueryDto) {
    return new StreamableFile(await this.feedback.exportXlsx(user, requestId, query));
  }

  @Permissions("feedback.export")
  @Get("reports/export.pdf")
  @Header("Content-Type", "application/pdf")
  @Header("Content-Disposition", "attachment; filename=feedback-report.pdf")
  async exportPdf(@CurrentUser() user: AuthPrincipal, @CurrentRequestId() requestId: string, @Query() query: FeedbackSubmissionQueryDto) {
    return new StreamableFile(await this.feedback.exportPdf(user, requestId, query));
  }
}
