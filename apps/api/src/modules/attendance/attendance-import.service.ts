import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import { Workbook, type Worksheet } from "exceljs";
import { AuditService } from "../audit/audit.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { Prisma } from "../../generated/prisma/client";
import {
  AcademicMembershipStatus,
  AccountStatus,
  StudentAcademicStatus,
} from "../../generated/prisma/enums";
import type { AttendanceImportUploadDto, AttendanceTemplateQueryDto } from "./dto/attendance-import.dto";

interface ValidatedAttendanceRow {
  rowNumber: number;
  studentUserId: string;
  studentPublicId: string;
  totalWorking: number;
  present: number;
  absent: number;
  percentage: number;
  remarks?: string;
  source: string;
}

interface AttendanceValidationReport {
  rows: ValidatedAttendanceRow[];
  errors: Array<{ rowNumber: number; field?: string; message: string }>;
  warnings: Array<{ rowNumber: number; message: string }>;
}

@Injectable()
export class AttendanceImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async template(user: AuthPrincipal, input: AttendanceTemplateQueryDto) {
    const { section, subject } = await this.requireAccess(user, input.sectionId, input.subjectId);
    const { dateFrom, dateTo } = this.dateRange(input.dateFrom, input.dateTo);
    const students = await this.prisma.studentProfile.findMany({
      where: this.activeRosterWhere(section.id),
      select: {
        userId: true,
        studentId: true,
        registerNumber: true,
        studyYear: true,
        user: { select: { publicId: true, collegeIdentityId: true, fullName: true, email: true } },
        department: { select: { code: true, name: true } },
        programme: { select: { code: true, name: true } },
        section: { select: { code: true, name: true, studyYear: true, semester: { select: { number: true, name: true } } } },
      },
      orderBy: [{ registerNumber: "asc" }, { studentId: "asc" }],
    });
    const workbook = new Workbook();
    workbook.creator = "AVS College Management System";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Attendance", { views: [{ state: "frozen", ySplit: 4 }] });
    sheet.mergeCells("A1:O1");
    sheet.getCell("A1").value = `AVS Attendance - ${section.name}${subject ? ` - ${subject.name}` : " - Overall"}`;
    sheet.getCell("A1").font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
    sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3D91" } };
    sheet.getCell("A2").value = "Date range";
    sheet.getCell("B2").value = `${input.dateFrom} to ${input.dateTo}`;
    sheet.getCell("D2").value = "Section";
    sheet.getCell("E2").value = section.code;
    sheet.getCell("G2").value = "Subject";
    sheet.getCell("H2").value = subject?.code ?? "OVERALL";
    const headers = [
      "Student User ID", "College ID", "Register Number", "Student Name", "Official Email",
      "Department", "Programme", "Year", "Semester", "Section",
      "Total Working Days / Hours", "Present Days / Hours", "Absent Days / Hours", "Attendance Percentage", "Remarks",
    ];
    const headerRow = sheet.getRow(4);
    headerRow.values = headers;
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF006B5F" } };
    for (const [index, profile] of students.entries()) {
      const rowNumber = index + 5;
      const row = sheet.getRow(rowNumber);
      row.values = [
        profile.user.publicId,
        profile.user.collegeIdentityId,
        profile.registerNumber ?? "",
        profile.user.fullName,
        profile.user.email ?? "",
        profile.department.code,
        profile.programme.code,
        profile.studyYear ?? profile.section.studyYear ?? "",
        profile.section.semester.number,
        profile.section.code,
        "",
        "",
        { formula: `IF(OR(K${rowNumber}="",L${rowNumber}=""),"",K${rowNumber}-L${rowNumber})`, result: "" },
        { formula: `IFERROR(ROUND(L${rowNumber}/K${rowNumber}*100,2),"")`, result: "" },
        "",
      ];
      for (let column = 1; column <= 15; column += 1) row.getCell(column).protection = { locked: ![11, 12, 14, 15].includes(column) };
      row.getCell(11).dataValidation = { type: "decimal", operator: "greaterThanOrEqual", formulae: [0], allowBlank: true, showErrorMessage: true, error: "Enter zero or a positive number." };
      row.getCell(12).dataValidation = { type: "decimal", operator: "between", formulae: [0, 100000], allowBlank: true, showErrorMessage: true, error: "Present attendance must be zero or more." };
      row.getCell(14).dataValidation = { type: "decimal", operator: "between", formulae: [0, 100], allowBlank: true, showErrorMessage: true, error: "Percentage must be from 0 to 100." };
    }
    sheet.columns.forEach((column, index) => { column.width = [38, 20, 20, 28, 34, 15, 18, 10, 12, 15, 24, 24, 24, 24, 30][index] ?? 18; });
    sheet.autoFilter = { from: "A4", to: "O4" };
    await sheet.protect("AVS Attendance Template", { selectLockedCells: true, selectUnlockedCells: true, formatCells: false, insertRows: false, deleteRows: false });
    const metadata = workbook.addWorksheet("_AVS_METADATA", { state: "veryHidden" });
    metadata.addRows([
      ["schema", "AVS_ATTENDANCE_V1"],
      ["sectionId", section.id],
      ["subjectId", subject?.id ?? ""],
      ["dateFrom", dateFrom.toISOString().slice(0, 10)],
      ["dateTo", dateTo.toISOString().slice(0, 10)],
    ]);
    const content = Buffer.from(await workbook.xlsx.writeBuffer());
    return { content, fileName: `avs-attendance-${section.code}-${input.dateFrom}-${input.dateTo}.xlsx`, students: students.length };
  }

  async validate(user: AuthPrincipal, input: AttendanceImportUploadDto, file: Express.Multer.File | undefined, requestId: string) {
    if (!file?.buffer?.length) throw new BadRequestException("Select a completed attendance workbook.");
    if (![".xlsx", ".xls"].includes(extname(file.originalname).toLowerCase())) throw new BadRequestException("Attendance imports must be .xlsx or .xls workbooks.");
    if (file.buffer.length > 10 * 1024 * 1024) throw new BadRequestException("Attendance workbook exceeds the 10 MB limit.");
    const { section, subject } = await this.requireAccess(user, input.sectionId, input.subjectId);
    const { dateFrom, dateTo } = this.dateRange(input.dateFrom, input.dateTo);
    const sourceSha256 = createHash("sha256").update(file.buffer).digest("hex");
    const duplicate = await this.prisma.attendanceImportBatch.findFirst({
      where: { collegeId: user.collegeId, requestedById: user.id, sectionId: section.id, subjectId: subject?.id ?? null, sourceSha256, status: { in: ["READY", "COMPLETED"] } },
      orderBy: { createdAt: "desc" },
    });
    if (duplicate) return this.batchView(duplicate);
    const workbook = new Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const worksheet = workbook.getWorksheet("Attendance") ?? workbook.worksheets.find((item) => item.state === "visible");
    if (!worksheet) throw new BadRequestException("The workbook does not contain an Attendance worksheet.");
    const report = await this.validateRows(user, worksheet, section.id, input.attendanceMode);
    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.attendanceImportBatch.create({
        data: {
          collegeId: user.collegeId,
          requestedById: user.id,
          sectionId: section.id,
          subjectId: subject?.id,
          importMode: input.importMode,
          attendanceMode: input.attendanceMode,
          dateFrom,
          dateTo,
          sourceSha256,
          status: report.errors.length ? "FAILED" : "READY",
          totalRows: report.rows.length + report.errors.length,
          validRows: report.rows.length,
          errorRows: report.errors.length,
          validationReport: report as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.record({ actorId: user.id, action: "attendance_import.validated", entityType: "AttendanceImportBatch", entityId: created.id, afterValue: { sectionId: section.id, subjectId: subject?.id, totalRows: created.totalRows, validRows: created.validRows, errorRows: created.errorRows, importMode: input.importMode }, requestId }, tx);
      return created;
    });
    return this.batchView(batch);
  }

  async confirm(user: AuthPrincipal, batchId: string, requestId: string) {
    const batch = await this.requireBatch(user, batchId);
    if (batch.status === "COMPLETED") return this.batchView(batch);
    if (batch.status !== "READY" || batch.errorRows > 0) throw new BadRequestException("Resolve validation errors before confirming this attendance import.");
    if (batch.importMode === "VALIDATE_ONLY") throw new BadRequestException("Validate-only batches cannot be imported.");
    const report = batch.validationReport as unknown as AttendanceValidationReport;
    const counts = await this.prisma.$transaction(async (tx) => {
      const result = { created: 0, updated: 0, skipped: 0 };
      for (const row of report.rows) {
        const existing = await tx.attendanceSummary.findFirst({
          where: { studentUserId: row.studentUserId, sectionId: batch.sectionId, subjectId: batch.subjectId, dateFrom: batch.dateFrom, dateTo: batch.dateTo },
        });
        if (existing && batch.importMode === "CREATE_MISSING_SUMMARY") { result.skipped += 1; continue; }
        if (!existing && batch.importMode === "UPDATE_EXISTING_SUMMARY") { result.skipped += 1; continue; }
        const data = {
          collegeId: batch.collegeId,
          studentUserId: row.studentUserId,
          sectionId: batch.sectionId,
          subjectId: batch.subjectId,
          dateFrom: batch.dateFrom,
          dateTo: batch.dateTo,
          totalWorking: row.totalWorking,
          present: row.present,
          absent: row.absent,
          percentage: row.percentage,
          remarks: row.remarks,
          source: row.source,
          importBatchId: batch.id,
        };
        if (existing) {
          await tx.attendanceSummary.update({ where: { id: existing.id }, data });
          result.updated += 1;
        } else {
          await tx.attendanceSummary.create({ data });
          result.created += 1;
        }
      }
      await tx.attendanceImportBatch.update({ where: { id: batch.id }, data: { status: "COMPLETED", confirmedAt: new Date() } });
      await this.audit.record({ actorId: user.id, action: "attendance_import.confirmed", entityType: "AttendanceImportBatch", entityId: batch.id, afterValue: result, requestId }, tx);
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { ...(await this.batchView(await this.requireBatch(user, batch.id))), result: counts };
  }

  async get(user: AuthPrincipal, batchId: string) {
    return this.batchView(await this.requireBatch(user, batchId));
  }

  private async validateRows(user: AuthPrincipal, worksheet: Worksheet, sectionId: string, attendanceMode: string): Promise<AttendanceValidationReport> {
    let headerRow = 0;
    const headerMap = new Map<string, number>();
    for (let rowNumber = 1; rowNumber <= Math.min(10, worksheet.rowCount); rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const current = new Map<string, number>();
      row.eachCell((cell, columnNumber) => current.set(this.header(cell.text), columnNumber));
      if (current.has("student_user_id") && (current.has("total_working_days_hours") || current.has("attendance_percentage"))) {
        headerRow = rowNumber;
        current.forEach((value, key) => headerMap.set(key, value));
        break;
      }
    }
    if (!headerRow) throw new BadRequestException("Attendance header row was not found in the first 10 rows.");
    const roster = await this.prisma.studentProfile.findMany({
      where: this.activeRosterWhere(sectionId),
      select: { userId: true, studentId: true, registerNumber: true, user: { select: { publicId: true, collegeIdentityId: true, normalizedEmail: true } } },
    });
    const identity = new Map<string, typeof roster[number]>();
    for (const profile of roster) {
      identity.set(`id:${profile.user.publicId.toLowerCase()}`, profile);
      identity.set(`college:${profile.user.collegeIdentityId.toLowerCase()}`, profile);
      if (profile.registerNumber) identity.set(`register:${profile.registerNumber.toLowerCase()}`, profile);
      if (profile.user.normalizedEmail) identity.set(`email:${profile.user.normalizedEmail}`, profile);
    }
    const report: AttendanceValidationReport = { rows: [], errors: [], warnings: [] };
    const seen = new Set<string>();
    for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const rawId = this.textAt(row, headerMap.get("student_user_id"));
      const collegeId = this.textAt(row, headerMap.get("college_id"));
      const registerNumber = this.textAt(row, headerMap.get("register_number"));
      const email = this.textAt(row, headerMap.get("official_email")).toLowerCase();
      if (![rawId, collegeId, registerNumber, email].some(Boolean)) continue;
      const profile = identity.get(`id:${rawId.toLowerCase()}`)
        ?? identity.get(`college:${collegeId.toLowerCase()}`)
        ?? identity.get(`register:${registerNumber.toLowerCase()}`)
        ?? identity.get(`email:${email}`);
      if (!profile) { report.errors.push({ rowNumber, field: "Student User ID", message: "Student does not belong to the selected section." }); continue; }
      if (seen.has(profile.userId)) { report.errors.push({ rowNumber, message: "Duplicate student row." }); continue; }
      seen.add(profile.userId);
      const total = this.numberAt(row, headerMap.get("total_working_days_hours"));
      const present = this.numberAt(row, headerMap.get("present_days_hours"));
      const directPercentage = this.numberAt(row, headerMap.get("attendance_percentage"));
      let totalWorking: number;
      let presentValue: number;
      let percentage: number;
      let source = "EXCEL_COUNTS_SUMMARY";
      if (total !== undefined || present !== undefined) {
        if (total === undefined || present === undefined) { report.errors.push({ rowNumber, message: "Enter both total working and present values." }); continue; }
        if (total < 0 || present < 0 || present > total) { report.errors.push({ rowNumber, message: "Present attendance must not exceed a non-negative total working value." }); continue; }
        totalWorking = total;
        presentValue = present;
        percentage = total === 0 ? 0 : this.round((present / total) * 100);
        if (directPercentage !== undefined && Math.abs(directPercentage - percentage) > 0.05) report.warnings.push({ rowNumber, message: "Workbook percentage was recalculated from working and present values." });
      } else {
        if (directPercentage === undefined || directPercentage < 0 || directPercentage > 100) { report.errors.push({ rowNumber, message: "Attendance percentage must be from 0 to 100." }); continue; }
        totalWorking = 100;
        presentValue = directPercentage;
        percentage = this.round(directPercentage);
        source = "EXCEL_PERCENTAGE_SUMMARY";
      }
      if (attendanceMode === "PERIOD_WISE") report.warnings.push({ rowNumber, message: "This workbook creates a period-wise summary only; submitted period attendance records are not overwritten." });
      report.rows.push({
        rowNumber,
        studentUserId: profile.userId,
        studentPublicId: profile.user.publicId,
        totalWorking,
        present: presentValue,
        absent: this.round(totalWorking - presentValue),
        percentage,
        remarks: this.textAt(row, headerMap.get("remarks")).slice(0, 500) || undefined,
        source,
      });
    }
    if (!report.rows.length && !report.errors.length) report.errors.push({ rowNumber: headerRow + 1, message: "No student attendance rows were found." });
    return report;
  }

  private async requireAccess(user: AuthPrincipal, sectionId: string, subjectId?: string) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, isActive: true, archivedAt: null, semester: { programme: { collegeId: user.collegeId } } },
      select: { id: true, code: true, name: true, semesterId: true },
    });
    if (!section) throw new NotFoundException("Active section not found.");
    const subject = subjectId ? await this.prisma.subject.findFirst({ where: { id: subjectId, semesterId: section.semesterId, isActive: true }, select: { id: true, code: true, name: true } }) : null;
    if (subjectId && !subject) throw new BadRequestException("Subject does not belong to the selected section semester.");
    const elevated = user.roles.some((role) => ["SUPER_ADMIN", "MAIN_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"].includes(role));
    if (!elevated) {
      const [faculty, coordinator] = await Promise.all([
        subjectId ? this.prisma.facultySubjectAssignment.findFirst({ where: { facultyId: user.id, sectionId, subjectId, isActive: true, attendancePermission: true }, select: { id: true } }) : null,
        this.prisma.classCoordinatorAssignment.findFirst({ where: { coordinatorId: user.id, sectionId, isActive: true }, select: { id: true } }),
      ]);
      if (!faculty && !coordinator) throw new ForbiddenException("You do not have attendance-import permission for this section and subject.");
    }
    return { section, subject };
  }

  private activeRosterWhere(sectionId: string): Prisma.StudentProfileWhereInput {
    return {
      sectionId,
      academicStatus: StudentAcademicStatus.ACTIVE,
      user: {
        status: AccountStatus.ACTIVE,
        archivedAt: null,
        sectionMemberships: {
          some: {
            sectionId,
            isActive: true,
            endsOn: null,
            status: AcademicMembershipStatus.ACTIVE,
          },
        },
      },
    };
  }

  private async requireBatch(user: AuthPrincipal, id: string) {
    const batch = await this.prisma.attendanceImportBatch.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!batch) throw new NotFoundException("Attendance import batch not found.");
    if (batch.requestedById !== user.id && !user.roles.some((role) => ["SUPER_ADMIN", "MAIN_ADMIN"].includes(role))) throw new ForbiddenException("You cannot access another user's attendance import.");
    return batch;
  }

  private dateRange(from: string, to: string) {
    const dateFrom = new Date(`${from}T00:00:00.000Z`);
    const dateTo = new Date(`${to}T00:00:00.000Z`);
    if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime()) || dateTo < dateFrom) throw new BadRequestException("Attendance date range is invalid.");
    return { dateFrom, dateTo };
  }

  private header(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  private textAt(row: ReturnType<Worksheet["getRow"]>, column?: number) {
    return column ? row.getCell(column).text.trim() : "";
  }

  private numberAt(row: ReturnType<Worksheet["getRow"]>, column?: number): number | undefined {
    if (!column) return undefined;
    const cell = row.getCell(column);
    const value = cell.value;
    const raw = value && typeof value === "object" && "result" in value ? value.result : value;
    if (raw === null || raw === undefined || raw === "") return undefined;
    const parsed = typeof raw === "number" ? raw : Number(String(raw).trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private round(value: number) { return Math.round(value * 100) / 100; }

  private batchView<T extends { id: string; status: string; importMode: string; attendanceMode: string; totalRows: number; validRows: number; errorRows: number; validationReport: unknown; createdAt: Date; confirmedAt: Date | null }>(batch: T) {
    const report = batch.validationReport as AttendanceValidationReport | null;
    return {
      id: batch.id,
      status: batch.status,
      importMode: batch.importMode,
      attendanceMode: batch.attendanceMode,
      totalRows: batch.totalRows,
      validRows: batch.validRows,
      errorRows: batch.errorRows,
      errors: report?.errors ?? [],
      warnings: report?.warnings ?? [],
      preview: report?.rows.map((row) => ({ rowNumber: row.rowNumber, studentPublicId: row.studentPublicId, totalWorking: row.totalWorking, present: row.present, absent: row.absent, percentage: row.percentage, remarks: row.remarks })) ?? [],
      createdAt: batch.createdAt,
      confirmedAt: batch.confirmedAt,
    };
  }
}
