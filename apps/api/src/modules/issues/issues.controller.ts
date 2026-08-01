import { Body, Controller, DefaultValuePipe, Get, Headers, Param, ParseBoolPipe, ParseEnumPipe, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import type { AuthPrincipal, RequestWithId } from "../../common/http/request-context";
import { IssueStatus } from "../../generated/prisma/enums";
import { AssignIssueDto, CreateIssueCategoryDto, CreateIssueDto, CreateIssueTypeDto, FinishIssueDto, IssueCommentDto, IssueStatusDto, IssueTimelineDto, SubscribeIssueDto, UpdateIssueCategoryDto, UpdateIssueTypeDto, VerifyIssueDto } from "./dto/issue.dto";
import { IssuesService } from "./issues.service";

@ApiTags("issues")
@Controller()
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Permissions("issues.create")
  @Post("issues")
  create(@CurrentUser() user: AuthPrincipal, @Body() input: CreateIssueDto, @Headers("idempotency-key") key: string, @Req() request: RequestWithId) { return this.issues.create(user, input, key, this.metadata(request)); }

  @Get("issues")
  list(@CurrentUser() user: AuthPrincipal, @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number, @Query("pageSize", new DefaultValuePipe(20), ParseIntPipe) pageSize: number, @Query("status", new ParseEnumPipe(IssueStatus, { optional: true })) status?: IssueStatus, @Query("search") search?: string, @Query("assigned", new ParseBoolPipe({ optional: true })) assigned?: boolean) { return this.issues.list(user, Math.max(1, page), Math.min(100, Math.max(1, pageSize)), { status, search, assigned }); }
  @Permissions("issues.assign") @Get("issues/assignment-options") assignmentOptions(@CurrentUser() user: AuthPrincipal) { return this.issues.assignmentOptions(user); }
  @Get("issues/:id") detail(@CurrentUser() user: AuthPrincipal, @Param("id") id: string) { return this.issues.detail(user, id); }
  @Permissions("issues.assign")
  @Post("issues/:id/assign") assign(@CurrentUser() user: AuthPrincipal, @Param("id") id: string, @Body() input: AssignIssueDto, @Req() request: RequestWithId) { return this.issues.assign(user, id, input, this.metadata(request)); }
  @Post("issues/:id/status") status(@CurrentUser() user: AuthPrincipal, @Param("id") id: string, @Body() input: IssueStatusDto, @Req() request: RequestWithId) { return this.issues.status(user, id, input, this.metadata(request)); }
  @Permissions("issues.acknowledge") @Post("issues/:id/acknowledge") acknowledge(@CurrentUser() user: AuthPrincipal, @Param("id") id: string, @Req() request: RequestWithId) { return this.issues.status(user, id, { status: "ACKNOWLEDGED" }, this.metadata(request)); }
  @Permissions("issues.start") @Post("issues/:id/start") start(@CurrentUser() user: AuthPrincipal, @Param("id") id: string, @Req() request: RequestWithId) { return this.issues.status(user, id, { status: "IN_PROGRESS" }, this.metadata(request)); }
  @Permissions("issues.update_work") @Post("issues/:id/timeline") timeline(@CurrentUser() user: AuthPrincipal, @Param("id") id: string, @Body() input: IssueTimelineDto) { return this.issues.addTimeline(user, id, input); }
  @Permissions("issues.resolve") @Post("issues/:id/finish") finish(@CurrentUser() user: AuthPrincipal, @Param("id") id: string, @Body() input: FinishIssueDto, @Req() request: RequestWithId) { return this.issues.finish(user, id, input, this.metadata(request)); }
  @Permissions("issues.resolve") @Post("issues/:id/resolve") resolve(@CurrentUser() user: AuthPrincipal, @Param("id") id: string, @Body() input: FinishIssueDto, @Req() request: RequestWithId) { return this.issues.finish(user, id, input, this.metadata(request)); }
  @Post("issues/:id/verify") verify(@CurrentUser() user: AuthPrincipal, @Param("id") id: string, @Body() input: VerifyIssueDto, @Req() request: RequestWithId) { return this.issues.verify(user, id, input, this.metadata(request)); }
  @Post("issues/:id/reopen") reopen(@CurrentUser() user: AuthPrincipal, @Param("id") id: string, @Body() input: IssueCommentDto, @Req() request: RequestWithId) { return this.issues.status(user, id, { status: "REOPENED", comment: input.body }, this.metadata(request)); }
  @Post("issues/:id/comments") comment(@CurrentUser() user: AuthPrincipal, @Param("id") id: string, @Body() input: IssueCommentDto) { return this.issues.comment(user, id, input); }
  @Permissions("issues.update_work") @Post("issues/:id/progress") progress(@CurrentUser() user: AuthPrincipal, @Param("id") id: string, @Body() input: IssueCommentDto) { return this.issues.comment(user, id, { ...input, isInternal: false }); }
  @Permissions("issues.subscribe") @Post("issues/:id/subscribe") subscribe(@CurrentUser() user: AuthPrincipal, @Param("id") id: string, @Body() input?: SubscribeIssueDto) { return this.issues.subscribe(user, id, input?.duplicateSubscriptionProof); }
  @Get("issues/:id/history") async history(@CurrentUser() user: AuthPrincipal, @Param("id") id: string) { return (await this.issues.detail(user, id)).statusHistory; }

  /* ─── Public category/type reads (active only) ─── */

  @Get("issue-categories") categories(@CurrentUser() user: AuthPrincipal) { return this.issues.categories(user); }
  @Get("issue-types") issueTypes(@CurrentUser() user: AuthPrincipal, @Query("categoryId", ParseUUIDPipe) categoryId: string) { return this.issues.issueTypes(user, categoryId); }

  /* ─── Admin category/type management ─── */

  @Permissions("issue_config.manage") @Get("issue-categories/admin") adminCategories(@CurrentUser() user: AuthPrincipal) { return this.issues.adminCategories(user); }
  @Permissions("issue_config.manage") @Get("issue-types/admin") adminIssueTypes(@CurrentUser() user: AuthPrincipal, @Query("categoryId") categoryId?: string) { return this.issues.adminIssueTypes(user, categoryId); }
  @Permissions("issue_config.manage") @Post(["issue-categories", "admin/issue-categories"]) createCategory(@CurrentUser() user: AuthPrincipal, @Body() input: CreateIssueCategoryDto) { return this.issues.createCategory(user, input); }
  @Permissions("issue_config.manage") @Patch(["issue-categories/:id", "admin/issue-categories/:id"]) updateCategory(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateIssueCategoryDto) { return this.issues.updateCategory(user, id, input); }
  @Permissions("issue_config.manage") @Post(["issue-categories/:id/archive", "admin/issue-categories/:id/archive"]) archiveCategory(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.issues.updateCategory(user, id, { isActive: false }); }
  @Permissions("issue_config.manage") @Post("issue-types") createIssueType(@CurrentUser() user: AuthPrincipal, @Body() input: CreateIssueTypeDto) { return this.issues.createIssueType(user, input); }
  @Permissions("issue_config.manage") @Patch("issue-types/:id") updateIssueType(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateIssueTypeDto) { return this.issues.updateIssueType(user, id, input); }

  private metadata(request: RequestWithId) { return { requestId: request.id, ipAddress: request.ip, userAgent: request.header("user-agent") }; }
}
