import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { NotificationsService } from "./notifications.service";
import { DeviceRegistrationService } from "./device-registration.service";
import { RegisterDeviceDto } from "./dto/device-registration.dto";
import { NotificationQueryDto } from "./dto/notification-query.dto";

@ApiTags("notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService, private readonly devices: DeviceRegistrationService) {}
  @Permissions("notifications.read_own") @Get() list(@CurrentUser() user: AuthPrincipal, @Query() query: NotificationQueryDto) { return this.notifications.list(user, query); }
  @Permissions("notifications.read_own") @Get("summary") summary(@CurrentUser() user: AuthPrincipal) { return this.notifications.summary(user); }
  @Permissions("notifications.read_own") @Get("preferences") preferences(@CurrentUser() user: AuthPrincipal) { return this.notifications.preferences(user); }
  @Permissions("notifications.read_own") @Post(":id/read") read(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.notifications.markRead(user, id); }
  @Permissions("notifications.read_own") @Post("read-all") readAll(@CurrentUser() user: AuthPrincipal) { return this.notifications.markAllRead(user); }
  @Permissions("notifications.read_own") @Get("devices") deviceList(@CurrentUser() user: AuthPrincipal) { return this.devices.list(user); }
  @Permissions("notifications.read_own") @Post("devices") registerDevice(@CurrentUser() user: AuthPrincipal, @Body() input: RegisterDeviceDto) { return this.devices.register(user, input); }
  @Permissions("notifications.read_own") @Delete("devices/:id") @HttpCode(HttpStatus.NO_CONTENT) disableDevice(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.devices.disable(user, id); }
}
