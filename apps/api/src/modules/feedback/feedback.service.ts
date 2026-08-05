import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import QRCode from "qrcode";
import { stringify } from "csv-stringify/sync";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ulid } from "ulid";
import { AccessService } from "../../common/access/access.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { FeedbackPriority, FeedbackQrStatus, FeedbackSentiment, FeedbackSubmissionRule, FeedbackSubmissionStatus, FeedbackTargetType, Prisma } from "../../generated/prisma/client";
import { AuditService } from "../audit/audit.service";
import type {
  AssignFeedbackDto,
  BulkGenerateQrDto,
  CreateFeedbackCycleDto,
  CreateFeedbackQrDto,
  CreateFeedbackQuestionDto,
  CreateFeedbackTargetDto,
  FeedbackCycleQueryDto,
  FeedbackDashboardQueryDto,
  FeedbackQrQueryDto,
  FeedbackQuestionQueryDto,
  FeedbackSettingsDto,
  FeedbackSubmissionQueryDto,
  FeedbackSubmissionStatusDto,
  FeedbackTargetQueryDto,
  ReopenFeedbackDto,
  SubmitFeedbackDto,
  UpdateFeedbackCycleDto,
  UpdateFeedbackQuestionDto,
  UpdateFeedbackTargetDto,
} from "./dto/feedback.dto";
import { createFeedbackReportPdf, createFeedbackReportXlsx, type FeedbackReportMetadata, type FeedbackReportRow } from "./feedback-report";
import { createQrPosterPdf } from "./qr-poster";

const studentFeedbackPermissions = ["feedback.scan", "feedback.submit", "feedback.read_own"];
const managementReadPermissions = ["feedback.read_staff", "feedback.read_department", "feedback.read_college"];
const locationTargetTypes = new Set<FeedbackTargetType>([
  "BUILDING",
  "BLOCK",
  "FLOOR",
  "CLASSROOM",
  "LABORATORY",
  "LIBRARY",
  "CANTEEN",
  "TRANSPORT",
  "MAINTENANCE",
  "SECURITY",
  "OFFICE",
  "CAMPUS_SERVICE",
  "OTHER_SERVICE",
]);
const staffTargetTypes = new Set<FeedbackTargetType>(["STAFF", "HOD", "PRINCIPAL", "VICE_PRINCIPAL"]);
const studentManualTargetTypes = [...staffTargetTypes];
const submissionTicketTtlSeconds = 10 * 60;
const terminalFeedbackStatuses = new Set<FeedbackSubmissionStatus>(["RESOLVED", "REJECTED", "ARCHIVED"]);
const workflowTransitions: Record<FeedbackSubmissionStatus, ReadonlySet<FeedbackSubmissionStatus>> = {
  NEW: new Set(["VIEWED", "UNDER_REVIEW", "ASSIGNED", "ACTION_REQUIRED", "RESOLVED", "REJECTED", "ARCHIVED"]),
  VIEWED: new Set(["UNDER_REVIEW", "ASSIGNED", "ACTION_REQUIRED", "RESOLVED", "REJECTED", "ARCHIVED"]),
  UNDER_REVIEW: new Set(["ASSIGNED", "ACTION_REQUIRED", "RESOLVED", "REJECTED", "ARCHIVED"]),
  ASSIGNED: new Set(["UNDER_REVIEW", "ACTION_REQUIRED", "RESOLVED", "REJECTED", "ARCHIVED"]),
  ACTION_REQUIRED: new Set(["UNDER_REVIEW", "ASSIGNED", "RESOLVED", "REJECTED", "ARCHIVED"]),
  RESOLVED: new Set(["UNDER_REVIEW", "ARCHIVED"]),
  REJECTED: new Set(["UNDER_REVIEW", "ARCHIVED"]),
  ARCHIVED: new Set(),
};
interface RequestFingerprint {
  ip?: string;
  userAgent?: string;
}

export interface FeedbackSubmissionTicketClaims {
  version: 1;
  purpose: "feedback-submit";
  userId: string;
  collegeId: string;
  targetId: string;
  targetUuid: string;
  qrCodeId: string | null;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

interface ActiveFeedbackPolicy {
  submissionRule: FeedbackSubmissionRule;
  anonymousMode: boolean;
  commentsRequired: boolean;
  staffCanViewComments: boolean;
  studentIdentityVisibleToManagement: boolean;
  negativeFeedbackRequiresInvestigation: boolean;
}

interface PublicTargetPayload {
  targetUuid: string;
  targetType: FeedbackTargetType;
  targetName: string;
  description: string | null;
  serviceCode: string | null;
  isActive: boolean;
  staff?: {
    publicId: string;
    collegeIdentityId: string;
    fullName: string;
    profilePhotoKey: string | null;
    staffProfile: {
      employeeId: string;
      designation: string | null;
      department: { id: string; code: string; name: string } | null;
    } | null;
  } | null;
  department?: { id: string; code: string; name: string } | null;
  campus?: { id: string; code: string; name: string } | null;
  block?: { id: string; code: string; name: string } | null;
  floor?: { id: string; code: string; name: string; level: number } | null;
  room?: { id: string; code: string; name: string; roomNumber: string | null; roomType: string } | null;
}

interface ManagementSubmissionPayload {
  id: string;
  referenceNumber: string;
  overallRating: number;
  sentiment: FeedbackSentiment;
  status: FeedbackSubmissionStatus;
  priority: FeedbackPriority;
  submittedAt: Date;
  isAnonymous: boolean;
  positiveComment: string | null;
  improvementComment: string | null;
  generalComment: string | null;
  complaintText: string | null;
  target: PublicTargetPayload;
  student: { publicId: string; collegeIdentityId: string; fullName: string };
  feedbackCycle?: { studentIdentityVisibleToManagement: boolean } | null;
}

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async scan(user: AuthPrincipal, rawToken: string, request: RequestFingerprint) {
    this.requireAny(user, ["feedback.scan", ...managementReadPermissions]);
    const token = this.extractToken(rawToken);
    const qr = await this.prisma.feedbackQrCode.findUnique({
      where: { secureTokenHash: this.hashToken(token) },
      include: { target: { include: this.targetInclude() } },
    });
    if (!qr) throw new BadRequestException("Invalid feedback QR code.");
    const validationError = this.qrValidationError(qr);
    if (validationError) {
      await this.recordScan(qr.id, user.id, false, validationError, request);
      throw new BadRequestException(validationError);
    }
    if (qr.target.collegeId !== user.collegeId) {
      await this.recordScan(qr.id, user.id, false, "QR code does not belong to this college.", request);
      throw new BadRequestException("Invalid feedback QR code.");
    }
    const recent = await this.prisma.feedbackScanLog.findFirst({
      where: { qrCodeId: qr.id, studentUserId: user.id, successStatus: true, scannedAt: { gte: new Date(Date.now() - 10_000) } },
      select: { id: true },
    });
    if (!recent) {
      await this.prisma.$transaction([
        this.prisma.feedbackQrCode.update({ where: { id: qr.id }, data: { scanCount: { increment: 1 }, lastScannedAt: new Date() } }),
        this.prisma.feedbackScanLog.create({ data: this.scanLogData(qr.id, user.id, true, undefined, request) }),
      ]);
    }
    const questions = await this.questionsForTarget(user.collegeId, qr.target.targetType);
    return {
      qrId: qr.qrUuid,
      target: this.publicTarget(qr.target),
      questions,
      submissionTicket: this.issueSubmissionTicket(user, qr.target.id, qr.target.targetUuid, qr.id),
      submissionTicketExpiresInSeconds: submissionTicketTtlSeconds,
    };
  }

  async targets(user: AuthPrincipal, query: FeedbackTargetQueryDto) {
    this.requireAny(user, ["feedback.scan", ...managementReadPermissions, "feedback.targets.manage"]);
    const search = query.search?.trim();
    const student = this.isStudentFeedbackUser(user);
    if (student && query.targetType && !staffTargetTypes.has(query.targetType)) {
      throw new ForbiddenException("Students can manually browse only staff and college leadership feedback targets.");
    }
    const visibility = student
      ? { collegeId: user.collegeId, targetType: { in: studentManualTargetTypes } }
      : await this.targetDiscoveryWhere(user, query.departmentId);
    const targets = await this.prisma.feedbackTarget.findMany({
      where: {
        ...visibility,
        isActive: true,
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.departmentId && student ? { departmentId: query.departmentId } : {}),
        ...(search
          ? {
              OR: [
                { targetName: { contains: search, mode: "insensitive" } },
                { serviceCode: { contains: search, mode: "insensitive" } },
                { staff: { fullName: { contains: search, mode: "insensitive" } } },
                { staff: { collegeIdentityId: { contains: search, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      include: this.targetInclude(),
      orderBy: [{ targetType: "asc" }, { targetName: "asc" }],
      take: 100,
    });
    return targets.map((target) => this.publicTarget(target));
  }

  async target(user: AuthPrincipal, targetUuid: string) {
    this.requireAny(user, ["feedback.scan", ...managementReadPermissions, "feedback.targets.manage"]);
    const student = this.isStudentFeedbackUser(user);
    const visibility = student
      ? { collegeId: user.collegeId, targetType: { in: studentManualTargetTypes } }
      : await this.targetDiscoveryWhere(user);
    const target = await this.prisma.feedbackTarget.findFirst({ where: { targetUuid, isActive: true, AND: [visibility] }, include: this.targetInclude() });
    if (!target) throw new NotFoundException("Feedback target not found.");
    if (student && !staffTargetTypes.has(target.targetType)) {
      throw new ForbiddenException("Scan this target's active QR code before submitting feedback.");
    }
    return {
      target: this.publicTarget(target),
      questions: await this.questionsForTarget(user.collegeId, target.targetType),
      submissionTicket: this.issueSubmissionTicket(user, target.id, target.targetUuid, null),
      submissionTicketExpiresInSeconds: submissionTicketTtlSeconds,
    };
  }

  async submit(user: AuthPrincipal, input: SubmitFeedbackDto, requestId: string, request: RequestFingerprint) {
    this.requireAny(user, ["feedback.submit"]);
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        section: { select: { semesterId: true, semester: { select: { academicYearId: true } } } },
      },
    });
    if (!student) throw new ForbiddenException("Only active student accounts can submit feedback.");
    const ticket = this.verifySubmissionTicket(user, input.submissionTicket, input.targetId);
    const target = await this.prisma.feedbackTarget.findFirst({
      where: { id: ticket.targetId, targetUuid: input.targetId, collegeId: user.collegeId, isActive: true },
      include: this.targetInclude(),
    });
    if (!target) throw new NotFoundException("Feedback target not found.");
    let submittedQr: { id: string; status: FeedbackQrStatus; expiryDate: Date | null; target: { isActive: boolean } } | null = null;
    if (ticket.qrCodeId) {
      submittedQr = await this.prisma.feedbackQrCode.findFirst({
        where: { id: ticket.qrCodeId, targetId: target.id },
        select: { id: true, status: true, expiryDate: true, target: { select: { isActive: true } } },
      });
      if (!submittedQr) throw new BadRequestException("The feedback QR submission ticket is no longer valid.");
      const qrError = this.qrValidationError(submittedQr);
      if (qrError) throw new BadRequestException(qrError);
    } else if (!staffTargetTypes.has(target.targetType)) {
      throw new ForbiddenException("Scan this target's active QR code before submitting feedback.");
    }
    const questions = await this.questionsForTarget(user.collegeId, target.targetType);
    const questionMap = new Map(questions.map((question) => [question.id, question]));
    const ratings = input.ratings.map((rating) => {
      const question = questionMap.get(rating.questionId);
      if (!question) throw new BadRequestException("One or more ratings do not belong to this feedback target.");
      if (question.questionType !== "RATING") throw new BadRequestException("Only rating questions accept a numeric rating.");
      return { questionId: rating.questionId, rating: rating.rating };
    });
    const seen = new Set<string>();
    for (const rating of ratings) {
      if (seen.has(rating.questionId)) throw new BadRequestException("A question cannot be rated more than once.");
      seen.add(rating.questionId);
    }
    const missing = questions.filter((question) => question.isRequired && question.questionType === "RATING" && !seen.has(question.id));
    if (missing.length) throw new BadRequestException("Please complete all required ratings before submitting feedback.");
    if (!ratings.length) throw new BadRequestException("At least one rating answer is required.");
    const settings = await this.feedbackSettings(user.collegeId);
    const cycle = await this.activeCycle(user.collegeId, student.section.semesterId, student.section.semester.academicYearId);
    const policy = this.feedbackPolicy(settings, cycle);
    const comments = {
      positiveComment: this.cleanText(input.positiveComment),
      improvementComment: this.cleanText(input.improvementComment),
      generalComment: this.cleanText(input.generalComment),
      complaintText: this.cleanText(input.complaintText),
    };
    if (policy.commentsRequired && !Object.values(comments).some(Boolean)) {
      throw new BadRequestException("A written comment is required for this feedback cycle.");
    }
    const overallRating = this.average(ratings.map((rating) => rating.rating));
    if (overallRating < 1 || overallRating > 5) throw new BadRequestException("The calculated overall rating is invalid.");
    const sentiment = this.sentiment(overallRating);
    const priority = this.priority(overallRating, comments.complaintText);
    const initialStatus: FeedbackSubmissionStatus = policy.negativeFeedbackRequiresInvestigation && sentiment === "NEGATIVE"
      ? "ACTION_REQUIRED"
      : "NEW";
    const referenceNumber = this.referenceNumber();
    const recipients = await this.feedbackAlertRecipients(user.collegeId, target.departmentId);
    const submissionWindowKey = await this.submissionWindowKey(user.collegeId, policy.submissionRule, cycle?.id);
    const departmentName = target.department?.name ?? target.staff?.staffProfile?.department?.name ?? "Unassigned";
    let submission: {
      referenceNumber: string;
      status: FeedbackSubmissionStatus;
      priority: FeedbackPriority;
      submittedAt: Date;
    };
    try {
      submission = await this.prisma.$transaction(async (tx) => {
        const created = await tx.feedbackSubmission.create({
          data: {
            referenceNumber,
            collegeId: user.collegeId,
            studentUserId: user.id,
            targetId: target.id,
            qrCodeId: submittedQr?.id,
            feedbackCycleId: cycle?.id,
            submissionWindowKey,
            overallRating,
            ...comments,
            isAnonymous: policy.anonymousMode ? (input.isAnonymous ?? true) : false,
            sentiment,
            status: initialStatus,
            priority,
            deviceInfo: { userAgent: request.userAgent?.slice(0, 300) ?? null },
            ipHash: this.hashIp(request.ip),
            ratings: { create: ratings },
          },
        });
        if (submittedQr) {
          await tx.feedbackQrCode.update({ where: { id: submittedQr.id }, data: { feedbackCount: { increment: 1 } } });
        }
        if (recipients.length) {
          const dashboardPath = `/admin/feedback/submissions/${created.id}`;
          const notificationData = {
            submissionId: created.id,
            referenceNumber,
            targetName: target.targetName,
            targetType: target.targetType,
            rating: overallRating,
            department: departmentName,
            dashboardPath,
          };
          const notification = await tx.notification.create({
            data: {
              type: "FEEDBACK_ALERT",
              title: priority === "LOW"
                ? `${target.targetName} feedback submitted`
                : `${target.targetName} feedback needs review`,
              body: `${referenceNumber} | ${target.targetName} | Rating ${overallRating}/5 | Department: ${departmentName}`,
              data: notificationData,
              priority: priority === "CRITICAL" ? "CRITICAL" : priority === "HIGH" ? "HIGH" : priority === "MEDIUM" ? "MEDIUM" : "LOW",
              relatedEntityType: "FeedbackSubmission",
              relatedEntityId: created.id,
              recipients: { createMany: { data: recipients.map((recipient) => ({ userId: recipient.id })), skipDuplicates: true } },
            },
          });
          await tx.outboxEvent.create({
            data: {
              aggregateType: "FeedbackSubmission",
              aggregateId: created.id,
              eventType: "feedback.submitted",
              payload: { notificationId: notification.id, priority, ...notificationData },
              idempotencyKey: `feedback.submitted:${created.id}`,
            },
          });
        }
        await this.audit.record({ actorId: user.id, action: "feedback.submitted", entityType: "FeedbackSubmission", entityId: created.id, afterValue: { referenceNumber, targetId: target.targetUuid, qrCodeId: submittedQr?.id ?? null, overallRating, sentiment, priority, status: initialStatus }, requestId }, tx);
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) throw error;
      const duplicate = await this.prisma.feedbackSubmission.findFirst({
        where: { studentUserId: user.id, targetId: target.id, submissionWindowKey },
        select: { referenceNumber: true, submittedAt: true },
      });
      if (!duplicate) throw error;
      throw new ConflictException({
        message: "You have already submitted feedback for this target within the allowed feedback window.",
        referenceNumber: duplicate.referenceNumber,
        submittedAt: duplicate.submittedAt,
      });
    }
    return {
      referenceNumber: submission.referenceNumber,
      status: submission.status,
      priority: submission.priority,
      submittedAt: submission.submittedAt,
      message: "Thank you. Your feedback has been submitted.",
    };
  }

  async myHistory(user: AuthPrincipal, page: number, pageSize: number) {
    this.requireAny(user, ["feedback.read_own"]);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.feedbackSubmission.findMany({
        where: { studentUserId: user.id, collegeId: user.collegeId },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { submittedAt: "desc" },
        include: { target: { include: this.targetInclude() }, ratings: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } } },
      }),
      this.prisma.feedbackSubmission.count({ where: { studentUserId: user.id, collegeId: user.collegeId } }),
    ]);
    return {
      data: data.map((submission) => ({
        referenceNumber: submission.referenceNumber,
        target: this.publicTarget(submission.target),
        overallRating: submission.overallRating,
        sentiment: submission.sentiment,
        status: submission.status,
        submittedAt: submission.submittedAt,
        comments: {
          positive: submission.positiveComment,
          improvement: submission.improvementComment,
          general: submission.generalComment,
          complaint: submission.complaintText,
        },
        ratings: submission.ratings.map((rating) => ({ category: rating.question.category, rating: rating.rating })),
      })),
      meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
    };
  }

  async dashboard(user: AuthPrincipal, query: FeedbackDashboardQueryDto) {
    const targetWhere = await this.scopedTargetWhere(user, query.departmentId);
    const submittedAt = this.dateRange(query.from, query.to);
    const baseWhere: Prisma.FeedbackSubmissionWhereInput = {
      target: { ...targetWhere, ...(query.targetType ? { targetType: query.targetType } : {}) },
      ...(submittedAt ? { submittedAt } : {}),
    };
    const [total, aggregate, submissions, activeQr, disabledQr, pendingActions, resolved] = await this.prisma.$transaction([
      this.prisma.feedbackSubmission.count({ where: baseWhere }),
      this.prisma.feedbackSubmission.aggregate({ where: baseWhere, _avg: { overallRating: true } }),
      this.prisma.feedbackSubmission.findMany({
        where: baseWhere,
        take: 5000,
        orderBy: { submittedAt: "desc" },
        select: {
          overallRating: true,
          sentiment: true,
          status: true,
          priority: true,
          submittedAt: true,
          target: { select: { id: true, targetName: true, targetType: true, department: { select: { name: true } } } },
          ratings: { select: { rating: true, question: { select: { category: true } } } },
        },
      }),
      this.prisma.feedbackQrCode.count({ where: { status: "ACTIVE", target: targetWhere } }),
      this.prisma.feedbackQrCode.count({ where: { status: { in: ["DISABLED", "EXPIRED", "ARCHIVED"] }, target: targetWhere } }),
      this.prisma.feedbackSubmission.count({ where: { ...baseWhere, status: { in: ["NEW", "UNDER_REVIEW", "ASSIGNED", "ACTION_REQUIRED"] } } }),
      this.prisma.feedbackSubmission.count({ where: { ...baseWhere, status: "RESOLVED" } }),
    ]);
    const ratedStaffTargets = new Set(submissions.filter((row) => staffTargetTypes.has(row.target.targetType)).map((row) => row.target.id));
    const buildingFeedback = submissions.filter((row) => locationTargetTypes.has(row.target.targetType)).length;
    return {
      summary: {
        totalFeedbackSubmissions: total,
        averageCollegeRating: this.round(aggregate._avg.overallRating ?? 0),
        totalFacultyRated: ratedStaffTargets.size,
        totalStaffRated: ratedStaffTargets.size,
        totalBuildingFeedback: buildingFeedback,
        positiveFeedbackCount: submissions.filter((row) => row.sentiment === "POSITIVE").length,
        neutralFeedbackCount: submissions.filter((row) => row.sentiment === "NEUTRAL").length,
        negativeFeedbackCount: submissions.filter((row) => row.sentiment === "NEGATIVE").length,
        criticalComplaints: submissions.filter((row) => row.priority === "CRITICAL").length,
        pendingActions,
        resolvedIssues: resolved,
        activeQrCodes: activeQr,
        disabledQrCodes: disabledQr,
        analyticsTruncated: submissions.length === 5000,
      },
      ratingDistribution: [1, 2, 3, 4, 5].map((rating) => ({ rating, count: submissions.filter((row) => row.overallRating === rating).length })),
      departmentWise: this.breakdownAverage(submissions.map((row) => ({ name: row.target.department?.name ?? "Unassigned", rating: row.overallRating }))),
      targetWise: this.breakdownAverage(submissions.map((row) => ({ name: row.target.targetName, rating: row.overallRating }))).slice(0, 20),
      monthlyTrend: this.monthlyTrend(submissions),
      categoryWise: this.breakdownAverage(submissions.flatMap((row) => row.ratings.map((rating) => ({ name: rating.question.category, rating: rating.rating })))),
      statusDistribution: this.countBreakdown(submissions.map((row) => row.status)),
      sentimentDistribution: this.countBreakdown(submissions.map((row) => row.sentiment)),
    };
  }

  async staffAnalytics(user: AuthPrincipal, staffId: string) {
    const staff = staffId === "me"
      ? await this.prisma.user.findFirst({ where: { id: user.id, collegeId: user.collegeId }, include: { staffProfile: { include: { department: true } } } })
      : await this.prisma.user.findFirst({ where: { collegeId: user.collegeId, OR: [{ publicId: staffId }, { collegeIdentityId: staffId }, { staffProfile: { employeeId: staffId } }] }, include: { staffProfile: { include: { department: true } } } });
    if (!staff?.staffProfile) throw new NotFoundException("Staff member not found.");
    await this.assertCanReadStaff(user, staff.id, staff.staffProfile.departmentId);
    const targetIds = (await this.prisma.feedbackTarget.findMany({ where: { collegeId: user.collegeId, staffUserId: staff.id }, select: { id: true } })).map((target) => target.id);
    const submissions = targetIds.length
      ? await this.prisma.feedbackSubmission.findMany({
          where: { targetId: { in: targetIds } },
          include: {
            ratings: { include: { question: true } },
            actions: { orderBy: { createdAt: "desc" }, take: 5 },
            feedbackCycle: { select: { staffCanViewComments: true } },
          },
          orderBy: { submittedAt: "desc" },
          take: 5000,
        })
      : [];
    const settings = await this.feedbackSettings(user.collegeId);
    const management = this.canReadCollege(user) || this.canReadDepartment(user, staff.staffProfile.departmentId);
    const attendance = await this.staffAttendanceSummary(staff.id);
    const categoryRatings = this.breakdownAverage(submissions.flatMap((row) => row.ratings.map((rating) => ({ name: rating.question.category, rating: rating.rating }))));
    const average = this.round(submissions.length ? submissions.reduce((sum, row) => sum + row.overallRating, 0) / submissions.length : 0);
    return {
      staff: {
        publicId: staff.publicId,
        staffId: staff.staffProfile.employeeId,
        name: staff.fullName,
        designation: staff.staffProfile.designation,
        department: staff.staffProfile.department?.name ?? null,
        profilePhotoKey: staff.profilePhotoKey,
      },
      overallAverageRating: average,
      ratingBadge: this.ratingBadge(average),
      totalFeedbackCount: submissions.length,
      categoryRatings,
      monthlyTrend: this.monthlyTrend(submissions),
      positiveFeedbackPercentage: this.percent(submissions.filter((row) => row.sentiment === "POSITIVE").length, submissions.length),
      negativeFeedbackPercentage: this.percent(submissions.filter((row) => row.sentiment === "NEGATIVE").length, submissions.length),
      attendance,
      comments: submissions
        .filter((row) => management || (row.feedbackCycle?.staffCanViewComments ?? settings.staffCanViewComments))
        .slice(0, 100)
        .map((row) => ({ referenceNumber: row.referenceNumber, rating: row.overallRating, submittedAt: row.submittedAt, positiveComment: row.positiveComment, improvementComment: row.improvementComment, generalComment: row.generalComment, complaintText: row.complaintText, status: row.status })),
      actionStatus: this.countBreakdown(submissions.map((row) => row.status)),
    };
  }

  async departmentAnalytics(user: AuthPrincipal, departmentId: string) {
    if (!(this.canReadCollege(user) || this.canReadDepartment(user, departmentId))) throw new ForbiddenException("You cannot access feedback for this department.");
    const department = await this.prisma.department.findFirst({ where: { id: departmentId, collegeId: user.collegeId }, select: { id: true, name: true, code: true } });
    if (!department) throw new NotFoundException("Department not found.");
    return { department, ...(await this.dashboard(user, { departmentId })) };
  }

  async locationAnalytics(user: AuthPrincipal, targetUuid: string) {
    const targetWhere = await this.scopedTargetWhere(user);
    const target = await this.prisma.feedbackTarget.findFirst({ where: { targetUuid, AND: [targetWhere] }, include: this.targetInclude() });
    if (!target) throw new NotFoundException("Feedback target not found.");
    const submissions = await this.prisma.feedbackSubmission.findMany({
      where: { targetId: target.id },
      include: { ratings: { include: { question: true } } },
      orderBy: { submittedAt: "desc" },
      take: 5000,
    });
    return {
      target: this.publicTarget(target),
      averageRating: this.round(submissions.length ? submissions.reduce((sum, row) => sum + row.overallRating, 0) / submissions.length : 0),
      totalFeedbackCount: submissions.length,
      categoryRatings: this.breakdownAverage(submissions.flatMap((row) => row.ratings.map((rating) => ({ name: rating.question.category, rating: rating.rating })))),
      monthlyTrend: this.monthlyTrend(submissions),
      sentimentDistribution: this.countBreakdown(submissions.map((row) => row.sentiment)),
      openIssues: submissions.filter((row) => ["NEW", "UNDER_REVIEW", "ASSIGNED", "ACTION_REQUIRED"].includes(row.status)).length,
    };
  }

  async listQr(user: AuthPrincipal, query: FeedbackQrQueryDto) {
    this.requireAny(user, ["feedback.qr.manage", "feedback.qr.download"]);
    const targetWhere: Prisma.FeedbackTargetWhereInput = { collegeId: user.collegeId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.feedbackQrCode.findMany({
        where: {
          target: {
            ...targetWhere,
            ...(query.search ? { targetName: { contains: query.search.trim(), mode: "insensitive" } } : {}),
          },
          ...(query.status ? { status: query.status } : {}),
        },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
        include: { target: { include: this.targetInclude() }, createdBy: { select: { fullName: true, collegeIdentityId: true } } },
      }),
      this.prisma.feedbackQrCode.count({
        where: {
          target: {
            ...targetWhere,
            ...(query.search ? { targetName: { contains: query.search.trim(), mode: "insensitive" } } : {}),
          },
          ...(query.status ? { status: query.status } : {}),
        },
      }),
    ]);
    return {
      data: data.map((qr) => ({
        id: qr.qrUuid,
        qrId: qr.qrUuid,
        target: this.publicTarget(qr.target),
        status: qr.status,
        expiryDate: qr.expiryDate,
        scanCount: qr.scanCount,
        feedbackCount: qr.feedbackCount,
        lastScannedAt: qr.lastScannedAt,
        createdAt: qr.createdAt,
        createdBy: qr.createdBy?.fullName ?? null,
        secureUrl: qr.qrUrl,
      })),
      meta: { page: query.page, pageSize: query.pageSize, total, pageCount: Math.ceil(total / query.pageSize) },
    };
  }

  async createTarget(user: AuthPrincipal, input: CreateFeedbackTargetDto, requestId: string) {
    this.requireAny(user, ["feedback.targets.manage"]);
    const data = await this.validatedTargetData(user, input);
    const target = await this.prisma.feedbackTarget.create({
      data: { ...data, collegeId: user.collegeId, targetName: input.targetName.trim(), description: this.cleanText(input.description), createdById: user.id },
      include: this.targetInclude(),
    });
    await this.audit.record({ actorId: user.id, action: "feedback.target_created", entityType: "FeedbackTarget", entityId: target.id, afterValue: { targetUuid: target.targetUuid, targetType: target.targetType, targetName: target.targetName }, requestId });
    return this.publicTarget(target);
  }

  async updateTarget(user: AuthPrincipal, targetUuid: string, input: UpdateFeedbackTargetDto, requestId: string) {
    this.requireAny(user, ["feedback.targets.manage"]);
    if (input.targetName === undefined && input.description === undefined && input.isActive === undefined) {
      throw new BadRequestException("Provide at least one feedback target field to update.");
    }
    const current = await this.prisma.feedbackTarget.findFirst({
      where: { targetUuid, collegeId: user.collegeId },
      include: this.targetInclude(),
    });
    if (!current) throw new NotFoundException("Feedback target not found.");
    const updated = await this.prisma.feedbackTarget.update({
      where: { id: current.id },
      data: {
        ...(input.targetName !== undefined ? { targetName: input.targetName.trim() } : {}),
        ...(input.description !== undefined ? { description: this.cleanText(input.description) ?? null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      include: this.targetInclude(),
    });
    await this.audit.record({
      actorId: user.id,
      action: "feedback.target_updated",
      entityType: "FeedbackTarget",
      entityId: current.id,
      beforeValue: { targetName: current.targetName, description: current.description, isActive: current.isActive },
      afterValue: { targetName: updated.targetName, description: updated.description, isActive: updated.isActive },
      requestId,
    });
    return this.publicTarget(updated);
  }

  async createQr(user: AuthPrincipal, input: CreateFeedbackQrDto, requestId: string) {
    this.requireAny(user, ["feedback.qr.manage"]);
    const target = await this.prisma.feedbackTarget.findFirst({ where: { targetUuid: input.targetId, collegeId: user.collegeId, isActive: true }, select: { id: true, targetUuid: true, targetName: true } });
    if (!target) throw new NotFoundException("Feedback target not found.");
    const qr = await this.createQrForTarget(target.id, user.id, input.expiryDate ? new Date(input.expiryDate) : undefined);
    await this.audit.record({ actorId: user.id, action: "feedback.qr_created", entityType: "FeedbackQrCode", entityId: qr.id, afterValue: { qrUuid: qr.qrUuid, targetUuid: target.targetUuid }, requestId });
    return { id: qr.qrUuid, qrId: qr.qrUuid, secureUrl: qr.qrUrl, targetName: target.targetName, status: qr.status, expiryDate: qr.expiryDate };
  }

  async bulkGenerate(user: AuthPrincipal, input: BulkGenerateQrDto, requestId: string) {
    this.requireAny(user, ["feedback.qr.manage", "feedback.targets.manage"]);
    const allowed = new Set(input.targetTypes ?? Object.values(FeedbackTargetType));
    let targetsCreated = 0;
    let qrCreated = 0;
    const ensureTarget = async (data: Omit<Prisma.FeedbackTargetUncheckedCreateInput, "id" | "targetUuid" | "createdAt" | "updatedAt" | "collegeId" | "createdById">) => {
      if (!allowed.has(data.targetType)) return;
      const existing = await this.prisma.feedbackTarget.findFirst({
        where: {
          collegeId: user.collegeId,
          targetType: data.targetType,
          ...(data.staffUserId ? { staffUserId: data.staffUserId } : {}),
          ...(data.departmentId ? { departmentId: data.departmentId } : {}),
          ...(data.campusId ? { campusId: data.campusId } : {}),
          ...(data.blockId ? { blockId: data.blockId } : {}),
          ...(data.floorId ? { floorId: data.floorId } : {}),
          ...(data.roomId ? { roomId: data.roomId } : {}),
          ...(data.serviceCode ? { serviceCode: data.serviceCode } : {}),
        },
        select: { id: true },
      });
      const target = existing ?? await this.prisma.feedbackTarget.create({ data: { ...data, collegeId: user.collegeId, createdById: user.id }, select: { id: true } });
      if (!existing) targetsCreated += 1;
      if (!(await this.prisma.feedbackQrCode.findFirst({ where: { targetId: target.id, status: "ACTIVE" }, select: { id: true } }))) {
        await this.createQrForTarget(target.id, user.id);
        qrCreated += 1;
      }
    };
    const [staff, departments, blocks, floors, rooms] = await Promise.all([
      this.prisma.staffProfile.findMany({ where: { collegeId: user.collegeId, user: { status: "ACTIVE" } }, include: { user: { include: { roles: { include: { role: true } } } }, department: true } }),
      this.prisma.department.findMany({ where: { collegeId: user.collegeId, isActive: true } }),
      this.prisma.block.findMany({ where: { isActive: true, campus: { collegeId: user.collegeId } }, include: { campus: true } }),
      this.prisma.floor.findMany({ where: { isActive: true, block: { campus: { collegeId: user.collegeId } } }, include: { block: { include: { campus: true } } } }),
      this.prisma.room.findMany({ where: { isActive: true, floor: { block: { campus: { collegeId: user.collegeId } } } }, include: { floor: { include: { block: true } } } }),
    ]);
    for (const profile of staff) {
      const roles = profile.user.roles.map((role) => role.role.code);
      const targetType: FeedbackTargetType = roles.includes("PRINCIPAL") ? "PRINCIPAL" : roles.includes("VICE_PRINCIPAL") ? "VICE_PRINCIPAL" : roles.includes("HOD") ? "HOD" : "STAFF";
      await ensureTarget({ targetType, staffUserId: profile.userId, departmentId: profile.departmentId, targetName: profile.user.fullName, description: profile.designation ?? undefined, isActive: true });
    }
    for (const department of departments) await ensureTarget({ targetType: "DEPARTMENT", departmentId: department.id, targetName: department.name, description: department.code, isActive: true });
    for (const block of blocks) {
      await ensureTarget({ targetType: "BUILDING", campusId: block.campusId, blockId: block.id, targetName: block.name, description: block.campus.name, isActive: true });
      await ensureTarget({ targetType: "BLOCK", campusId: block.campusId, blockId: block.id, targetName: block.name, description: block.campus.name, isActive: true });
    }
    for (const floor of floors) await ensureTarget({ targetType: "FLOOR", campusId: floor.block.campusId, blockId: floor.blockId, floorId: floor.id, targetName: `${floor.block.name} - ${floor.name}`, isActive: true });
    for (const room of rooms) {
      await ensureTarget({ targetType: room.roomType === "LABORATORY" ? "LABORATORY" : "CLASSROOM", departmentId: room.departmentId ?? undefined, blockId: room.floor.blockId, floorId: room.floorId, roomId: room.id, targetName: room.name, description: room.roomNumber ?? undefined, isActive: true });
    }
    for (const [serviceCode, targetName, targetType] of [
      ["LIBRARY", "Library", "LIBRARY"],
      ["CANTEEN", "Canteen", "CANTEEN"],
      ["TRANSPORT", "Transport", "TRANSPORT"],
      ["MAINTENANCE", "Maintenance services", "MAINTENANCE"],
      ["SECURITY", "Security services", "SECURITY"],
      ["OFFICE", "Office administration", "OFFICE"],
      ["PLACEMENT", "Placement cell", "CAMPUS_SERVICE"],
      ["TRAINING", "Training cell", "CAMPUS_SERVICE"],
      ["HOSTEL", "Hostel", "CAMPUS_SERVICE"],
      ["SPORTS", "Sports facilities", "CAMPUS_SERVICE"],
      ["MEDICAL", "Medical room", "CAMPUS_SERVICE"],
      ["DRINKING_WATER", "Drinking water", "CAMPUS_SERVICE"],
      ["RESTROOM", "Restrooms", "CAMPUS_SERVICE"],
    ] as const) await ensureTarget({ targetType, serviceCode, targetName, isActive: true });
    await this.audit.record({ actorId: user.id, action: "feedback.qr_bulk_generated", entityType: "FeedbackQrCode", afterValue: { targetsCreated, qrCreated, targetTypes: [...allowed] }, requestId });
    return { targetsCreated, qrCreated };
  }

  async setQrStatus(user: AuthPrincipal, qrUuid: string, status: FeedbackQrStatus, requestId: string) {
    this.requireAny(user, ["feedback.qr.manage"]);
    const qr = await this.prisma.feedbackQrCode.findFirst({ where: { qrUuid, target: { collegeId: user.collegeId } }, select: { id: true, status: true } });
    if (!qr) throw new NotFoundException("QR code not found.");
    const updated = await this.prisma.feedbackQrCode.update({ where: { id: qr.id }, data: { status } });
    await this.audit.record({ actorId: user.id, action: "feedback.qr_status_changed", entityType: "FeedbackQrCode", entityId: qr.id, beforeValue: { status: qr.status }, afterValue: { status }, requestId });
    return { id: updated.qrUuid, status: updated.status };
  }

  async regenerateQr(user: AuthPrincipal, qrUuid: string, requestId: string) {
    this.requireAny(user, ["feedback.qr.manage"]);
    const qr = await this.prisma.feedbackQrCode.findFirst({ where: { qrUuid, target: { collegeId: user.collegeId } }, include: { target: true } });
    if (!qr) throw new NotFoundException("QR code not found.");
    const token = this.newToken();
    const updated = await this.prisma.feedbackQrCode.update({
      where: { id: qr.id },
      data: { secureTokenHash: this.hashToken(token), qrUrl: this.webFeedbackUrl(token), status: "ACTIVE", scanCount: 0, lastScannedAt: null },
    });
    await this.audit.record({ actorId: user.id, action: "feedback.qr_regenerated", entityType: "FeedbackQrCode", entityId: qr.id, afterValue: { qrUuid, targetUuid: qr.target.targetUuid }, requestId });
    return { id: updated.qrUuid, secureUrl: updated.qrUrl, status: updated.status };
  }

  async downloadQr(user: AuthPrincipal, qrUuid: string, format: string, requestId: string) {
    this.requireAny(user, ["feedback.qr.download"]);
    if (!["png", "svg", "pdf", "poster"].includes(format)) {
      throw new BadRequestException("QR download format must be png, svg, pdf, or poster.");
    }
    const qr = await this.prisma.feedbackQrCode.findFirst({ where: { qrUuid, target: { collegeId: user.collegeId } }, include: { target: { include: this.targetInclude() } } });
    if (!qr) throw new NotFoundException("QR code not found.");
    const baseName = `${qr.target.targetName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "feedback-qr"}-${qr.qrUuid}`;
    await this.audit.record({ actorId: user.id, action: "feedback.qr_downloaded", entityType: "FeedbackQrCode", entityId: qr.id, afterValue: { qrUuid, targetType: qr.target.targetType, format }, requestId });
    if (format === "svg") {
      return { fileName: `${baseName}.svg`, contentType: "image/svg+xml; charset=utf-8", body: Buffer.from(await QRCode.toString(qr.qrUrl, { type: "svg", margin: 2, width: 960 }), "utf8") };
    }
    if (format === "pdf") {
      return {
        fileName: `${baseName}-poster.pdf`,
        contentType: "application/pdf",
        body: await createQrPosterPdf(qr.qrUrl, qr.target),
      };
    }
    if (format === "poster") {
      return { fileName: `${baseName}-poster.svg`, contentType: "image/svg+xml; charset=utf-8", body: Buffer.from(await this.posterSvg(qr), "utf8") };
    }
    return { fileName: `${baseName}.png`, contentType: "image/png", body: await QRCode.toBuffer(qr.qrUrl, { type: "png", margin: 2, width: 960 }) };
  }

  async listSubmissions(user: AuthPrincipal, query: FeedbackSubmissionQueryDto) {
    const targetWhere = await this.scopedTargetWhere(user, query.departmentId);
    const submittedAt = this.dateRange(query.from, query.to);
    const search = query.search?.trim();
    const where: Prisma.FeedbackSubmissionWhereInput = {
      target: { ...targetWhere, ...(query.targetType ? { targetType: query.targetType } : {}) },
      ...(query.status ? { status: query.status } : {}),
      ...(query.rating ? { overallRating: query.rating } : {}),
      ...(query.sentiment ? { sentiment: query.sentiment } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(submittedAt ? { submittedAt } : {}),
      ...(search ? {
        OR: [
          { referenceNumber: { contains: search, mode: "insensitive" } },
          { target: { targetName: { contains: search, mode: "insensitive" } } },
        ],
      } : {}),
    };
    const orderBy = { [query.sortBy]: query.sortOrder } as Prisma.FeedbackSubmissionOrderByWithRelationInput;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.feedbackSubmission.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy,
        include: {
          target: { include: this.targetInclude() },
          student: { select: { publicId: true, collegeIdentityId: true, fullName: true } },
          feedbackCycle: { select: { studentIdentityVisibleToManagement: true } },
        },
      }),
      this.prisma.feedbackSubmission.count({ where }),
    ]);
    const settings = await this.feedbackSettings(user.collegeId);
    const identityOverride = user.permissions.includes("feedback.settings.manage");
    return {
      data: data.map((submission) => this.managementSubmission(
        submission,
        identityOverride || (submission.feedbackCycle?.studentIdentityVisibleToManagement ?? settings.studentIdentityVisibleToManagement),
      )),
      meta: { page: query.page, pageSize: query.pageSize, total, pageCount: Math.ceil(total / query.pageSize) },
    };
  }

  async submissionDetail(user: AuthPrincipal, id: string) {
    const targetWhere = await this.scopedTargetWhere(user);
    const submission = await this.prisma.feedbackSubmission.findFirst({
      where: { id, target: targetWhere },
      include: { target: { include: this.targetInclude() }, student: { select: { publicId: true, collegeIdentityId: true, fullName: true } }, feedbackCycle: { select: { studentIdentityVisibleToManagement: true } }, ratings: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } }, actions: { include: { assignedTo: { select: { publicId: true, fullName: true } }, assignedDepartment: { select: { id: true, name: true } }, createdBy: { select: { fullName: true } } }, orderBy: { createdAt: "desc" } } },
    });
    if (!submission) throw new NotFoundException("Feedback submission not found.");
    const settings = await this.feedbackSettings(user.collegeId);
    const identityVisible = user.permissions.includes("feedback.settings.manage") || (submission.feedbackCycle?.studentIdentityVisibleToManagement ?? settings.studentIdentityVisibleToManagement);
    return { ...this.managementSubmission(submission, identityVisible), ratings: submission.ratings.map((rating) => ({ questionId: rating.questionId, category: rating.question.category, questionText: rating.question.questionText, rating: rating.rating })), actions: submission.actions };
  }

  async updateSubmissionStatus(user: AuthPrincipal, id: string, input: FeedbackSubmissionStatusDto, requestId: string, allowReopen = false) {
    this.requireAny(user, ["feedback.actions.manage"]);
    const submission = await this.authorizedSubmission(user, id);
    this.assertWorkflowTransition(submission.status, input.status, allowReopen);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.feedbackSubmission.update({ where: { id: submission.id }, data: { status: input.status, ...(input.priority ? { priority: input.priority } : {}) } });
      await tx.feedbackAction.create({
        data: {
          submissionId: submission.id,
          status: input.status,
          priority: input.priority ?? submission.priority,
          actionNote: this.cleanText(input.actionNote),
          internalNote: this.cleanText(input.internalNote),
          resolvedAt: input.status === "RESOLVED" ? new Date() : undefined,
          createdById: user.id,
        },
      });
      await this.audit.record({ actorId: user.id, action: "feedback.status_changed", entityType: "FeedbackSubmission", entityId: submission.id, beforeValue: { status: submission.status, priority: submission.priority }, afterValue: { status: input.status, priority: input.priority ?? submission.priority }, requestId }, tx);
      return row;
    });
    return { id: updated.id, referenceNumber: updated.referenceNumber, status: updated.status, priority: updated.priority };
  }

  async assignSubmission(user: AuthPrincipal, id: string, input: AssignFeedbackDto, requestId: string) {
    this.requireAny(user, ["feedback.actions.manage"]);
    const submission = await this.authorizedSubmission(user, id);
    const assignee = input.assignedToPublicId
      ? await this.prisma.user.findFirst({ where: { publicId: input.assignedToPublicId, collegeId: user.collegeId, status: "ACTIVE" }, select: { id: true, staffProfile: { select: { departmentId: true } } } })
      : null;
    if (input.assignedToPublicId && !assignee) throw new BadRequestException("Assigned user is not an active college account.");
    if (input.assignedDepartmentId) {
      const department = await this.prisma.department.findFirst({ where: { id: input.assignedDepartmentId, collegeId: user.collegeId }, select: { id: true } });
      if (!department) throw new BadRequestException("Assigned department is not in this college.");
    }
    await this.assertScopedAssignment(user, submission.target.departmentId, input.assignedDepartmentId, assignee?.staffProfile?.departmentId ?? null);
    this.assertWorkflowTransition(submission.status, "ASSIGNED");
    const priority = input.priority ?? submission.priority;
    const action = await this.prisma.$transaction(async (tx) => {
      const created = await tx.feedbackAction.create({
        data: {
          submissionId: submission.id,
          assignedToUserId: assignee?.id,
          assignedDepartmentId: input.assignedDepartmentId,
          actionNote: input.actionNote.trim(),
          internalNote: this.cleanText(input.internalNote),
          status: "ASSIGNED",
          priority,
          dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
          createdById: user.id,
        },
      });
      await tx.feedbackSubmission.update({ where: { id: submission.id }, data: { status: "ASSIGNED", priority } });
      await this.audit.record({ actorId: user.id, action: "feedback.assigned", entityType: "FeedbackSubmission", entityId: submission.id, afterValue: { assignedToUserId: assignee?.id, assignedDepartmentId: input.assignedDepartmentId, priority }, requestId }, tx);
      return created;
    });
    return action;
  }

  async resolveSubmission(user: AuthPrincipal, id: string, input: FeedbackSubmissionStatusDto, requestId: string) {
    return this.updateSubmissionStatus(user, id, { ...input, status: "RESOLVED" }, requestId);
  }

  async reopenSubmission(user: AuthPrincipal, id: string, input: ReopenFeedbackDto, requestId: string) {
    this.requireAny(user, ["feedback.actions.manage"]);
    const submission = await this.authorizedSubmission(user, id);
    if (!terminalFeedbackStatuses.has(submission.status) || submission.status === "ARCHIVED") {
      throw new ConflictException("Only resolved or rejected feedback can be reopened.");
    }
    return this.updateSubmissionStatus(user, id, {
      status: "UNDER_REVIEW",
      priority: submission.priority,
      actionNote: `Reopened: ${input.reason.trim()}`,
    }, requestId, true);
  }

  async listCycles(user: AuthPrincipal, query: FeedbackCycleQueryDto) {
    this.requireAny(user, ["feedback.cycles.manage"]);
    const search = query.search?.trim();
    const where: Prisma.FeedbackCycleWhereInput = {
      collegeId: user.collegeId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
      ...(query.semesterId ? { semesterId: query.semesterId } : {}),
      ...(search ? { cycleName: { contains: search, mode: "insensitive" } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.feedbackCycle.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
        include: {
          academicYear: { select: { id: true, name: true } },
          semester: { select: { id: true, name: true, number: true } },
          createdBy: { select: { publicId: true, fullName: true } },
        },
      }),
      this.prisma.feedbackCycle.count({ where }),
    ]);
    return { data, meta: { page: query.page, pageSize: query.pageSize, total, pageCount: Math.ceil(total / query.pageSize) } };
  }

  async createCycle(user: AuthPrincipal, input: CreateFeedbackCycleDto, requestId: string) {
    this.requireAny(user, ["feedback.cycles.manage"]);
    const dates = this.cycleDates(input.startDate, input.endDate);
    await this.assertCycleResources(user.collegeId, input.academicYearId, input.semesterId);
    const cycle = await this.prisma.feedbackCycle.create({
      data: {
        collegeId: user.collegeId,
        cycleName: input.cycleName.trim(),
        academicYearId: input.academicYearId,
        semesterId: input.semesterId,
        ...dates,
        submissionRule: input.submissionRule ?? "ONCE_PER_DAY",
        anonymousMode: input.anonymousMode ?? true,
        commentsRequired: input.commentsRequired ?? false,
        staffCanViewComments: input.staffCanViewComments ?? false,
        studentIdentityVisibleToManagement: input.studentIdentityVisibleToManagement ?? false,
        negativeFeedbackRequiresInvestigation: input.negativeFeedbackRequiresInvestigation ?? true,
        status: input.status ?? "DRAFT",
        createdById: user.id,
      },
    });
    await this.audit.record({ actorId: user.id, action: "feedback.cycle_created", entityType: "FeedbackCycle", entityId: cycle.id, afterValue: cycle, requestId });
    return cycle;
  }

  async updateCycle(user: AuthPrincipal, id: string, input: UpdateFeedbackCycleDto, requestId: string) {
    this.requireAny(user, ["feedback.cycles.manage"]);
    const current = await this.prisma.feedbackCycle.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!current) throw new NotFoundException("Feedback cycle not found.");
    if (!Object.keys(input).length) throw new BadRequestException("Provide at least one feedback cycle field to update.");
    const dates = this.cycleDates(
      input.startDate ?? current.startDate.toISOString(),
      input.endDate ?? current.endDate.toISOString(),
    );
    await this.assertCycleResources(user.collegeId, input.academicYearId ?? current.academicYearId ?? undefined, input.semesterId ?? current.semesterId ?? undefined);
    const updated = await this.prisma.feedbackCycle.update({
      where: { id: current.id },
      data: {
        ...(input.cycleName !== undefined ? { cycleName: input.cycleName.trim() } : {}),
        ...(input.academicYearId !== undefined ? { academicYearId: input.academicYearId } : {}),
        ...(input.semesterId !== undefined ? { semesterId: input.semesterId } : {}),
        ...(input.startDate !== undefined ? { startDate: dates.startDate } : {}),
        ...(input.endDate !== undefined ? { endDate: dates.endDate } : {}),
        ...(input.submissionRule !== undefined ? { submissionRule: input.submissionRule } : {}),
        ...(input.anonymousMode !== undefined ? { anonymousMode: input.anonymousMode } : {}),
        ...(input.commentsRequired !== undefined ? { commentsRequired: input.commentsRequired } : {}),
        ...(input.staffCanViewComments !== undefined ? { staffCanViewComments: input.staffCanViewComments } : {}),
        ...(input.studentIdentityVisibleToManagement !== undefined ? { studentIdentityVisibleToManagement: input.studentIdentityVisibleToManagement } : {}),
        ...(input.negativeFeedbackRequiresInvestigation !== undefined ? { negativeFeedbackRequiresInvestigation: input.negativeFeedbackRequiresInvestigation } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
    await this.audit.record({ actorId: user.id, action: "feedback.cycle_updated", entityType: "FeedbackCycle", entityId: current.id, beforeValue: current, afterValue: updated, requestId });
    return updated;
  }

  async listQuestions(user: AuthPrincipal, query: FeedbackQuestionQueryDto) {
    this.requireAny(user, ["feedback.questions.manage"]);
    const search = query.search?.trim();
    const where: Prisma.FeedbackQuestionWhereInput = {
      collegeId: user.collegeId,
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(search ? { OR: [{ category: { contains: search, mode: "insensitive" } }, { questionText: { contains: search, mode: "insensitive" } }] } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.feedbackQuestion.findMany({ where, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: [{ targetType: "asc" }, { displayOrder: "asc" }, { createdAt: "asc" }] }),
      this.prisma.feedbackQuestion.count({ where }),
    ]);
    return { data, meta: { page: query.page, pageSize: query.pageSize, total, pageCount: Math.ceil(total / query.pageSize) } };
  }

  async createQuestion(user: AuthPrincipal, input: CreateFeedbackQuestionDto, requestId: string) {
    this.requireAny(user, ["feedback.questions.manage"]);
    if (input.questionType && input.questionType !== "RATING") {
      throw new BadRequestException("Only RATING feedback questions are supported. Use the dedicated comment fields for written feedback.");
    }
    const duplicate = await this.prisma.feedbackQuestion.findFirst({
      where: { collegeId: user.collegeId, targetType: input.targetType, category: { equals: input.category.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException("A feedback question category already exists for this target type.");
    const question = await this.prisma.feedbackQuestion.create({
      data: {
        collegeId: user.collegeId,
        targetType: input.targetType,
        category: input.category.trim(),
        questionText: input.questionText.trim(),
        questionType: input.questionType ?? "RATING",
        displayOrder: input.displayOrder ?? 0,
        isRequired: input.isRequired ?? true,
        isActive: input.isActive ?? true,
      },
    });
    await this.audit.record({ actorId: user.id, action: "feedback.question_created", entityType: "FeedbackQuestion", entityId: question.id, afterValue: question, requestId });
    return question;
  }

  async updateQuestion(user: AuthPrincipal, id: string, input: UpdateFeedbackQuestionDto, requestId: string) {
    this.requireAny(user, ["feedback.questions.manage"]);
    if (input.questionType && input.questionType !== "RATING") {
      throw new BadRequestException("Only RATING feedback questions are supported. Use the dedicated comment fields for written feedback.");
    }
    const current = await this.prisma.feedbackQuestion.findFirst({ where: { id, collegeId: user.collegeId }, include: { _count: { select: { ratings: true } } } });
    if (!current) throw new NotFoundException("Feedback question not found.");
    if (!Object.keys(input).length) throw new BadRequestException("Provide at least one feedback question field to update.");
    if (current._count.ratings > 0 && ((input.targetType && input.targetType !== current.targetType) || (input.questionType && input.questionType !== current.questionType))) {
      throw new ConflictException("A question with submitted ratings cannot change target or response type.");
    }
    const updated = await this.prisma.feedbackQuestion.update({
      where: { id: current.id },
      data: {
        ...(input.targetType !== undefined ? { targetType: input.targetType } : {}),
        ...(input.category !== undefined ? { category: input.category.trim() } : {}),
        ...(input.questionText !== undefined ? { questionText: input.questionText.trim() } : {}),
        ...(input.questionType !== undefined ? { questionType: input.questionType } : {}),
        ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
        ...(input.isRequired !== undefined ? { isRequired: input.isRequired } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await this.audit.record({ actorId: user.id, action: "feedback.question_updated", entityType: "FeedbackQuestion", entityId: current.id, beforeValue: current, afterValue: updated, requestId });
    return updated;
  }

  async settings(user: AuthPrincipal) {
    this.requireAny(user, ["feedback.settings.manage", "settings.read"]);
    return this.feedbackSettings(user.collegeId);
  }

  async updateSettings(user: AuthPrincipal, input: FeedbackSettingsDto, requestId: string) {
    this.requireAny(user, ["feedback.settings.manage"]);
    const current = await this.feedbackSettings(user.collegeId);
    const next = { ...current, ...input };
    const updated = await this.prisma.appSetting.upsert({
      where: { collegeId_key: { collegeId: user.collegeId, key: "feedback.settings" } },
      create: { collegeId: user.collegeId, key: "feedback.settings", value: next },
      update: { value: next, updatedById: user.id },
    });
    await this.audit.record({ actorId: user.id, action: "feedback.settings_changed", entityType: "AppSetting", entityId: updated.id, beforeValue: current, afterValue: next, requestId });
    return next;
  }

  async exportCsv(user: AuthPrincipal, requestId: string, query: FeedbackSubmissionQueryDto) {
    const report = await this.feedbackReportData(user, query);
    const csv = stringify(report.rows.map((row) => ({
      reference_number: this.csvCell(row.referenceNumber),
      submitted_at: row.submittedAt.toISOString(),
      target_type: this.csvCell(row.targetType),
      target_name: this.csvCell(row.targetName),
      department: this.csvCell(row.department),
      overall_rating: row.overallRating,
      sentiment: this.csvCell(row.sentiment),
      status: this.csvCell(row.status),
      priority: this.csvCell(row.priority),
      positive_comment: this.csvCell(row.positiveComment),
      improvement_comment: this.csvCell(row.improvementComment),
      general_comment: this.csvCell(row.generalComment),
      complaint_text: this.csvCell(row.complaintText),
      category_ratings: this.csvCell(row.categoryRatings),
    })), { header: true });
    await this.auditFeedbackReport(user, requestId, query, "csv", report.rows.length);
    return Buffer.from(`\uFEFF${csv}`, "utf8");
  }

  async exportXlsx(user: AuthPrincipal, requestId: string, query: FeedbackSubmissionQueryDto) {
    const report = await this.feedbackReportData(user, query);
    const body = await createFeedbackReportXlsx(report.rows, report.metadata);
    await this.auditFeedbackReport(user, requestId, query, "xlsx", report.rows.length);
    return body;
  }

  async exportPdf(user: AuthPrincipal, requestId: string, query: FeedbackSubmissionQueryDto) {
    const report = await this.feedbackReportData(user, query);
    const body = await createFeedbackReportPdf(report.rows, report.metadata);
    await this.auditFeedbackReport(user, requestId, query, "pdf", report.rows.length);
    return body;
  }

  private async feedbackReportData(user: AuthPrincipal, query: FeedbackSubmissionQueryDto): Promise<{ rows: FeedbackReportRow[]; metadata: FeedbackReportMetadata }> {
    const targetWhere = await this.scopedTargetWhere(user, query.departmentId);
    const submittedAt = this.dateRange(query.from, query.to);
    const search = query.search?.trim();
    const where: Prisma.FeedbackSubmissionWhereInput = {
      target: { ...targetWhere, ...(query.targetType ? { targetType: query.targetType } : {}) },
      ...(query.status ? { status: query.status } : {}),
      ...(query.rating ? { overallRating: query.rating } : {}),
      ...(query.sentiment ? { sentiment: query.sentiment } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(submittedAt ? { submittedAt } : {}),
      ...(search ? {
        OR: [
          { referenceNumber: { contains: search, mode: "insensitive" } },
          { target: { targetName: { contains: search, mode: "insensitive" } } },
        ],
      } : {}),
    };
    const maximumRows = 50_000;
    const [submissions, college] = await Promise.all([
      this.prisma.feedbackSubmission.findMany({
        where,
        take: maximumRows,
        orderBy: { [query.sortBy]: query.sortOrder } as Prisma.FeedbackSubmissionOrderByWithRelationInput,
        include: { target: { include: this.targetInclude() }, ratings: { include: { question: true } } },
      }),
      this.prisma.college.findUnique({ where: { id: user.collegeId }, select: { name: true } }),
    ]);
    return {
      rows: submissions.map((row) => ({
        referenceNumber: row.referenceNumber,
        submittedAt: row.submittedAt,
        targetType: row.target.targetType,
        targetName: row.target.targetName,
        department: row.target.department?.name ?? row.target.staff?.staffProfile?.department?.name ?? "",
        overallRating: row.overallRating,
        sentiment: row.sentiment,
        status: row.status,
        priority: row.priority,
        positiveComment: row.positiveComment ?? "",
        improvementComment: row.improvementComment ?? "",
        generalComment: row.generalComment ?? "",
        complaintText: row.complaintText ?? "",
        categoryRatings: row.ratings.map((rating) => `${rating.question.category}:${rating.rating}`).join("; "),
      })),
      metadata: {
        collegeName: college?.name ?? "AVS Engineering College",
        generatedAt: new Date(),
        filterSummary: this.feedbackReportFilterSummary(query),
        maximumRows,
      },
    };
  }

  private feedbackReportFilterSummary(query: FeedbackSubmissionQueryDto): string {
    const filters = [
      query.departmentId ? `department=${query.departmentId}` : undefined,
      query.targetType ? `target=${query.targetType}` : undefined,
      query.status ? `status=${query.status}` : undefined,
      query.rating ? `rating=${query.rating}` : undefined,
      query.sentiment ? `sentiment=${query.sentiment}` : undefined,
      query.priority ? `priority=${query.priority}` : undefined,
      query.from ? `from=${query.from}` : undefined,
      query.to ? `to=${query.to}` : undefined,
      query.search?.trim() ? `search=${query.search.trim()}` : undefined,
    ].filter((value): value is string => Boolean(value));
    return filters.length ? filters.join("; ") : "All feedback in the caller's authorized scope";
  }

  private async auditFeedbackReport(user: AuthPrincipal, requestId: string, query: FeedbackSubmissionQueryDto, format: "csv" | "xlsx" | "pdf", rows: number): Promise<void> {
    await this.audit.record({
      actorId: user.id,
      action: "feedback.exported",
      entityType: "FeedbackSubmission",
      afterValue: { format, rows, filters: query },
      requestId,
    });
  }

  private async authorizedSubmission(user: AuthPrincipal, id: string) {
    const targetWhere = await this.scopedTargetWhere(user);
    const submission = await this.prisma.feedbackSubmission.findFirst({
      where: { id, target: targetWhere },
      include: { target: { select: { departmentId: true } } },
    });
    if (!submission) throw new NotFoundException("Feedback submission not found.");
    return submission;
  }

  private async validatedTargetData(user: AuthPrincipal, input: CreateFeedbackTargetDto): Promise<Omit<Prisma.FeedbackTargetUncheckedCreateInput, "id" | "targetUuid" | "targetName" | "description" | "createdAt" | "updatedAt" | "collegeId" | "createdById">> {
    let staffUserId: string | undefined;
    if (input.staffPublicId) {
      const staff = await this.prisma.user.findFirst({ where: { publicId: input.staffPublicId, collegeId: user.collegeId, status: "ACTIVE", staffProfile: { isNot: null } }, select: { id: true } });
      if (!staff) throw new BadRequestException("Staff target must be an active staff account in this college.");
      staffUserId = staff.id;
    }
    await this.assertOptionalCollegeResources(user.collegeId, input);
    return {
      targetType: input.targetType,
      staffUserId,
      departmentId: input.departmentId,
      campusId: input.campusId,
      blockId: input.blockId,
      floorId: input.floorId,
      roomId: input.roomId,
      serviceCode: input.serviceCode?.trim().toUpperCase(),
      isActive: true,
    };
  }

  private async assertOptionalCollegeResources(collegeId: string, input: CreateFeedbackTargetDto): Promise<void> {
    if (input.departmentId && !(await this.prisma.department.findFirst({ where: { id: input.departmentId, collegeId }, select: { id: true } }))) throw new BadRequestException("Department target is not in this college.");
    if (input.campusId && !(await this.prisma.campus.findFirst({ where: { id: input.campusId, collegeId }, select: { id: true } }))) throw new BadRequestException("Campus target is not in this college.");
    if (input.blockId && !(await this.prisma.block.findFirst({ where: { id: input.blockId, campus: { collegeId } }, select: { id: true } }))) throw new BadRequestException("Block target is not in this college.");
    if (input.floorId && !(await this.prisma.floor.findFirst({ where: { id: input.floorId, block: { campus: { collegeId } } }, select: { id: true } }))) throw new BadRequestException("Floor target is not in this college.");
    if (input.roomId && !(await this.prisma.room.findFirst({ where: { id: input.roomId, floor: { block: { campus: { collegeId } } } }, select: { id: true } }))) throw new BadRequestException("Room target is not in this college.");
  }

  private async createQrForTarget(targetId: string, createdById?: string, expiryDate?: Date) {
    const token = this.newToken();
    return this.prisma.feedbackQrCode.create({ data: { targetId, secureTokenHash: this.hashToken(token), qrUrl: this.webFeedbackUrl(token), createdById, expiryDate } });
  }

  private async targetDiscoveryWhere(user: AuthPrincipal, departmentId?: string): Promise<Prisma.FeedbackTargetWhereInput> {
    if (this.canReadCollege(user) || (user.permissions.includes("feedback.targets.manage") && this.access.isCollegeWide(user))) {
      return { collegeId: user.collegeId, ...(departmentId ? { departmentId } : {}) };
    }
    return this.scopedTargetWhere(user, departmentId);
  }

  private async scopedTargetWhere(user: AuthPrincipal, departmentId?: string): Promise<Prisma.FeedbackTargetWhereInput> {
    if (this.canReadCollege(user)) return { collegeId: user.collegeId, ...(departmentId ? { departmentId } : {}) };
    const or: Prisma.FeedbackTargetWhereInput[] = [];
    if (user.permissions.includes("feedback.read_staff")) or.push({ staffUserId: user.id });
    if (user.permissions.includes("feedback.read_department")) {
      const scopedDepartments = user.scopes.filter((scope) => scope.type === "DEPARTMENT" && scope.id).map((scope) => scope.id as string);
      const ownDepartment = (await this.prisma.staffProfile.findUnique({ where: { userId: user.id }, select: { departmentId: true } }))?.departmentId;
      const departments = [...new Set([...scopedDepartments, ...(ownDepartment ? [ownDepartment] : [])])];
      if (departmentId && !departments.includes(departmentId)) throw new ForbiddenException("You cannot access feedback for this department.");
      if (departments.length) or.push({ departmentId: { in: departmentId ? [departmentId] : departments } });
    }
    if (!or.length) throw new ForbiddenException("You do not have permission to view feedback analytics.");
    return { AND: [{ collegeId: user.collegeId }, { OR: or }] };
  }

  private async assertCanReadStaff(user: AuthPrincipal, staffUserId: string, departmentId: string | null): Promise<void> {
    if (this.canReadCollege(user)) return;
    if (user.permissions.includes("feedback.read_staff") && staffUserId === user.id) return;
    if (departmentId && this.canReadDepartment(user, departmentId)) return;
    throw new ForbiddenException("You cannot access this staff feedback.");
  }

  private canReadCollege(user: AuthPrincipal): boolean {
    return user.permissions.includes("feedback.read_college") && this.access.isCollegeWide(user);
  }

  private canReadDepartment(user: AuthPrincipal, departmentId: string | null | undefined): boolean {
    if (!departmentId || !user.permissions.includes("feedback.read_department")) return false;
    return user.scopes.some((scope) => scope.type === "DEPARTMENT" && scope.id === departmentId) || this.access.isCollegeWide(user);
  }

  private requireAny(user: AuthPrincipal, permissions: string[]): void {
    if (!permissions.some((permission) => user.permissions.includes(permission))) throw new ForbiddenException("You do not have permission to perform this action.");
  }

  private targetInclude() {
    return {
      staff: { select: { publicId: true, collegeIdentityId: true, fullName: true, profilePhotoKey: true, staffProfile: { select: { employeeId: true, designation: true, department: { select: { id: true, code: true, name: true } } } } } },
      department: { select: { id: true, code: true, name: true } },
      campus: { select: { id: true, code: true, name: true } },
      block: { select: { id: true, code: true, name: true } },
      floor: { select: { id: true, code: true, name: true, level: true } },
      room: { select: { id: true, code: true, name: true, roomNumber: true, roomType: true } },
    } satisfies Prisma.FeedbackTargetInclude;
  }

  private publicTarget(target: PublicTargetPayload) {
    return {
      id: target.targetUuid,
      targetType: target.targetType,
      targetName: target.targetName,
      description: target.description,
      serviceCode: target.serviceCode,
      isActive: target.isActive,
      staff: target.staff ? {
        publicId: target.staff.publicId,
        staffId: target.staff.staffProfile?.employeeId ?? target.staff.collegeIdentityId,
        name: target.staff.fullName,
        designation: target.staff.staffProfile?.designation ?? null,
        department: target.staff.staffProfile?.department ?? null,
        profilePhotoKey: target.staff.profilePhotoKey,
      } : null,
      department: target.department ?? target.staff?.staffProfile?.department ?? null,
      campus: target.campus,
      block: target.block,
      floor: target.floor,
      room: target.room,
    };
  }

  private async questionsForTarget(collegeId: string, targetType: FeedbackTargetType) {
    const exact = await this.prisma.feedbackQuestion.findMany({ where: { collegeId, targetType, questionType: "RATING", isActive: true }, orderBy: { displayOrder: "asc" } });
    const questions = exact.length || targetType === "CAMPUS_SERVICE" ? exact : await this.prisma.feedbackQuestion.findMany({ where: { collegeId, targetType: "CAMPUS_SERVICE", questionType: "RATING", isActive: true }, orderBy: { displayOrder: "asc" } });
    return questions.map((question) => ({ id: question.id, category: question.category, questionText: question.questionText, questionType: question.questionType, displayOrder: question.displayOrder, isRequired: question.isRequired }));
  }

  private qrValidationError(qr: { status: FeedbackQrStatus; expiryDate: Date | null; target: { isActive: boolean } }): string | undefined {
    if (!qr.target.isActive) return "This feedback target is inactive.";
    if (qr.status !== "ACTIVE") return `This QR code is ${qr.status.toLowerCase()}.`;
    if (qr.expiryDate && qr.expiryDate < new Date()) return "This QR code has expired.";
    return undefined;
  }

  private async recordScan(qrCodeId: string, studentUserId: string | undefined, successStatus: boolean, failureReason: string | undefined, request: RequestFingerprint): Promise<void> {
    await this.prisma.feedbackScanLog.create({ data: this.scanLogData(qrCodeId, studentUserId, successStatus, failureReason, request) });
  }

  private scanLogData(qrCodeId: string, studentUserId: string | undefined, successStatus: boolean, failureReason: string | undefined, request: RequestFingerprint): Prisma.FeedbackScanLogUncheckedCreateInput {
    return {
      qrCodeId,
      studentUserId,
      successStatus,
      failureReason,
      ipHash: this.hashIp(request.ip),
      deviceType: this.deviceType(request.userAgent),
      browser: request.userAgent?.slice(0, 160),
    };
  }

  private extractToken(raw: string): string {
    const input = decodeURIComponent(raw).trim();
    const token = input.startsWith("http://") || input.startsWith("https://") ? new URL(input).pathname.split("/").filter(Boolean).pop() ?? "" : input;
    if (!/^FB_[A-Za-z0-9_-]{16,160}$/.test(token)) throw new BadRequestException("Invalid feedback QR token format.");
    return token;
  }

  private issueSubmissionTicket(user: AuthPrincipal, targetId: string, targetUuid: string, qrCodeId: string | null): string {
    const issuedAt = Math.floor(Date.now() / 1000);
    return signFeedbackSubmissionTicket({
      version: 1,
      purpose: "feedback-submit",
      userId: user.id,
      collegeId: user.collegeId,
      targetId,
      targetUuid,
      qrCodeId,
      issuedAt,
      expiresAt: issuedAt + submissionTicketTtlSeconds,
      nonce: randomBytes(16).toString("base64url"),
    }, this.feedbackTicketSecret());
  }

  private verifySubmissionTicket(user: AuthPrincipal, ticket: string, targetUuid: string): FeedbackSubmissionTicketClaims {
    let claims: FeedbackSubmissionTicketClaims;
    try {
      claims = verifyFeedbackSubmissionTicket(ticket, this.feedbackTicketSecret());
    } catch (error) {
      const message = error instanceof Error && /expired/i.test(error.message)
        ? "The feedback submission ticket has expired. Scan or open the target again."
        : "The feedback submission ticket is invalid. Scan or open the target again.";
      throw new BadRequestException(message);
    }
    if (claims.userId !== user.id || claims.collegeId !== user.collegeId || claims.targetUuid !== targetUuid) {
      throw new BadRequestException("The feedback submission ticket does not match this student or target.");
    }
    return claims;
  }

  private feedbackTicketSecret(): string {
    const secret = this.config.get<string>("FEEDBACK_SUBMISSION_SECRET") ?? this.config.get<string>("CSRF_SECRET");
    if (!secret || secret.length < 16) throw new Error("FEEDBACK_SUBMISSION_SECRET or CSRF_SECRET must contain at least 16 characters.");
    return secret;
  }

  private isStudentFeedbackUser(user: AuthPrincipal): boolean {
    return user.roles.includes("STUDENT")
      && !user.permissions.some((permission) => managementReadPermissions.includes(permission) || permission === "feedback.targets.manage");
  }

  private feedbackPolicy(
    settings: Awaited<ReturnType<FeedbackService["feedbackSettings"]>>,
    cycle: {
      submissionRule: FeedbackSubmissionRule;
      anonymousMode: boolean;
      commentsRequired: boolean;
      staffCanViewComments: boolean;
      studentIdentityVisibleToManagement: boolean;
      negativeFeedbackRequiresInvestigation: boolean;
    } | null,
  ): ActiveFeedbackPolicy {
    return cycle ? {
      submissionRule: cycle.submissionRule,
      anonymousMode: cycle.anonymousMode,
      commentsRequired: cycle.commentsRequired,
      staffCanViewComments: cycle.staffCanViewComments,
      studentIdentityVisibleToManagement: cycle.studentIdentityVisibleToManagement,
      negativeFeedbackRequiresInvestigation: cycle.negativeFeedbackRequiresInvestigation,
    } : {
      submissionRule: settings.defaultSubmissionRule,
      anonymousMode: settings.anonymousMode,
      commentsRequired: settings.commentsRequired,
      staffCanViewComments: settings.staffCanViewComments,
      studentIdentityVisibleToManagement: settings.studentIdentityVisibleToManagement,
      negativeFeedbackRequiresInvestigation: settings.negativeFeedbackRequiresInvestigation,
    };
  }

  private async activeCycle(collegeId: string, semesterId?: string, academicYearId?: string) {
    const timezone = (await this.prisma.college.findUnique({ where: { id: collegeId }, select: { timezone: true } }))?.timezone ?? "Asia/Kolkata";
    const day = this.utcDate(this.localIsoDate(new Date(), timezone));
    const candidates = await this.prisma.feedbackCycle.findMany({
      where: {
        collegeId,
        status: "ACTIVE",
        startDate: { lte: day },
        endDate: { gte: day },
        ...(semesterId ? { OR: [{ semesterId }, { semesterId: null }] } : { semesterId: null }),
        ...(academicYearId ? { AND: [{ OR: [{ academicYearId }, { academicYearId: null }] }] } : { academicYearId: null }),
      },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      take: 20,
    });
    return candidates.sort((left, right) => {
      const leftScore = (left.semesterId === semesterId ? 2 : 0) + (left.academicYearId === academicYearId ? 1 : 0);
      const rightScore = (right.semesterId === semesterId ? 2 : 0) + (right.academicYearId === academicYearId ? 1 : 0);
      return rightScore - leftScore;
    })[0] ?? null;
  }

  private async submissionWindowKey(collegeId: string, rule: FeedbackSubmissionRule, cycleId?: string): Promise<string> {
    if (rule === "UNLIMITED") return `UNLIMITED:${ulid()}`;
    if (rule === "ONCE_PER_CYCLE") return `CYCLE:${cycleId ?? "NO_ACTIVE_CYCLE"}`;
    const timezone = (await this.prisma.college.findUnique({ where: { id: collegeId }, select: { timezone: true } }))?.timezone ?? "Asia/Kolkata";
    const now = new Date();
    const localDate = this.localIsoDate(now, timezone);
    return rule === "ONCE_PER_WEEK" ? `WEEK:${this.isoWeek(localDate)}` : `DAY:${localDate}`;
  }

  private async feedbackSettings(collegeId: string) {
    const row = await this.prisma.appSetting.findUnique({ where: { collegeId_key: { collegeId, key: "feedback.settings" } }, select: { value: true } });
    const value = typeof row?.value === "object" && row.value !== null ? row.value as Record<string, unknown> : {};
    return {
      requiredAttendancePercentage: this.numberSetting(value.requiredAttendancePercentage, 75),
      attendanceWarningPercentage: this.numberSetting(value.attendanceWarningPercentage, 65),
      attendanceCriticalPercentage: this.numberSetting(value.attendanceCriticalPercentage, 50),
      defaultSubmissionRule: this.ruleSetting(value.defaultSubmissionRule),
      anonymousMode: this.booleanSetting(value.anonymousMode, true),
      commentsRequired: this.booleanSetting(value.commentsRequired, false),
      staffCanViewComments: this.booleanSetting(value.staffCanViewComments, false),
      studentIdentityVisibleToManagement: this.booleanSetting(value.studentIdentityVisibleToManagement, false),
      negativeFeedbackRequiresInvestigation: this.booleanSetting(value.negativeFeedbackRequiresInvestigation, true),
      emailAlertsEnabled: this.booleanSetting(value.emailAlertsEnabled, false),
      whatsAppAlertsEnabled: this.booleanSetting(value.whatsAppAlertsEnabled, false),
    };
  }

  private managementSubmission(submission: ManagementSubmissionPayload, identityVisible: boolean) {
    return {
      id: submission.id,
      referenceNumber: submission.referenceNumber,
      target: this.publicTarget(submission.target),
      overallRating: submission.overallRating,
      sentiment: submission.sentiment,
      status: submission.status,
      priority: submission.priority,
      submittedAt: submission.submittedAt,
      isAnonymous: submission.isAnonymous,
      student: identityVisible && !submission.isAnonymous ? submission.student : null,
      comments: {
        positive: submission.positiveComment,
        improvement: submission.improvementComment,
        general: submission.generalComment,
        complaint: submission.complaintText,
      },
    };
  }

  private async feedbackAlertRecipients(collegeId: string, departmentId: string | null) {
    const base = await this.prisma.user.findMany({
      where: { collegeId, status: "ACTIVE", roles: { some: { role: { code: { in: ["MAIN_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"] } } } } },
      select: { id: true },
    });
    if (!departmentId) return base;
    const hods = await this.prisma.user.findMany({
      where: { collegeId, status: "ACTIVE", roles: { some: { role: { code: "HOD" } } }, scopes: { some: { scopeType: "DEPARTMENT", scopeId: departmentId } } },
      select: { id: true },
    });
    return [...new Map([...base, ...hods].map((row) => [row.id, row])).values()];
  }

  private async staffAttendanceSummary(staffUserId: string) {
    const sessions = await this.prisma.attendanceSession.findMany({ where: { facultyId: staffUserId }, select: { sessionDate: true, status: true } });
    const totalWorkingDays = new Set(sessions.map((session) => session.sessionDate.toISOString().slice(0, 10))).size;
    const presentSessions = sessions.filter((session) => ["SUBMITTED", "LOCKED"].includes(session.status)).length;
    return {
      totalWorkingDays,
      presentDays: new Set(sessions.filter((session) => ["SUBMITTED", "LOCKED"].includes(session.status)).map((session) => session.sessionDate.toISOString().slice(0, 10))).size,
      absentDays: 0,
      leaveDays: 0,
      onDutyDays: 0,
      lateArrivalCount: 0,
      earlyDepartureCount: 0,
      totalSessions: sessions.length,
      submittedSessions: presentSessions,
      attendancePercentage: this.percent(presentSessions, sessions.length),
      monthlyTrend: this.monthlySessionTrend(sessions),
      sourceNote: "Calculated from submitted or locked teaching attendance sessions because no separate staff clock-in table exists.",
    };
  }

  private async posterSvg(qr: { qrUrl: string; target: PublicTargetPayload }) {
    const qrSvg = await QRCode.toString(qr.qrUrl, { type: "svg", margin: 1, width: 640 });
    const encodedQr = Buffer.from(qrSvg, "utf8").toString("base64");
    const target = this.escapeXml(qr.target.targetName);
    const location = this.escapeXml([qr.target.block?.name, qr.target.floor?.name, qr.target.room?.roomNumber ?? qr.target.room?.name].filter(Boolean).join(" / "));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123" viewBox="0 0 794 1123">
  <rect width="794" height="1123" fill="#ffffff"/>
  <rect x="0" y="0" width="794" height="168" fill="#1d4ed8"/>
  <text x="397" y="74" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#ffffff">AVS Engineering College</text>
  <text x="397" y="122" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" fill="#dbeafe">We Value Your Feedback</text>
  <rect x="104" y="230" width="586" height="586" rx="18" fill="#eff6ff" stroke="#bfdbfe"/>
  <image href="data:image/svg+xml;base64,${encodedQr}" x="152" y="278" width="490" height="490"/>
  <text x="397" y="878" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#0f172a">${target}</text>
  <text x="397" y="920" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" fill="#475569">${location}</text>
  <text x="397" y="986" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#1d4ed8">Scan the QR Code</text>
  <text x="397" y="1024" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" fill="#334155">Share Your Rating and Feedback</text>
  <text x="397" y="1064" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#64748b">Your Feedback Helps Us Improve</text>
</svg>`;
  }

  private assertWorkflowTransition(current: FeedbackSubmissionStatus, next: FeedbackSubmissionStatus, allowReopen = false): void {
    if (current === next) return;
    if (terminalFeedbackStatuses.has(current) && next === "UNDER_REVIEW" && !allowReopen) {
      throw new ConflictException("Use the reopen action to move resolved or rejected feedback back under review.");
    }
    if (!workflowTransitions[current].has(next)) {
      throw new ConflictException(`Feedback cannot move from ${current} to ${next}.`);
    }
  }

  private async assertScopedAssignment(
    user: AuthPrincipal,
    submissionDepartmentId: string | null,
    assignedDepartmentId?: string,
    assigneeDepartmentId?: string | null,
  ): Promise<void> {
    if (!user.roles.includes("HOD") || this.canReadCollege(user)) return;
    const ownDepartmentId = (await this.prisma.staffProfile.findUnique({
      where: { userId: user.id },
      select: { departmentId: true },
    }))?.departmentId;
    const permittedDepartmentIds = new Set([
      ...user.scopes.filter((scope) => scope.type === "DEPARTMENT" && scope.id).map((scope) => scope.id as string),
      ...(ownDepartmentId ? [ownDepartmentId] : []),
    ]);
    if (!submissionDepartmentId || !permittedDepartmentIds.has(submissionDepartmentId)) {
      throw new ForbiddenException("HOD users can act only on feedback in their own department.");
    }
    if (assignedDepartmentId && !permittedDepartmentIds.has(assignedDepartmentId)) {
      throw new ForbiddenException("HOD users cannot assign feedback to another department.");
    }
    if (assigneeDepartmentId !== undefined && (!assigneeDepartmentId || !permittedDepartmentIds.has(assigneeDepartmentId))) {
      throw new ForbiddenException("HOD users cannot assign feedback to a user outside their department.");
    }
  }

  private cycleDates(startInput: string, endInput: string): { startDate: Date; endDate: Date } {
    const startDate = this.utcDate(startInput);
    const endDate = this.utcDate(endInput);
    if (endDate < startDate) throw new BadRequestException("Feedback cycle end date must be on or after its start date.");
    return { startDate, endDate };
  }

  private async assertCycleResources(collegeId: string, academicYearId?: string, semesterId?: string): Promise<void> {
    const [academicYear, semester] = await Promise.all([
      academicYearId
        ? this.prisma.academicYear.findFirst({ where: { id: academicYearId, collegeId }, select: { id: true } })
        : null,
      semesterId
        ? this.prisma.semester.findFirst({
            where: { id: semesterId, programme: { department: { collegeId } } },
            select: { id: true, academicYearId: true },
          })
        : null,
    ]);
    if (academicYearId && !academicYear) throw new BadRequestException("Feedback cycle academic year is not in this college.");
    if (semesterId && !semester) throw new BadRequestException("Feedback cycle semester is not in this college.");
    if (academicYearId && semester && semester.academicYearId !== academicYearId) {
      throw new BadRequestException("Feedback cycle semester does not belong to the selected academic year.");
    }
  }

  private localIsoDate(value: Date, timezone: string): string {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(value);
      const item = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
      const year = item("year");
      const month = item("month");
      const day = item("day");
      if (!year || !month || !day) throw new Error("Incomplete localized date.");
      return `${year}-${month}-${day}`;
    } catch {
      return value.toISOString().slice(0, 10);
    }
  }

  private isoWeek(localDate: string): string {
    const [year = 0, month = 0, day = 0] = localDate.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - weekday);
    const weekYear = date.getUTCFullYear();
    const yearStart = new Date(Date.UTC(weekYear, 0, 1));
    const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
    return `${weekYear}-W${String(week).padStart(2, "0")}`;
  }

  private utcDate(input: string): Date {
    const datePart = input.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) throw new BadRequestException("A valid ISO date is required.");
    const value = new Date(`${datePart}T00:00:00.000Z`);
    if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== datePart) {
      throw new BadRequestException("A valid calendar date is required.");
    }
    return value;
  }

  private dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
    const range: Prisma.DateTimeFilter = {};
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if (fromDate && Number.isNaN(fromDate.getTime())) throw new BadRequestException("The feedback start date is invalid.");
    if (toDate && Number.isNaN(toDate.getTime())) throw new BadRequestException("The feedback end date is invalid.");
    if (fromDate) range.gte = fromDate;
    if (toDate) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(to ?? "")) {
        range.lt = new Date(toDate.getTime() + 86_400_000);
      } else {
        range.lte = toDate;
      }
    }
    const effectiveEnd = range.lt instanceof Date ? range.lt : range.lte instanceof Date ? range.lte : undefined;
    if (fromDate && effectiveEnd && fromDate > effectiveEnd) {
      throw new BadRequestException("The feedback start date must be before the end date.");
    }
    return Object.keys(range).length ? range : undefined;
  }

  private csvCell(value: string): string {
    const cleaned = value.replace(/\0/g, "");
    return /^[\t\r=+\-@]/.test(cleaned) ? `'${cleaned}` : cleaned;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
  }

  private average(values: number[]): number {
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  }

  private sentiment(rating: number): FeedbackSentiment {
    if (rating >= 4) return "POSITIVE";
    if (rating <= 2) return "NEGATIVE";
    return "NEUTRAL";
  }

  private priority(rating: number, complaint?: string): FeedbackPriority {
    if (rating <= 1 || (complaint && /unsafe|harass|threat|urgent|danger|fire|abuse/i.test(complaint))) return "CRITICAL";
    if (rating <= 2 || complaint) return "HIGH";
    if (rating === 3) return "MEDIUM";
    return "LOW";
  }

  private ratingBadge(rating: number): string {
    if (rating >= 4.5) return "Excellent";
    if (rating >= 3.5) return "Good";
    if (rating >= 2.5) return "Average";
    if (rating >= 1.5) return "Needs Improvement";
    if (rating >= 1) return "Critical";
    return "No rating";
  }

  private breakdownAverage(rows: Array<{ name: string; rating: number }>) {
    const map = new Map<string, { name: string; total: number; count: number }>();
    for (const row of rows) {
      const slot = map.get(row.name) ?? { name: row.name, total: 0, count: 0 };
      slot.total += row.rating;
      slot.count += 1;
      map.set(row.name, slot);
    }
    return [...map.values()].map((row) => ({ name: row.name, count: row.count, averageRating: this.round(row.total / row.count) })).sort((a, b) => b.averageRating - a.averageRating);
  }

  private countBreakdown(values: string[]) {
    const map = new Map<string, number>();
    for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
    return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }

  private monthlyTrend(rows: Array<{ submittedAt: Date; overallRating: number }>) {
    const map = new Map<string, { month: string; count: number; total: number }>();
    for (const row of rows) {
      const month = row.submittedAt.toISOString().slice(0, 7);
      const slot = map.get(month) ?? { month, count: 0, total: 0 };
      slot.count += 1;
      slot.total += row.overallRating;
      map.set(month, slot);
    }
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month)).map((row) => ({ month: row.month, count: row.count, averageRating: this.round(row.total / row.count) }));
  }

  private monthlySessionTrend(rows: Array<{ sessionDate: Date; status: string }>) {
    const map = new Map<string, { month: string; total: number; submitted: number }>();
    for (const row of rows) {
      const month = row.sessionDate.toISOString().slice(0, 7);
      const slot = map.get(month) ?? { month, total: 0, submitted: 0 };
      slot.total += 1;
      if (["SUBMITTED", "LOCKED"].includes(row.status)) slot.submitted += 1;
      map.set(month, slot);
    }
    return [...map.values()].map((row) => ({ ...row, percentage: this.percent(row.submitted, row.total) }));
  }

  private referenceNumber(): string {
    return `AVS-FB-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${ulid().slice(-8)}`;
  }

  private newToken(): string {
    return `FB_${randomBytes(24).toString("base64url")}`;
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private webFeedbackUrl(token: string): string {
    const publicAppUrl =
      this.config.get<string>("PUBLIC_APP_URL") ??
      this.config.get<string>("WEB_URL", "http://localhost:3000");
    return `${publicAppUrl.replace(/\/$/, "")}/feedback/scan/${token}`;
  }

  private hashIp(ip?: string): string | undefined {
    return ip ? createHash("sha256").update(`${ip}:${this.config.get<string>("CSRF_SECRET", "")}`).digest("hex") : undefined;
  }

  private deviceType(userAgent?: string): string | undefined {
    if (!userAgent) return undefined;
    if (/Mobile|Android|iPhone/i.test(userAgent)) return "mobile";
    if (/iPad|Tablet/i.test(userAgent)) return "tablet";
    return "desktop";
  }

  private cleanText(value?: string): string | undefined {
    const cleaned = value?.replace(/\0/g, "").trim();
    return cleaned ? cleaned.slice(0, 3000) : undefined;
  }

  private percent(value: number, total: number): number {
    return total ? this.round((value / total) * 100) : 0;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private numberSetting(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
  }

  private booleanSetting(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
  }

  private ruleSetting(value: unknown): FeedbackSubmissionRule {
    return typeof value === "string" && Object.values(FeedbackSubmissionRule).includes(value as FeedbackSubmissionRule) ? value as FeedbackSubmissionRule : "ONCE_PER_DAY";
  }

  private escapeXml(value: string): string {
    return value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;" })[char] ?? char);
  }
}

export function requiredStudentFeedbackPermissions(): string[] {
  return studentFeedbackPermissions;
}

export function signFeedbackSubmissionTicket(claims: FeedbackSubmissionTicketClaims, secret: string): string {
  if (secret.length < 16) throw new Error("Feedback submission ticket secret is too short.");
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signedValue = `v1.${payload}`;
  const signature = createHmac("sha256", secret).update(signedValue).digest("base64url");
  return `${signedValue}.${signature}`;
}

export function verifyFeedbackSubmissionTicket(ticket: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): FeedbackSubmissionTicketClaims {
  if (secret.length < 16) throw new Error("Feedback submission ticket secret is too short.");
  const parts = ticket.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) throw new Error("Invalid feedback submission ticket.");
  const signedValue = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", secret).update(signedValue).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(parts[2], "base64url");
  } catch {
    throw new Error("Invalid feedback submission ticket.");
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("Invalid feedback submission ticket.");
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid feedback submission ticket.");
  }
  if (!isFeedbackSubmissionTicketClaims(claims)) throw new Error("Invalid feedback submission ticket.");
  if (claims.expiresAt <= nowSeconds) throw new Error("Feedback submission ticket has expired.");
  if (claims.issuedAt > nowSeconds + 30 || claims.expiresAt <= claims.issuedAt) throw new Error("Invalid feedback submission ticket.");
  return claims;
}

function isFeedbackSubmissionTicketClaims(value: unknown): value is FeedbackSubmissionTicketClaims {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Partial<FeedbackSubmissionTicketClaims>;
  return claims.version === 1
    && claims.purpose === "feedback-submit"
    && typeof claims.userId === "string" && claims.userId.length > 0
    && typeof claims.collegeId === "string" && claims.collegeId.length > 0
    && typeof claims.targetId === "string" && claims.targetId.length > 0
    && typeof claims.targetUuid === "string" && claims.targetUuid.length > 0
    && (claims.qrCodeId === null || typeof claims.qrCodeId === "string")
    && Number.isInteger(claims.issuedAt)
    && Number.isInteger(claims.expiresAt)
    && typeof claims.nonce === "string" && claims.nonce.length >= 16;
}
