import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { AcademicService } from "./academic.service";
import {
  CreateDepartmentDto,
  CreateDegreeTypeDto,
  UpdateDegreeTypeDto,
  UpdateDepartmentDto,
  CreateProgrammeDto,
  UpdateProgrammeDto,
  CreateAcademicYearDto,
  UpdateAcademicYearDto,
  CreateSemesterDto,
  CreateSectionDto,
  CreateSubjectDto,
  CreateFacultySubjectAssignmentDto,
  CreateClassCoordinatorAssignmentDto,
  CreateClassRepresentativeAssignmentDto,
  CreateClassStaffAssignmentDto,
  AssignSectionStudentDto,
  DeactivateAcademicAssignmentDto,
  UpdateEntityStatusDto,
  UpdateSectionDto,
  ArchiveDepartmentDto,
} from "./dto/academic.dto";

@ApiTags("academic")
@Controller("academic")
export class AcademicController {
  constructor(private readonly academic: AcademicService) {}

  /* ─── Active-only reads (existing behavior, all authenticated users) ─── */

  @Get("degree-types")
  degreeTypes(@CurrentUser() user: AuthPrincipal) {
    return this.academic.degreeTypes(user);
  }

  @Get("departments")
  departments(@CurrentUser() user: AuthPrincipal, @Query("degreeTypeId") degreeTypeId?: string) {
    return this.academic.departments(user, degreeTypeId);
  }

  @Get("programmes")
  programmes(@CurrentUser() user: AuthPrincipal, @Query("departmentId") departmentId?: string, @Query("degreeTypeId") degreeTypeId?: string) {
    return this.academic.programmes(user, departmentId, degreeTypeId);
  }

  @Get("years")
  years(@CurrentUser() user: AuthPrincipal) {
    return this.academic.years(user);
  }

  @Get("semesters")
  semesters(@CurrentUser() user: AuthPrincipal, @Query("programmeId") programmeId?: string, @Query("academicYearId") academicYearId?: string, @Query("studyYear") studyYearInput?: string) {
    return this.academic.semesters(user, programmeId, academicYearId, this.studyYear(studyYearInput));
  }

  @Get("sections")
  sections(@CurrentUser() user: AuthPrincipal, @Query("semesterId") semesterId?: string, @Query("programmeId") programmeId?: string, @Query("academicYearId") academicYearId?: string, @Query("studyYear") studyYearInput?: string) {
    return this.academic.sections(user, { semesterId, programmeId, academicYearId, studyYear: this.studyYear(studyYearInput) });
  }

  @Get("subjects")
  subjects(@CurrentUser() user: AuthPrincipal, @Query("semesterId") semesterId?: string) {
    return this.academic.subjects(user, semesterId);
  }

  /* ─── Admin reads (includes inactive, with counts) ─── */

  @Permissions("academic.manage")
  @Get("admin/degree-types")
  adminDegreeTypes(@CurrentUser() user: AuthPrincipal) {
    return this.academic.allDegreeTypes(user);
  }

  @Permissions("academic.manage")
  @Get("admin/departments")
  adminDepartments(@CurrentUser() user: AuthPrincipal, @Query("search") search?: string, @Query("status") status?: string, @Query("hod") hod?: string) {
    return this.academic.allDepartments(user, { search: search?.trim(), status, hod });
  }

  @Permissions("academic.manage")
  @Get("departments/:id")
  department(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.academic.department(user, id);
  }

  @Permissions("academic.manage")
  @Get("admin/programmes")
  adminProgrammes(@CurrentUser() user: AuthPrincipal, @Query("departmentId") departmentId?: string) {
    return this.academic.allProgrammes(user, departmentId);
  }

  @Permissions("academic.manage")
  @Get("admin/years")
  adminYears(@CurrentUser() user: AuthPrincipal) {
    return this.academic.allYears(user);
  }

  @Permissions("academic.manage")
  @Get("admin/semesters")
  adminSemesters(@CurrentUser() user: AuthPrincipal, @Query("programmeId") programmeId?: string, @Query("academicYearId") academicYearId?: string) {
    return this.academic.allSemesters(user, programmeId, academicYearId);
  }

  @Permissions("academic.manage")
  @Get("admin/sections")
  adminSections(@CurrentUser() user: AuthPrincipal, @Query("semesterId") semesterId?: string) {
    return this.academic.allSections(user, semesterId);
  }

  @Permissions("academic.manage")
  @Get("sections/:id")
  section(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.academic.section(user, id);
  }

  @Permissions("academic.manage")
  @Get("admin/subjects")
  adminSubjects(@CurrentUser() user: AuthPrincipal, @Query("semesterId") semesterId?: string) {
    return this.academic.allSubjects(user, semesterId);
  }

  @Permissions("academic.manage")
  @Get("admin/assignments")
  assignments(@CurrentUser() user: AuthPrincipal) {
    return this.academic.assignments(user);
  }

  @Permissions("academic.manage")
  @Get("admin/assignments/options")
  assignmentOptions(@CurrentUser() user: AuthPrincipal) {
    return this.academic.assignmentOptions(user);
  }

  /* ─── Create ─── */

  @Permissions("academic.manage")
  @Post("degree-types")
  createDegreeType(@CurrentUser() user: AuthPrincipal, @Body() input: CreateDegreeTypeDto, @CurrentRequestId() requestId: string) {
    return this.academic.createDegreeType(user, input, requestId);
  }

  @Permissions("academic.manage")
  @Post("departments")
  createDepartment(@CurrentUser() user: AuthPrincipal, @Body() input: CreateDepartmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.createDepartment(user, input, requestId);
  }

  @Permissions("academic.manage")
  @Post("programmes")
  createProgramme(@CurrentUser() user: AuthPrincipal, @Body() input: CreateProgrammeDto, @CurrentRequestId() requestId: string) {
    return this.academic.createProgramme(user, input, requestId);
  }

  @Permissions("academic.manage")
  @Post("years")
  createAcademicYear(@CurrentUser() user: AuthPrincipal, @Body() input: CreateAcademicYearDto, @CurrentRequestId() requestId: string) {
    return this.academic.createAcademicYear(user, input, requestId);
  }

  @Permissions("academic.manage")
  @Post("semesters")
  createSemester(@CurrentUser() user: AuthPrincipal, @Body() input: CreateSemesterDto, @CurrentRequestId() requestId: string) {
    return this.academic.createSemester(user, input, requestId);
  }

  @Permissions("academic.manage")
  @Post("sections")
  createSection(@CurrentUser() user: AuthPrincipal, @Body() input: CreateSectionDto, @CurrentRequestId() requestId: string) {
    return this.academic.createSection(user, input, requestId);
  }

  @Permissions("academic.manage")
  @Post("subjects")
  createSubject(@CurrentUser() user: AuthPrincipal, @Body() input: CreateSubjectDto, @CurrentRequestId() requestId: string) {
    return this.academic.createSubject(user, input, requestId);
  }

  @Permissions("academic.manage")
  @Post("admin/assignments/faculty")
  createFacultyAssignment(@CurrentUser() user: AuthPrincipal, @Body() input: CreateFacultySubjectAssignmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.createFacultyAssignment(user, input, requestId);
  }

  @Permissions("academic.manage")
  @Post("admin/assignments/coordinators")
  createCoordinatorAssignment(@CurrentUser() user: AuthPrincipal, @Body() input: CreateClassCoordinatorAssignmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.createCoordinatorAssignment(user, input, requestId);
  }

  @Permissions("academic.manage")
  @Post("admin/assignments/representatives")
  createRepresentativeAssignment(@CurrentUser() user: AuthPrincipal, @Body() input: CreateClassRepresentativeAssignmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.createRepresentativeAssignment(user, input, requestId);
  }

  @Permissions("academic.manage")
  @Post("admin/assignments/class-staff")
  createClassStaffAssignment(@CurrentUser() user: AuthPrincipal, @Body() input: CreateClassStaffAssignmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.createClassStaffAssignment(user, input, requestId);
  }

  @Permissions("academic.manage")
  @Post("sections/:id/students")
  assignStudent(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: AssignSectionStudentDto, @CurrentRequestId() requestId: string) {
    return this.academic.assignStudent(user, id, input, requestId);
  }

  /* ─── Update ─── */

  @Permissions("academic.manage")
  @Patch("degree-types/:id")
  updateDegreeType(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateDegreeTypeDto, @CurrentRequestId() requestId: string) {
    return this.academic.updateDegreeType(user, id, input, requestId);
  }

  @Permissions("academic.manage")
  @Post("degree-types/:id/archive")
  archiveDegreeType(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: ArchiveDepartmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.archiveDegreeType(user, id, input?.reason, requestId);
  }

  @Permissions("academic.manage")
  @Post("degree-types/:id/restore")
  restoreDegreeType(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    return this.academic.restoreDegreeType(user, id, requestId);
  }

  @Permissions("academic.manage")
  @Patch("departments/:id")
  updateDepartment(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateDepartmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.updateDepartment(user, id, input, requestId);
  }

  @Permissions("academic.manage")
  @Patch("programmes/:id")
  updateProgramme(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateProgrammeDto, @CurrentRequestId() requestId: string) {
    return this.academic.updateProgramme(user, id, input, requestId);
  }

  @Permissions("academic.manage")
  @Post("programmes/:id/archive")
  archiveProgramme(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: ArchiveDepartmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.archiveProgramme(user, id, input?.reason, requestId);
  }

  @Permissions("academic.manage")
  @Post("programmes/:id/restore")
  restoreProgramme(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    return this.academic.restoreProgramme(user, id, requestId);
  }

  @Permissions("academic.manage")
  @Patch("years/:id")
  updateAcademicYear(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateAcademicYearDto, @CurrentRequestId() requestId: string) {
    return this.academic.updateAcademicYear(user, id, input, requestId);
  }

  @Permissions("academic.manage")
  @Post("years/:id/set-current")
  setCurrentAcademicYear(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    return this.academic.setCurrentAcademicYear(user, id, requestId);
  }

  @Permissions("academic.manage")
  @Post("years/:id/archive")
  archiveAcademicYear(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: ArchiveDepartmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.archiveAcademicYear(user, id, input?.reason, requestId);
  }

  @Permissions("academic.manage")
  @Post("years/:id/restore")
  restoreAcademicYear(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    return this.academic.restoreAcademicYear(user, id, requestId);
  }

  @Permissions("academic.manage")
  @Patch("sections/:id")
  updateSection(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateSectionDto, @CurrentRequestId() requestId: string) {
    return this.academic.updateSection(user, id, input, requestId);
  }

  @Permissions("academic.manage")
  @Post("departments/:id/archive")
  archiveDepartment(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: ArchiveDepartmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.archiveDepartment(user, id, input.reason, requestId);
  }

  @Permissions("academic.manage")
  @Get("departments/:id/dependencies")
  departmentDependencies(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.academic.departmentDependencies(user, id);
  }

  @Permissions("academic.manage")
  @Post("departments/:id/restore")
  restoreDepartment(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    return this.academic.restoreDepartment(user, id, requestId);
  }

  @Permissions("academic.manage")
  @Delete("departments/:id")
  deleteDepartment(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    return this.academic.deleteDepartment(user, id, requestId);
  }

  @Permissions("academic.manage")
  @Get("sections/:id/dependencies")
  sectionDependencies(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.academic.sectionDependencies(user, id);
  }

  @Permissions("academic.manage")
  @Post("sections/:id/archive")
  archiveSection(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: ArchiveDepartmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.archiveSection(user, id, input.reason, requestId);
  }

  @Permissions("academic.manage")
  @Post("sections/:id/restore")
  restoreSection(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    return this.academic.restoreSection(user, id, requestId);
  }

  @Permissions("academic.manage")
  @Delete("sections/:id")
  deleteSection(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    return this.academic.deleteSection(user, id, requestId);
  }

  @Permissions("academic.manage")
  @Patch("admin/assignments/faculty/:id/deactivate")
  deactivateFacultyAssignment(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: DeactivateAcademicAssignmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.deactivateFacultyAssignment(user, id, input, requestId);
  }

  @Permissions("academic.manage")
  @Patch("admin/assignments/coordinators/:id/deactivate")
  deactivateCoordinatorAssignment(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: DeactivateAcademicAssignmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.deactivateCoordinatorAssignment(user, id, input, requestId);
  }

  @Permissions("academic.manage")
  @Patch("admin/assignments/representatives/:id/deactivate")
  deactivateRepresentativeAssignment(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: DeactivateAcademicAssignmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.deactivateRepresentativeAssignment(user, id, input, requestId);
  }

  @Permissions("academic.manage")
  @Patch("admin/assignments/class-staff/:id/deactivate")
  deactivateClassStaffAssignment(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: DeactivateAcademicAssignmentDto, @CurrentRequestId() requestId: string) {
    return this.academic.deactivateClassStaffAssignment(user, id, input, requestId);
  }

  @Permissions("academic.manage")
  @Patch(":entityType/:id/status")
  updateStatus(
    @CurrentUser() user: AuthPrincipal,
    @Param("entityType") entityType: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: UpdateEntityStatusDto,
    @CurrentRequestId() requestId: string,
  ) {
    const allowed = ["department", "programme", "semester", "section", "subject", "academicYear"];
    if (!allowed.includes(entityType)) {
      throw new BadRequestException(`Entity type must be one of: ${allowed.join(", ")}`);
    }
    return this.academic.updateEntityStatus(user, entityType, id, input, requestId);
  }

  private studyYear(value?: string): number | undefined {
    if (value === undefined || value.trim() === "") return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
      throw new BadRequestException("Study year must be a whole number from 1 to 4.");
    }
    return parsed;
  }
}
