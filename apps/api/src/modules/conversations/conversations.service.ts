import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import { createCipheriv, randomBytes, scrypt } from "node:crypto";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { AuditService } from "../audit/audit.service";
import type {
  ConversationPreferenceDto,
  CreateDirectConversationDto,
  CreateGroupConversationDto,
  EditMessageDto,
  ModerateMessageReportDto,
  SendMessageDto,
  UpdateConversationDto,
} from "./dto/conversation.dto";
import { OfficialGroupsService } from "./official-groups.service";
import { RealtimeGateway } from "./realtime.gateway";

const MESSAGE_WINDOW_MS = 15 * 60_000;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
    private readonly officialGroups: OfficialGroupsService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async encryptedBackup(user: AuthPrincipal, currentPassword: string, requestId: string) {
    const credential = await this.prisma.userCredential.findUnique({ where: { userId: user.id }, select: { passwordHash: true } });
    const pepper = this.config?.get<string>("PASSWORD_PEPPER", "") ?? "";
    if (!credential || !(await argon2.verify(credential.passwordHash, currentPassword + pepper))) {
      throw new UnauthorizedException("The current password is incorrect.");
    }
    const conversations = await this.prisma.conversation.findMany({
      where: { collegeId: user.collegeId, participants: { some: { userId: user.id, leftAt: null } } },
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        participants: {
          where: { leftAt: null },
          select: { role: true, joinedAt: true, user: { select: { publicId: true, fullName: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    const conversationIds = conversations.map((conversation) => conversation.id);
    const maxMessages = this.config?.get<number>("MESSAGE_BACKUP_MAX_MESSAGES", 100_000) ?? 100_000;
    const messages = conversationIds.length ? await this.prisma.message.findMany({
      where: { conversationId: { in: conversationIds }, deletions: { none: { userId: user.id } } },
      select: {
        id: true,
        conversationId: true,
        replyToId: true,
        forwardedFromId: true,
        type: true,
        status: true,
        clientId: true,
        body: true,
        pinnedAt: true,
        editedAt: true,
        deletedAt: true,
        createdAt: true,
        sender: { select: { publicId: true, fullName: true } },
        attachments: {
          where: { deletedAt: null },
          select: { id: true, originalName: true, safeName: true, mimeType: true, sizeBytes: true, sha256: true, width: true, height: true, uploadStatus: true, createdAt: true },
        },
        readReceipts: { select: { readAt: true, user: { select: { publicId: true } } } },
        reactions: { select: { emoji: true, createdAt: true, userId: true } },
        deliveries: { where: { userId: user.id }, select: { status: true, updatedAt: true } },
      },
      orderBy: { createdAt: "asc" },
      take: maxMessages + 1,
    }) : [];
    if (messages.length > maxMessages) throw new BadRequestException(`This backup exceeds the configured ${maxMessages} message limit. Ask an administrator to raise the secure export limit.`);
    const cursors = conversationIds.length ? await this.prisma.messageLocalSyncCursor.findMany({ where: { userId: user.id, conversationId: { in: conversationIds } } }) : [];
    const plain = Buffer.from(JSON.stringify({
      format: "AVS_MESSAGE_BACKUP_V1",
      exportedAt: new Date().toISOString(),
      ownerPublicId: user.publicId,
      conversationCount: conversations.length,
      messageCount: messages.length,
      conversations,
      messages: messages.map((message) => ({
        ...message,
        attachments: message.attachments.map((attachment) => ({ ...attachment, sizeBytes: attachment.sizeBytes.toString(), serverReference: attachment.id })),
      })),
      syncCursors: cursors,
      restorePolicy: "Drafts and encrypted local cache may be restored locally. Server access is always re-authorized and attachment URLs must be requested again.",
    }), "utf8");
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await this.deriveBackupKey(currentPassword, salt);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const envelope = Buffer.from(JSON.stringify({
      format: "AVS_ENCRYPTED_JSON_V1",
      algorithm: "AES-256-GCM",
      kdf: { name: "scrypt", salt: salt.toString("base64"), keyLength: 32 },
      iv: iv.toString("base64"),
      authenticationTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    }), "utf8");
    key.fill(0);
    plain.fill(0);
    await this.audit.record({
      actorId: user.id,
      action: "messages.backup_exported",
      entityType: "User",
      entityId: user.id,
      afterValue: { conversationCount: conversations.length, messageCount: messages.length, encrypted: true },
      requestId,
    });
    return { content: envelope, fileName: `avs-message-backup-${new Date().toISOString().slice(0, 10)}.avs.json` };
  }

  private deriveBackupKey(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(password, salt, 32, { N: 16_384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key as Buffer));
    });
  }

  async list(user: AuthPrincipal, search = "") {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        collegeId: user.collegeId,
        archivedAt: null,
        ...(search ? { title: { contains: search.slice(0, 100), mode: "insensitive" } } : {}),
        participants: { some: { userId: user.id, leftAt: null, archivedAt: null } },
      },
      include: {
        participants: {
          where: { leftAt: null },
          include: { user: { select: { publicId: true, fullName: true, profilePhotoKey: true, lastLoginAt: true } } },
        },
        messages: {
          where: { deletions: { none: { userId: user.id } } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, body: true, type: true, status: true, createdAt: true, senderId: true, deletedAt: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    const withUnread = await Promise.all(conversations.map(async (conversation) => {
      const own = conversation.participants.find((participant) => participant.userId === user.id);
      const cutoff = own?.markedUnreadAt ?? own?.lastReadAt;
      const unreadCount = await this.prisma.message.count({
        where: {
          conversationId: conversation.id,
          senderId: { not: user.id },
          deletedAt: null,
          deletions: { none: { userId: user.id } },
          ...(cutoff ? { createdAt: { gt: cutoff } } : {}),
        },
      });
      return { ...conversation, unreadCount };
    }));
    return withUnread.sort((a, b) => {
      const aPin = a.participants.find((participant) => participant.userId === user.id)?.pinnedAt?.getTime() ?? 0;
      const bPin = b.participants.find((participant) => participant.userId === user.id)?.pinnedAt?.getTime() ?? 0;
      return bPin - aPin || b.updatedAt.getTime() - a.updatedAt.getTime();
    });
  }

  async get(user: AuthPrincipal, conversationId: string) {
    await this.requireParticipant(user, conversationId);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, collegeId: user.collegeId },
      include: { participants: { where: { leftAt: null }, include: { user: { select: { publicId: true, fullName: true, profilePhotoKey: true, lastLoginAt: true } } } }, _count: { select: { messages: true } } },
    });
    if (!conversation) throw new NotFoundException("Conversation not found.");
    return conversation;
  }

  async createDirect(user: AuthPrincipal, input: CreateDirectConversationDto) {
    const visibility = await this.contactVisibilityWhere(user);
    const target = await this.prisma.user.findFirst({ where: { AND: [visibility, { publicId: input.participantPublicId }] } });
    if (!target) throw new BadRequestException("Select a college user you are permitted to contact.");
    const key = `direct:${[user.id, target.id].sort().join(":")}`;
    return this.prisma.conversation.upsert({
      where: { officialKey: key },
      create: { type: "DIRECT", collegeId: user.collegeId, officialKey: key, createdById: user.id, participants: { create: [{ userId: user.id }, { userId: target.id }] } },
      update: { archivedAt: null, participants: { updateMany: { where: { userId: { in: [user.id, target.id] } }, data: { leftAt: null, archivedAt: null } } } },
      include: { participants: { include: { user: { select: { publicId: true, fullName: true } } } } },
    });
  }

  async createGroup(user: AuthPrincipal, input: CreateGroupConversationDto, requestId: string) {
    const ids = [...new Set(input.participantPublicIds)];
    const members = await this.prisma.user.findMany({ where: { publicId: { in: ids }, collegeId: user.collegeId, status: "ACTIVE", archivedAt: null }, select: { id: true, publicId: true } });
    if (members.length !== ids.length) throw new BadRequestException("One or more selected group members are invalid or inactive.");
    const conversation = await this.prisma.conversation.create({
      data: {
        type: "CUSTOM_GROUP",
        title: input.title.trim(),
        description: input.description?.trim(),
        collegeId: user.collegeId,
        createdById: user.id,
        sendRestricted: input.sendRestricted ?? false,
        participants: { create: [{ userId: user.id, role: "OWNER" }, ...members.filter((member) => member.id !== user.id).map((member) => ({ userId: member.id, role: "MEMBER" as const }))] },
      },
      include: { participants: { include: { user: { select: { publicId: true, fullName: true } } } } },
    });
    await this.audit.record({ actorId: user.id, action: "conversation.group_created", entityType: "Conversation", entityId: conversation.id, afterValue: { title: conversation.title, participantCount: conversation.participants.length }, requestId });
    return conversation;
  }

  async updateConversation(user: AuthPrincipal, conversationId: string, input: UpdateConversationDto, requestId: string) {
    const participant = await this.requireParticipant(user, conversationId);
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException("Conversation not found.");
    if (conversation.isOfficial && !user.permissions.includes("conversations.manage_official")) throw new ForbiddenException("Official group details are managed by authorized administrators.");
    if (!conversation.isOfficial && !["OWNER", "ADMIN"].includes(participant.role)) throw new ForbiddenException("Only a group owner or administrator may edit group details.");
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.sendRestricted !== undefined ? { sendRestricted: input.sendRestricted } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
      },
    });
    await this.audit.record({ actorId: user.id, action: "conversation.updated", entityType: "Conversation", entityId: conversationId, beforeValue: conversation, afterValue: updated, requestId });
    return updated;
  }

  async messages(user: AuthPrincipal, conversationId: string, before?: Date, cursor?: string) {
    await this.requireParticipant(user, conversationId);
    if (before && Number.isNaN(before.getTime())) throw new BadRequestException("Message cursor date is invalid.");
    return this.prisma.message.findMany({
      where: { conversationId, deletions: { none: { userId: user.id } }, ...(before ? { createdAt: { lt: before } } : {}) },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: 50,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        sender: { select: { publicId: true, fullName: true } },
        replyTo: { select: { id: true, body: true, sender: { select: { fullName: true } } } },
        forwardedFrom: { select: { id: true, sender: { select: { fullName: true } } } },
        readReceipts: { select: { userId: true, readAt: true } },
        deliveries: { select: { userId: true, status: true, updatedAt: true } },
        reactions: { select: { userId: true, emoji: true, createdAt: true } },
        stars: { where: { userId: user.id }, select: { createdAt: true } },
        attachments: { where: { deletedAt: null }, select: { id: true, originalName: true, safeName: true, mimeType: true, sizeBytes: true, sha256: true, thumbnailKey: true, width: true, height: true, createdAt: true } },
      },
    });
  }

  async send(user: AuthPrincipal, conversationId: string, input: SendMessageDto) {
    const participant = await this.requireParticipant(user, conversationId);
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { sendRestricted: true, archivedAt: true } });
    if (!conversation || conversation.archivedAt) throw new NotFoundException("Conversation not found.");
    if (conversation.sendRestricted && participant.role === "MEMBER") throw new ForbiddenException("Only group administrators may send messages in this conversation.");
    const body = input.body?.trim() ?? "";
    const attachmentUploadIds = [...new Set(input.attachmentUploadIds ?? [])];
    if (!body && !attachmentUploadIds.length && !input.forwardedFromId) throw new BadRequestException("Enter a message or select an attachment.");
    if (input.replyToId) await this.requireMessageInConversation(input.replyToId, conversationId, "Reply target");
    let forwardedBody = body;
    if (input.forwardedFromId) {
      const source = await this.requireMessageInConversation(input.forwardedFromId, conversationId, "Forward source");
      forwardedBody ||= source.body;
    }
    if (input.clientId) {
      const existing = await this.prisma.message.findFirst({ where: { senderId: user.id, clientId: input.clientId }, include: { sender: { select: { publicId: true, fullName: true } }, attachments: true, readReceipts: true, reactions: true, deliveries: true } });
      if (existing) return existing;
    }
    const message = await this.prisma.$transaction(async (tx) => {
      const recipients = await tx.conversationParticipant.findMany({ where: { conversationId, userId: { not: user.id }, leftAt: null }, select: { userId: true } });
      const attachmentUploads = attachmentUploadIds.length ? await tx.messageAttachmentUpload.findMany({
        where: {
          id: { in: attachmentUploadIds },
          collegeId: user.collegeId,
          conversationId,
          uploadedById: user.id,
          status: "READY",
          consumedByMessageId: null,
          expiresAt: { gt: new Date() },
        },
      }) : [];
      if (attachmentUploads.length !== attachmentUploadIds.length) {
        throw new BadRequestException("One or more attachments are incomplete, expired or already sent.");
      }
      const firstMime = attachmentUploads[0]?.mimeType;
      const messageType = firstMime?.startsWith("image/") ? "IMAGE"
        : firstMime?.startsWith("video/") ? "VIDEO"
          : firstMime?.startsWith("audio/") ? "AUDIO"
            : attachmentUploads.length ? "DOCUMENT"
              : input.messageType ?? "TEXT";
      const created = await tx.message.create({
        data: {
          conversationId,
          senderId: user.id,
          body: forwardedBody,
          replyToId: input.replyToId,
          forwardedFromId: input.forwardedFromId,
          type: messageType,
          status: "SENT",
          clientId: input.clientId,
          attachments: {
            create: attachmentUploads.map((upload) => ({
              storageKey: upload.storageKey,
              originalName: upload.originalName,
              safeName: upload.safeName,
              mimeType: upload.mimeType,
              sizeBytes: upload.sizeBytes,
              sha256: upload.sha256,
              thumbnailKey: upload.thumbnailKey,
              width: upload.width,
              height: upload.height,
              uploadedById: user.id,
              uploadStatus: "SENT",
            })),
          },
          deliveries: { create: recipients.map((recipient) => ({ userId: recipient.userId, status: "SENT" })) },
        },
        include: { sender: { select: { publicId: true, fullName: true } }, attachments: true, readReceipts: true, reactions: true, deliveries: true },
      });
      if (attachmentUploadIds.length) {
        await tx.messageAttachmentUpload.updateMany({ where: { id: { in: attachmentUploadIds }, consumedByMessageId: null }, data: { status: "CONSUMED", consumedByMessageId: created.id } });
      }
      await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      if (recipients.length) {
        await tx.notification.create({ data: { type: "NEW_MESSAGE", title: `New message from ${user.fullName}`, body: forwardedBody.slice(0, 180) || "Shared an attachment", relatedEntityType: "Conversation", relatedEntityId: conversationId, recipients: { create: recipients.map((recipient) => ({ userId: recipient.userId })) } } });
      }
      return created;
    });
    this.realtime.messageCreated(conversationId, message);
    return message;
  }

  async retry(user: AuthPrincipal, messageId: string) {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, senderId: user.id, deletedAt: null, conversation: { participants: { some: { userId: user.id, leftAt: null } } } },
      include: { attachments: { where: { deletedAt: null } }, deliveries: true },
    });
    if (!message) throw new NotFoundException("Message not found.");
    if (!["FAILED", "RETRYING", "SENT"].includes(message.status)) throw new BadRequestException("This message cannot be retried.");
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.message.update({ where: { id: message.id }, data: { status: "RETRYING" } });
      await tx.messageDelivery.updateMany({ where: { messageId, status: "FAILED" }, data: { status: "RETRYING", lastError: null } });
      const sent = await tx.message.update({
        where: { id: message.id },
        data: { status: "SENT" },
        include: { sender: { select: { publicId: true, fullName: true } }, attachments: true, readReceipts: true, reactions: true, deliveries: true },
      });
      await tx.messageDelivery.updateMany({ where: { messageId, status: "RETRYING" }, data: { status: "SENT", lastError: null } });
      return sent;
    });
    this.realtime.messageCreated(message.conversationId, updated);
    return updated;
  }

  async markRead(user: AuthPrincipal, conversationId: string) {
    await this.requireParticipant(user, conversationId);
    const messages = await this.prisma.message.findMany({ where: { conversationId, senderId: { not: user.id }, deletedAt: null, readReceipts: { none: { userId: user.id } } }, select: { id: true } });
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (messages.length) {
        await tx.messageReadReceipt.createMany({ data: messages.map((message) => ({ messageId: message.id, userId: user.id, readAt: now })), skipDuplicates: true });
        await tx.messageDelivery.updateMany({ where: { messageId: { in: messages.map((message) => message.id) }, userId: user.id }, data: { status: "READ" } });
      }
      await tx.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId: user.id } }, data: { lastReadAt: now, markedUnreadAt: null, lastReadMessageId: messages[0]?.id } });
    });
    this.realtime.readChanged(conversationId, { conversationId, userId: user.id, messageIds: messages.map((message) => message.id), readAt: now });
    return { read: messages.length, readAt: now };
  }

  async readMessage(user: AuthPrincipal, messageId: string) {
    const message = await this.requireAccessibleMessage(user, messageId);
    return this.markRead(user, message.conversationId);
  }

  async edit(user: AuthPrincipal, messageId: string, input: EditMessageDto) {
    const message = await this.prisma.message.findFirst({ where: { id: messageId, senderId: user.id, deletedAt: null } });
    if (!message) throw new NotFoundException("Message not found.");
    if (Date.now() - message.createdAt.getTime() > MESSAGE_WINDOW_MS) throw new ForbiddenException("The message edit window has expired.");
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.messageEditHistory.create({ data: { messageId, previousBody: message.body, editedById: user.id } });
      return tx.message.update({ where: { id: messageId }, data: { body: input.body.trim(), editedAt: new Date() } });
    });
    this.realtime.messageUpdated(message.conversationId, updated);
    return updated;
  }

  async remove(user: AuthPrincipal, messageId: string, forEveryone = true): Promise<void> {
    const message = await this.prisma.message.findFirst({ where: { id: messageId, deletedAt: null }, select: { id: true, senderId: true, conversationId: true, createdAt: true } });
    if (!message) throw new NotFoundException("Message not found.");
    const participant = await this.requireParticipant(user, message.conversationId);
    if (!forEveryone) {
      await this.prisma.messageDeletion.upsert({ where: { messageId_userId: { messageId, userId: user.id } }, create: { messageId, userId: user.id }, update: { deletedAt: new Date() } });
      return;
    }
    const mayModerate = participant.role !== "MEMBER" && user.permissions.includes("messages.moderate_reported");
    if (message.senderId !== user.id && !mayModerate) throw new ForbiddenException("Only the sender may delete this message for everyone.");
    if (!mayModerate && Date.now() - message.createdAt.getTime() > MESSAGE_WINDOW_MS) throw new ForbiddenException("The message deletion window has expired.");
    const deletedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.message.update({ where: { id: message.id }, data: { deletedAt, body: "", status: "DELETED" } }),
      this.prisma.messageDelivery.updateMany({ where: { messageId }, data: { status: "DELETED" } }),
    ]);
    this.realtime.messageUpdated(message.conversationId, { id: message.id, deletedAt, status: "DELETED" });
  }

  async star(user: AuthPrincipal, messageId: string) {
    const message = await this.requireAccessibleMessage(user, messageId);
    return this.prisma.messageStar.upsert({ where: { messageId_userId: { messageId, userId: user.id } }, create: { messageId, userId: user.id }, update: {} }).then(() => ({ messageId: message.id, starred: true }));
  }

  async unstar(user: AuthPrincipal, messageId: string): Promise<void> {
    await this.requireAccessibleMessage(user, messageId);
    await this.prisma.messageStar.deleteMany({ where: { messageId, userId: user.id } });
  }

  async pinMessage(user: AuthPrincipal, messageId: string, pinned: boolean) {
    const message = await this.requireAccessibleMessage(user, messageId);
    const participant = await this.requireParticipant(user, message.conversationId);
    if (participant.role === "MEMBER") throw new ForbiddenException("Only group administrators may pin messages.");
    const updated = await this.prisma.message.update({ where: { id: messageId }, data: { pinnedAt: pinned ? new Date() : null } });
    this.realtime.messageUpdated(message.conversationId, updated);
    return updated;
  }

  async react(user: AuthPrincipal, messageId: string, rawEmoji: string) {
    const message = await this.requireAccessibleMessage(user, messageId);
    const reaction = await this.prisma.messageReaction.upsert({ where: { messageId_userId_emoji: { messageId, userId: user.id, emoji: rawEmoji.trim() } }, create: { messageId, userId: user.id, emoji: rawEmoji.trim() }, update: {} });
    this.realtime.messageUpdated(message.conversationId, { id: messageId, reaction });
    return reaction;
  }

  async unreact(user: AuthPrincipal, messageId: string, rawEmoji: string): Promise<void> {
    const message = await this.requireAccessibleMessage(user, messageId);
    await this.prisma.messageReaction.deleteMany({ where: { messageId, userId: user.id, emoji: rawEmoji.trim() } });
    this.realtime.messageUpdated(message.conversationId, { id: messageId, reactionRemoved: rawEmoji.trim(), userId: user.id });
  }

  async report(user: AuthPrincipal, messageId: string, rawReason: string) {
    const message = await this.requireAccessibleMessage(user, messageId);
    if (message.senderId === user.id) throw new BadRequestException("You cannot report your own message.");
    const existing = await this.prisma.reportedMessage.findFirst({ where: { messageId, reportedById: user.id, status: "OPEN" } });
    return existing ?? this.prisma.reportedMessage.create({ data: { messageId, reportedById: user.id, reason: rawReason.trim() } });
  }

  async reports(user: AuthPrincipal, status: string) {
    if (!["OPEN", "REVIEWED", "DISMISSED", "ACTIONED"].includes(status)) throw new BadRequestException("Report status is not recognized.");
    return this.prisma.reportedMessage.findMany({ where: { status, message: { conversation: { collegeId: user.collegeId } } }, take: 100, orderBy: { createdAt: "desc" }, include: { reportedBy: { select: { publicId: true, fullName: true } }, reviewedBy: { select: { publicId: true, fullName: true } }, message: { select: { id: true, body: true, createdAt: true, sender: { select: { publicId: true, fullName: true } }, conversation: { select: { id: true, title: true, type: true } } } } } });
  }

  async moderateReport(user: AuthPrincipal, id: string, input: ModerateMessageReportDto, requestId: string) {
    const report = await this.prisma.reportedMessage.findFirst({ where: { id, message: { conversation: { collegeId: user.collegeId } } } });
    if (!report) throw new NotFoundException("Reported message not found.");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.reportedMessage.update({ where: { id }, data: { status: input.status, reviewNote: input.note?.trim(), reviewedById: user.id, reviewedAt: new Date() } });
      await this.audit.record({ actorId: user.id, action: "message_report.moderated", entityType: "ReportedMessage", entityId: id, beforeValue: { status: report.status }, afterValue: { status: updated.status, reviewNote: updated.reviewNote }, requestId }, tx);
      return updated;
    });
  }

  async preferences(user: AuthPrincipal, conversationId: string, input: ConversationPreferenceDto) {
    await this.requireParticipant(user, conversationId);
    return this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      data: {
        ...(input.mutedUntil !== undefined ? { mutedUntil: input.mutedUntil ? new Date(input.mutedUntil) : null } : {}),
        ...(input.pinned !== undefined ? { pinnedAt: input.pinned ? new Date() : null } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
        ...(input.markedUnread !== undefined ? { markedUnreadAt: input.markedUnread ? new Date(Date.now() - 1) : null } : {}),
      },
      select: { mutedUntil: true, pinnedAt: true, archivedAt: true, markedUnreadAt: true },
    });
  }

  async search(user: AuthPrincipal, conversationId: string, query: string) {
    await this.requireParticipant(user, conversationId);
    if (query.length < 2) return [];
    return this.prisma.message.findMany({ where: { conversationId, deletedAt: null, deletions: { none: { userId: user.id } }, body: { contains: query.slice(0, 100), mode: "insensitive" } }, orderBy: { createdAt: "desc" }, take: 50, include: { sender: { select: { publicId: true, fullName: true } } } });
  }

  async contacts(user: AuthPrincipal, search: string) {
    if (search.length < 2) return [];
    const visibility = await this.contactVisibilityWhere(user);
    return this.prisma.user.findMany({ where: { AND: [visibility, { OR: [{ fullName: { contains: search.slice(0, 100), mode: "insensitive" } }, { collegeIdentityId: { contains: search.slice(0, 100), mode: "insensitive" } }] }] }, take: 30, orderBy: { fullName: "asc" }, select: { publicId: true, fullName: true, collegeIdentityId: true, profilePhotoKey: true, roles: { where: { role: { isActive: true } }, select: { role: { select: { name: true } } } } } });
  }

  syncOfficial(user: AuthPrincipal) {
    return this.officialGroups.synchronizeCollege(user.collegeId);
  }

  private async contactVisibilityWhere(user: AuthPrincipal): Promise<Prisma.UserWhereInput> {
    const collegeWide = user.scopes.some((scope) => scope.type === "COLLEGE" && (!scope.id || scope.id === user.collegeId));
    const sectionIds = user.scopes.filter((scope) => scope.type === "SECTION" && scope.id).map((scope) => scope.id as string);
    const departmentIds = user.scopes.filter((scope) => scope.type === "DEPARTMENT" && scope.id).map((scope) => scope.id as string);
    const ownProfile = await this.prisma.user.findUnique({ where: { id: user.id }, select: { studentProfile: { select: { sectionId: true, departmentId: true } }, staffProfile: { select: { departmentId: true } }, responsibleMemberships: { where: { isActive: true }, select: { teamId: true } } } });
    if (ownProfile?.studentProfile) { sectionIds.push(ownProfile.studentProfile.sectionId); departmentIds.push(ownProfile.studentProfile.departmentId); }
    if (ownProfile?.staffProfile?.departmentId) departmentIds.push(ownProfile.staffProfile.departmentId);
    const teams = ownProfile?.responsibleMemberships.map((membership) => membership.teamId) ?? [];
    const visibility: Prisma.UserWhereInput[] = [];
    if (sectionIds.length) visibility.push({ studentProfile: { sectionId: { in: sectionIds } } }, { coordinatorAssignments: { some: { sectionId: { in: sectionIds }, isActive: true } } }, { representativeAssignments: { some: { sectionId: { in: sectionIds }, isActive: true } } }, { facultyAssignments: { some: { sectionId: { in: sectionIds }, isActive: true } } });
    if (departmentIds.length) visibility.push({ staffProfile: { departmentId: { in: departmentIds } } }, { studentProfile: { departmentId: { in: departmentIds } } });
    if (teams.length) visibility.push({ responsibleMemberships: { some: { teamId: { in: teams }, isActive: true } } });
    return { id: { not: user.id }, collegeId: user.collegeId, status: "ACTIVE", ...(collegeWide ? {} : { OR: visibility.length ? visibility : [{ id: "00000000-0000-0000-0000-000000000000" }] }) };
  }

  private async requireMessageInConversation(messageId: string, conversationId: string, label: string) {
    const message = await this.prisma.message.findFirst({ where: { id: messageId, conversationId, deletedAt: null } });
    if (!message) throw new BadRequestException(`${label} is not available in this conversation.`);
    return message;
  }

  private async requireAccessibleMessage(user: AuthPrincipal, messageId: string) {
    const message = await this.prisma.message.findFirst({ where: { id: messageId, conversation: { collegeId: user.collegeId, participants: { some: { userId: user.id, leftAt: null } } }, deletions: { none: { userId: user.id } } }, select: { id: true, senderId: true, conversationId: true, createdAt: true } });
    if (!message) throw new NotFoundException("Message not found.");
    return message;
  }

  private async requireParticipant(user: AuthPrincipal, conversationId: string) {
    const participant = await this.prisma.conversationParticipant.findFirst({ where: { conversationId, userId: user.id, leftAt: null, conversation: { collegeId: user.collegeId } } });
    if (!participant) throw new NotFoundException("Conversation not found.");
    return participant;
  }
}
