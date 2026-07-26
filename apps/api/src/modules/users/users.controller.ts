import { Body, Controller, DefaultValuePipe, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import type { AuthPrincipal, RequestWithId } from "../../common/http/request-context";
import { AccountStatus } from "../../generated/prisma/enums";
import { ArchiveUserDto, AssignUserRoleDto, CreateMaintenanceStaffDto, CreateRoleDto, CreateUserDto, DeleteUserDto, RemoveUserRoleDto, ResetUserPasswordDto, UpdateRoleDto, UpdateUserAccessDto, UpdateUserStatusDto } from "./dto/user.dto";
import { UsersService } from "./users.service";

@ApiTags("users")
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get(["users/me/profile-requirements", "students/me/profile-requirements"]) profileRequirements(@CurrentUser() user: AuthPrincipal) { return this.users.profileRequirements(user); }
  @Get(["users/me/profile", "students/me/profile"]) myProfile(@CurrentUser() user: AuthPrincipal) { return this.users.myProfile(user); }
  @Patch(["users/me/profile", "students/me/profile"]) saveMyProfile(@CurrentUser() user: AuthPrincipal, @Body() input: Record<string, unknown>, @Req() request: RequestWithId) { return this.users.saveMyProfileDraft(user, input, request.id); }
  @Post(["users/me/profile/submit", "students/me/profile/submit"]) submitMyProfile(@CurrentUser() user: AuthPrincipal, @Body() input: Record<string, unknown>, @Req() request: RequestWithId) { return this.users.submitMyProfile(user, input, request.id); }
  @Permissions("users.read") @Get("users") list(@CurrentUser() user: AuthPrincipal, @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number, @Query("pageSize", new DefaultValuePipe(20), ParseIntPipe) pageSize: number, @Query("search") search?: string, @Query("role") role?: string, @Query("status") status?: string, @Query("firstLogin") firstLogin?: string, @Query("profileStatus") profileStatus?: string, @Query("departmentId") departmentId?: string) { return this.users.list(user, Math.max(1, page), Math.min(100, Math.max(1, pageSize)), search, { role, status, firstLogin, profileStatus, departmentId }); }
  @Permissions("users.read") @Get(["admin/users", "admin/students", "admin/profile-submissions", "admin/people"]) adminList(
    @CurrentUser() user: AuthPrincipal,
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("pageSize", new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Query("search") search?: string,
    @Query("role") role?: string,
    @Query("status") status?: string,
    @Query("firstLogin") firstLogin?: string,
    @Query("profileStatus") profileStatus?: string,
    @Query("departmentId") departmentId?: string,
    @Query("programmeId") programmeId?: string,
    @Query("academicYearId") academicYearId?: string,
    @Query("studyYear") studyYear?: string,
    @Query("semesterId") semesterId?: string,
    @Query("sectionId") sectionId?: string,
    @Query("campusId") campusId?: string,
    @Query("blockId") blockId?: string,
    @Query("floorId") floorId?: string,
    @Query("roomId") roomId?: string,
    @Query("archived") archived?: string,
    @Query("lastLogin") lastLogin?: string,
    @Query("importBatchId") importBatchId?: string,
  ) {
    return this.users.list(user, Math.max(1, page), Math.min(100, Math.max(1, pageSize)), search, {
      role, status, firstLogin, profileStatus, departmentId, programmeId, academicYearId, studyYear, semesterId, sectionId,
      campusId, blockId, floorId, roomId, archived, lastLogin, importBatchId,
    });
  }
  @Permissions("users.create") @Post("users") create(@CurrentUser() user: AuthPrincipal, @Body() input: CreateUserDto, @Req() request: RequestWithId) { return this.users.create(user, input, request.id); }
  @Permissions("users.create") @Post("admin/users") adminCreate(@CurrentUser() user: AuthPrincipal, @Body() input: CreateUserDto, @Req() request: RequestWithId) { return this.users.create(user, input, request.id); }
  @Permissions("users.read") @Get(["admin/users/:publicId", "admin/students/:publicId", "admin/people/:publicId"]) adminDetail(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string) { return this.users.detail(user, publicId); }
  @Permissions("users.create") @Patch(["admin/users/:publicId", "admin/students/:publicId", "admin/people/:publicId"]) adminUpdate(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body() input: Record<string, unknown>, @Req() request: RequestWithId) { return this.users.updateBasic(user, publicId, input, request.id); }
  @Permissions("users.suspend") @Patch("users/:publicId/status") status(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body() input: UpdateUserStatusDto, @Req() request: RequestWithId) { return this.users.status(user, publicId, input, request.id); }
  @Permissions("users.suspend") @Post(["admin/users/:publicId/suspend", "admin/students/:publicId/suspend"]) adminSuspend(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body() input: Partial<UpdateUserStatusDto>, @Req() request: RequestWithId) { return this.users.status(user, publicId, { status: AccountStatus.SUSPENDED, reason: input.reason || "Suspended by admin" }, request.id); }
  @Permissions("users.suspend") @Post(["admin/users/:publicId/activate", "admin/students/:publicId/activate"]) adminActivate(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body() input: Partial<UpdateUserStatusDto>, @Req() request: RequestWithId) { return this.users.status(user, publicId, { status: AccountStatus.ACTIVE, reason: input.reason || "Activated by admin" }, request.id); }
  @Permissions("users.suspend") @Post(["admin/users/:publicId/archive", "admin/students/:publicId/archive"]) adminArchive(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body() input: Partial<UpdateUserStatusDto>, @Req() request: RequestWithId) { return this.users.status(user, publicId, { status: AccountStatus.ARCHIVED, reason: input.reason || "Archived by admin" }, request.id); }
  @Permissions("users.suspend") @Post("admin/people/:publicId/archive") archivePerson(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body() input: ArchiveUserDto, @Req() request: RequestWithId) { return this.users.status(user, publicId, { status: AccountStatus.ARCHIVED, reason: input.reason }, request.id); }
  @Permissions("users.suspend") @Post(["admin/users/:publicId/restore", "admin/people/:publicId/restore"]) restorePerson(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body() input: Partial<ArchiveUserDto>, @Req() request: RequestWithId) { return this.users.status(user, publicId, { status: AccountStatus.ACTIVE, reason: input.reason || "Restored by admin" }, request.id); }
  @Permissions("users.read") @Get(["admin/users/:publicId/dependencies", "admin/people/:publicId/dependencies"]) dependencies(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string) { return this.users.dependencyReport(user, publicId); }
  @Permissions("users.delete_permanent") @Delete(["admin/users/:publicId", "admin/people/:publicId"]) deletePerson(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body() input: DeleteUserDto, @Req() request: RequestWithId) { return this.users.deletePermanently(user, publicId, input, request.id); }
  @Permissions("sessions.revoke_any") @Post(["admin/users/:publicId/revoke-sessions", "admin/people/:publicId/revoke-sessions"]) revokeSessions(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body() input: ArchiveUserDto, @Req() request: RequestWithId) { return this.users.revokeSessions(user, publicId, input.reason, request.id); }
  @Permissions("users.reset_password") @Post("users/:publicId/reset-password") resetPassword(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body() input: ResetUserPasswordDto, @Req() request: RequestWithId) { return this.users.resetPassword(user, publicId, input, request.id); }
  @Permissions("users.reset_password") @Post(["admin/users/:publicId/reset-password", "admin/students/:publicId/reset-password"]) adminResetPassword(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body() input: ResetUserPasswordDto, @Req() request: RequestWithId) { return this.users.resetPassword(user, publicId, input, request.id); }
  @Permissions("users.create") @Post(["admin/users/:publicId/verify-profile", "admin/students/:publicId/verify-profile"]) adminVerifyProfile(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Req() request: RequestWithId) { return this.users.verifyProfile(user, publicId, request.id); }
  @Permissions("users.create") @Post(["admin/users/:publicId/reject-profile", "admin/students/:publicId/reject-profile"]) adminRejectProfile(@CurrentUser() user: AuthPrincipal, @Param("publicId", ParseUUIDPipe) publicId: string, @Body("reason") reason: string, @Req() request: RequestWithId) { return this.users.rejectProfile(user, publicId, reason, request.id); }
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
