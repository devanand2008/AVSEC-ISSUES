import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import type { AuthPrincipal, RequestWithId } from "../../common/http/request-context";
import { FeedbackDashboardQueryDto, FeedbackHistoryQueryDto, FeedbackSubmissionQueryDto, FeedbackTargetQueryDto, SubmitFeedbackDto } from "./dto/feedback.dto";
import { FeedbackService } from "./feedback.service";

@ApiTags("feedback")
@Controller("feedback")
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get("scan/:token")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  scan(@CurrentUser() user: AuthPrincipal, @Param("token") token: string, @Req() request: RequestWithId) {
    return this.feedback.scan(user, token, { ip: request.ip, userAgent: request.headers["user-agent"] });
  }

  @Post("submit")
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  submit(@CurrentUser() user: AuthPrincipal, @Body() input: SubmitFeedbackDto, @CurrentRequestId() requestId: string, @Req() request: RequestWithId) {
    return this.feedback.submit(user, input, requestId, { ip: request.ip, userAgent: request.headers["user-agent"] });
  }

  @Get("my-history")
  history(
    @CurrentUser() user: AuthPrincipal,
    @Query() query: FeedbackHistoryQueryDto,
  ) {
    return this.feedback.myHistory(user, query.page, query.pageSize);
  }

  @Get("targets")
  targets(@CurrentUser() user: AuthPrincipal, @Query() query: FeedbackTargetQueryDto) {
    return this.feedback.targets(user, query);
  }

  @Get("targets/:id")
  target(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.feedback.target(user, id);
  }

  @Get("dashboard")
  dashboard(@CurrentUser() user: AuthPrincipal, @Query() query: FeedbackDashboardQueryDto) {
    return this.feedback.dashboard(user, query);
  }

  @Get("staff/:staffId/analytics")
  staff(@CurrentUser() user: AuthPrincipal, @Param("staffId") staffId: string) {
    return this.feedback.staffAnalytics(user, staffId);
  }

  @Get("department/:departmentId/analytics")
  department(@CurrentUser() user: AuthPrincipal, @Param("departmentId", ParseUUIDPipe) departmentId: string) {
    return this.feedback.departmentAnalytics(user, departmentId);
  }

  @Get("location/:targetId/analytics")
  location(@CurrentUser() user: AuthPrincipal, @Param("targetId", ParseUUIDPipe) targetId: string) {
    return this.feedback.locationAnalytics(user, targetId);
  }

  @Get("submissions")
  submissions(
    @CurrentUser() user: AuthPrincipal,
    @Query() query: FeedbackSubmissionQueryDto,
  ) {
    return this.feedback.listSubmissions(user, query);
  }
}
