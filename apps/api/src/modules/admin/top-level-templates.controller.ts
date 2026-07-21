import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { AdminService } from "./admin.service";
import { CreateNotificationTemplateDto, UpdateNotificationTemplateDto } from "./dto/admin.dto";

@ApiTags("templates")
@Controller("templates")
export class TemplatesController {
  constructor(private readonly admin: AdminService) {}

  @Permissions("settings.manage")
  @Get()
  list() {
    return this.admin.notificationTemplates();
  }

  @Permissions("settings.manage")
  @Post()
  create(@CurrentUser() user: AuthPrincipal, @Body() input: CreateNotificationTemplateDto, @CurrentRequestId() requestId: string) {
    return this.admin.createNotificationTemplate(user, input, requestId);
  }

  @Permissions("settings.manage")
  @Patch(":id")
  update(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateNotificationTemplateDto, @CurrentRequestId() requestId: string) {
    return this.admin.updateNotificationTemplate(user, id, input, requestId);
  }

  @Permissions("settings.manage")
  @Delete(":id")
  remove(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    return this.admin.deleteNotificationTemplate(user, id, requestId);
  }
}
