import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { AuditService } from "../audit/audit.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import type { CreateQrCodeDto, UpdateQrStatusDto } from "./dto/qr.dto";

interface RequestMetadata {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

type ParsedQr =
  | { kind: "ROOM"; token: string }
  | { kind: "FEEDBACK"; token: string }
  | { kind: "GENERIC"; token: string };

const ROOM_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEEDBACK_TOKEN = /^FB_[A-Za-z0-9_-]{16,160}$/;
const GENERIC_TOKEN = /^QR_[A-Za-z0-9_-]{24,160}$/;
const APPROVED_PATH_PREFIXES = [
  "/report-issue",
  "/locations/rooms/qr",
  "/qr/scan",
  "/scan-qr",
  "/student/feedback/target",
  "/student/feedback/scanner",
  "/attendance",
  "/announcements",
  "/notifications",
  "/profile",
  "/",
];

type GenericQrType = "APPLICATION" | "BLOCK" | "FLOOR" | "CLASS" | "ANNOUNCEMENT" | "LINK";

@Injectable()
export class QrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async validate(
    user: AuthPrincipal,
    rawValue: string,
    metadata: RequestMetadata,
    scanMethod?: string,
  ) {
    const parsed = this.extract(rawValue);
    if (parsed.kind === "ROOM") {
      const result = await this.validateRoom(user, parsed.token);
      await this.audit.record({
        actorId: user.id,
        action: "qr.room_validated",
        entityType: "Room",
        entityId: result.context.roomId,
        afterValue: {
          qrType: "ROOM",
          destination: result.destination,
          scanMethod: scanMethod ?? "UNKNOWN",
        },
        ...metadata,
      });
      return result;
    }
    if (parsed.kind === "GENERIC") {
      return this.validateGeneric(user, parsed.token, metadata, scanMethod);
    }
    const result = await this.validateFeedback(user, parsed.token);
    await this.audit.record({
      actorId: user.id,
      action: "qr.feedback_validated",
      entityType: "FeedbackQrCode",
      entityId: result.context.qrId,
      afterValue: {
        qrType: "STAFF_FEEDBACK",
        destination: result.destination,
        scanMethod: scanMethod ?? "UNKNOWN",
      },
      ...metadata,
    });
    return result;
  }

  async analytics(user: AuthPrincipal) {
    this.requireAny(user, ["locations.qr", "feedback.qr.manage", "audit.read"]);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [
      activeRoomQrCodes,
      activeFeedbackQrCodes,
      activeGenericQrCodes,
      roomQrIssueReports,
      roomQrValidations,
      feedbackQrValidations,
      feedbackQrScans,
      feedbackQrFailures,
      genericQrScans,
      genericQrFailures,
    ] = await Promise.all([
      this.prisma.room.count({
        where: {
          isActive: true,
          floor: { isActive: true, block: { isActive: true, campus: { collegeId: user.collegeId, isActive: true } } },
        },
      }),
      this.prisma.feedbackQrCode.count({
        where: { status: "ACTIVE", target: { collegeId: user.collegeId, isActive: true } },
      }),
      this.prisma.qrCode.count({
        where: { collegeId: user.collegeId, status: "ACTIVE" },
      }),
      this.prisma.issue.count({
        where: { collegeId: user.collegeId, submissionSource: "QR_SCAN", createdAt: { gte: since } },
      }),
      this.prisma.auditLog.count({
        where: { collegeId: user.collegeId, action: "qr.room_validated", createdAt: { gte: since } },
      }),
      this.prisma.auditLog.count({
        where: { collegeId: user.collegeId, action: "qr.feedback_validated", createdAt: { gte: since } },
      }),
      this.prisma.feedbackScanLog.count({
        where: {
          successStatus: true,
          scannedAt: { gte: since },
          qrCode: { target: { collegeId: user.collegeId } },
        },
      }),
      this.prisma.feedbackScanLog.count({
        where: {
          successStatus: false,
          scannedAt: { gte: since },
          qrCode: { target: { collegeId: user.collegeId } },
        },
      }),
      this.prisma.qrScanEvent.count({
        where: { collegeId: user.collegeId, successStatus: true, scannedAt: { gte: since } },
      }),
      this.prisma.qrScanEvent.count({
        where: { collegeId: user.collegeId, successStatus: false, scannedAt: { gte: since } },
      }),
    ]);
    return {
      windowDays: 30,
      activeRoomQrCodes,
      activeFeedbackQrCodes,
      activeGenericQrCodes,
      roomQrIssueReports,
      roomQrValidations,
      feedbackQrValidations,
      feedbackQrScans,
      feedbackQrFailures,
      genericQrScans,
      genericQrFailures,
    };
  }

  async listCodes(user: AuthPrincipal) {
    this.requireAny(user, ["locations.qr", "announcements.publish_college", "settings.manage", "audit.read"]);
    const codes = await this.prisma.qrCode.findMany({
      where: { collegeId: user.collegeId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        publicId: true,
        qrType: true,
        label: true,
        destination: true,
        entityType: true,
        entityId: true,
        status: true,
        expiryDate: true,
        scanCount: true,
        lastScannedAt: true,
        qrUrl: true,
        createdAt: true,
      },
    });
    return codes.map((code) => ({ ...code, id: code.publicId }));
  }

  async createCode(user: AuthPrincipal, input: CreateQrCodeDto, metadata: RequestMetadata) {
    this.requireAny(user, ["locations.qr", "announcements.publish_college", "settings.manage"]);
    const qrType = input.qrType as GenericQrType;
    const token = this.generateToken();
    const entity = await this.resolveGenericEntity(user, qrType, input.entityId);
    const destination = this.safeInternalDestination(input.destination ?? this.defaultDestination(qrType, token));
    const qrUrl = this.qrScanUrl(token);
    const created = await this.prisma.qrCode.create({
      data: {
        collegeId: user.collegeId,
        qrType,
        secureTokenHash: this.hash(token),
        qrUrl,
        label: input.label.trim(),
        destination,
        entityType: entity.entityType,
        entityId: entity.entityId,
        metadata: this.json(input.metadata),
        expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined,
        createdById: user.id,
      },
      select: {
        id: true,
        publicId: true,
        qrType: true,
        label: true,
        destination: true,
        status: true,
        expiryDate: true,
        qrUrl: true,
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: "qr.generic_created",
      entityType: "QrCode",
      entityId: created.id,
      afterValue: { publicId: created.publicId, qrType: created.qrType, destination: created.destination },
      ...metadata,
    });
    return {
      id: created.publicId,
      qrType: created.qrType,
      label: created.label,
      destination: created.destination,
      status: created.status,
      expiryDate: created.expiryDate,
      secureUrl: created.qrUrl,
      dataUrl: await QRCode.toDataURL(created.qrUrl, { errorCorrectionLevel: "M", margin: 1, width: 512 }),
    };
  }

  async updateStatus(user: AuthPrincipal, publicId: string, input: UpdateQrStatusDto, metadata: RequestMetadata) {
    this.requireAny(user, ["locations.qr", "announcements.publish_college", "settings.manage"]);
    const current = await this.prisma.qrCode.findFirst({
      where: { publicId, collegeId: user.collegeId },
      select: { id: true, publicId: true, status: true },
    });
    if (!current) throw new NotFoundException("QR code not found.");
    const updated = await this.prisma.qrCode.update({
      where: { id: current.id },
      data: {
        status: input.status,
        revokedAt: input.status === "REVOKED" ? new Date() : null,
      },
      select: { publicId: true, status: true },
    });
    await this.audit.record({
      actorId: user.id,
      action: "qr.generic_status_changed",
      entityType: "QrCode",
      entityId: current.id,
      beforeValue: { status: current.status },
      afterValue: { status: updated.status },
      ...metadata,
    });
    return { id: updated.publicId, status: updated.status };
  }

  async regenerate(user: AuthPrincipal, publicId: string, metadata: RequestMetadata) {
    this.requireAny(user, ["locations.qr", "announcements.publish_college", "settings.manage"]);
    const current = await this.prisma.qrCode.findFirst({
      where: { publicId, collegeId: user.collegeId },
      select: { id: true, publicId: true, qrType: true, label: true, destination: true },
    });
    if (!current) throw new NotFoundException("QR code not found.");
    const token = this.generateToken();
    const qrUrl = this.qrScanUrl(token);
    const destination = this.destinationNeedsToken(current.destination) ? this.defaultDestination(current.qrType as GenericQrType, token) : current.destination;
    const updated = await this.prisma.qrCode.update({
      where: { id: current.id },
      data: {
        secureTokenHash: this.hash(token),
        qrUrl,
        destination,
        status: "ACTIVE",
        revokedAt: null,
      },
      select: { publicId: true, qrType: true, label: true, destination: true, status: true, qrUrl: true },
    });
    await this.audit.record({
      actorId: user.id,
      action: "qr.generic_regenerated",
      entityType: "QrCode",
      entityId: current.id,
      afterValue: { publicId: updated.publicId, qrType: updated.qrType },
      ...metadata,
    });
    return {
      id: updated.publicId,
      qrType: updated.qrType,
      label: updated.label,
      destination: updated.destination,
      status: updated.status,
      secureUrl: updated.qrUrl,
      dataUrl: await QRCode.toDataURL(updated.qrUrl, { errorCorrectionLevel: "M", margin: 1, width: 512 }),
    };
  }

  private async validateRoom(user: AuthPrincipal, token: string) {
    if (!user.permissions.includes("issues.create"))
      throw new BadRequestException("You are not allowed to report issues from room QR codes.");
    const room = await this.prisma.room.findFirst({
      where: {
        qrToken: token,
        isActive: true,
        floor: { isActive: true, block: { isActive: true, campus: { collegeId: user.collegeId, isActive: true } } },
      },
      select: {
        id: true,
        code: true,
        name: true,
        roomNumber: true,
        roomType: true,
        department: { select: { id: true, code: true, name: true } },
        floor: {
          select: {
            id: true,
            code: true,
            name: true,
            level: true,
            block: {
              select: {
                id: true,
                code: true,
                name: true,
                campus: { select: { id: true, code: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!room) throw new NotFoundException("This room QR code is not recognized or the linked room is inactive.");
    const destination = `/report-issue?roomToken=${encodeURIComponent(token)}&source=qr`;
    return {
      valid: true,
      qrType: "ROOM",
      destination,
      label: `${room.floor.block.name} / ${room.floor.name} / ${room.name}`,
      context: {
        roomId: room.id,
        roomCode: room.code,
        roomName: room.name,
        roomNumber: room.roomNumber,
        roomType: room.roomType,
        floorId: room.floor.id,
        floorCode: room.floor.code,
        floorName: room.floor.name,
        floorLevel: room.floor.level,
        blockId: room.floor.block.id,
        blockCode: room.floor.block.code,
        blockName: room.floor.block.name,
        campusId: room.floor.block.campus.id,
        campusCode: room.floor.block.campus.code,
        campusName: room.floor.block.campus.name,
        department: room.department,
      },
    };
  }

  private async validateFeedback(user: AuthPrincipal, token: string) {
    if (!user.permissions.includes("feedback.scan"))
      throw new BadRequestException("You are not allowed to scan feedback QR codes.");
    const qr = await this.prisma.feedbackQrCode.findUnique({
      where: { secureTokenHash: this.hash(token) },
      include: {
        target: {
          select: {
            targetUuid: true,
            targetName: true,
            targetType: true,
            collegeId: true,
            isActive: true,
            department: { select: { code: true, name: true } },
            room: { select: { code: true, name: true } },
            staff: { select: { publicId: true, fullName: true } },
          },
        },
      },
    });
    if (!qr) throw new NotFoundException("This QR code is not recognized by the AVS College Management System.");
    if (qr.target.collegeId !== user.collegeId) throw new BadRequestException("This QR code belongs to another college.");
    if (!qr.target.isActive) throw new BadRequestException("This feedback target is inactive.");
    if (qr.status !== "ACTIVE") throw new BadRequestException(`This QR code is ${qr.status.toLowerCase()}.`);
    if (qr.expiryDate && qr.expiryDate < new Date()) throw new BadRequestException("This QR code has expired.");
    return {
      valid: true,
      qrType: "STAFF_FEEDBACK",
      destination: `/feedback/scan/${encodeURIComponent(token)}`,
      label: qr.target.targetName,
      context: {
        qrId: qr.id,
        qrPublicId: qr.qrUuid,
        targetId: qr.target.targetUuid,
        targetType: qr.target.targetType,
        targetName: qr.target.targetName,
        department: qr.target.department,
        room: qr.target.room,
        staff: qr.target.staff ? { id: qr.target.staff.publicId, fullName: qr.target.staff.fullName } : null,
      },
    };
  }

  private async validateGeneric(
    user: AuthPrincipal,
    token: string,
    metadata: RequestMetadata,
    scanMethod?: string,
  ) {
    const qr = await this.prisma.qrCode.findUnique({
      where: { secureTokenHash: this.hash(token) },
      select: {
        id: true,
        publicId: true,
        collegeId: true,
        qrType: true,
        label: true,
        destination: true,
        entityType: true,
        entityId: true,
        metadata: true,
        status: true,
        expiryDate: true,
      },
    });
    if (!qr) throw new NotFoundException("This QR code is not recognized by the AVS College Management System.");
    try {
      if (qr.collegeId !== user.collegeId) throw new BadRequestException("This QR code belongs to another college.");
      if (qr.status !== "ACTIVE") throw new BadRequestException(`This QR code is ${qr.status.toLowerCase()}.`);
      if (qr.expiryDate && qr.expiryDate < new Date()) throw new BadRequestException("This QR code has expired.");
      this.ensureGenericPermission(user, qr.qrType as GenericQrType);
      const context = await this.genericContext(user, qr.qrType as GenericQrType, qr.entityId);
      await Promise.all([
        this.prisma.qrCode.update({
          where: { id: qr.id },
          data: { scanCount: { increment: 1 }, lastScannedAt: new Date() },
        }),
        this.prisma.qrScanEvent.create({
          data: {
            qrCodeId: qr.id,
            collegeId: user.collegeId,
            userId: user.id,
            scanMethod: scanMethod ?? "UNKNOWN",
            successStatus: true,
            destination: qr.destination,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
        }),
        this.audit.record({
          actorId: user.id,
          action: "qr.generic_validated",
          entityType: "QrCode",
          entityId: qr.id,
          afterValue: { publicId: qr.publicId, qrType: qr.qrType, destination: qr.destination, scanMethod: scanMethod ?? "UNKNOWN" },
          ...metadata,
        }),
      ]);
      return {
        valid: true,
        qrType: qr.qrType,
        destination: qr.destination,
        label: qr.label,
        context: {
          qrId: qr.publicId,
          entityType: qr.entityType,
          entityId: qr.entityId,
          metadata: qr.metadata,
          ...context,
        },
      };
    } catch (error) {
      await this.prisma.qrScanEvent.create({
        data: {
          qrCodeId: qr.id,
          collegeId: user.collegeId,
          userId: user.id,
          scanMethod: scanMethod ?? "UNKNOWN",
          successStatus: false,
          failureReason: error instanceof Error ? error.message.slice(0, 300) : "QR validation failed.",
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        },
      }).catch(() => undefined);
      throw error;
    }
  }

  private extract(rawValue: string): ParsedQr {
    const value = rawValue.trim();
    if (ROOM_TOKEN.test(value)) return { kind: "ROOM", token: value };
    if (FEEDBACK_TOKEN.test(value)) return { kind: "FEEDBACK", token: value };
    if (GENERIC_TOKEN.test(value)) return { kind: "GENERIC", token: value };
    if (!/^https?:\/\//i.test(value))
      throw new BadRequestException("This QR code is not an official AVS code.");
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException("This QR code could not be read.");
    }
    this.assertApprovedOrigin(url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (!APPROVED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      throw new BadRequestException("This QR destination is not approved.");
    }
    const roomToken = url.searchParams.get("roomToken");
    if (roomToken && ROOM_TOKEN.test(roomToken)) return { kind: "ROOM", token: roomToken };
    const genericQueryToken = url.searchParams.get("qrToken") ?? url.searchParams.get("token");
    if (genericQueryToken && GENERIC_TOKEN.test(genericQueryToken)) return { kind: "GENERIC", token: genericQueryToken };
    const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
    if (ROOM_TOKEN.test(lastSegment)) return { kind: "ROOM", token: lastSegment };
    if (FEEDBACK_TOKEN.test(lastSegment)) return { kind: "FEEDBACK", token: lastSegment };
    if (GENERIC_TOKEN.test(lastSegment)) return { kind: "GENERIC", token: lastSegment };
    throw new BadRequestException("This QR code does not contain a recognized AVS token.");
  }

  private async resolveGenericEntity(user: AuthPrincipal, qrType: GenericQrType, entityId?: string) {
    if (["APPLICATION", "LINK"].includes(qrType)) return { entityType: null, entityId: null };
    if (!entityId) throw new BadRequestException(`${qrType.toLowerCase()} QR codes require a linked entity.`);
    const context = await this.genericContext(user, qrType, entityId);
    return { entityType: context.entityType, entityId };
  }

  private async genericContext(user: AuthPrincipal, qrType: GenericQrType, entityId: string | null) {
    if (qrType === "APPLICATION" || qrType === "LINK") return {};
    if (!entityId) throw new BadRequestException("This QR code is missing its linked entity.");
    if (qrType === "BLOCK") {
      const block = await this.prisma.block.findFirst({
        where: { id: entityId, isActive: true, campus: { collegeId: user.collegeId, isActive: true } },
        select: { id: true, code: true, name: true, campus: { select: { id: true, code: true, name: true } } },
      });
      if (!block) throw new NotFoundException("The linked block is inactive or no longer exists.");
      return {
        entityType: "Block",
        blockId: block.id,
        blockCode: block.code,
        blockName: block.name,
        campusId: block.campus.id,
        campusCode: block.campus.code,
        campusName: block.campus.name,
      };
    }
    if (qrType === "FLOOR") {
      const floor = await this.prisma.floor.findFirst({
        where: { id: entityId, isActive: true, block: { isActive: true, campus: { collegeId: user.collegeId, isActive: true } } },
        select: {
          id: true,
          code: true,
          name: true,
          level: true,
          block: { select: { id: true, code: true, name: true, campus: { select: { id: true, code: true, name: true } } } },
        },
      });
      if (!floor) throw new NotFoundException("The linked floor is inactive or no longer exists.");
      return {
        entityType: "Floor",
        floorId: floor.id,
        floorCode: floor.code,
        floorName: floor.name,
        floorLevel: floor.level,
        blockId: floor.block.id,
        blockCode: floor.block.code,
        blockName: floor.block.name,
        campusId: floor.block.campus.id,
        campusCode: floor.block.campus.code,
        campusName: floor.block.campus.name,
      };
    }
    if (qrType === "CLASS") {
      const section = await this.prisma.section.findFirst({
        where: {
          id: entityId,
          isActive: true,
          semester: { isActive: true, programme: { collegeId: user.collegeId, isActive: true } },
        },
        select: {
          id: true,
          code: true,
          name: true,
          semester: {
            select: {
              id: true,
              number: true,
              name: true,
              programme: { select: { id: true, code: true, name: true, department: { select: { id: true, code: true, name: true } } } },
            },
          },
        },
      });
      if (!section) throw new NotFoundException("The linked class is inactive or no longer exists.");
      return {
        entityType: "Section",
        sectionId: section.id,
        sectionCode: section.code,
        sectionName: section.name,
        semesterId: section.semester.id,
        semesterNumber: section.semester.number,
        semesterName: section.semester.name,
        programmeId: section.semester.programme.id,
        programmeCode: section.semester.programme.code,
        programmeName: section.semester.programme.name,
        departmentId: section.semester.programme.department.id,
        departmentCode: section.semester.programme.department.code,
        departmentName: section.semester.programme.department.name,
      };
    }
    const announcement = await this.prisma.announcement.findFirst({
      where: { id: entityId, collegeId: user.collegeId },
      select: { id: true, title: true, status: true },
    });
    if (!announcement) throw new NotFoundException("The linked announcement no longer exists.");
    return {
      entityType: "Announcement",
      announcementId: announcement.id,
      announcementTitle: announcement.title,
      announcementStatus: announcement.status,
    };
  }

  private ensureGenericPermission(user: AuthPrincipal, qrType: GenericQrType): void {
    const allowed =
      qrType === "BLOCK" || qrType === "FLOOR"
        ? user.permissions.includes("issues.create")
        : qrType === "CLASS"
          ? user.permissions.some((permission) => permission.startsWith("attendance.read") || permission === "attendance.session.create")
          : qrType === "ANNOUNCEMENT"
            ? user.permissions.includes("announcements.read")
            : true;
    if (!allowed) throw new BadRequestException("You are not allowed to use this QR code.");
  }

  private safeInternalDestination(destination: string): string {
    const trimmed = destination.trim();
    if (!trimmed.startsWith("/")) throw new BadRequestException("QR destinations must be internal application paths.");
    const url = new URL(trimmed, this.config.get<string>("WEB_URL", "http://localhost:3000"));
    this.assertApprovedOrigin(url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (!APPROVED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      throw new BadRequestException("This QR destination is not approved.");
    }
    return `${url.pathname}${url.search}${url.hash}`;
  }

  private defaultDestination(qrType: GenericQrType, token: string): string {
    if (qrType === "BLOCK" || qrType === "FLOOR") return `/report-issue?qrToken=${encodeURIComponent(token)}&source=qr`;
    if (qrType === "CLASS") return "/attendance";
    if (qrType === "ANNOUNCEMENT") return "/announcements";
    return "/";
  }

  private destinationNeedsToken(destination: string): boolean {
    return destination.startsWith("/report-issue?") && destination.includes("qrToken=");
  }

  private qrScanUrl(token: string): string {
    return `${this.config.get<string>("WEB_URL", "http://localhost:3000").replace(/\/$/, "")}/scan-qr?token=${encodeURIComponent(token)}`;
  }

  private generateToken(): string {
    return `QR_${randomBytes(32).toString("base64url")}`;
  }

  private assertApprovedOrigin(url: URL): void {
    const configured = this.config.get<string>("WEB_URL", "http://localhost:3000");
    const allowed = new Set<string>();
    const configuredOrigins = (this.config.get<string>("CORS_ALLOWED_ORIGINS", "") || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    for (const candidate of [configured, ...configuredOrigins, "http://localhost:3000", "https://localhost:3000"]) {
      try {
        const parsed = new URL(candidate);
        allowed.add(parsed.origin);
      } catch {
        continue;
      }
    }
    const isLanDev =
      ["http:", "https:"].includes(url.protocol) &&
      /^(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/i.test(url.hostname);
    if (!allowed.has(url.origin) && !isLanDev) {
      throw new BadRequestException("External QR destinations are not allowed.");
    }
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private json(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private requireAny(user: AuthPrincipal, permissions: string[]): void {
    if (!permissions.some((permission) => user.permissions.includes(permission))) {
      throw new ForbiddenException("You do not have permission to view QR analytics.");
    }
  }
}
