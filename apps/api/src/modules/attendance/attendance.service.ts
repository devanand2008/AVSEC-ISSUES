import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { addHours } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { AccessService } from "../../common/access/access.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import { IdempotencyService } from "../../common/idempotency/idempotency.service";
import { PrismaService } from "../../database/prisma.service";
import { Prisma } from "../../generated/prisma/client";
import { UsersService } from "../users/users.service";
import type { AddClassStudentDto, CreateAttendanceSessionDto, RequestCorrectionDto, ReviewCorrectionDto, SubmitAttendanceDto } from "./dto/attendance.dto";
import { attendanceCredit, attendanceParts } from "./attendance-value";

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly access: AccessService,
    private readonly users: UsersService,
  ) {}

  async createSession(user: AuthPrincipal, input: CreateAttendanceSessionDto) {
    const date = new Date(`${input.sessionDate}T00:00:00.000Z`);
    if (Boolean(input.startTime) !== Boolean(input.endTime)) throw new BadRequestException("Start time and end time must be supplied together.");
    const subject = await this.prisma.subject.findFirst({
      where: { id: input.subjectId, semester: { sections: { some: { id: input.sectionId } }, academicYearId: input.academicYearId, programme: { collegeId: user.collegeId } } },
      select: { id: true, semester: { select: { programme: { select: { college: { select: { timezone: true } } } } } } },
    });
    if (!subject) throw new BadRequestException("Subject, section and academic year do not match.");
    const timezone = subject.semester.programme.college.timezone;
    const startsAt = input.startTime ? fromZonedTime(`${input.sessionDate}T${input.startTime}:00`, timezone) : undefined;
    const endsAt = input.endTime ? fromZonedTime(`${input.sessionDate}T${input.endTime}:00`, timezone) : undefined;
    if (startsAt && endsAt && endsAt <= startsAt) throw new BadRequestException("Session end time must be after its start time.");
    const elevated = user.permissions.includes("attendance.read_college") && this.access.isCollegeWide(user);
    if (!elevated) {
      const assignment = await this.prisma.facultySubjectAssignment.findFirst({ where: { facultyId: user.id, subjectId: input.subjectId, sectionId: input.sectionId, isActive: true, attendancePermission: true, validFrom: { lte: date }, OR: [{ validUntil: null }, { validUntil: { gte: date } }] } });
      if (!assignment) throw new ForbiddenException("You do not have attendance permission for this subject and section.");
    }
    try {
      return await this.prisma.attendanceSession.create({ data: { academicYearId: input.academicYearId, sectionId: input.sectionId, subjectId: input.subjectId, facultyId: user.id, sessionDate: date, periodNumber: input.periodNumber, sessionType: input.sessionType ?? "LECTURE", startsAt, endsAt } });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
      return this.prisma.attendanceSession.findFirstOrThrow({ where: { sectionId: input.sectionId, subjectId: input.subjectId, sessionDate: date, periodNumber: input.periodNumber } });
    }
  }

  async list(user: AuthPrincipal, page: number, pageSize: number) {
    await this.lockExpiredSessions(user.collegeId);
    const where = await this.sessionWhere(user);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.attendanceSession.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ sessionDate: "desc" }, { periodNumber: "desc" }], include: { subject: { select: { code: true, name: true } }, section: { select: { code: true, name: true } }, faculty: { select: { publicId: true, fullName: true } }, _count: { select: { records: true } } } }),
      this.prisma.attendanceSession.count({ where }),
    ]);
    return { data, meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
  }

  async roster(user: AuthPrincipal, sessionId: string) {
    const session = await this.authorizedSession(user, sessionId, true);
    const students = await this.prisma.studentProfile.findMany({ where: { sectionId: session.sectionId, user: { status: "ACTIVE" } }, include: { user: { select: { id: true, publicId: true, fullName: true } } }, orderBy: [{ rollNumber: "asc" }, { user: { fullName: "asc" } }] });
    const existing = await this.prisma.attendanceRecord.findMany({ where: { sessionId }, select: { id: true, studentUserId: true, status: true, morningStatus: true, afternoonStatus: true, effectiveAttendanceValue: true, note: true } });
    const byStudent = new Map(existing.map((record) => [record.studentUserId, record]));
    return {
      session: { id: session.id, status: session.status, sessionType: session.sessionType, submittedAt: session.submittedAt, lockedAt: session.lockedAt, version: session.version },
      students: students.map((profile) => { const record = byStudent.get(profile.userId); return { recordId: record?.id, userId: profile.user.id, publicId: profile.user.publicId, studentId: profile.studentId, rollNumber: profile.rollNumber, fullName: profile.user.fullName, status: record?.status ?? null, morningStatus: record?.morningStatus ?? null, afternoonStatus: record?.afternoonStatus ?? null, effectiveAttendanceValue: record ? Number(record.effectiveAttendanceValue) : null, note: record?.note ?? null }; }),
    };
  }

  async classStudents(user: AuthPrincipal, sectionId: string) {
    await this.authorizedSection(user, sectionId);
    const students = await this.prisma.studentProfile.findMany({
      where: { sectionId, user: { status: "ACTIVE" } },
      include: { user: { select: { publicId: true, collegeIdentityId: true, fullName: true, email: true, mobile: true, status: true } } },
      orderBy: [{ rollNumber: "asc" }, { user: { fullName: "asc" } }],
    });
    return students.map((profile) => ({
      userId: profile.userId,
      publicId: profile.user.publicId,
      collegeIdentityId: profile.user.collegeIdentityId,
      studentId: profile.studentId,
      rollNumber: profile.rollNumber,
      fullName: profile.user.fullName,
      email: profile.user.email,
      mobile: profile.user.mobile,
      status: profile.user.status,
    }));
  }

  async addClassStudent(user: AuthPrincipal, sectionId: string, input: AddClassStudentDto, requestId: string) {
    const section = await this.sectionForStudentEntry(user, sectionId);
    return this.users.create(user, {
      collegeIdentityId: input.studentId.trim(),
      fullName: input.fullName.trim(),
      email: input.email.trim(),
      ...(input.mobile ? { mobile: input.mobile.trim() } : {}),
      temporaryPassword: input.temporaryPassword,
      roleCodes: ["STUDENT"],
      scopes: [{ type: "SECTION", id: section.id }],
      studentProfile: {
        departmentId: section.semester.programme.departmentId,
        programmeId: section.semester.programmeId,
        sectionId: section.id,
        studentId: input.studentId.trim(),
        registerNumber: input.registerNumber.trim(),
        academicYearId: section.semester.academicYearId,
        semesterId: section.semester.id,
        studyYear: section.studyYear ?? Math.ceil(section.semester.number / 2),
        admissionYear: input.admissionYear ?? section.semester.academicYear.startsOn.getUTCFullYear(),
        ...(input.rollNumber ? { rollNumber: input.rollNumber.trim() } : {}),
        ...(input.dateOfBirth ? { dateOfBirth: input.dateOfBirth } : {}),
        ...(input.gender ? { gender: input.gender.trim() } : {}),
      },
    }, requestId);
  }

  async saveDraft(user: AuthPrincipal, sessionId: string, input: SubmitAttendanceDto, requestId: string) {
    const session = await this.authorizedSession(user, sessionId, true);
    if (session.status !== "DRAFT") throw new ConflictException("Only a draft attendance session can be saved without submission.");
    const roster = await this.prisma.studentProfile.findMany({ where: { sectionId: session.sectionId, user: { status: "ACTIVE" } }, select: { userId: true } });
    const allowed = new Set(roster.map((row) => row.userId));
    const submitted = new Set<string>();
    for (const record of input.records) {
      if (!allowed.has(record.studentUserId)) throw new BadRequestException("The draft contains a student outside this section.");
      if (submitted.has(record.studentUserId)) throw new BadRequestException("A student appears more than once in the draft.");
      submitted.add(record.studentUserId);
    }
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.attendanceSession.updateMany({
        where: { id: sessionId, status: "DRAFT", version: input.expectedVersion },
        data: { version: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new ConflictException("Attendance changed in another session. Refresh the roster before saving again.");
      for (const inputRecord of input.records) {
        const existing = await tx.attendanceRecord.findUnique({ where: { sessionId_studentUserId: { sessionId, studentUserId: inputRecord.studentUserId } } });
        const note = inputRecord.note?.trim() || undefined;
        const parts = this.partsFor(inputRecord.status, inputRecord.morningStatus, inputRecord.afternoonStatus);
        const record = existing
          ? await tx.attendanceRecord.update({ where: { id: existing.id }, data: { status: inputRecord.status, ...parts, note, markedAt: new Date(), version: { increment: 1 } } })
          : await tx.attendanceRecord.create({ data: { sessionId, studentUserId: inputRecord.studentUserId, status: inputRecord.status, ...parts, note } });
        if (!existing || existing.status !== inputRecord.status || existing.morningStatus !== parts.morningStatus || existing.afternoonStatus !== parts.afternoonStatus || (existing.note || undefined) !== note) {
          await tx.attendanceChangeHistory.create({ data: { recordId: record.id, previousStatus: existing?.status, newStatus: inputRecord.status, previousMorningStatus: existing?.morningStatus, previousAfternoonStatus: existing?.afternoonStatus, morningStatus: parts.morningStatus, afternoonStatus: parts.afternoonStatus, previousEffectiveAttendanceValue: existing?.effectiveAttendanceValue, newEffectiveAttendanceValue: parts.effectiveAttendanceValue, previousNote: existing?.note, newNote: note, changedById: user.id, reason: "Attendance draft saved.", requestId } });
        }
      }
      const version = input.expectedVersion + 1;
      await tx.auditLog.create({ data: { collegeId: user.collegeId, actorId: user.id, action: "attendance.draft_saved", entityType: "AttendanceSession", entityId: sessionId, afterValue: { recordCount: input.records.length, version }, requestId } });
      return { sessionId, status: "DRAFT" as const, recordCount: input.records.length, version, savedAt: new Date() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async submit(user: AuthPrincipal, sessionId: string, input: SubmitAttendanceDto, key: string, requestId: string) {
    if (!key || key.length > 120) throw new BadRequestException("A valid Idempotency-Key header is required.");
    const hash = this.idempotency.hash(input);
    const replay = await this.idempotency.replay(user.id, `/attendance/sessions/${sessionId}/submit`, key, hash);
    if (replay) return replay;
    const session = await this.authorizedSession(user, sessionId, true);
    if (session.status === "LOCKED" || session.status === "CANCELLED") throw new ConflictException(`Attendance is ${session.status.toLowerCase()}.`);
    if (session.status === "SUBMITTED" && !user.permissions.includes("attendance.edit_window")) {
      throw new ConflictException("Submitted attendance requires an approved correction request.");
    }
    const roster = await this.prisma.studentProfile.findMany({ where: { sectionId: session.sectionId, user: { status: "ACTIVE" } }, select: { userId: true } });
    const allowed = new Set(roster.map((row) => row.userId));
    const submitted = new Set<string>();
    for (const record of input.records) {
      if (!allowed.has(record.studentUserId)) throw new BadRequestException("The submitted roster contains a student outside this section.");
      if (submitted.has(record.studentUserId)) throw new BadRequestException("A student appears more than once in the submission.");
      submitted.add(record.studentUserId);
    }
    if (submitted.size !== allowed.size) throw new BadRequestException("Attendance must include every active student in the roster.");

    return this.prisma.$transaction(async (tx) => {
      const submittedAt = new Date();
      const claimed = await tx.attendanceSession.updateMany({
        where: { id: sessionId, status: session.status, version: input.expectedVersion },
        data: { status: "SUBMITTED", submittedAt, version: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new ConflictException("Attendance changed in another session. Refresh the roster before submitting again.");
      for (const inputRecord of input.records) {
        const existing = await tx.attendanceRecord.findUnique({ where: { sessionId_studentUserId: { sessionId, studentUserId: inputRecord.studentUserId } } });
        const note = inputRecord.note?.trim() || undefined;
        const parts = this.partsFor(inputRecord.status, inputRecord.morningStatus, inputRecord.afternoonStatus);
        const record = existing
          ? await tx.attendanceRecord.update({ where: { id: existing.id }, data: { status: inputRecord.status, ...parts, note, markedAt: submittedAt, version: { increment: 1 } } })
          : await tx.attendanceRecord.create({ data: { sessionId, studentUserId: inputRecord.studentUserId, status: inputRecord.status, ...parts, note, markedAt: submittedAt } });
        if (!existing || existing.status !== inputRecord.status || existing.morningStatus !== parts.morningStatus || existing.afternoonStatus !== parts.afternoonStatus || (existing.note || undefined) !== note) await tx.attendanceChangeHistory.create({ data: { recordId: record.id, previousStatus: existing?.status, newStatus: inputRecord.status, previousMorningStatus: existing?.morningStatus, previousAfternoonStatus: existing?.afternoonStatus, morningStatus: parts.morningStatus, afternoonStatus: parts.afternoonStatus, previousEffectiveAttendanceValue: existing?.effectiveAttendanceValue, newEffectiveAttendanceValue: parts.effectiveAttendanceValue, previousNote: existing?.note, newNote: note, changedById: user.id, reason: existing ? "Attendance resubmission within the permitted window." : "Initial attendance submission.", requestId } });
      }
      const response = { sessionId, status: "SUBMITTED" as const, submittedAt, version: input.expectedVersion + 1, recordCount: input.records.length };
      await tx.idempotencyKey.create({ data: { actorId: user.id, endpoint: `/attendance/sessions/${sessionId}/submit`, key, requestHash: hash, responseStatus: 200, responseBody: response, resourceId: sessionId, expiresAt: addHours(new Date(), 24) } });
      await tx.auditLog.create({ data: { collegeId: user.collegeId, actorId: user.id, action: "attendance.submitted", entityType: "AttendanceSession", entityId: sessionId, afterValue: response, requestId } });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async ownSummary(user: AuthPrincipal) {
    const profile = await this.prisma.studentProfile.findUnique({ where: { userId: user.id } });
    if (!profile) throw new ForbiddenException("This account does not have a student profile.");
    const [records, importedSummaries] = await Promise.all([
      this.prisma.attendanceRecord.findMany({ where: { studentUserId: user.id, session: { status: { in: ["SUBMITTED", "LOCKED"] } } }, include: { session: { include: { subject: { select: { id: true, code: true, name: true } } } } } }),
      this.prisma.attendanceSummary.findMany({
        where: { studentUserId: user.id },
        include: { subject: { select: { id: true, code: true, name: true } } },
        orderBy: [{ dateTo: "desc" }, { updatedAt: "desc" }],
        take: 100,
      }),
    ]);
    const grouped = new Map<string, { subject: { id: string; code: string; name: string }; total: number; attended: number }>();
    for (const record of records) {
      const row = grouped.get(record.session.subjectId) ?? { subject: record.session.subject, total: 0, attended: 0 };
      row.total += 1;
      row.attended += attendanceCredit(record);
      grouped.set(record.session.subjectId, row);
    }
    const periodOverall = this.percentage(records.reduce((sum, record) => sum + attendanceCredit(record), 0), records.length);
    const latestOverallImport = importedSummaries.find((summary) => summary.subjectId === null);
    return {
      overall: latestOverallImport?.percentage ?? periodOverall,
      periodOverall,
      subjects: [...grouped.values()].map((row) => ({ ...row, percentage: this.percentage(row.attended, row.total) })),
      importedSummaries: importedSummaries.map((summary) => ({
        id: summary.id,
        subject: summary.subject,
        dateFrom: summary.dateFrom,
        dateTo: summary.dateTo,
        totalWorking: summary.totalWorking,
        present: summary.present,
        absent: summary.absent,
        percentage: summary.percentage,
        remarks: summary.remarks,
        source: summary.source,
      })),
    };
  }

  async staffSummary(user: AuthPrincipal, filters: { departmentId?: string; staffId?: string; from?: string; to?: string }) {
    this.requireAttendanceAnalytics(user);
    const where = await this.sessionWhere(user);
    const sessions = await this.prisma.attendanceSession.findMany({
      where: {
        AND: [
          where,
          { status: { in: ["SUBMITTED", "LOCKED"] } },
          ...(filters.from || filters.to ? [{ sessionDate: this.dateFilter(filters.from, filters.to) }] : []),
          ...(filters.departmentId ? [{ faculty: { staffProfile: { departmentId: filters.departmentId } } }] : []),
          ...(filters.staffId ? [{ faculty: { OR: [{ publicId: filters.staffId }, { collegeIdentityId: filters.staffId }, { staffProfile: { employeeId: filters.staffId } }] } }] : []),
        ],
      },
      include: { faculty: { select: { id: true, publicId: true, collegeIdentityId: true, fullName: true, staffProfile: { select: { employeeId: true, designation: true, department: { select: { id: true, code: true, name: true } } } } } } },
      orderBy: { sessionDate: "desc" },
      take: 50_000,
    });
    const grouped = new Map<string, { staff: unknown; totalSessions: number; submittedSessions: number; workingDays: Set<string> }>();
    for (const session of sessions) {
      const slot = grouped.get(session.facultyId) ?? { staff: session.faculty, totalSessions: 0, submittedSessions: 0, workingDays: new Set<string>() };
      slot.totalSessions += 1;
      slot.submittedSessions += 1;
      slot.workingDays.add(session.sessionDate.toISOString().slice(0, 10));
      grouped.set(session.facultyId, slot);
    }
    const rows = [...grouped.values()].map((row) => ({
      staff: row.staff,
      totalWorkingDays: row.workingDays.size,
      presentDays: row.workingDays.size,
      absentDays: 0,
      leaveDays: 0,
      onDutyDays: 0,
      lateArrivalCount: 0,
      earlyDepartureCount: 0,
      totalSessions: row.totalSessions,
      submittedSessions: row.submittedSessions,
      attendancePercentage: this.percentage(row.submittedSessions, row.totalSessions),
    }));
    return { data: rows, sourceNote: "Staff attendance is derived from submitted or locked teaching attendance sessions because no dedicated staff clock-in table exists." };
  }

  async staffDetail(user: AuthPrincipal, staffId: string, filters: { from?: string; to?: string }) {
    const summary = await this.staffSummary(user, { ...filters, staffId });
    const row = summary.data[0];
    if (!row) throw new NotFoundException("Staff attendance was not found in your authorized scope.");
    return row;
  }

  async classSummary(user: AuthPrincipal, filters: { departmentId?: string; sectionId?: string; subjectId?: string; from?: string; to?: string }) {
    this.requireAttendanceAnalytics(user);
    const where = await this.sessionWhere(user);
    const thresholds = await this.attendanceThresholds(user.collegeId);
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        session: {
          AND: [
            where,
            { status: { in: ["SUBMITTED", "LOCKED"] } },
            ...(filters.sectionId ? [{ sectionId: filters.sectionId }] : []),
            ...(filters.subjectId ? [{ subjectId: filters.subjectId }] : []),
            ...(filters.from || filters.to ? [{ sessionDate: this.dateFilter(filters.from, filters.to) }] : []),
            ...(filters.departmentId ? [{ section: { semester: { programme: { departmentId: filters.departmentId } } } }] : []),
          ],
        },
      },
      include: { session: { include: { section: { include: { semester: { include: { programme: { include: { department: true } } } } } }, subject: true } } },
      take: 100_000,
    });
    const grouped = new Map<string, { section: unknown; total: number; attended: number; absent: number; onDuty: number; leave: number }>();
    for (const record of records) {
      const slot = grouped.get(record.session.sectionId) ?? { section: record.session.section, total: 0, attended: 0, absent: 0, onDuty: 0, leave: 0 };
      slot.total += 1;
      const credit = attendanceCredit(record);
      slot.attended += credit;
      slot.absent += 1 - credit;
      if (record.status === "ON_DUTY") slot.onDuty += 1;
      if (["MEDICAL_LEAVE", "AUTHORIZED_LEAVE"].includes(record.status)) slot.leave += 1;
      grouped.set(record.session.sectionId, slot);
    }
    return [...grouped.values()].map((row) => {
      const attendancePercentage = this.percentage(row.attended, row.total);
      return { ...row, attendancePercentage, status: this.attendanceStatus(attendancePercentage, thresholds) };
    });
  }

  async classStudentAnalytics(user: AuthPrincipal, sectionId: string, filters: { subjectId?: string; from?: string; to?: string }) {
    await this.authorizedSection(user, sectionId);
    const thresholds = await this.attendanceThresholds(user.collegeId);
    const sessions = await this.prisma.attendanceSession.findMany({
      where: {
        sectionId,
        status: { in: ["SUBMITTED", "LOCKED"] },
        ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
        ...(filters.from || filters.to ? { sessionDate: this.dateFilter(filters.from, filters.to) } : {}),
      },
      select: { id: true, sessionDate: true, subject: { select: { id: true, code: true, name: true } } },
    });
    const sessionIds = sessions.map((session) => session.id);
    const [students, records] = await Promise.all([
      this.prisma.studentProfile.findMany({
        where: { sectionId, user: { status: "ACTIVE" } },
        include: { user: { select: { publicId: true, collegeIdentityId: true, fullName: true, mobile: true, profilePhotoKey: true } }, department: { select: { name: true } }, section: { select: { code: true, name: true } } },
        orderBy: [{ rollNumber: "asc" }, { user: { fullName: "asc" } }],
      }),
      sessionIds.length ? this.prisma.attendanceRecord.findMany({ where: { sessionId: { in: sessionIds } }, include: { session: { select: { subjectId: true, sessionDate: true } } } }) : [],
    ]);
    return students.map((student) => {
      const studentRecords = records.filter((record) => record.studentUserId === student.userId);
      return this.studentAttendanceRow(student, studentRecords, thresholds, this.canViewStudentContact(user), sessions);
    });
  }

  async lowAttendance(user: AuthPrincipal, filters: { sectionId?: string; departmentId?: string; subjectId?: string; below?: string; notified?: string }) {
    this.requireAttendanceAnalytics(user);
    const thresholds = await this.attendanceThresholds(user.collegeId);
    const below = Math.min(Number(filters.below) || thresholds.required, thresholds.required);
    const where = await this.sessionWhere(user);
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        session: {
          AND: [
            where,
            { status: { in: ["SUBMITTED", "LOCKED"] } },
            ...(filters.sectionId ? [{ sectionId: filters.sectionId }] : []),
            ...(filters.subjectId ? [{ subjectId: filters.subjectId }] : []),
            ...(filters.departmentId ? [{ section: { semester: { programme: { departmentId: filters.departmentId } } } }] : []),
          ],
        },
      },
      include: {
        student: { include: { studentProfile: { include: { department: true, section: true } } } },
        session: { select: { subjectId: true, subject: { select: { code: true, name: true } }, sessionDate: true } },
      },
      take: 100_000,
    });
    const grouped = new Map<string, typeof records>();
    for (const record of records) grouped.set(record.studentUserId, [...(grouped.get(record.studentUserId) ?? []), record]);
    return [...grouped.values()]
      .map((studentRecords) => {
        const first = studentRecords[0];
        if (!first?.student.studentProfile) return null;
        return this.studentAttendanceRow({ ...first.student.studentProfile, user: first.student, department: first.student.studentProfile.department, section: first.student.studentProfile.section }, studentRecords, thresholds, this.canViewStudentContact(user));
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => row.attendancePercentage < below)
      .sort((a, b) => a.attendancePercentage - b.attendancePercentage);
  }

  async studentAnalytics(user: AuthPrincipal, studentId: string) {
    const own = studentId === "me" || studentId === user.publicId || studentId === user.id;
    if (!own) this.requireAttendanceAnalytics(user);
    const profile = await this.prisma.studentProfile.findFirst({
      where: own
        ? { userId: user.id }
        : { user: { collegeId: user.collegeId, OR: [{ publicId: studentId }, { collegeIdentityId: studentId }] } },
      include: { user: { select: { publicId: true, collegeIdentityId: true, fullName: true, mobile: true, profilePhotoKey: true } }, department: true, section: true },
    });
    if (!profile) throw new NotFoundException("Student not found.");
    if (!own) await this.authorizedSection(user, profile.sectionId);
    return (await this.classStudentAnalytics(user, profile.sectionId, {})).find((row) => row.student.publicId === profile.user.publicId);
  }

  async requestCorrection(user: AuthPrincipal, sessionId: string, input: RequestCorrectionDto) {
    const session = await this.authorizedSession(user, sessionId);
    if (session.status === "DRAFT" || session.status === "CANCELLED") throw new ConflictException("Corrections can only be requested for submitted attendance.");
    const record = await this.prisma.attendanceRecord.findFirst({ where: { id: input.recordId, sessionId } });
    if (!record) throw new BadRequestException("Attendance record does not belong to this session.");
    if (record.status === input.requestedStatus) throw new BadRequestException("The requested status is already recorded.");
    const pending = await this.prisma.attendanceCorrectionRequest.findFirst({ where: { recordId: record.id, status: "PENDING" }, select: { id: true } });
    if (pending) throw new ConflictException("A correction for this attendance record is already pending.");
    try {
      return await this.prisma.attendanceCorrectionRequest.create({ data: { sessionId, recordId: record.id, requestedById: user.id, requestedStatus: input.requestedStatus, reason: input.reason.trim() } });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new ConflictException("A correction for this attendance record is already pending.");
      throw error;
    }
  }

  async requestCorrectionForRecord(user: AuthPrincipal, input: RequestCorrectionDto) {
    const sessionWhere = await this.sessionWhere(user);
    const record = await this.prisma.attendanceRecord.findFirst({
      where: { id: input.recordId, session: sessionWhere },
      select: { sessionId: true },
    });
    if (!record) throw new NotFoundException("Attendance record not found.");
    return this.requestCorrection(user, record.sessionId, input);
  }

  async reviewCorrection(user: AuthPrincipal, correctionId: string, approved: boolean, input: ReviewCorrectionDto, requestId: string) {
    if (!user.permissions.includes("attendance.correction.approve")) throw new ForbiddenException("You cannot review attendance corrections.");
    const sessionWhere = await this.sessionWhere(user);
    const correction = await this.prisma.attendanceCorrectionRequest.findFirst({ where: { id: correctionId, status: "PENDING", session: sessionWhere }, include: { record: true, session: true } });
    if (!correction) throw new NotFoundException("Pending correction request not found.");
    if (correction.requestedById === user.id) throw new ForbiddenException("You cannot approve your own attendance correction request.");
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.attendanceCorrectionRequest.updateMany({
        where: { id: correction.id, status: "PENDING" },
        data: { status: approved ? "APPROVED" : "REJECTED", reviewedById: user.id, reviewComment: input.comment?.trim(), reviewedAt: new Date() },
      });
      if (claimed.count !== 1) throw new ConflictException("This correction was already reviewed.");
      if (approved) {
        if (correction.record.status === correction.requestedStatus) throw new ConflictException("The attendance record already has the requested status.");
        const parts = this.partsFor(correction.requestedStatus);
        const changed = await tx.attendanceRecord.updateMany({ where: { id: correction.recordId, version: correction.record.version }, data: { status: correction.requestedStatus, ...parts, correctionReason: correction.reason, correctedById: user.id, correctedAt: new Date(), version: { increment: 1 } } });
        if (changed.count !== 1) throw new ConflictException("The attendance record changed while this correction was being reviewed.");
        await tx.attendanceChangeHistory.create({ data: { recordId: correction.recordId, previousStatus: correction.record.status, newStatus: correction.requestedStatus, previousMorningStatus: correction.record.morningStatus, previousAfternoonStatus: correction.record.afternoonStatus, morningStatus: parts.morningStatus, afternoonStatus: parts.afternoonStatus, previousEffectiveAttendanceValue: correction.record.effectiveAttendanceValue, newEffectiveAttendanceValue: parts.effectiveAttendanceValue, previousNote: correction.record.note, newNote: correction.record.note, changedById: user.id, reason: correction.reason, requestId } });
      }
      return tx.attendanceCorrectionRequest.findUniqueOrThrow({ where: { id: correction.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async corrections(user: AuthPrincipal, status?: "PENDING" | "APPROVED" | "REJECTED") {
    if (!user.permissions.includes("attendance.correction.approve") && !user.permissions.includes("attendance.correction.request")) throw new ForbiddenException("You cannot access attendance corrections.");
    const sessionWhere = await this.sessionWhere(user);
    return this.prisma.attendanceCorrectionRequest.findMany({
      where: { session: sessionWhere, ...(!user.permissions.includes("attendance.correction.approve") ? { requestedById: user.id } : {}), ...(status ? { status } : {}) },
      include: {
        record: { include: { student: { select: { publicId: true, fullName: true, collegeIdentityId: true } } } },
        session: { include: { subject: { select: { code: true, name: true } }, section: { select: { code: true, name: true } } } },
        requestedBy: { select: { publicId: true, fullName: true } },
        reviewedBy: { select: { publicId: true, fullName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async correction(user: AuthPrincipal, id: string) {
    if (!user.permissions.includes("attendance.correction.approve") && !user.permissions.includes("attendance.correction.request")) throw new ForbiddenException("You cannot access attendance corrections.");
    const sessionWhere = await this.sessionWhere(user);
    const correction = await this.prisma.attendanceCorrectionRequest.findFirst({
      where: { id, session: sessionWhere, ...(!user.permissions.includes("attendance.correction.approve") ? { requestedById: user.id } : {}) },
      include: { record: { include: { student: { select: { publicId: true, fullName: true, collegeIdentityId: true } } } }, session: { include: { subject: true, section: true } }, requestedBy: { select: { publicId: true, fullName: true } }, reviewedBy: { select: { publicId: true, fullName: true } } },
    });
    if (!correction) throw new NotFoundException("Attendance correction request not found.");
    return correction;
  }

  private async authorizedSession(user: AuthPrincipal, sessionId: string, requireMarkPermission = false) {
    await this.lockExpiredSessions(user.collegeId);
    const where = await this.sessionWhere(user);
    const session = await this.prisma.attendanceSession.findFirst({ where: { AND: [{ id: sessionId }, where] } });
    if (!session) throw new NotFoundException("Attendance session not found.");
    if (requireMarkPermission && session.facultyId === user.id && !this.access.isCollegeWide(user)) {
      const assignment = await this.prisma.facultySubjectAssignment.findFirst({
        where: {
          facultyId: user.id,
          subjectId: session.subjectId,
          sectionId: session.sectionId,
          isActive: true,
          attendancePermission: true,
          validFrom: { lte: session.sessionDate },
          OR: [{ validUntil: null }, { validUntil: { gte: session.sessionDate } }],
        },
        select: { id: true },
      });
      if (!assignment) throw new ForbiddenException("You no longer have attendance permission for this subject and section.");
    }
    return session;
  }

  private async authorizedSection(user: AuthPrincipal, sectionId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, isActive: true, semester: { programme: { collegeId: user.collegeId } } },
      select: { id: true, semesterId: true, semester: { select: { programmeId: true, academicYearId: true, programme: { select: { departmentId: true, department: { select: { campusId: true } } } } } } },
    });
    if (!section) throw new NotFoundException("Class section not found.");
    if (user.permissions.includes("attendance.read_college") && this.access.isCollegeWide(user)) return section;
    const scopes = new Set(user.scopes.map((scope) => `${scope.type}:${scope.id ?? ""}`));
    if (user.permissions.includes("attendance.read_class") && scopes.has(`SECTION:${section.id}`)) return section;
    if (user.permissions.includes("attendance.read_class") && scopes.has(`SEMESTER:${section.semesterId}`)) return section;
    if (user.permissions.includes("attendance.read_class") && scopes.has(`ACADEMIC_YEAR:${section.semester.academicYearId}`)) return section;
    if (user.permissions.includes("attendance.read_department") && scopes.has(`PROGRAMME:${section.semester.programmeId}`)) return section;
    if (user.permissions.includes("attendance.read_department") && scopes.has(`DEPARTMENT:${section.semester.programme.departmentId}`)) return section;
    if (user.permissions.includes("attendance.read_college") && scopes.has(`CAMPUS:${section.semester.programme.department.campusId}`)) return section;
    throw new ForbiddenException("You are not assigned to this class section.");
  }

  private async sectionForStudentEntry(user: AuthPrincipal, sectionId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, isActive: true, archivedAt: null, semester: { isActive: true, programme: { collegeId: user.collegeId, isActive: true, department: { isActive: true, archivedAt: null } }, academicYear: { collegeId: user.collegeId, isActive: true } } },
      select: { id: true, studyYear: true, semester: { select: { id: true, number: true, academicYearId: true, academicYear: { select: { startsOn: true } }, programmeId: true, programme: { select: { departmentId: true } } } } },
    });
    if (!section) throw new BadRequestException("The selected class section is not active.");
    return section;
  }

  private requireAttendanceAnalytics(user: AuthPrincipal): void {
    if (!["attendance.read_college", "attendance.read_department", "attendance.read_class"].some((permission) => user.permissions.includes(permission))) {
      throw new ForbiddenException("You cannot access attendance analytics.");
    }
  }

  private async attendanceThresholds(collegeId: string) {
    const setting = await this.prisma.appSetting.findUnique({ where: { collegeId_key: { collegeId, key: "feedback.settings" } }, select: { value: true } });
    const value = typeof setting?.value === "object" && setting.value !== null ? setting.value as Record<string, unknown> : {};
    return {
      required: this.numberSetting(value.requiredAttendancePercentage, 75),
      warning: this.numberSetting(value.attendanceWarningPercentage, 65),
      critical: this.numberSetting(value.attendanceCriticalPercentage, 50),
    };
  }

  private dateFilter(from?: string, to?: string): Prisma.DateTimeFilter {
    const filter: Prisma.DateTimeFilter = {};
    if (from) filter.gte = new Date(from);
    if (to) filter.lte = new Date(to);
    return filter;
  }

  private studentAttendanceRow(
    profile: {
      userId: string;
      studentId: string;
      admissionYear: number;
      rollNumber: string | null;
      user: { publicId: string; collegeIdentityId: string; fullName: string; mobile?: string | null; profilePhotoKey?: string | null };
      department?: { name: string } | null;
      section?: { code: string; name: string } | null;
    },
    records: Array<{ status: string; effectiveAttendanceValue?: number | { toNumber(): number } | null; session: { subjectId: string; sessionDate: Date; subject?: { code: string; name: string } } }>,
    thresholds: { required: number; warning: number; critical: number },
    showContact: boolean,
    sessions?: Array<{ subject: { id: string; code: string; name: string }; sessionDate: Date }>,
  ) {
    const totalPeriods = sessions?.length ?? records.length;
    const presentPeriods = records.reduce((sum, record) => sum + attendanceCredit(record), 0);
    const absentPeriods = Math.max(0, totalPeriods - presentPeriods);
    const onDutyPeriods = records.filter((record) => record.status === "ON_DUTY").length;
    const leavePeriods = records.filter((record) => ["MEDICAL_LEAVE", "AUTHORIZED_LEAVE"].includes(record.status)).length;
    const attendancePercentage = this.percentage(presentPeriods, totalPeriods);
    const subjectMap = new Map<string, { subject: { code: string; name: string }; total: number; attended: number }>();
    for (const record of records) {
      if (!record.session.subject) continue;
      const slot = subjectMap.get(record.session.subjectId) ?? { subject: record.session.subject, total: 0, attended: 0 };
      slot.total += 1;
      slot.attended += attendanceCredit(record);
      subjectMap.set(record.session.subjectId, slot);
    }
    const lastAttendance = records.reduce<Date | null>((latest, record) => !latest || record.session.sessionDate > latest ? record.session.sessionDate : latest, null);
    return {
      student: {
        publicId: profile.user.publicId,
        photoKey: profile.user.profilePhotoKey ?? null,
        name: profile.user.fullName,
        registerNumber: profile.studentId || profile.user.collegeIdentityId,
      },
      department: profile.department?.name ?? null,
      year: profile.admissionYear,
      class: profile.section?.name ?? null,
      section: profile.section?.code ?? null,
      mobileNumber: showContact ? profile.user.mobile ?? null : null,
      parentContact: null,
      totalPeriods,
      presentPeriods,
      absentPeriods,
      onDutyPeriods,
      leavePeriods,
      attendancePercentage,
      attendanceStatus: this.attendanceStatus(attendancePercentage, thresholds),
      requiredAttendancePercentage: thresholds.required,
      classesNeededToReachRequiredPercentage: this.classesNeeded(presentPeriods, totalPeriods, thresholds.required),
      subjectWiseShortage: [...subjectMap.values()].map((row) => {
        const percentage = this.percentage(row.attended, row.total);
        return { subject: row.subject, totalPeriods: row.total, presentPeriods: row.attended, attendancePercentage: percentage, shortageClasses: this.classesNeeded(row.attended, row.total, thresholds.required) };
      }),
      lastAttendanceDate: lastAttendance,
      warningStatus: this.attendanceStatus(attendancePercentage, thresholds),
      notificationStatus: "NOT_SENT",
      counsellingCompleted: false,
    };
  }

  private attendanceStatus(percentage: number, thresholds: { required: number; warning: number; critical: number }): "SAFE" | "WARNING" | "CRITICAL" {
    if (percentage >= thresholds.required) return "SAFE";
    if (percentage >= thresholds.warning) return "WARNING";
    return "CRITICAL";
  }

  private partsFor(status: Parameters<typeof attendanceParts>[0], morningStatus?: Parameters<typeof attendanceParts>[1], afternoonStatus?: Parameters<typeof attendanceParts>[2]) {
    try { return attendanceParts(status, morningStatus, afternoonStatus); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid half-day attendance values."); }
  }

  private classesNeeded(attended: number, total: number, requiredPercentage: number): number {
    const required = requiredPercentage / 100;
    if (required >= 1) return 0;
    if (total > 0 && attended / total >= required) return 0;
    return Math.max(0, Math.ceil(((required * total) - attended) / (1 - required)));
  }

  private canViewStudentContact(user: AuthPrincipal): boolean {
    return user.permissions.includes("users.read") || user.permissions.includes("attendance.read_college");
  }

  private numberSetting(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
  }

  private async sessionWhere(user: AuthPrincipal): Promise<Prisma.AttendanceSessionWhereInput> {
    const college: Prisma.AttendanceSessionWhereInput = { archivedAt: null, section: { semester: { programme: { collegeId: user.collegeId } } } };
    if (user.permissions.includes("attendance.read_college") && this.access.isCollegeWide(user)) return college;
    const campuses = user.scopes.filter((scope) => scope.type === "CAMPUS" && scope.id).map((scope) => scope.id as string);
    const departments = user.scopes.filter((scope) => scope.type === "DEPARTMENT" && scope.id).map((scope) => scope.id as string);
    const programmes = user.scopes.filter((scope) => scope.type === "PROGRAMME" && scope.id).map((scope) => scope.id as string);
    const academicYears = user.scopes.filter((scope) => scope.type === "ACADEMIC_YEAR" && scope.id).map((scope) => scope.id as string);
    const semesters = user.scopes.filter((scope) => scope.type === "SEMESTER" && scope.id).map((scope) => scope.id as string);
    const sections = user.scopes.filter((scope) => scope.type === "SECTION" && scope.id).map((scope) => scope.id as string);
    const or: Prisma.AttendanceSessionWhereInput[] = [{ facultyId: user.id }];
    const scopedDimensions: Prisma.AttendanceSessionWhereInput[] = [];
    if (user.permissions.includes("attendance.read_college") && campuses.length) scopedDimensions.push({ section: { semester: { programme: { department: { campusId: { in: campuses } } } } } });
    if (user.permissions.includes("attendance.read_department") && departments.length) scopedDimensions.push({ section: { semester: { programme: { departmentId: { in: departments } } } } });
    if (user.permissions.includes("attendance.read_department") && programmes.length) scopedDimensions.push({ section: { semester: { programmeId: { in: programmes } } } });
    if (user.permissions.includes("attendance.read_class") && academicYears.length) scopedDimensions.push({ academicYearId: { in: academicYears } });
    if (user.permissions.includes("attendance.read_class") && semesters.length) scopedDimensions.push({ section: { semesterId: { in: semesters } } });
    if (user.permissions.includes("attendance.read_class") && sections.length) scopedDimensions.push({ sectionId: { in: sections } });
    if (scopedDimensions.length) or.push({ AND: scopedDimensions });
    if (user.permissions.includes("attendance.read_own")) or.push({ records: { some: { studentUserId: user.id } } });
    return { AND: [college, { OR: or }] };
  }

  private percentage(value: number, total: number): number { return total ? Math.round((value / total) * 10_000) / 100 : 0; }

  private async lockExpiredSessions(collegeId: string): Promise<void> {
    const setting = await this.prisma.appSetting.findUnique({ where: { collegeId_key: { collegeId, key: "attendance.lock_after_minutes" } }, select: { value: true } });
    const configured = typeof setting?.value === "number" ? setting.value : 60;
    const minutes = Number.isFinite(configured) ? Math.min(10_080, Math.max(1, configured)) : 60;
    const threshold = new Date(Date.now() - minutes * 60_000);
    const expired = await this.prisma.attendanceSession.findMany({
      where: { status: "SUBMITTED", submittedAt: { lt: threshold }, section: { semester: { programme: { collegeId } } } },
      select: { id: true, version: true },
      orderBy: { submittedAt: "asc" },
      take: 500,
    });
    if (!expired.length) return;
    const lockedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const session of expired) {
        const locked = await tx.attendanceSession.updateMany({ where: { id: session.id, status: "SUBMITTED", version: session.version }, data: { status: "LOCKED", lockedAt, version: { increment: 1 } } });
        if (locked.count === 1) {
          await tx.auditLog.create({ data: { collegeId, actorId: null, action: "attendance.auto_locked", entityType: "AttendanceSession", entityId: session.id, beforeValue: { status: "SUBMITTED", version: session.version }, afterValue: { status: "LOCKED", version: session.version + 1, lockedAt }, reason: `Configured lock window: ${minutes} minutes`, requestId: `attendance-auto-lock:${session.id}:${session.version}` } });
        }
      }
    });
  }
}
