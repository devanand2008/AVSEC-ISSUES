import { Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "../../common/http/request-context";
import { AccessService } from "../../common/access/access.service";
import { PrismaService } from "../../database/prisma.service";
import type {
  AiContextResult,
  AiSuggestedAction,
} from "./ai.types";

const ACTIONS: Record<string, AiSuggestedAction[]> = {
  attendance: [
    { label: "Open Attendance", route: "/attendance", kind: "open" },
  ],
  subjects: [{ label: "Open AVS Learn", route: "/learn", kind: "open" }],
  learn: [{ label: "Open AVS Learn", route: "/learn", kind: "open" }],
  campus: [{ label: "Open Campus", route: "/campus", kind: "open" }],
  issues: [{ label: "Open Issues", route: "/issues", kind: "open" }],
  feedback: [{ label: "Open Feedback", route: "/feedback", kind: "open" }],
  profile: [{ label: "Open Profile", route: "/profile", kind: "open" }],
  announcements: [
    { label: "Open Announcements", route: "/announcements", kind: "open" },
  ],
};

@Injectable()
export class AiContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  detectIntent(message: string): string {
    const value = message.toLowerCase();
    if (/attendance|absent|present|percentage|வருகை|ஆஜர்/.test(value))
      return "attendance";
    if (/subject|syllabus|faculty|course code|பாடம்/.test(value))
      return "subjects";
    if (/learn|skill|course|lesson|quiz|certificate|training/.test(value))
      return "learn";
    if (
      /campus|block|floor|room|classroom|laboratory|lab|library|canteen|கல்லூரி|அறை/.test(
        value,
      )
    )
      return "campus";
    if (
      /issue|complaint|repair|maintenance|electric|plumb|status|புகார்|பராமரிப்பு/.test(
        value,
      )
    )
      return "issues";
    if (/feedback|rating|suggestion|கருத்து/.test(value)) return "feedback";
    if (/announcement|notice|circular|event|அறிவிப்பு/.test(value))
      return "announcements";
    if (/profile|verification|details|account|சுயவிவரம்/.test(value))
      return "profile";
    return "general";
  }

  async build(user: AuthPrincipal, message: string): Promise<AiContextResult> {
    const intent = this.detectIntent(message);
    let context: Record<string, unknown>;
    switch (intent) {
      case "attendance":
        context = await this.attendance(user);
        break;
      case "subjects":
        context = await this.subjects(user);
        break;
      case "learn":
        context = await this.learn(user);
        break;
      case "campus":
        context = await this.campus(user, message);
        break;
      case "issues":
        context = await this.issues(user);
        break;
      case "announcements":
        context = await this.announcements(user);
        break;
      case "profile":
        context = await this.profile(user);
        break;
      case "feedback":
        context = {
          guidance:
            "Feedback must be submitted from the authenticated Feedback screen. AVS Bot can explain the process but cannot submit, edit, identify anonymous authors, or change a feedback record.",
        };
        break;
      default:
        context = await this.profileSummary(user);
    }
    return {
      intent,
      context: {
        generatedAt: new Date().toISOString(),
        roleCodes: user.roles,
        intent,
        data: context,
      },
      suggestedActions: ACTIONS[intent] ?? [],
    };
  }

  private async attendance(
    user: AuthPrincipal,
  ): Promise<Record<string, unknown>> {
    if (user.roles.includes("STUDENT")) {
      const rows = await this.prisma.attendanceSummary.findMany({
        where: { studentUserId: user.id, isArchived: false },
        select: {
          subject: { select: { code: true, name: true } },
          dateFrom: true,
          dateTo: true,
          totalWorking: true,
          present: true,
          absent: true,
          percentage: true,
          remarks: true,
        },
        orderBy: { dateTo: "desc" },
        take: 12,
      });
      return {
        scope: "own_attendance_only",
        summaries: rows.map((row) => ({
          subject: row.subject
            ? `${row.subject.code} — ${row.subject.name}`
            : "Overall",
          dateFrom: row.dateFrom,
          dateTo: row.dateTo,
          totalWorking: Number(row.totalWorking),
          present: Number(row.present),
          absent: Number(row.absent),
          percentage: Number(row.percentage),
          remarks: row.remarks,
        })),
      };
    }

    if (
      user.roles.some((role) =>
        ["HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "MAIN_ADMIN"].includes(
          role,
        ),
      )
    ) {
      const profile = await this.prisma.staffProfile.findUnique({
        where: { userId: user.id },
        select: { departmentId: true },
      });
      const departmentOnly =
        user.roles.includes("HOD") && profile?.departmentId
          ? profile.departmentId
          : null;
      const where = {
        collegeId: user.collegeId,
        isArchived: false,
        ...(departmentOnly
          ? {
              section: {
                semester: {
                  programme: { departmentId: departmentOnly },
                },
              },
            }
          : {}),
      };
      const [summary, atRisk] = await Promise.all([
        this.prisma.attendanceSummary.aggregate({
          where,
          _avg: { percentage: true },
          _count: { _all: true },
        }),
        this.prisma.attendanceSummary.count({
          where: { ...where, percentage: { lt: 75 } },
        }),
      ]);
      return {
        scope: departmentOnly ? "department_aggregate" : "college_aggregate",
        averagePercentage: summary._avg.percentage
          ? Number(summary._avg.percentage)
          : null,
        summaryRows: summary._count._all,
        below75SummaryRows: atRisk,
        note: "Aggregate counts only; no student identities are supplied to AVS Bot.",
      };
    }

    const records = await this.prisma.staffAttendanceRecord.findMany({
      where: { staffUserId: user.id },
      select: {
        attendanceDate: true,
        status: true,
        checkInAt: true,
        checkOutAt: true,
        isLate: true,
      },
      orderBy: { attendanceDate: "desc" },
      take: 14,
    });
    return { scope: "own_staff_attendance_only", records };
  }

  private async subjects(user: AuthPrincipal): Promise<Record<string, unknown>> {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: {
        section: {
          select: {
            name: true,
            semesterId: true,
            semester: { select: { name: true, number: true } },
          },
        },
      },
    });
    if (profile) {
      const rows = await this.prisma.subject.findMany({
        where: {
          semesterId: profile.section.semesterId,
          isActive: true,
        },
        select: { id: true, code: true, name: true },
        orderBy: { code: "asc" },
      });
      return {
        scope: "own_current_semester",
        section: profile.section.name,
        semester: profile.section.semester,
        subjects: rows,
      };
    }
    const assignments =
      await this.prisma.facultySubjectAssignment.findMany({
        where: {
          facultyId: user.id,
          isActive: true,
          OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
        },
        select: {
          subject: { select: { id: true, code: true, name: true } },
          section: { select: { id: true, name: true } },
        },
        orderBy: { validFrom: "desc" },
        take: 30,
      });
    return { scope: "own_active_assignments", assignments };
  }

  private async learn(user: AuthPrincipal): Promise<Record<string, unknown>> {
    const [profile, courses, completedLessons, results] = await Promise.all([
      this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
        select: { departmentId: true, programmeId: true },
      }),
      this.prisma.course.findMany({
        where: {
          collegeId: user.collegeId,
          status: "PUBLISHED",
        },
        select: {
          id: true,
          code: true,
          title: true,
          category: true,
          level: true,
          departmentId: true,
          programmeId: true,
        },
        orderBy: { title: "asc" },
        take: 50,
      }),
      this.prisma.studentProgress.count({ where: { studentId: user.id } }),
      this.prisma.assessmentResult.findMany({
        where: { studentId: user.id },
        select: {
          score: true,
          passed: true,
          completedAt: true,
          assessment: { select: { title: true } },
          course: { select: { code: true, title: true } },
        },
        orderBy: { completedAt: "desc" },
        take: 10,
      }),
    ]);
    const visible = courses.filter(
      (course) =>
        (!course.departmentId ||
          course.departmentId === profile?.departmentId) &&
        (!course.programmeId || course.programmeId === profile?.programmeId),
    );
    return {
      scope: "published_role_scoped_courses",
      courses: visible,
      completedLessons,
      recentAssessmentResults: results,
    };
  }

  private async campus(
    user: AuthPrincipal,
    message: string,
  ): Promise<Record<string, unknown>> {
    const terms = message
      .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 3)
      .slice(0, 5);
    const rooms = await this.prisma.room.findMany({
      where: {
        floor: { block: { campus: { collegeId: user.collegeId } } },
        isActive: true,
        archivedAt: null,
        ...(terms.length
          ? {
              OR: terms.flatMap((term) => [
                { name: { contains: term, mode: "insensitive" as const } },
                { code: { contains: term, mode: "insensitive" as const } },
              ]),
            }
          : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        roomType: true,
        floor: {
          select: {
            name: true,
            level: true,
            block: {
              select: {
                name: true,
                campus: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
      take: 20,
    });
    return { scope: "active_campus_locations", rooms };
  }

  private async issues(user: AuthPrincipal): Promise<Record<string, unknown>> {
    const issues = await this.prisma.issue.findMany({
      where: this.access.issueWhere(user),
      select: {
        id: true,
        issueNumber: true,
        title: true,
        status: true,
        priority: true,
        createdAt: true,
        updatedAt: true,
        resolutionDueAt: true,
        category: { select: { name: true } },
        room: { select: { name: true, code: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 15,
    });
    return {
      scope: "issues_visible_to_authenticated_user",
      issues,
      note: "AVS Bot can explain status but cannot create, assign, update, resolve, or verify an issue.",
    };
  }

  private async announcements(
    user: AuthPrincipal,
  ): Promise<Record<string, unknown>> {
    const receipts = await this.prisma.announcementReadReceipt.findMany({
      where: {
        userId: user.id,
        announcement: {
          collegeId: user.collegeId,
          status: {
            in: ["PUBLISHED", "PARTIALLY_DELIVERED"],
          },
          archivedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      },
      select: {
        deliveryStatus: true,
        readAt: true,
        announcement: {
          select: {
            id: true,
            title: true,
            message: true,
            category: true,
            priority: true,
            publishedAt: true,
            expiresAt: true,
          },
        },
      },
      orderBy: { announcement: { publishedAt: "desc" } },
      take: 12,
    });
    return { scope: "announcements_delivered_to_user", announcements: receipts };
  }

  private async profile(user: AuthPrincipal): Promise<Record<string, unknown>> {
    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        publicId: true,
        fullName: true,
        collegeIdentityId: true,
        email: true,
        mobile: true,
        status: true,
        profileCompletionStatus: true,
        profileCompletionPercentage: true,
        profileRejectionReason: true,
        studentProfile: {
          select: {
            studentId: true,
            registerNumber: true,
            studyYear: true,
            department: { select: { name: true } },
            programme: { select: { name: true } },
            section: { select: { name: true } },
          },
        },
        staffProfile: {
          select: {
            employeeId: true,
            designation: true,
            department: { select: { name: true } },
          },
        },
      },
    });
    return {
      scope: "own_profile_only",
      profile: record,
      note: "AVS Bot cannot verify or change profile details.",
    };
  }

  private async profileSummary(
    user: AuthPrincipal,
  ): Promise<Record<string, unknown>> {
    return {
      user: {
        name: user.fullName,
        roles: user.roles,
        profileCompletionStatus: user.profileCompletionStatus,
        profileCompletionPercentage: user.profileCompletionPercentage,
      },
      capabilities:
        "AVS Bot can explain your own attendance, subjects, AVS Learn and Skill content, campus locations, visible issue status, delivered announcements, profile progress, and feedback process.",
    };
  }
}
