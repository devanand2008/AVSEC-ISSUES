import { Body, Controller, DefaultValuePipe, Delete, Get, HttpCode, HttpStatus, Param, ParseBoolPipe, ParseIntPipe, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { NotificationsService } from "./notifications.service";
import { DeviceRegistrationService } from "./device-registration.service";
import { RegisterDeviceDto } from "./dto/device-registration.dto";

@ApiTags("notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService, private readonly devices: DeviceRegistrationService) {}
  @Permissions("notifications.read_own") @Get() list(@CurrentUser() user: AuthPrincipal, @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number, @Query("pageSize", new DefaultValuePipe(20), ParseIntPipe) pageSize: number, @Query("unreadOnly", new DefaultValuePipe(false), ParseBoolPipe) unreadOnly: boolean) { return this.notifications.list(user, Math.max(1, page), Math.min(100, Math.max(1, pageSize)), unreadOnly); }
  @Permissions("notifications.read_own") @Post(":id/read") read(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.notifications.markRead(user, id); }
  @Permissions("notifications.read_own") @Post("read-all") readAll(@CurrentUser() user: AuthPrincipal) { return this.notifications.markAllRead(user); }
  @Permissions("notifications.read_own") @Get("devices") deviceList(@CurrentUser() user: AuthPrincipal) { return this.devices.list(user); }
  @Permissions("notifications.read_own") @Post("devices") registerDevice(@CurrentUser() user: AuthPrincipal, @Body() input: RegisterDeviceDto) { return this.devices.register(user, input); }
  @Permissions("notifications.read_own") @Delete("devices/:id") @HttpCode(HttpStatus.NO_CONTENT) disableDevice(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.devices.disable(user, id); }
}
