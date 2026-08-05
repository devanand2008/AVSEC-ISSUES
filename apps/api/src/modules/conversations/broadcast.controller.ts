import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { BroadcastService } from "./broadcast.service";
import { CreateBroadcastDto } from "./dto/broadcast.dto";

@ApiTags("broadcasts")
@Controller()
export class BroadcastController {
  constructor(private readonly broadcasts: BroadcastService) {}

  @Permissions("broadcasts.create")
  @Get("broadcasts")
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.broadcasts.list(user, page ? Number(page) : 1, pageSize ? Number(pageSize) : 20);
  }

  @Permissions("broadcasts.create")
  @Get("broadcast/recipients")
  recipients(
    @CurrentUser() user: AuthPrincipal,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("search") search?: string,
    @Query("role") role?: string,
    @Query("departmentId") departmentId?: string,
    @Query("sectionId") sectionId?: string,
    @Query("programmeId") programmeId?: string,
    @Query("academicYearId") academicYearId?: string,
    @Query("semesterId") semesterId?: string,
  ) { return this.broadcasts.recipients(user, { page: page ? Number(page) : 1, pageSize: pageSize ? Number(pageSize) : 20, search, role, departmentId, sectionId, programmeId, academicYearId, semesterId }); }

  @Permissions("broadcasts.create")
  @Get("broadcasts/:id")
  getOne(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.broadcasts.getOne(user, id);
  }

  @Permissions("broadcasts.create")
  @Post("broadcasts")
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: CreateBroadcastDto,
    @CurrentRequestId() requestId: string,
  ) {
    return this.broadcasts.create(user, body, requestId);
  }

  @Permissions("broadcasts.send")
  @Post("broadcasts/:id/send")
  send(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentRequestId() requestId: string,
  ) {
    return this.broadcasts.send(user, id, requestId);
  }

  @Permissions("broadcasts.create")
  @Post("broadcasts/:id/cancel")
  cancel(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentRequestId() requestId: string,
  ) {
    return this.broadcasts.cancel(user, id, requestId);
  }
}
