import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import type { Readable } from "node:stream";
import sharp from "sharp";
import { AccessService } from "../../common/access/access.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import type { CompleteIssueAttachmentDto, PresignIssueAttachmentDto } from "./dto/storage.dto";
import { AuditService } from "../audit/audit.service";

const MIME_EXTENSIONS: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"], "image/gif": [".gif"],
  "application/pdf": [".pdf"], "application/msword": [".doc"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "text/csv": [".csv"],
  "application/vnd.ms-powerpoint": [".ppt"], "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"], "text/plain": [".txt"],
  "video/mp4": [".mp4"], "video/webm": [".webm"], "audio/mpeg": [".mp3"], "audio/wav": [".wav"], "audio/x-wav": [".wav"], "audio/mp4": [".m4a"], "audio/webm": [".webm"],
};

const OFFICE_ZIP_MIMES = new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]);
const OFFICE_OLE_MIMES = new Set(["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"]);

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly clientOptions: ConstructorParameters<typeof S3Client>[0];
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly access: AccessService, private readonly audit: AuditService) {
    this.bucket = config.getOrThrow<string>("S3_BUCKET");
    this.clientOptions = { endpoint: config.getOrThrow<string>("S3_ENDPOINT"), region: config.get<string>("S3_REGION", "us-east-1"), forcePathStyle: config.get<boolean>("S3_FORCE_PATH_STYLE", true), credentials: { accessKeyId: config.getOrThrow<string>("S3_ACCESS_KEY"), secretAccessKey: config.getOrThrow<string>("S3_SECRET_KEY") } };
    this.client = new S3Client(this.clientOptions);
  }

  async presign(user: AuthPrincipal, issueId: string, input: PresignIssueAttachmentDto, publicEndpoint?: string) {
    await this.requireIssue(user, issueId, true);
    if (!["ISSUE_REPORT", "ISSUE_UPDATE", "ISSUE_RESOLUTION"].includes(input.purpose)) throw new BadRequestException("Attachment purpose is not valid for an issue.");
    this.validateFile(input);
    const extension = extname(input.fileName).toLowerCase();
    const storageKey = `colleges/${user.collegeId}/issues/${issueId}/${randomUUID()}${extension}`;
    const expiresIn = this.config.get<number>("S3_SIGNED_URL_EXPIRY_SECONDS", 300);
    const uploadUrl = await getSignedUrl(this.signingClient(publicEndpoint), new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, ContentType: input.mimeType, ContentLength: input.sizeBytes, Metadata: { uploader: user.id, purpose: input.purpose } }), { expiresIn });
    return { storageKey, uploadUrl, expiresIn, requiredHeaders: { "content-type": input.mimeType } };
  }

  async complete(user: AuthPrincipal, issueId: string, input: CompleteIssueAttachmentDto, requestId: string) {
    await this.requireIssue(user, issueId, true);
    if (!["ISSUE_REPORT", "ISSUE_UPDATE", "ISSUE_RESOLUTION"].includes(input.purpose)) throw new BadRequestException("Attachment purpose is not valid for an issue.");
    this.validateFile(input);
    const prefix = `colleges/${user.collegeId}/issues/${issueId}/`;
    if (!input.storageKey.startsWith(prefix)) throw new ForbiddenException("Storage key is outside the authorized issue path.");
    const { sha256 } = await this.verifyObject(input);
    return this.prisma.$transaction(async (tx) => {
      const attachment = await tx.issueAttachment.create({ data: { issueId, uploadedById: user.id, purpose: input.purpose, storageKey: input.storageKey, originalName: this.safeName(input.fileName), mimeType: input.mimeType, sizeBytes: BigInt(input.sizeBytes), sha256 }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true, purpose: true, sha256: true, createdAt: true } });
      await this.audit.record({ actorId: user.id, action: "issue_attachment.created", entityType: "IssueAttachment", entityId: attachment.id, afterValue: { issueId, originalName: attachment.originalName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes.toString(), sha256 }, requestId }, tx);
      return attachment;
    });
  }

  async download(user: AuthPrincipal, issueId: string, attachmentId: string, publicEndpoint?: string) {
    await this.requireIssue(user, issueId);
    const attachment = await this.prisma.issueAttachment.findFirst({ where: { id: attachmentId, issueId, deletedAt: null } });
    if (!attachment) throw new NotFoundException("Attachment not found.");
    const expiresIn = this.config.get<number>("S3_SIGNED_URL_EXPIRY_SECONDS", 300);
    const url = await getSignedUrl(this.signingClient(publicEndpoint), new GetObjectCommand({ Bucket: this.bucket, Key: attachment.storageKey, ResponseContentDisposition: `attachment; filename="${this.safeName(attachment.originalName)}"` }), { expiresIn });
    return { url, expiresIn };
  }

  async presignMessage(user: AuthPrincipal, messageId: string, input: PresignIssueAttachmentDto, publicEndpoint?: string) {
    await this.requireMessage(user, messageId, true);
    if (input.purpose !== "MESSAGE") throw new BadRequestException("Message attachments must use the MESSAGE purpose.");
    this.validateFile(input);
    const extension = extname(input.fileName).toLowerCase();
    const storageKey = `colleges/${user.collegeId}/messages/${messageId}/${randomUUID()}${extension}`;
    const expiresIn = this.config.get<number>("S3_SIGNED_URL_EXPIRY_SECONDS", 300);
    const uploadUrl = await getSignedUrl(this.signingClient(publicEndpoint), new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, ContentType: input.mimeType, ContentLength: input.sizeBytes, Metadata: { uploader: user.id, purpose: "MESSAGE" } }), { expiresIn });
    return { storageKey, uploadUrl, expiresIn, requiredHeaders: { "content-type": input.mimeType } };
  }

  async completeMessage(user: AuthPrincipal, messageId: string, input: CompleteIssueAttachmentDto, requestId: string) {
    await this.requireMessage(user, messageId, true);
    if (input.purpose !== "MESSAGE") throw new BadRequestException("Message attachments must use the MESSAGE purpose.");
    this.validateFile(input);
    const prefix = `colleges/${user.collegeId}/messages/${messageId}/`;
    if (!input.storageKey.startsWith(prefix)) throw new ForbiddenException("Storage key is outside the authorized message path.");
    const existingAttachments = await this.prisma.messageAttachment.count({ where: { messageId, deletedAt: null } });
    const maxAttachments = this.config.get<number>("MAX_ATTACHMENTS_PER_MESSAGE", 10);
    if (existingAttachments >= maxAttachments) throw new BadRequestException(`A message can contain at most ${maxAttachments} attachments.`);
    const verified = await this.verifyObject(input);
    const processed = input.mimeType.startsWith("image/") ? await this.processImage(input.storageKey, input.mimeType, verified.content) : { content: verified.content, thumbnailKey: null, width: null, height: null };
    const sha256 = createHash("sha256").update(processed.content).digest("hex");
    const safeName = `${randomUUID()}${extname(input.fileName).toLowerCase()}`;
    const messageType = input.mimeType.startsWith("image/") ? "IMAGE" : input.mimeType.startsWith("video/") ? "VIDEO" : input.mimeType.startsWith("audio/") ? "AUDIO" : "DOCUMENT";
    return this.prisma.$transaction(async (tx) => {
      const attachment = await tx.messageAttachment.create({ data: { messageId, storageKey: input.storageKey, originalName: this.safeName(input.fileName), safeName, mimeType: input.mimeType, sizeBytes: BigInt(processed.content.length), sha256, thumbnailKey: processed.thumbnailKey, width: processed.width, height: processed.height, uploadedById: user.id }, select: { id: true, originalName: true, safeName: true, mimeType: true, sizeBytes: true, sha256: true, thumbnailKey: true, width: true, height: true, createdAt: true } });
      await tx.message.update({ where: { id: messageId }, data: { type: messageType } });
      await this.audit.record({ actorId: user.id, action: "message_attachment.created", entityType: "MessageAttachment", entityId: attachment.id, afterValue: { messageId, originalName: attachment.originalName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes.toString(), sha256 }, requestId }, tx);
      return attachment;
    });
  }

  async downloadMessage(user: AuthPrincipal, messageId: string, attachmentId: string, publicEndpoint?: string) {
    await this.requireMessage(user, messageId);
    const attachment = await this.prisma.messageAttachment.findFirst({ where: { id: attachmentId, messageId, deletedAt: null } });
    if (!attachment) throw new NotFoundException("Message attachment not found.");
    const expiresIn = this.config.get<number>("S3_SIGNED_URL_EXPIRY_SECONDS", 300);
    const url = await getSignedUrl(this.signingClient(publicEndpoint), new GetObjectCommand({ Bucket: this.bucket, Key: attachment.storageKey, ResponseContentDisposition: `attachment; filename="${this.safeName(attachment.originalName)}"` }), { expiresIn });
    return { url, expiresIn };
  }

  async remove(user: AuthPrincipal, issueId: string, attachmentId: string, requestId: string) {
    const issue = await this.requireIssue(user, issueId);
    const attachment = await this.prisma.issueAttachment.findFirst({ where: { id: attachmentId, issueId, deletedAt: null } });
    if (!attachment) throw new NotFoundException("Attachment not found.");
    const teamMember = issue.teamId ? Boolean(await this.prisma.responsibleTeamMember.findFirst({ where: { teamId: issue.teamId, userId: user.id, isActive: true } })) : false;
    const canWork = this.access.canWorkIssue(user, issue, teamMember);
    if (attachment.uploadedById !== user.id && !canWork) throw new ForbiddenException("Only the uploader or authorized responsible staff may remove this attachment.");
    return this.prisma.$transaction(async (tx) => {
      await tx.issueAttachment.update({ where: { id: attachment.id }, data: { deletedAt: new Date() } });
      await this.audit.record({ actorId: user.id, action: "issue_attachment.removed", entityType: "IssueAttachment", entityId: attachment.id, beforeValue: { issueId, originalName: attachment.originalName, mimeType: attachment.mimeType, sha256: attachment.sha256 }, afterValue: { deletedAt: new Date() }, reason: "Authorized attachment removal", requestId }, tx);
      return { id: attachment.id, deleted: true };
    });
  }

  private signingClient(publicEndpoint?: string): S3Client {
    const endpoint = this.config.get<string>("S3_PUBLIC_ENDPOINT") ?? publicEndpoint;
    return endpoint ? new S3Client({ ...this.clientOptions, endpoint }) : this.client;
  }

  private async requireIssue(user: AuthPrincipal, id: string, forWrite = false) {
    const issue = await this.prisma.issue.findFirst({ where: { AND: [{ id }, this.access.issueWhere(user)] }, select: { id: true, collegeId: true, reporterId: true, assignedToId: true, teamId: true, affectedUsers: { where: { userId: user.id }, select: { userId: true } } } });
    if (!issue) throw new NotFoundException("Issue not found.");
    if (forWrite) {
      const teamMember = issue.teamId ? Boolean(await this.prisma.responsibleTeamMember.findFirst({ where: { teamId: issue.teamId, userId: user.id, isActive: true } })) : false;
      const mayAttach = issue.reporterId === user.id || issue.affectedUsers.length > 0 || this.access.canWorkIssue(user, issue, teamMember);
      if (!mayAttach) throw new ForbiddenException("You are not authorized to add evidence to this issue.");
    }
    return issue;
  }

  private async requireMessage(user: AuthPrincipal, id: string, forWrite = false) {
    const message = await this.prisma.message.findFirst({ where: { id, deletedAt: null, conversation: { collegeId: user.collegeId, participants: { some: { userId: user.id, leftAt: null } } } }, select: { id: true, senderId: true, createdAt: true } });
    if (!message) throw new NotFoundException("Message not found.");
    if (forWrite && (message.senderId !== user.id || Date.now() - message.createdAt.getTime() > 15 * 60_000)) throw new ForbiddenException("Only the sender may add an attachment during the message edit window.");
    return message;
  }

  private validateFile(input: PresignIssueAttachmentDto): void {
    const extension = extname(input.fileName).toLowerCase();
    if ([".exe", ".bat", ".cmd", ".ps1", ".js", ".vbs", ".scr", ".com", ".msi"].includes(extension)) throw new BadRequestException("Executable and script files are blocked.");
    const configuredAllowlist = this.config.get<string>("MESSAGE_ALLOWED_MIME_TYPES")?.split(",").map((value) => value.trim()).filter(Boolean);
    if (configuredAllowlist?.length && !configuredAllowlist.includes(input.mimeType)) throw new BadRequestException("This file type is disabled by the college attachment policy.");
    if (!MIME_EXTENSIONS[input.mimeType]?.includes(extension)) throw new BadRequestException("File type and extension are not allowed or do not match.");
    const limitMb = input.mimeType.startsWith("image/") ? this.config.get<number>("MAX_IMAGE_SIZE_MB", 10) : input.mimeType.startsWith("video/") ? this.config.get<number>("MAX_VIDEO_SIZE_MB", 50) : input.mimeType.startsWith("audio/") ? this.config.get<number>("MAX_AUDIO_SIZE_MB", 15) : this.config.get<number>("MAX_DOCUMENT_SIZE_MB", 15);
    if (input.sizeBytes > limitMb * 1024 * 1024) throw new BadRequestException(`File exceeds the ${limitMb} MB limit.`);
  }

  private async verifyObject(input: CompleteIssueAttachmentDto): Promise<{ sha256: string; content: Buffer }> {
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: input.storageKey }));
    if (head.ContentLength !== input.sizeBytes || head.ContentType !== input.mimeType) throw new BadRequestException("Uploaded object metadata does not match the upload request.");
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: input.storageKey }));
    const content = await this.toBuffer(object.Body as Readable | undefined, input.sizeBytes);
    if (!this.matchesSignature(input.mimeType, content)) throw new BadRequestException("The uploaded file content does not match its declared file type.");
    const sha256 = createHash("sha256").update(content).digest("hex");
    await this.scan(content, input.mimeType, sha256);
    return { sha256, content };
  }

  private matchesSignature(mimeType: string, content: Buffer): boolean {
    if (content.length < 4) return false;
    if (mimeType === "image/jpeg") return content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
    if (mimeType === "image/png") return content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mimeType === "image/webp") return content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP";
    if (mimeType === "image/gif") return ["GIF87a", "GIF89a"].includes(content.subarray(0, 6).toString("ascii"));
    if (mimeType === "application/pdf") return content.subarray(0, 5).toString("ascii") === "%PDF-";
    if (OFFICE_ZIP_MIMES.has(mimeType)) return content[0] === 0x50 && content[1] === 0x4b && [0x03, 0x05, 0x07].includes(content[2] ?? 0);
    if (OFFICE_OLE_MIMES.has(mimeType)) return content.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    if (["text/plain", "text/csv"].includes(mimeType)) return !content.subarray(0, Math.min(content.length, 8192)).includes(0);
    if (["video/mp4", "audio/mp4"].includes(mimeType)) return content.subarray(4, 8).toString("ascii") === "ftyp";
    if (mimeType === "audio/mpeg") return content.subarray(0, 3).toString("ascii") === "ID3" || (content[0] === 0xff && ((content[1] ?? 0) & 0xe0) === 0xe0);
    if (["audio/webm", "video/webm"].includes(mimeType)) return content.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (["audio/wav", "audio/x-wav"].includes(mimeType)) return content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WAVE";
    return false;
  }

  private async processImage(storageKey: string, mimeType: string, original: Buffer): Promise<{ content: Buffer; thumbnailKey: string | null; width: number | null; height: number | null }> {
    const source = sharp(original, { animated: mimeType === "image/gif" }).rotate();
    const metadata = await source.metadata();
    let content = original;
    if (mimeType !== "image/gif" && (original.length > 1_000_000 || (metadata.width ?? 0) > 2560 || (metadata.height ?? 0) > 2560)) {
      const resized = sharp(original).rotate().resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true });
      if (mimeType === "image/jpeg") content = await resized.jpeg({ quality: 84, mozjpeg: true }).toBuffer();
      else if (mimeType === "image/png") content = await resized.png({ compressionLevel: 9 }).toBuffer();
      else if (mimeType === "image/webp") content = await resized.webp({ quality: 84 }).toBuffer();
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, Body: content, ContentType: mimeType, Metadata: { processed: "true" } }));
    }
    const finalMetadata = await sharp(content).metadata();
    const thumbnail = await sharp(content, { animated: false }).rotate().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    const thumbnailKey = `${storageKey}.thumbnail.webp`;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: thumbnailKey, Body: thumbnail, ContentType: "image/webp", Metadata: { private: "true" } }));
    return { content, thumbnailKey, width: finalMetadata.width ?? null, height: finalMetadata.height ?? null };
  }

  private async scan(content: Buffer, mimeType: string, sha256: string): Promise<void> {
    if (!this.config.get<boolean>("MALWARE_SCAN_ENABLED", false)) return;
    const url = this.config.getOrThrow<string>("MALWARE_SCAN_URL");
    const response = await fetch(url, { method: "POST", headers: { "content-type": mimeType, "x-content-sha256": sha256 }, body: content as unknown as BodyInit, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new BadRequestException("The malware scanner is unavailable; the attachment was not accepted.");
    const result = await response.json() as { clean?: boolean };
    if (result.clean !== true) throw new BadRequestException("The attachment did not pass the malware scan.");
  }

  private async toBuffer(stream: Readable | undefined, expectedSize: number): Promise<Buffer> {
    if (!stream) throw new BadRequestException("Uploaded object content is unavailable.");
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of stream) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array); size += buffer.length; if (size > expectedSize) throw new BadRequestException("Uploaded object exceeds its declared size."); chunks.push(buffer); }
    if (size !== expectedSize) throw new BadRequestException("Uploaded object size changed during verification.");
    return Buffer.concat(chunks);
  }

  private safeName(value: string): string { return value.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 255); }
}
