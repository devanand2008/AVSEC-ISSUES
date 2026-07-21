import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import {
  allowedOriginsFromConfig,
  isAllowedOriginFromConfig,
} from "../../common/http/allowed-origins";
import type { AuthPrincipal } from "../../common/http/request-context";
import { AnnouncementsService } from "./announcements.service";
import type {
  CompleteAnnouncementImageDto,
  CreateAnnouncementDto,
  PresignAnnouncementImageDto,
  RecipientQueryDto,
  UpdateAnnouncementDto,
} from "./dto/announcement.dto";

// SSE connected clients registry
const sseClients = new Map<string, Response>();

@ApiTags("announcements")
@Controller("announcements")
export class AnnouncementsController {
  constructor(
    private readonly announcements: AnnouncementsService,
    private readonly config: ConfigService,
  ) {}

  // ─── USER-FACING ──────────────────────────────────────────────────────────────

  @ApiOperation({ summary: "List published announcements for current user" })
  @Permissions("announcements.read")
  @Get()
  list(@CurrentUser() user: AuthPrincipal) {
    return this.announcements.list(user);
  }

  @ApiOperation({
    summary: "Get pending one-time auto-display announcements for current user",
  })
  @Permissions("announcements.read")
  @Get("me/pending")
  getPending(@CurrentUser() user: AuthPrincipal) {
    return this.announcements.getPending(user);
  }

  @ApiOperation({
    summary:
      "Server-Sent Events stream for real-time announcement notifications",
  })
  @Permissions("announcements.read")
  @Get("stream")
  stream(
    @CurrentUser() user: AuthPrincipal,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const origin = req.header("origin");
    const allowedOrigins = allowedOriginsFromConfig(this.config);
    const responseOrigin =
      origin && isAllowedOriginFromConfig(this.config, origin)
        ? origin
        : allowedOrigins[0];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    if (responseOrigin)
      res.setHeader("Access-Control-Allow-Origin", responseOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
    res.flushHeaders();

    sseClients.set(user.id, res);

    // Send a heartbeat every 25s to prevent proxy timeouts
    const interval = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 25000);

    res.on("close", () => {
      clearInterval(interval);
      sseClients.delete(user.id);
    });
  }

  @ApiOperation({ summary: "Get one announcement for current recipient" })
  @Permissions("announcements.read")
  @Get(":id")
  getOne(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.announcements.getOne(user, id);
  }

  @ApiOperation({ summary: "Legacy: mark announcement as read" })
  @Permissions("announcements.read")
  @Post(":id/read")
  read(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("acknowledge", ParseBoolPipe) acknowledge = false,
  ) {
    return this.announcements.read(user, id, acknowledge);
  }

  @ApiOperation({ summary: "Mark announcement as displayed in popup" })
  @Permissions("announcements.read")
  @Post(":id/display")
  markDisplay(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.announcements.markDisplay(user, id);
  }

  @ApiOperation({
    summary: "Mark announcement as viewed (minimum dwell reached)",
  })
  @Permissions("announcements.read")
  @Post(":id/view")
  markViewed(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.announcements.markViewed(user, id);
  }

  @ApiOperation({ summary: "Acknowledge announcement" })
  @Permissions("announcements.read")
  @Post(":id/acknowledge")
  markAcknowledged(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.announcements.markAcknowledged(user, id);
  }

  @ApiOperation({ summary: "Track manual open of announcement from history" })
  @Permissions("announcements.read")
  @Post(":id/open")
  markOpen(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.announcements.markOpen(user, id);
  }

  // ─── ADMIN ────────────────────────────────────────────────────────────────────

  @ApiOperation({ summary: "Admin list all announcements for college" })
  @Permissions("announcements.publish_college")
  @Get("admin/all")
  adminList(@CurrentUser() user: AuthPrincipal) {
    return this.announcements.adminList(user);
  }

  @ApiOperation({ summary: "Create new announcement" })
  @Permissions("announcements.publish_college")
  @Post()
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body() input: CreateAnnouncementDto,
  ) {
    return this.announcements.create(user, input);
  }

  @ApiOperation({ summary: "Update announcement (DRAFT/SCHEDULED only)" })
  @Permissions("announcements.publish_college")
  @Put(":id")
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: UpdateAnnouncementDto,
    @Req() req: Request,
  ) {
    return this.announcements.update(
      user,
      id,
      input,
      (req as { requestId?: string }).requestId ?? "",
    );
  }

  @ApiOperation({ summary: "Patch announcement (DRAFT/SCHEDULED only)" })
  @Permissions("announcements.publish_college")
  @Patch(":id")
  patch(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: UpdateAnnouncementDto,
    @Req() req: Request,
  ) {
    return this.announcements.update(
      user,
      id,
      input,
      (req as { requestId?: string }).requestId ?? "",
    );
  }

  @ApiOperation({ summary: "Publish announcement to audiences" })
  @Permissions("announcements.publish_college")
  @Post(":id/publish")
  publish(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.announcements.publish(user, id);
  }

  @ApiOperation({
    summary: "Send announcement to ALL active users (background job)",
  })
  @Permissions("announcements.publish_college")
  @Post(":id/send-all")
  async sendAll(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() req: Request,
  ) {
    const result = await this.announcements.sendAll(
      user,
      id,
      (req as { requestId?: string }).requestId ?? "",
      idempotencyKey,
    );
    // Notify all connected SSE clients
    for (const [, res] of sseClients) {
      res.write(
        `data: ${JSON.stringify({ type: "announcement:published", announcementId: id })}\n\n`,
      );
    }
    return result;
  }

  @ApiOperation({ summary: "Count estimated recipients before sending" })
  @Permissions("announcements.publish_college")
  @Get(":id/recipient-count")
  countRecipients(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.announcements.countRecipients(user, id);
  }

  @ApiOperation({ summary: "Get announcement analytics" })
  @Permissions("announcements.publish_college")
  @Get(":id/analytics")
  getAnalytics(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.announcements.getAnalytics(user, id);
  }

  @ApiOperation({ summary: "Get paginated recipient list" })
  @Permissions("announcements.publish_college")
  @Get(":id/recipients")
  getRecipients(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: RecipientQueryDto,
  ) {
    return this.announcements.getRecipients(user, id, query);
  }

  @ApiOperation({ summary: "Export announcement recipients as CSV" })
  @Permissions("announcements.publish_college")
  @Get(":id/recipients/export.csv")
  @Header("content-type", "text/csv; charset=utf-8")
  @Header(
    "content-disposition",
    'attachment; filename="announcement-recipients.csv"',
  )
  exportRecipients(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: RecipientQueryDto,
    @Req() req: Request,
  ) {
    return this.announcements.exportRecipientsCsv(
      user,
      id,
      query,
      (req as { requestId?: string }).requestId ?? "",
    );
  }

  @ApiOperation({ summary: "Presign an image upload URL for an announcement" })
  @Permissions("announcements.publish_college")
  @Post(":id/image/presign")
  presignImage(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: PresignAnnouncementImageDto,
  ) {
    return this.announcements.presignImage(user, id, input);
  }

  @ApiOperation({ summary: "Complete announcement image upload" })
  @Permissions("announcements.publish_college")
  @Post(":id/image/complete")
  completeImage(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: CompleteAnnouncementImageDto,
    @Req() req: Request,
  ) {
    return this.announcements.completeImage(
      user,
      id,
      input,
      (req as { requestId?: string }).requestId ?? "",
    );
  }

  @ApiOperation({ summary: "Archive an announcement" })
  @Permissions("announcements.publish_college")
  @Post(":id/archive")
  archive(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.announcements.archive(
      user,
      id,
      (req as { requestId?: string }).requestId ?? "",
    );
  }

  @ApiOperation({ summary: "Unpublish an announcement" })
  @Permissions("announcements.publish_college")
  @Post(":id/unpublish")
  unpublish(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.announcements.unpublish(
      user,
      id,
      (req as { requestId?: string }).requestId ?? "",
    );
  }
}

@ApiTags("users")
@Controller("users/me/announcements")
export class UserAnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @ApiOperation({ summary: "List published announcements for current user" })
  @Permissions("announcements.read")
  @Get()
  list(@CurrentUser() user: AuthPrincipal) {
    return this.announcements.list(user);
  }

  @ApiOperation({
    summary: "Get pending one-time auto-display announcements for current user",
  })
  @Permissions("announcements.read")
  @Get("pending")
  getPending(@CurrentUser() user: AuthPrincipal) {
    return this.announcements.getPending(user);
  }
}
