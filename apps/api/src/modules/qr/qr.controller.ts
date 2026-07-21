import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthPrincipal, RequestWithId } from "../../common/http/request-context";
import { CreateQrCodeDto, UpdateQrStatusDto, ValidateQrDto } from "./dto/qr.dto";
import { QrService } from "./qr.service";

@ApiTags("qr")
@Controller("qr")
export class QrController {
  constructor(private readonly qr: QrService) {}

  @Post("validate")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  validate(@CurrentUser() user: AuthPrincipal, @Body() input: ValidateQrDto, @Req() request: RequestWithId) {
    return this.qr.validate(
      user,
      input.token,
      { requestId: request.id, ipAddress: request.ip, userAgent: request.header("user-agent") },
      input.scanMethod,
    );
  }

  @Get("analytics")
  analytics(@CurrentUser() user: AuthPrincipal) {
    return this.qr.analytics(user);
  }

  @Get("codes")
  codes(@CurrentUser() user: AuthPrincipal) {
    return this.qr.listCodes(user);
  }

  @Post("codes")
  createCode(@CurrentUser() user: AuthPrincipal, @Body() input: CreateQrCodeDto, @Req() request: RequestWithId) {
    return this.qr.createCode(
      user,
      input,
      { requestId: request.id, ipAddress: request.ip, userAgent: request.header("user-agent") },
    );
  }

  @Patch("codes/:id/status")
  updateStatus(
    @CurrentUser() user: AuthPrincipal,
    @Param("id") id: string,
    @Body() input: UpdateQrStatusDto,
    @Req() request: RequestWithId,
  ) {
    return this.qr.updateStatus(
      user,
      id,
      input,
      { requestId: request.id, ipAddress: request.ip, userAgent: request.header("user-agent") },
    );
  }

  @Post("codes/:id/regenerate")
  regenerate(@CurrentUser() user: AuthPrincipal, @Param("id") id: string, @Req() request: RequestWithId) {
    return this.qr.regenerate(
      user,
      id,
      { requestId: request.id, ipAddress: request.ip, userAgent: request.header("user-agent") },
    );
  }
}
