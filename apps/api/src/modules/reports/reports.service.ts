import { Injectable } from "@nestjs/common";
import { AccessService } from "../../common/access/access.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { stringify } from "csv-stringify/sync";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}
  async dashboard(user: AuthPrincipal) {
    const issueWhere = this.access.issueWhere(user);
    const now = new Date();
    const [open, newIssues, unassigned, critical, overdue, resolvedToday, unread, recent, analytics] = await this.prisma.$transaction([
      this.prisma.issue.count({ where: { AND: [issueWhere, { status: { notIn: ["CLOSED", "CANCELLED", "REJECTED"] } }] } }),
      this.prisma.issue.count({ where: { AND: [issueWhere, { status: "NEW" }] } }),
      this.prisma.issue.count({ where: { AND: [issueWhere, { OR: [{ status: "NEEDS_MANUAL_ASSIGNMENT" }, { assignedToId: null, teamId: null }] }] } }),
      this.prisma.issue.count({ where: { AND: [issueWhere, { priority: { in: ["CRITICAL", "EMERGENCY"] }, status: { notIn: ["CLOSED", "CANCELLED", "REJECTED"] } }] } }),
      this.prisma.issue.count({ where: { AND: [issueWhere, { resolutionDueAt: { lt: now }, status: { notIn: ["RESOLVED", "VERIFIED", "CLOSED", "CANCELLED", "REJECTED"] } }] } }),
      this.prisma.issue.count({ where: { AND: [issueWhere, { resolvedAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } }] } }),
      this.prisma.notificationRecipient.count({ where: { userId: user.id, readAt: null } }),
      this.prisma.issue.findMany({ where: issueWhere, orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, issueNumber: true, title: true, status: true, priority: true, updatedAt: true } }),
      this.prisma.issue.findMany({ where: issueWhere, orderBy: { createdAt: "desc" }, take: 5000, select: { id: true, status: true, priority: true, createdAt: true, acknowledgedAt: true, resolvedAt: true, resolutionDueAt: true, escalationLevel: true, category: { select: { name: true } }, block: { select: { name: true } }, floor: { select: { name: true } }, room: { select: { name: true } }, department: { select: { name: true } }, assignedTo: { select: { fullName: true } }, team: { select: { name: true } }, asset: { select: { name: true, code: true } } } }),
    ]);
    const acknowledged = analytics.filter((issue) => issue.acknowledgedAt);
    const resolved = analytics.filter((issue) => issue.resolvedAt);
    const slaEligible = resolved.filter((issue) => issue.resolutionDueAt);
    const failedDeliveries = analytics.length ? await this.prisma.notificationDeliveryAttempt.count({ where: { status: "FAILED", notification: { relatedEntityType: "Issue", relatedEntityId: { in: analytics.map((issue) => issue.id) } } } }) : 0;
    const breakdown = (values: Array<string | null | undefined>) => [...values.reduce((map, value) => { const key = value || "Unspecified"; map.set(key, (map.get(key) ?? 0) + 1); return map; }, new Map<string, number>())].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    return {
      metrics: {
        openIssues: open,
        newIssues,
        unassignedIssues: unassigned,
        criticalIssues: critical,
        overdueIssues: overdue,
        resolvedToday,
        unreadNotifications: unread,
        averageAcknowledgementMinutes: acknowledged.length ? Math.round(acknowledged.reduce((total, issue) => total + (issue.acknowledgedAt!.getTime() - issue.createdAt.getTime()), 0) / acknowledged.length / 60_000) : null,
        averageResolutionMinutes: resolved.length ? Math.round(resolved.reduce((total, issue) => total + (issue.resolvedAt!.getTime() - issue.createdAt.getTime()), 0) / resolved.length / 60_000) : null,
        slaCompliancePercentage: slaEligible.length ? Math.round(slaEligible.filter((issue) => issue.resolvedAt! <= issue.resolutionDueAt!).length / slaEligible.length * 10_000) / 100 : null,
        escalatedIssues: analytics.filter((issue) => issue.escalationLevel > 0).length,
        notificationFailures: failedDeliveries,
      },
      recentIssues: recent,
      issuesByStatus: breakdown(analytics.map((issue) => issue.status)).map((item) => ({ status: item.name, count: item.count })),
      issuesByCategory: breakdown(analytics.map((issue) => issue.category.name)),
      issuesByBlock: breakdown(analytics.map((issue) => issue.block.name)),
      issuesByFloor: breakdown(analytics.map((issue) => issue.floor.name)),
      issuesByDepartment: breakdown(analytics.map((issue) => issue.department?.name)),
      issuesByResponsiblePerson: breakdown(analytics.map((issue) => issue.assignedTo?.fullName ?? issue.team?.name)),
      repeatProblemLocations: breakdown(analytics.map((issue) => issue.room.name)).filter((item) => item.count > 1).slice(0, 10),
      frequentlyDamagedAssets: breakdown(analytics.map((issue) => issue.asset ? `${issue.asset.code} · ${issue.asset.name}` : null)).filter((item) => item.name !== "Unspecified").slice(0, 10),
      analyticsTruncated: analytics.length === 5000,
    };
  }

  async issuesCsv(user: AuthPrincipal, requestId: string, status?: string): Promise<Buffer> {
    const allowedStatuses = ["NEW", "NEEDS_MANUAL_ASSIGNMENT", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "WAITING_FOR_MATERIAL", "WAITING_FOR_VENDOR", "ON_HOLD", "RESOLVED", "VERIFICATION_PENDING", "VERIFIED", "CLOSED", "REOPENED", "REJECTED", "CANCELLED"] as const;
    const selectedStatus = allowedStatuses.find((item) => item === status);
    const issues = await this.prisma.issue.findMany({
      where: { AND: [this.access.issueWhere(user), ...(selectedStatus ? [{ status: selectedStatus }] : [])] },
      take: 10_000,
      orderBy: { createdAt: "desc" },
      include: { campus: { select: { name: true } }, block: { select: { name: true } }, floor: { select: { name: true } }, room: { select: { code: true, name: true } }, department: { select: { code: true, name: true } }, category: { select: { name: true } }, issueType: { select: { name: true } }, reporter: { select: { collegeIdentityId: true, fullName: true } }, assignedTo: { select: { collegeIdentityId: true, fullName: true } }, team: { select: { name: true } } },
    });
    const output = stringify(issues.map((issue) => ({ issue_number: issue.issueNumber, title: issue.title, status: issue.status, priority: issue.priority, campus: issue.campus.name, block: issue.block.name, floor: issue.floor.name, room_code: issue.room.code, room: issue.room.name, department: issue.department?.name ?? "", category: issue.category.name, problem: issue.issueType?.name ?? "Other", reporter_id: issue.reporter.collegeIdentityId, reporter: issue.reporter.fullName, assigned_to: issue.assignedTo?.fullName ?? issue.team?.name ?? "", acknowledgement_due_at: issue.acknowledgementDueAt?.toISOString() ?? "", resolution_due_at: issue.resolutionDueAt?.toISOString() ?? "", acknowledged_at: issue.acknowledgedAt?.toISOString() ?? "", resolved_at: issue.resolvedAt?.toISOString() ?? "", created_at: issue.createdAt.toISOString(), updated_at: issue.updatedAt.toISOString() })), { header: true });
    await this.audit.record({ actorId: user.id, action: "issues.exported", entityType: "Issue", afterValue: { rows: issues.length, status: selectedStatus ?? null }, requestId });
    return Buffer.from(`\uFEFF${output}`, "utf8");
  }

  async attendanceCsv(user: AuthPrincipal, requestId: string): Promise<Buffer> {
    const where = this.attendanceWhere(user);
    const records = await this.prisma.attendanceRecord.findMany({
      where: { session: where },
      take: 50_000,
      orderBy: [{ session: { sessionDate: "desc" } }, { student: { fullName: "asc" } }],
      include: { student: { select: { collegeIdentityId: true, fullName: true, studentProfile: { select: { rollNumber: true } } } }, session: { include: { subject: { select: { code: true, name: true } }, section: { select: { code: true, name: true, semester: { select: { name: true, programme: { select: { code: true, name: true, department: { select: { code: true, name: true } } } } } } } }, faculty: { select: { collegeIdentityId: true, fullName: true } } } } },
    });
    const output = stringify(records.map((record) => ({ date: record.session.sessionDate.toISOString().slice(0, 10), period: record.session.periodNumber, department: record.session.section.semester.programme.department.name, programme: record.session.section.semester.programme.name, semester: record.session.section.semester.name, section: record.session.section.name, subject_code: record.session.subject.code, subject: record.session.subject.name, student_id: record.student.collegeIdentityId, roll_number: record.student.studentProfile?.rollNumber ?? "", student: record.student.fullName, status: record.status, note: record.note ?? "", faculty_id: record.session.faculty.collegeIdentityId, faculty: record.session.faculty.fullName, session_status: record.session.status, marked_at: record.markedAt.toISOString() })), { header: true });
    await this.audit.record({ actorId: user.id, action: "attendance.exported", entityType: "AttendanceRecord", afterValue: { rows: records.length }, requestId });
    return Buffer.from(`\uFEFF${output}`, "utf8");
  }

  async issueTrend(user: AuthPrincipal, days: number) {
    const cap = Math.min(Math.max(days, 7), 90);
    const since = new Date(Date.now() - cap * 24 * 60 * 60 * 1000);
    const issueWhere = this.access.issueWhere(user);
    const issues = await this.prisma.issue.findMany({
      where: { AND: [issueWhere, { createdAt: { gte: since } }] },
      select: { createdAt: true, resolvedAt: true, resolutionDueAt: true, status: true },
    });
    const map = new Map<string, { date: string; created: number; resolved: number; overdue: number }>();
    for (let i = 0; i < cap; i++) {
      const d = new Date(since.getTime() + i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      map.set(key, { date: key, created: 0, resolved: 0, overdue: 0 });
    }
    for (const issue of issues) {
      const cKey = issue.createdAt.toISOString().slice(0, 10);
      if (map.has(cKey)) map.get(cKey)!.created++;
      if (issue.resolvedAt) { const rKey = issue.resolvedAt.toISOString().slice(0, 10); if (map.has(rKey)) map.get(rKey)!.resolved++; }
      if (issue.resolutionDueAt && issue.resolutionDueAt < new Date() && !["RESOLVED", "VERIFIED", "CLOSED", "CANCELLED", "REJECTED"].includes(issue.status)) {
        const oKey = issue.resolutionDueAt.toISOString().slice(0, 10);
        if (map.has(oKey)) map.get(oKey)!.overdue++;
      }
    }
    return [...map.values()];
  }

  async slaTrend(user: AuthPrincipal, weeks: number) {
    const cap = Math.min(Math.max(weeks, 4), 24);
    const since = new Date(Date.now() - cap * 7 * 24 * 60 * 60 * 1000);
    const issueWhere = this.access.issueWhere(user);
    const issues = await this.prisma.issue.findMany({
      where: { AND: [issueWhere, { resolvedAt: { gte: since }, resolutionDueAt: { not: null } }] },
      select: { resolvedAt: true, resolutionDueAt: true },
    });
    const weekMap = new Map<string, { week: string; compliant: number; breached: number }>();
    for (let i = 0; i < cap; i++) {
      const weekStart = new Date(since.getTime() + i * 7 * 86400_000);
      const key = weekStart.toISOString().slice(0, 10);
      weekMap.set(key, { week: key, compliant: 0, breached: 0 });
    }
    for (const issue of issues) {
      const dayOffset = Math.floor((issue.resolvedAt!.getTime() - since.getTime()) / 86400_000);
      const weekIdx = Math.floor(dayOffset / 7);
      const weekStart = new Date(since.getTime() + weekIdx * 7 * 86400_000);
      const key = weekStart.toISOString().slice(0, 10);
      if (weekMap.has(key)) {
        if (issue.resolvedAt! <= issue.resolutionDueAt!) weekMap.get(key)!.compliant++;
        else weekMap.get(key)!.breached++;
      }
    }
    return [...weekMap.values()].map((w) => {
      const total = w.compliant + w.breached;
      return { ...w, total, complianceRate: total ? Math.round(w.compliant / total * 100) : null };
    });
  }

  async attendanceTrend(user: AuthPrincipal, days: number) {
    const cap = Math.min(Math.max(days, 7), 60);
    const since = new Date(Date.now() - cap * 24 * 60 * 60 * 1000);
    const where = this.attendanceWhere(user);
    const records = await this.prisma.attendanceRecord.findMany({
      where: { session: { ...where, sessionDate: { gte: since } } },
      select: { status: true, session: { select: { sessionDate: true } } },
    });
    const map = new Map<string, { date: string; present: number; absent: number; late: number; excused: number }>();
    for (let i = 0; i < cap; i++) {
      const d = new Date(since.getTime() + i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      map.set(key, { date: key, present: 0, absent: 0, late: 0, excused: 0 });
    }
    for (const record of records) {
      const key = record.session.sessionDate.toISOString().slice(0, 10);
      if (!map.has(key)) continue;
      const slot = map.get(key)!;
      if (record.status === "PRESENT") slot.present++;
      else if (record.status === "ABSENT") slot.absent++;
      else if (record.status === "LATE") slot.late++;
      else if (["ON_DUTY", "MEDICAL_LEAVE", "AUTHORIZED_LEAVE"].includes(record.status)) slot.excused++;
    }
    return [...map.values()];
  }

  private attendanceWhere(user: AuthPrincipal): Prisma.AttendanceSessionWhereInput {

    const college: Prisma.AttendanceSessionWhereInput = { section: { semester: { programme: { collegeId: user.collegeId } } } };
    if (user.permissions.includes("attendance.read_college") && this.access.isCollegeWide(user)) return college;
    const departments = user.scopes.filter((scope) => scope.type === "DEPARTMENT" && scope.id).map((scope) => scope.id as string);
    const sections = user.scopes.filter((scope) => scope.type === "SECTION" && scope.id).map((scope) => scope.id as string);
    const allowed: Prisma.AttendanceSessionWhereInput[] = [{ facultyId: user.id }];
    if (user.permissions.includes("attendance.read_department") && departments.length) allowed.push({ section: { semester: { programme: { departmentId: { in: departments } } } } });
    if (user.permissions.includes("attendance.read_class") && sections.length) allowed.push({ sectionId: { in: sections } });
    if (user.permissions.includes("attendance.read_own")) allowed.push({ records: { some: { studentUserId: user.id } } });
    return { AND: [college, { OR: allowed }] };
  }
}
