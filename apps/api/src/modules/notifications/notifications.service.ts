import { Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthPrincipal, page: number, pageSize: number, unreadOnly: boolean) {
    const where = { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) };
    const [data, total, unread] = await this.prisma.$transaction([
      this.prisma.notificationRecipient.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: "desc" }, select: { id: true, readAt: true, createdAt: true, notification: { select: { type: true, title: true, body: true, priority: true, relatedEntityType: true, relatedEntityId: true, data: true, createdAt: true } } } }),
      this.prisma.notificationRecipient.count({ where }),
      this.prisma.notificationRecipient.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { data, unread, meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
  }

  async markRead(user: AuthPrincipal, id: string) {
    const recipient = await this.prisma.notificationRecipient.findFirst({ where: { id, userId: user.id } });
    if (!recipient) throw new NotFoundException("Notification not found.");
    await this.prisma.notificationRecipient.update({ where: { id }, data: { readAt: recipient.readAt ?? new Date() } });
    return { read: true };
  }

  async markAllRead(user: AuthPrincipal) {
    const result = await this.prisma.notificationRecipient.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: result.count };
  }
}
