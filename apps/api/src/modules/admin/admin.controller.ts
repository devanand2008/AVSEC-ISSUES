import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { AdminService } from "./admin.service";
import { AuditLogQueryDto, BackgroundJobQueryDto, CreateAssetDto, CreateNotificationTemplateDto, UpdateAssetStatusDto, UpdateNotificationTemplateDto, UpdateSettingDto } from "./dto/admin.dto";

@ApiTags("administration")
@Controller()
export class AdminController {
  constructor(private readonly admin: AdminService) {}
  @Permissions("audit.read") @Get("audit-logs") audit(@CurrentUser() user: AuthPrincipal, @Query() query: AuditLogQueryDto) { return this.admin.audit(user, query); }
  @Permissions("notifications.retry") @Get("background-jobs") backgroundJobs(@CurrentUser() user: AuthPrincipal, @Query() query: BackgroundJobQueryDto) { return this.admin.backgroundJobs(user, query); }
  @Permissions("notifications.retry") @Post("background-jobs/:id/retry") retryJob(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) { return this.admin.retryJob(user, id, requestId); }
  @Permissions("notifications.retry") @Post("background-jobs/:id/resolve") resolveJob(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) { return this.admin.resolveJob(user, id, requestId); }
  @Permissions("settings.read") @Get("settings") settings(@CurrentUser() user: AuthPrincipal) { return this.admin.settings(user); }
  @Permissions("settings.manage") @Put("settings/:key") setting(@CurrentUser() user: AuthPrincipal, @Param("key") key: string, @Body() input: UpdateSettingDto, @CurrentRequestId() requestId: string) { return this.admin.updateSetting(user, key, input.value, requestId); }
  @Permissions("integrations.manage") @Get("settings/integrations/status") integrations() { return this.admin.integrations(); }
  @Get("search") search(@CurrentUser() user: AuthPrincipal, @Query("q") query: string) { return query?.trim().length >= 2 ? this.admin.search(user, query.trim()) : { rooms: [], issues: [], users: [] }; }

  /* ─── Escalation events ─── */
  @Permissions("routing.manage") @Get("escalation-events") escalationEvents(@CurrentUser() user: AuthPrincipal) { return this.admin.escalationEvents(user); }

  /* ─── Notification templates ─── */
  @Permissions("settings.manage") @Get("notification-templates") notificationTemplates() { return this.admin.notificationTemplates(); }
  @Permissions("settings.manage") @Post("notification-templates") createNotificationTemplate(@CurrentUser() user: AuthPrincipal, @Body() input: CreateNotificationTemplateDto, @CurrentRequestId() requestId: string) { return this.admin.createNotificationTemplate(user, input, requestId); }
  @Permissions("settings.manage") @Patch("notification-templates/:id") updateNotificationTemplate(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateNotificationTemplateDto, @CurrentRequestId() requestId: string) { return this.admin.updateNotificationTemplate(user, id, input, requestId); }
  @Permissions("settings.manage") @Delete("notification-templates/:id") deleteNotificationTemplate(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) { return this.admin.deleteNotificationTemplate(user, id, requestId); }

  /* ─── Asset management ─── */
  @Permissions("locations.manage") @Get("assets") adminAssets(@CurrentUser() user: AuthPrincipal) { return this.admin.adminAssets(user); }
  @Permissions("locations.manage") @Get("asset-categories") assetCategories() { return this.admin.assetCategories(); }
  @Permissions("locations.manage") @Post("assets") createAsset(@CurrentUser() user: AuthPrincipal, @Body() input: CreateAssetDto, @CurrentRequestId() requestId: string) { return this.admin.createAsset(user, input, requestId); }
  @Permissions("locations.manage") @Patch("assets/:id/status") updateAssetStatus(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateAssetStatusDto, @CurrentRequestId() requestId: string) { return this.admin.updateAssetStatus(user, id, input, requestId); }

  /* ─── System health ─── */
  @Permissions("system.health") @Get("system-health") systemHealth(@CurrentUser() user: AuthPrincipal) { return this.admin.systemHealth(user); }
}
