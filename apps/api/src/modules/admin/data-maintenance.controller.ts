import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { DataMaintenanceService } from "./data-maintenance.service";
import { DataMaintenanceBackupDto, DataMaintenanceDryRunDto, ExecuteDataMaintenanceDto } from "./dto/admin.dto";

@ApiTags("data-maintenance")
@Controller("admin/data-maintenance")
export class DataMaintenanceController {
  constructor(private readonly maintenance: DataMaintenanceService) {}

  @Permissions("data.maintenance")
  @Get("categories")
  categories() {
    return this.maintenance.categories();
  }

  @Permissions("data.maintenance")
  @Post("dry-run")
  dryRun(@CurrentUser() user: AuthPrincipal, @Body() input: DataMaintenanceDryRunDto, @CurrentRequestId() requestId: string) {
    return this.maintenance.dryRun(user, input, requestId);
  }

  @Permissions("data.maintenance")
  @Post(":id/backup")
  backup(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: DataMaintenanceBackupDto, @CurrentRequestId() requestId: string) {
    return this.maintenance.registerBackup(user, id, input.backupReference, requestId);
  }

  @Permissions("data.maintenance")
  @Post(":id/execute")
  execute(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: ExecuteDataMaintenanceDto, @CurrentRequestId() requestId: string) {
    return this.maintenance.execute(user, id, input, requestId);
  }

  @Permissions("data.maintenance")
  @Get("history")
  history(@CurrentUser() user: AuthPrincipal) {
    return this.maintenance.history(user);
  }

  @Permissions("data.maintenance")
  @Get(":id")
  get(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.maintenance.get(user, id);
  }
}
