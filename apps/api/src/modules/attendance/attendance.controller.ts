import { Body, Controller, DefaultValuePipe, Get, Header, Headers, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Req, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import type { AuthPrincipal, RequestWithId } from "../../common/http/request-context";
import { ReportsService } from "../reports/reports.service";
import { AttendanceImportService } from "./attendance-import.service";
import { AttendanceService } from "./attendance.service";
import { AttendanceImportUploadDto, AttendanceTemplateQueryDto, ConfirmAttendanceImportDto } from "./dto/attendance-import.dto";
import { AddClassStudentDto, CreateAttendanceSessionDto, RequestCorrectionDto, ReviewCorrectionDto, SubmitAttendanceDto } from "./dto/attendance.dto";

@ApiTags("attendance")
@Controller("attendance")
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly reports: ReportsService,
    private readonly attendanceImport: AttendanceImportService,
  ) {}
  @Permissions("attendance.session.create") @Post("sessions") create(@CurrentUser() user: AuthPrincipal, @Body() input: CreateAttendanceSessionDto) { return this.attendance.createSession(user, input); }
  @Get("sessions") list(@CurrentUser() user: AuthPrincipal, @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number, @Query("pageSize", new DefaultValuePipe(20), ParseIntPipe) pageSize: number) { return this.attendance.list(user, Math.max(1, page), Math.min(100, Math.max(1, pageSize))); }
  @Get("sessions/:id/roster") roster(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.attendance.roster(user, id); }
  @Permissions("attendance.read_class") @Get("classes/:sectionId/students") classStudents(@CurrentUser() user: AuthPrincipal, @Param("sectionId", ParseUUIDPipe) sectionId: string) { return this.attendance.classStudents(user, sectionId); }
  @Permissions("users.create") @Post("classes/:sectionId/students") addClassStudent(@CurrentUser() user: AuthPrincipal, @Param("sectionId", ParseUUIDPipe) sectionId: string, @Body() input: AddClassStudentDto, @Req() request: RequestWithId) { return this.attendance.addClassStudent(user, sectionId, input, request.id); }
  @Permissions("attendance.mark") @Put("sessions/:id/draft") draft(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: SubmitAttendanceDto, @Req() request: RequestWithId) { return this.attendance.saveDraft(user, id, input, request.id); }
  @Permissions("attendance.submit") @Post("sessions/:id/submit") submit(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: SubmitAttendanceDto, @Headers("idempotency-key") key: string, @Req() request: RequestWithId) { return this.attendance.submit(user, id, input, key, request.id); }
  @Permissions("attendance.correction.request") @Post("sessions/:id/corrections") correction(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: RequestCorrectionDto) { return this.attendance.requestCorrection(user, id, input); }
  @Permissions("attendance.correction.approve") @Post("corrections/:id/approve") approve(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: ReviewCorrectionDto, @Req() request: RequestWithId) { return this.attendance.reviewCorrection(user, id, true, input, request.id); }
  @Permissions("attendance.correction.approve") @Post("corrections/:id/reject") reject(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: ReviewCorrectionDto, @Req() request: RequestWithId) { return this.attendance.reviewCorrection(user, id, false, input, request.id); }
  @Permissions("attendance.correction.approve") @Get("corrections") corrections(@CurrentUser() user: AuthPrincipal, @Query("status") status?: "PENDING" | "APPROVED" | "REJECTED") { return this.attendance.corrections(user, status); }
  @Get("staff-summary") staffSummary(@CurrentUser() user: AuthPrincipal, @Query("departmentId") departmentId?: string, @Query("staffId") staffId?: string, @Query("from") from?: string, @Query("to") to?: string) { return this.attendance.staffSummary(user, { departmentId, staffId, from, to }); }
  @Get("staff/:staffId") staffDetail(@CurrentUser() user: AuthPrincipal, @Param("staffId") staffId: string, @Query("from") from?: string, @Query("to") to?: string) { return this.attendance.staffDetail(user, staffId, { from, to }); }
  @Get("class-summary") classSummary(@CurrentUser() user: AuthPrincipal, @Query("departmentId") departmentId?: string, @Query("sectionId") sectionId?: string, @Query("subjectId") subjectId?: string, @Query("from") from?: string, @Query("to") to?: string) { return this.attendance.classSummary(user, { departmentId, sectionId, subjectId, from, to }); }
  @Get("class/:classId/students") classStudentAnalytics(@CurrentUser() user: AuthPrincipal, @Param("classId", ParseUUIDPipe) classId: string, @Query("subjectId") subjectId?: string, @Query("from") from?: string, @Query("to") to?: string) { return this.attendance.classStudentAnalytics(user, classId, { subjectId, from, to }); }
  @Get("low-attendance") lowAttendance(@CurrentUser() user: AuthPrincipal, @Query("departmentId") departmentId?: string, @Query("sectionId") sectionId?: string, @Query("subjectId") subjectId?: string, @Query("below") below?: string, @Query("notified") notified?: string) { return this.attendance.lowAttendance(user, { departmentId, sectionId, subjectId, below, notified }); }
  @Get("student/:studentId") studentAnalytics(@CurrentUser() user: AuthPrincipal, @Param("studentId") studentId: string) { return this.attendance.studentAnalytics(user, studentId); }
  @Permissions("attendance.export") @Get("export") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=attendance.csv") async export(@CurrentUser() user: AuthPrincipal, @Req() request: RequestWithId) { return new StreamableFile(await this.reports.attendanceCsv(user, request.id)); }
  @Permissions("attendance.export") @Get("templates/class") async template(@CurrentUser() user: AuthPrincipal, @Query() input: AttendanceTemplateQueryDto) {
    const workbook = await this.attendanceImport.template(user, input);
    return new StreamableFile(workbook.content, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: `attachment; filename="${workbook.fileName}"`,
      length: workbook.content.length,
    });
  }
  @Permissions("attendance.import") @Post("import/upload") @ApiConsumes("multipart/form-data") @UseInterceptors(FileInterceptor("file", { limits: { files: 1, fileSize: 10 * 1024 * 1024 } }))
  uploadAttendance(@CurrentUser() user: AuthPrincipal, @Body() input: AttendanceImportUploadDto, @UploadedFile() file: Express.Multer.File | undefined, @Req() request: RequestWithId) {
    return this.attendanceImport.validate(user, input, file, request.id);
  }
  @Permissions("attendance.import") @Post("import/validate") @ApiConsumes("multipart/form-data") @UseInterceptors(FileInterceptor("file", { limits: { files: 1, fileSize: 10 * 1024 * 1024 } }))
  validateAttendance(@CurrentUser() user: AuthPrincipal, @Body() input: AttendanceImportUploadDto, @UploadedFile() file: Express.Multer.File | undefined, @Req() request: RequestWithId) {
    return this.attendanceImport.validate(user, input, file, request.id);
  }
  @Permissions("attendance.import") @Post("import/confirm")
  confirmAttendance(@CurrentUser() user: AuthPrincipal, @Body() input: ConfirmAttendanceImportDto, @Req() request: RequestWithId) {
    return this.attendanceImport.confirm(user, input.batchId, request.id);
  }
  @Permissions("attendance.import") @Post("import/:batchId/confirm")
  confirmAttendanceBatch(@CurrentUser() user: AuthPrincipal, @Param("batchId", ParseUUIDPipe) batchId: string, @Req() request: RequestWithId) {
    return this.attendanceImport.confirm(user, batchId, request.id);
  }
  @Permissions("attendance.import") @Get("import/:batchId")
  attendanceBatch(@CurrentUser() user: AuthPrincipal, @Param("batchId", ParseUUIDPipe) batchId: string) {
    return this.attendanceImport.get(user, batchId);
  }
  @Permissions("attendance.read_own") @Get("students/me") own(@CurrentUser() user: AuthPrincipal) { return this.attendance.ownSummary(user); }
}
