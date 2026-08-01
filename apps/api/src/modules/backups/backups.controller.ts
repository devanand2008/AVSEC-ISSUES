import { Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { BackupsService } from "./backups.service";

@ApiTags("storage-backups")
@Controller("admin/storage/backups")
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Permissions("backups.manage")
  @Get()
  list(@CurrentUser() user: AuthPrincipal) {
    return this.backups.list(user);
  }

  @Permissions("backups.manage")
  @Post()
  createManual(@CurrentUser() user: AuthPrincipal, @CurrentRequestId() requestId: string) {
    return this.backups.createManual(user, requestId);
  }

  @Permissions("backups.manage")
  @Post(":id/restore-test")
  restoreTest(
    @CurrentUser() user: AuthPrincipal,
    @Param("id") id: string,
    @CurrentRequestId() requestId: string,
  ) {
    return this.backups.restoreTest(user, id, requestId);
  }
}
