import { Controller, Get, Header, Query, Req, StreamableFile } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import type { RequestWithId } from "../../common/http/request-context";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { ReportsService } from "./reports.service";

@ApiTags("reports")
@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get("dashboard") dashboard(@CurrentUser() user: AuthPrincipal) { return this.reports.dashboard(user); }
  @Get("analytics/issues") issueTrend(@CurrentUser() user: AuthPrincipal, @Query("days") days?: string) { return this.reports.issueTrend(user, Number(days) || 30); }
  @Get("analytics/sla") slaTrend(@CurrentUser() user: AuthPrincipal, @Query("weeks") weeks?: string) { return this.reports.slaTrend(user, Number(weeks) || 12); }
  @Get("analytics/attendance") attendanceTrend(@CurrentUser() user: AuthPrincipal, @Query("days") days?: string) { return this.reports.attendanceTrend(user, Number(days) || 30); }
  @Permissions("issues.export") @Get("issues/export.csv") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=issues.csv") async issues(@CurrentUser() user: AuthPrincipal, @Req() request: RequestWithId, @Query("status") status?: string) { return new StreamableFile(await this.reports.issuesCsv(user, request.id, status)); }
  @Permissions("attendance.export") @Get("attendance/export.csv") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=attendance.csv") async attendance(@CurrentUser() user: AuthPrincipal, @Req() request: RequestWithId) { return new StreamableFile(await this.reports.attendanceCsv(user, request.id)); }
}

