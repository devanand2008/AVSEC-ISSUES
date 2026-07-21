import { Body, Controller, DefaultValuePipe, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import type { AuthPrincipal, RequestWithId } from "../../common/http/request-context";
import { AssignUserRoleDto, CreateMaintenanceStaffDto, CreateRoleDto, CreateUserDto, RemoveUserRoleDto, ResetUserPasswordDto, UpdateRoleDto, UpdateUserAccessDto, UpdateUserStatusDto } from "./dto/user.dto";
import { UsersService } from "./users.service";

@ApiTags("users")
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Permissions("users.read") @Get("users") list(@CurrentUser() user: AuthPrincipal, @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number, @Query("pageSize", new DefaultValuePipe(20), ParseIntPipe) pageSize: number, @Query("search") search?: string, @Query("role") role?: string, @Query("status") status?: string, @Query("firstLogin") firstLogin?: string) { return this.users.list(user, Math.max(1, page), Math.min(100, Math.max(1, pageSize)), search, { role, status, firstLogin }); }
  @Permissions("users.create") @Post("users") create(@CurrentUser() user: AuthPrincipal, @Body() input: CreateUserDto, @Req() request: RequestWithId) { return this.users.create(user, input, request.id); }
  @Permissions("users.suspend") @Patch("users/:publicId/status") status(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body() input: UpdateUserStatusDto, @Req() request: RequestWithId) { return this.users.status(user, publicId, input, request.id); }
  @Permissions("users.reset_password") @Post("users/:publicId/reset-password") resetPassword(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body() input: ResetUserPasswordDto, @Req() request: RequestWithId) { return this.users.resetPassword(user, publicId, input, request.id); }
  @Permissions("roles.manage", "scopes.manage") @Patch("users/:publicId/access") access(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body() input: UpdateUserAccessDto, @Req() request: RequestWithId) { return this.users.updateAccess(user, publicId, input, request.id); }
  @Permissions("roles.manage") @Post("users/:publicId/roles") addRole(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body() input: AssignUserRoleDto, @Req() request: RequestWithId) { return this.users.addRole(user, publicId, input, request.id); }
  @Permissions("roles.manage") @Delete("users/:publicId/roles/:roleId") removeRole(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Param("roleId") roleId: string, @Body() input: RemoveUserRoleDto, @Req() request: RequestWithId) { return this.users.removeRole(user, publicId, roleId, input, request.id); }
  @Permissions("roles.read") @Get("users/:publicId/role-history") roleHistory(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string) { return this.users.roleHistory(user, publicId); }
  @Permissions("users.create") @Post("maintenance-staff") createMaintenanceStaff(@CurrentUser() user: AuthPrincipal, @Body() input: CreateMaintenanceStaffDto, @Req() request: RequestWithId) { return this.users.createMaintenanceStaff(user, input, request.id); }
  @Permissions("users.read") @Get("maintenance-staff") maintenanceStaff(@CurrentUser() user: AuthPrincipal) { return this.users.maintenanceStaff(user); }
  @Permissions("roles.read") @Get("roles") roles(@CurrentUser() user: AuthPrincipal) { return this.users.roles(user); }
  @Permissions("roles.manage") @Post("roles") createRole(@CurrentUser() user: AuthPrincipal, @Body() input: CreateRoleDto, @Req() request: RequestWithId) { return this.users.createRole(user, input, request.id); }
  @Permissions("roles.manage") @Patch("roles/:code") updateRole(@CurrentUser() user: AuthPrincipal, @Param("code") code: string, @Body() input: UpdateRoleDto, @Req() request: RequestWithId) { return this.users.updateRole(user, code, input, request.id); }
  @Permissions("permissions.read") @Get("permissions") permissions() { return this.users.permissions(); }
  @Permissions("scopes.manage") @Get("users/scope-options") scopeOptions(@CurrentUser() user: AuthPrincipal) { return this.users.scopeOptions(user); }
}
