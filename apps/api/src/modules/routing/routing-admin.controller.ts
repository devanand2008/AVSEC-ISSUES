import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { CreateRoutingRuleDto, CreateTeamDto, UpsertSlaDto } from "./dto/routing.dto";
import { RoutingAdminService } from "./routing-admin.service";

@ApiTags("routing")
@Controller()
export class RoutingAdminController {
  constructor(private readonly routing: RoutingAdminService) {}
  @Permissions("routing.manage") @Get("responsible-teams") teams(@CurrentUser() user: AuthPrincipal) { return this.routing.teams(user); }
  @Permissions("routing.manage") @Post("responsible-teams") createTeam(@CurrentUser() user: AuthPrincipal, @Body() input: CreateTeamDto) { return this.routing.createTeam(user, input); }
  @Permissions("routing.manage") @Get("assignment-rules") rules(@CurrentUser() user: AuthPrincipal) { return this.routing.rules(user); }
  @Permissions("routing.manage") @Post("assignment-rules") createRule(@CurrentUser() user: AuthPrincipal, @Body() input: CreateRoutingRuleDto) { return this.routing.createRule(user, input); }
  @Permissions("sla.manage") @Get("settings/sla") slas(@CurrentUser() user: AuthPrincipal) { return this.routing.slas(user); }
  @Permissions("sla.manage") @Post("settings/sla") sla(@CurrentUser() user: AuthPrincipal, @Body() input: UpsertSlaDto) { return this.routing.upsertSla(user, input); }
}
