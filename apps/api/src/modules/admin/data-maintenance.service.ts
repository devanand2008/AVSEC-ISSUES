import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { Prisma } from "../../generated/prisma/client";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import type { DataMaintenanceCategory, DataMaintenanceDryRunDto, ExecuteDataMaintenanceDto } from "./dto/admin.dto";

type CountReport = Record<string, number>;

export interface MaintenanceParameters {
  beforeDate?: string;
  academicYearId?: string;
  sourceSectionId?: string;
  targetSectionId?: string;
  targetAcademicYearId?: string;
}

@Injectable()
export class DataMaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  categories() {
    return [
      { code: "ARCHIVE_OLD_ACADEMIC_YEAR", destructive: false, requires: ["academicYearId"] },
      { code: "PROMOTE_STUDENTS", destructive: false, requires: ["sourceSectionId", "targetSectionId"] },
      { code: "MOVE_STUDENTS_TO_NEW_SEMESTER", destructive: false, requires: ["sourceSectionId", "targetSectionId"] },
      { code: "ARCHIVE_OLD_ATTENDANCE_SESSIONS", destructive: false, requires: ["beforeDate"] },
      { code: "ARCHIVE_OLD_COURSE_ASSIGNMENTS", destructive: false, requires: ["beforeDate"] },
      { code: "ARCHIVE_OLD_ANNOUNCEMENTS", destructive: false, requires: ["beforeDate"] },
      { code: "ARCHIVE_CLOSED_ISSUES", destructive: false, requires: ["beforeDate"] },
      { code: "DELETE_TEMPORARY_IMPORTS", destructive: true, requires: ["beforeDate"] },
      { code: "CLEAN_EXPIRED_SESSIONS", destructive: true, requires: ["beforeDate"] },
      { code: "CLEAN_ORPHANED_ATTACHMENTS", destructive: true, requires: ["beforeDate"] },
      { code: "PREPARE_NEW_ACADEMIC_YEAR", destructive: false, requires: ["targetAcademicYearId"] },
    ];
  }

  async dryRun(user: AuthPrincipal, input: DataMaintenanceDryRunDto, requestId: string) {
    this.requireMaintainer(user);
    const parameters = this.parameters(input);
    const recordCounts = await this.analyse(user, input.category, parameters);
    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dataMaintenanceJob.create({
        data: {
          collegeId: user.collegeId,
          requestedById: user.id,
          category: input.category,
          recordCounts,
          report: this.json({ parameters, analysedAt: new Date().toISOString(), hardDeleteEnabled: false }),
        },
      });
      const phrase = this.confirmationPhrase(created.id, input.category);
      await tx.dataMaintenanceJob.update({
        where: { id: created.id },
        data: { confirmationPhraseHash: this.hash(phrase) },
      });
      await this.audit.record({
        actorId: user.id,
        action: "data_maintenance.analysed",
        entityType: "DataMaintenanceJob",
        entityId: created.id,
        afterValue: { category: input.category, recordCounts, parameters },
        requestId,
      }, tx);
      return { ...created, confirmationPhraseHash: this.hash(phrase), phrase };
    });
    return {
      id: job.id,
      category: job.category,
      status: job.status,
      recordCounts,
      parameters,
      backupRequired: true,
      hardDeleteEnabled: false,
      confirmationPhrase: job.phrase,
      createdAt: job.createdAt,
    };
  }

  async registerBackup(user: AuthPrincipal, jobId: string, backupReference: string, requestId: string) {
    this.requireMaintainer(user);
    const job = await this.requireJob(user, jobId);
    if (job.executedAt) throw new ConflictException("This maintenance job has already been executed.");
    if (job.status !== "ANALYSED" && job.status !== "BACKUP_CONFIRMED") throw new ConflictException("The maintenance job is not ready for backup confirmation.");
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.dataMaintenanceJob.update({
        where: { id: job.id },
        data: { backupReference: backupReference.trim(), status: "BACKUP_CONFIRMED" },
      });
      await this.audit.record({
        actorId: user.id,
        action: "data_maintenance.backup_registered",
        entityType: "DataMaintenanceJob",
        entityId: job.id,
        afterValue: { backupReference: saved.backupReference },
        requestId,
      }, tx);
      return saved;
    });
    return { id: updated.id, status: updated.status, backupReference: updated.backupReference };
  }

  async execute(user: AuthPrincipal, jobId: string, input: ExecuteDataMaintenanceDto, requestId: string) {
    this.requireMaintainer(user);
    const job = await this.requireJob(user, jobId);
    if (job.executedAt || job.status === "COMPLETED") return this.view(job);
    if (job.status !== "BACKUP_CONFIRMED" || !job.backupReference) throw new BadRequestException("Register a verified backup reference before execution.");
    if (job.backupReference !== input.backupReference.trim()) throw new BadRequestException("Backup reference does not match the dry-run job.");
    if (!job.confirmationPhraseHash || !this.matchesHash(input.confirmationPhrase.trim(), job.confirmationPhraseHash)) throw new BadRequestException("Confirmation phrase is incorrect.");
    const report = this.object(job.report);
    const parameters = this.object(report.parameters) as MaintenanceParameters;
    const currentCounts = await this.analyse(user, job.category as DataMaintenanceCategory, parameters);
    if (JSON.stringify(currentCounts) !== JSON.stringify(this.object(job.recordCounts))) {
      throw new ConflictException("The matching record counts changed after the dry run. Run a new analysis before executing.");
    }

    const result = await this.executeCategory(user, job.category as DataMaintenanceCategory, parameters);
    const completed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.dataMaintenanceJob.update({
        where: { id: job.id },
        data: {
          mode: "ARCHIVE_OR_CLEAN",
          status: "COMPLETED",
          reason: input.reason.trim(),
          executedAt: new Date(),
          report: this.json({
            parameters,
            analysedCounts: this.object(job.recordCounts),
            result,
            backupReference: job.backupReference,
            verifiedAt: new Date().toISOString(),
          }),
        },
      });
      await this.audit.record({
        actorId: user.id,
        action: "data_maintenance.executed",
        entityType: "DataMaintenanceJob",
        entityId: job.id,
        beforeValue: { status: job.status, recordCounts: job.recordCounts },
        afterValue: { status: updated.status, category: job.category, result, backupReference: job.backupReference },
        reason: input.reason.trim(),
        requestId,
      }, tx);
      return updated;
    });
    return this.view(completed);
  }

  async get(user: AuthPrincipal, jobId: string) {
    this.requireMaintainer(user);
    return this.view(await this.requireJob(user, jobId));
  }

  async history(user: AuthPrincipal) {
    this.requireMaintainer(user);
    const jobs = await this.prisma.dataMaintenanceJob.findMany({
      where: { collegeId: user.collegeId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return jobs.map((job) => this.view(job));
  }

  private async analyse(user: AuthPrincipal, category: DataMaintenanceCategory, parameters: MaintenanceParameters): Promise<CountReport> {
    const before = this.beforeDate(parameters, category);
    switch (category) {
      case "ARCHIVE_OLD_ACADEMIC_YEAR": {
        const year = await this.academicYear(user, parameters.academicYearId);
        if (year.isCurrent) throw new BadRequestException("The current academic year cannot be archived.");
        const semesterWhere = { academicYearId: year.id };
        return {
          academicYears: 1,
          semesters: await this.prisma.semester.count({ where: semesterWhere }),
          sections: await this.prisma.section.count({ where: { semester: semesterWhere, archivedAt: null } }),
          activeMemberships: await this.prisma.sectionMembership.count({ where: { section: { semester: semesterWhere }, isActive: true } }),
          attendanceSessions: await this.prisma.attendanceSession.count({ where: { academicYearId: year.id, archivedAt: null } }),
          attendanceRecords: await this.prisma.attendanceRecord.count({ where: { session: { academicYearId: year.id } } }),
          attendanceSummaries: await this.prisma.attendanceSummary.count({ where: { section: { semester: semesterWhere } } }),
        };
      }
      case "PROMOTE_STUDENTS":
      case "MOVE_STUDENTS_TO_NEW_SEMESTER":
        return this.transferAnalysis(user, parameters);
      case "ARCHIVE_OLD_ATTENDANCE_SESSIONS":
        return {
          attendanceSessions: await this.prisma.attendanceSession.count({ where: { archivedAt: null, sessionDate: { lt: before }, section: { semester: { programme: { collegeId: user.collegeId } } } } }),
          attendanceRecords: await this.prisma.attendanceRecord.count({ where: { session: { archivedAt: null, sessionDate: { lt: before }, section: { semester: { programme: { collegeId: user.collegeId } } } } } }),
        };
      case "ARCHIVE_OLD_COURSE_ASSIGNMENTS":
        return {
          facultySubjectAssignments: await this.prisma.facultySubjectAssignment.count({ where: { isActive: true, validUntil: { lt: before }, section: { semester: { programme: { collegeId: user.collegeId } } } } }),
          classStaffAssignments: await this.prisma.classStaffAssignment.count({ where: { isActive: true, validUntil: { lt: before }, section: { semester: { programme: { collegeId: user.collegeId } } } } }),
          coordinatorAssignments: await this.prisma.classCoordinatorAssignment.count({ where: { isActive: true, validUntil: { lt: before }, section: { semester: { programme: { collegeId: user.collegeId } } } } }),
        };
      case "ARCHIVE_OLD_ANNOUNCEMENTS":
        return { announcements: await this.prisma.announcement.count({ where: { collegeId: user.collegeId, archivedAt: null, OR: [{ expiresAt: { lt: before } }, { publishedAt: { lt: before }, status: { in: ["EXPIRED", "UNPUBLISHED"] } }] } }) };
      case "ARCHIVE_CLOSED_ISSUES":
        return { issues: await this.prisma.issue.count({ where: { collegeId: user.collegeId, archivedAt: null, status: { in: ["CLOSED", "CANCELLED", "REJECTED"] }, updatedAt: { lt: before } } }) };
      case "DELETE_TEMPORARY_IMPORTS": {
        const importIds = await this.deletableImportIds(user.collegeId, before);
        return {
          importJobs: importIds.length,
          importRows: importIds.length ? await this.prisma.importJobRecord.count({ where: { importJobId: { in: importIds } } }) : 0,
          failedAttendanceImports: await this.prisma.attendanceImportBatch.count({ where: { collegeId: user.collegeId, status: { in: ["FAILED", "ROLLED_BACK"] }, createdAt: { lt: before } } }),
        };
      }
      case "CLEAN_EXPIRED_SESSIONS":
        return {
          sessions: await this.prisma.session.count({ where: { user: { collegeId: user.collegeId }, expiresAt: { lt: before } } }),
          refreshTokens: await this.prisma.refreshToken.count({ where: { session: { user: { collegeId: user.collegeId }, expiresAt: { lt: before } } } }),
        };
      case "CLEAN_ORPHANED_ATTACHMENTS":
        return {
          pendingAttachmentUploads: await this.prisma.messageAttachmentUpload.count({ where: { collegeId: user.collegeId, status: { not: "CONSUMED" }, expiresAt: { lt: before } } }),
        };
      case "PREPARE_NEW_ACADEMIC_YEAR": {
        const target = await this.academicYear(user, parameters.targetAcademicYearId);
        return {
          targetAcademicYears: 1,
          currentAcademicYearsToClose: await this.prisma.academicYear.count({ where: { collegeId: user.collegeId, isCurrent: true, id: { not: target.id } } }),
          targetSemesters: await this.prisma.semester.count({ where: { academicYearId: target.id } }),
          targetSections: await this.prisma.section.count({ where: { semester: { academicYearId: target.id } } }),
        };
      }
    }
  }

  private async executeCategory(user: AuthPrincipal, category: DataMaintenanceCategory, parameters: MaintenanceParameters): Promise<Record<string, unknown>> {
    const before = this.beforeDate(parameters, category);
    switch (category) {
      case "ARCHIVE_OLD_ACADEMIC_YEAR": {
        const year = await this.academicYear(user, parameters.academicYearId);
        if (year.isCurrent) throw new BadRequestException("The current academic year cannot be archived.");
        const now = new Date();
        return this.prisma.$transaction(async (tx) => {
          const semesterWhere = { academicYearId: year.id };
          const attendance = await tx.attendanceSession.updateMany({ where: { academicYearId: year.id, archivedAt: null }, data: { archivedAt: now, status: "LOCKED", lockedAt: now } });
          const memberships = await tx.sectionMembership.updateMany({ where: { section: { semester: semesterWhere }, isActive: true }, data: { isActive: false, endsOn: now } });
          await tx.facultySubjectAssignment.updateMany({ where: { section: { semester: semesterWhere }, isActive: true }, data: { isActive: false, validUntil: now } });
          await tx.classStaffAssignment.updateMany({ where: { section: { semester: semesterWhere }, isActive: true }, data: { isActive: false, validUntil: now } });
          await tx.classCoordinatorAssignment.updateMany({ where: { section: { semester: semesterWhere }, isActive: true }, data: { isActive: false, validUntil: now } });
          await tx.classRepresentativeAssignment.updateMany({ where: { section: { semester: semesterWhere }, isActive: true }, data: { isActive: false, validUntil: now } });
          await tx.subject.updateMany({ where: { semester: semesterWhere }, data: { isActive: false } });
          const sections = await tx.section.updateMany({ where: { semester: semesterWhere, archivedAt: null }, data: { isActive: false, archivedAt: now } });
          await tx.semester.updateMany({ where: semesterWhere, data: { isActive: false } });
          await tx.academicYear.update({ where: { id: year.id }, data: { isActive: false, isCurrent: false } });
          await tx.archivedRecord.create({ data: { collegeId: user.collegeId, entityType: "AcademicYear", entityId: year.id, reason: "Archived by the controlled academic-year maintenance workflow.", archivedById: user.id, metadata: { attendanceSessions: attendance.count, memberships: memberships.count, sections: sections.count } } });
          return { academicYears: 1, attendanceSessions: attendance.count, memberships: memberships.count, sections: sections.count, historicalAttendancePreserved: true };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      }
      case "PROMOTE_STUDENTS":
      case "MOVE_STUDENTS_TO_NEW_SEMESTER":
        return this.transferStudents(user, parameters);
      case "ARCHIVE_OLD_ATTENDANCE_SESSIONS": {
        const updated = await this.prisma.attendanceSession.updateMany({ where: { archivedAt: null, sessionDate: { lt: before }, section: { semester: { programme: { collegeId: user.collegeId } } } }, data: { archivedAt: new Date(), status: "LOCKED", lockedAt: new Date() } });
        return { attendanceSessions: updated.count, recordsDeleted: 0, historicalAttendancePreserved: true };
      }
      case "ARCHIVE_OLD_COURSE_ASSIGNMENTS": {
        const [faculty, staff, coordinators] = await this.prisma.$transaction([
          this.prisma.facultySubjectAssignment.updateMany({ where: { isActive: true, validUntil: { lt: before }, section: { semester: { programme: { collegeId: user.collegeId } } } }, data: { isActive: false } }),
          this.prisma.classStaffAssignment.updateMany({ where: { isActive: true, validUntil: { lt: before }, section: { semester: { programme: { collegeId: user.collegeId } } } }, data: { isActive: false } }),
          this.prisma.classCoordinatorAssignment.updateMany({ where: { isActive: true, validUntil: { lt: before }, section: { semester: { programme: { collegeId: user.collegeId } } } }, data: { isActive: false } }),
        ]);
        return { facultySubjectAssignments: faculty.count, classStaffAssignments: staff.count, coordinatorAssignments: coordinators.count };
      }
      case "ARCHIVE_OLD_ANNOUNCEMENTS": {
        const updated = await this.prisma.announcement.updateMany({ where: { collegeId: user.collegeId, archivedAt: null, OR: [{ expiresAt: { lt: before } }, { publishedAt: { lt: before }, status: { in: ["EXPIRED", "UNPUBLISHED"] } }] }, data: { archivedAt: new Date(), status: "ARCHIVED" } });
        return { announcements: updated.count };
      }
      case "ARCHIVE_CLOSED_ISSUES": {
        const updated = await this.prisma.issue.updateMany({ where: { collegeId: user.collegeId, archivedAt: null, status: { in: ["CLOSED", "CANCELLED", "REJECTED"] }, updatedAt: { lt: before } }, data: { archivedAt: new Date() } });
        return { issues: updated.count };
      }
      case "DELETE_TEMPORARY_IMPORTS": {
        const jobs = await this.prisma.importJob.findMany({ where: { id: { in: await this.deletableImportIds(user.collegeId, before) } }, select: { id: true, sourceStorageKey: true, resultStorageKey: true } });
        const keys = jobs.flatMap((job) => [job.sourceStorageKey, job.resultStorageKey].filter((key): key is string => Boolean(key)));
        const storage = await this.storage.deleteMaintenanceObjects(keys);
        if (storage.failed) throw new ConflictException("Some temporary import objects could not be removed from private storage. Retry the cleanup.");
        const result = await this.prisma.$transaction(async (tx) => {
          const rows = jobs.length ? await tx.importJobRecord.deleteMany({ where: { importJobId: { in: jobs.map((job) => job.id) } } }) : { count: 0 };
          const deletedJobs = jobs.length ? await tx.importJob.deleteMany({ where: { id: { in: jobs.map((job) => job.id) } } }) : { count: 0 };
          const attendance = await tx.attendanceImportBatch.deleteMany({ where: { collegeId: user.collegeId, status: { in: ["FAILED", "ROLLED_BACK"] }, createdAt: { lt: before } } });
          return { importJobs: deletedJobs.count, importRows: rows.count, failedAttendanceImports: attendance.count };
        });
        return { ...result, storage };
      }
      case "CLEAN_EXPIRED_SESSIONS": {
        const sessions = await this.prisma.session.deleteMany({ where: { user: { collegeId: user.collegeId }, expiresAt: { lt: before } } });
        return { sessions: sessions.count, refreshTokensRemovedByCascade: true };
      }
      case "CLEAN_ORPHANED_ATTACHMENTS": {
        const uploads = await this.prisma.messageAttachmentUpload.findMany({ where: { collegeId: user.collegeId, status: { not: "CONSUMED" }, expiresAt: { lt: before } }, select: { id: true, storageKey: true, thumbnailKey: true } });
        const keys = uploads.flatMap((upload) => [upload.storageKey, upload.thumbnailKey].filter((key): key is string => Boolean(key)));
        const storage = await this.storage.deleteMaintenanceObjects(keys);
        if (storage.failed) throw new ConflictException("Some expired attachment objects could not be removed from private storage. Retry the cleanup.");
        const deleted = uploads.length ? await this.prisma.messageAttachmentUpload.deleteMany({ where: { id: { in: uploads.map((upload) => upload.id) } } }) : { count: 0 };
        return { pendingAttachmentUploads: deleted.count, storage };
      }
      case "PREPARE_NEW_ACADEMIC_YEAR": {
        const target = await this.academicYear(user, parameters.targetAcademicYearId);
        return this.prisma.$transaction(async (tx) => {
          const previous = await tx.academicYear.updateMany({ where: { collegeId: user.collegeId, isCurrent: true, id: { not: target.id } }, data: { isCurrent: false } });
          await tx.academicYear.update({ where: { id: target.id }, data: { isCurrent: true, isActive: true } });
          await tx.semester.updateMany({ where: { academicYearId: target.id }, data: { isActive: true } });
          await tx.section.updateMany({ where: { semester: { academicYearId: target.id }, archivedAt: null }, data: { isActive: true } });
          return { academicYearId: target.id, previousCurrentYearsClosed: previous.count, prepared: true };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      }
    }
  }

  private async transferAnalysis(user: AuthPrincipal, parameters: MaintenanceParameters): Promise<CountReport> {
    const { source, target } = await this.transferSections(user, parameters);
    const students = await this.prisma.studentProfile.count({ where: { sectionId: source.id, user: { status: "ACTIVE", archivedAt: null } } });
    const targetStudents = await this.prisma.studentProfile.count({ where: { sectionId: target.id, user: { status: "ACTIVE", archivedAt: null } } });
    if (targetStudents + students > target.capacity) throw new ConflictException(`Section capacity reached. Target has ${targetStudents} active students and only ${target.capacity - targetStudents} available seats.`);
    return { students, targetCurrentStudents: targetStudents, targetCapacity: target.capacity, targetAvailableAfterMove: target.capacity - targetStudents - students };
  }

  private async transferStudents(user: AuthPrincipal, parameters: MaintenanceParameters) {
    const { source, target } = await this.transferSections(user, parameters);
    const today = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`section-capacity:${target.id}`}))`;
      const profiles = await tx.studentProfile.findMany({ where: { sectionId: source.id, user: { status: "ACTIVE", archivedAt: null } }, select: { userId: true } });
      const targetCount = await tx.studentProfile.count({ where: { sectionId: target.id, user: { status: "ACTIVE", archivedAt: null } } });
      if (targetCount + profiles.length > target.capacity) throw new ConflictException("Section capacity reached. Create another section or move students before promoting.");
      const userIds = profiles.map((profile) => profile.userId);
      if (!userIds.length) return { studentsMoved: 0, historicalAttendancePreserved: true };
      await tx.sectionMembership.updateMany({ where: { studentUserId: { in: userIds }, isActive: true }, data: { isActive: false, endsOn: today } });
      await tx.sectionMembership.createMany({ data: userIds.map((studentUserId) => ({ studentUserId, sectionId: target.id, academicYearId: parameters.targetAcademicYearId ?? target.semester.academicYearId, startsOn: today, isActive: true })) });
      await tx.studentProfile.updateMany({ where: { userId: { in: userIds } }, data: { sectionId: target.id, programmeId: target.semester.programmeId, departmentId: target.semester.programme.departmentId, studyYear: target.studyYear } });
      await tx.userScope.deleteMany({ where: { userId: { in: userIds }, scopeType: "SECTION", scopeId: { in: [source.id, target.id] } } });
      await tx.userScope.createMany({ data: userIds.map((userId) => ({ userId, scopeType: "SECTION" as const, scopeId: target.id })) });
      return { studentsMoved: userIds.length, sourceSectionId: source.id, targetSectionId: target.id, historicalAttendancePreserved: true, previousMembershipsArchived: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async transferSections(user: AuthPrincipal, parameters: MaintenanceParameters) {
    if (!parameters.sourceSectionId || !parameters.targetSectionId) throw new BadRequestException("Source and target sections are required.");
    if (parameters.sourceSectionId === parameters.targetSectionId) throw new BadRequestException("Source and target sections must be different.");
    const select = { id: true, capacity: true, studyYear: true, semester: { select: { academicYearId: true, programmeId: true, programme: { select: { collegeId: true, departmentId: true } } } } } as const;
    const [source, target] = await Promise.all([
      this.prisma.section.findFirst({ where: { id: parameters.sourceSectionId, semester: { programme: { collegeId: user.collegeId } } }, select }),
      this.prisma.section.findFirst({ where: { id: parameters.targetSectionId, isActive: true, archivedAt: null, semester: { programme: { collegeId: user.collegeId } } }, select }),
    ]);
    if (!source || !target) throw new NotFoundException("Source or active target section was not found.");
    return { source, target };
  }

  private async academicYear(user: AuthPrincipal, id?: string) {
    if (!id) throw new BadRequestException("Academic year is required.");
    const year = await this.prisma.academicYear.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!year) throw new NotFoundException("Academic year not found.");
    return year;
  }

  private async deletableImportIds(collegeId: string, before: Date) {
    const jobs = await this.prisma.importJob.findMany({ where: { collegeId, status: { in: ["FAILED", "ROLLED_BACK"] }, createdAt: { lt: before } }, select: { id: true } });
    if (!jobs.length) return [];
    const referenced = await this.prisma.user.findMany({ where: { importBatchId: { in: jobs.map((job) => job.id) } }, select: { importBatchId: true } });
    const retained = new Set(referenced.map((row) => row.importBatchId).filter(Boolean));
    return jobs.map((job) => job.id).filter((id) => !retained.has(id));
  }

  private beforeDate(parameters: MaintenanceParameters, category: DataMaintenanceCategory) {
    const requiringDate = !["ARCHIVE_OLD_ACADEMIC_YEAR", "PROMOTE_STUDENTS", "MOVE_STUDENTS_TO_NEW_SEMESTER", "PREPARE_NEW_ACADEMIC_YEAR"].includes(category);
    if (!requiringDate) return new Date(0);
    if (!parameters.beforeDate) throw new BadRequestException("A cutoff date is required.");
    const date = new Date(parameters.beforeDate);
    if (Number.isNaN(date.getTime()) || date >= new Date()) throw new BadRequestException("Cutoff date must be a valid date in the past.");
    return date;
  }

  private parameters(input: DataMaintenanceDryRunDto): MaintenanceParameters {
    return {
      ...(input.beforeDate ? { beforeDate: input.beforeDate } : {}),
      ...(input.academicYearId ? { academicYearId: input.academicYearId } : {}),
      ...(input.sourceSectionId ? { sourceSectionId: input.sourceSectionId } : {}),
      ...(input.targetSectionId ? { targetSectionId: input.targetSectionId } : {}),
      ...(input.targetAcademicYearId ? { targetAcademicYearId: input.targetAcademicYearId } : {}),
    };
  }

  private requireMaintainer(user: AuthPrincipal) {
    if (!user.permissions.includes("data.maintenance") || !user.roles.some((role) => ["MAIN_ADMIN", "SUPER_ADMIN"].includes(role))) {
      throw new ForbiddenException("Only Main Admin can run controlled data-maintenance workflows.");
    }
  }

  private async requireJob(user: AuthPrincipal, id: string) {
    const job = await this.prisma.dataMaintenanceJob.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!job) throw new NotFoundException("Data-maintenance job not found.");
    return job;
  }

  private confirmationPhrase(id: string, category: string) {
    return `EXECUTE ${category} ${id}`;
  }

  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private matchesHash(value: string, expected: string) {
    const left = Buffer.from(this.hash(value), "hex");
    const right = Buffer.from(expected, "hex");
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private view<T extends { id: string; category: string; mode: string; status: string; recordCounts: unknown; backupReference: string | null; reason: string | null; report: unknown; createdAt: Date; executedAt: Date | null }>(job: T) {
    return {
      id: job.id,
      category: job.category,
      mode: job.mode,
      status: job.status,
      recordCounts: job.recordCounts,
      backupReference: job.backupReference,
      reason: job.reason,
      report: job.report,
      createdAt: job.createdAt,
      executedAt: job.executedAt,
    };
  }
}
