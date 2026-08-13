import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { AcademicService } from "./academic.service";
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
  CreateProgrammeDto,
  CreateSectionDto,
  UpdateSectionDto,
  ArchiveDepartmentDto,
} from "./dto/academic.dto";

@ApiTags("departments")
@Controller("departments")
export class DepartmentsController {
  constructor(private readonly academic: AcademicService) {}

  @Permissions("academic.manage")
  @Post()
  create(@CurrentUser() user: AuthPrincipal, @Body() input: CreateDepartmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.createDepartment(user, input, requestId);
  }

  @Get()
  list(@CurrentUser() user: AuthPrincipal, @Query("search") search?: string, @Query("status") status?: string, @Query("hod") hod?: string, @Query("degreeTypeId") degreeTypeId?: string) {
    if (user.permissions.includes("academic.manage") && (search || status || hod)) {
      return this.academic.allDepartments(user, { search: search?.trim(), status, hod });
    }
    return this.academic.departments(user, degreeTypeId);
  }

  @Permissions("academic.manage")
  @Get(":id")
  getOne(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.academic.department(user, id);
  }

  @Permissions("academic.manage")
  @Patch(":id")
  update(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateDepartmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.updateDepartment(user, id, input, requestId);
  }

  @Permissions("academic.manage")
  @Delete(":id")
  remove(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    return this.academic.deleteDepartment(user, id, requestId);
  }

  @Permissions("academic.manage")
  @Post(":id/archive")
  archive(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: ArchiveDepartmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.archiveDepartment(user, id, input?.reason, requestId);
  }

  @Permissions("academic.manage")
  @Post(":id/restore")
  restore(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    return this.academic.restoreDepartment(user, id, requestId);
  }

  @Permissions("academic.manage")
  @Get(":id/dependencies")
  dependencies(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.academic.departmentDependencies(user, id);
  }
}

@ApiTags("programmes")
@Controller("programmes")
export class ProgrammesController {
  constructor(private readonly academic: AcademicService) {}

  @Permissions("academic.manage")
  @Post()
  create(@CurrentUser() user: AuthPrincipal, @Body() input: CreateProgrammeDto, @CurrentRequestId() requestId: string) {
    return this.academic.createProgramme(user, input, requestId);
  }

  @Get()
  list(@CurrentUser() user: AuthPrincipal, @Query("departmentId") departmentId?: string, @Query("degreeTypeId") degreeTypeId?: string) {
    return this.academic.programmes(user, departmentId, degreeTypeId);
  }
}

@ApiTags("sections")
@Controller("sections")
export class SectionsController {
  constructor(private readonly academic: AcademicService) {}

  @Permissions("academic.manage")
  @Post()
  create(@CurrentUser() user: AuthPrincipal, @Body() input: CreateSectionDto, @CurrentRequestId() requestId: string) {
    return this.academic.createSection(user, input, requestId);
  }

  @Get()
  list(@CurrentUser() user: AuthPrincipal, @Query("semesterId") semesterId?: string) {
    return this.academic.sections(user, { semesterId });
  }

  @Permissions("academic.manage")
  @Get(":id")
  getOne(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.academic.section(user, id);
  }

  @Permissions("academic.manage")
  @Patch(":id")
  update(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateSectionDto, @CurrentRequestId() requestId: string) {
    return this.academic.updateSection(user, id, input, requestId);
  }

  @Permissions("academic.manage")
  @Get(":id/dependencies")
  dependencies(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.academic.sectionDependencies(user, id);
  }

  @Permissions("academic.manage")
  @Post(":id/archive")
  archive(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: ArchiveDepartmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.archiveSection(user, id, input.reason, requestId);
  }

  @Permissions("academic.manage")
  @Post(":id/restore")
  restore(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    return this.academic.restoreSection(user, id, requestId);
  }

  @Permissions("academic.manage")
  @Delete(":id")
  remove(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    return this.academic.deleteSection(user, id, requestId);
  }
}
