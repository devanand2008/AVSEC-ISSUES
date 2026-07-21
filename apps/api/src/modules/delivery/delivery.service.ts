import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job, Queue, Worker } from "bullmq";
import { createHash } from "node:crypto";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import nodemailer, { type Transporter } from "nodemailer";
import { PrismaService } from "../../database/prisma.service";
import { DeviceRegistrationService } from "../notifications/device-registration.service";

type DeliveryChannel = "PUSH" | "WHATSAPP" | "EMAIL";
interface DeliveryJob { notificationId: string; recipientUserId: string; channel: DeliveryChannel }
interface RetryableFailure { id: string; jobId: string; retryCount: number; payloadRedacted: unknown }

@Injectable()
export class DeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryService.name);
  private readonly connection: { host: string; port: number; username?: string; password?: string; tls?: Record<string, never> };
  private readonly queue: Queue<DeliveryJob, void, string>;
  private worker?: Worker<DeliveryJob, void, string>;
  private timer?: NodeJS.Timeout;
  private firebaseApp?: App;
  private emailTransport?: Transporter;

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly devices: DeviceRegistrationService) {
    const redisUrl = new URL(config.getOrThrow<string>("REDIS_URL"));
    this.connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379), ...(redisUrl.username ? { username: redisUrl.username } : {}), ...(redisUrl.password ? { password: redisUrl.password } : {}), ...(redisUrl.protocol === "rediss:" ? { tls: {} } : {}) };
    this.queue = new Queue<DeliveryJob, void, string>("notification-delivery", { connection: this.connection });
  }

  onModuleInit(): void {
    this.worker = new Worker<DeliveryJob, void, string>("notification-delivery", (job) => this.deliver(job), { connection: this.connection, concurrency: 5 });
    this.worker.on("failed", (job, error) => {
      this.logger.error({ jobId: job?.id, error: error.message }, "Notification delivery failed");
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        void this.recordPermanentFailure(job, error).catch((recordError: unknown) =>
          this.logger.error({ error: recordError instanceof Error ? recordError.message : "Unknown persistence error" }, "Could not persist failed delivery job"),
        );
      }
    });
    this.worker.on("error", (error) => this.logger.error({ error: error.message }, "Notification worker connection error"));
    this.queue.on("error", (error) => this.logger.error({ error: error.message }, "Notification queue connection error"));
    this.timer = setInterval(() => {
      void this.escalateOverdue().catch((error: unknown) => this.logger.error({ error: error instanceof Error ? error.message : "Unknown escalation error" }, "Issue escalation scan failed"));
      void this.dispatchOutbox().catch((error: unknown) => this.logger.error({ error: error instanceof Error ? error.message : "Unknown outbox error" }, "Outbox dispatch failed"));
    }, 5000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.emailTransport?.close();
    await this.worker?.close();
    await this.queue.close();
  }

  async dispatchOutbox(): Promise<void> {
    const events = await this.prisma.outboxEvent.findMany({ where: { processedAt: null, availableAt: { lte: new Date() }, eventType: { in: ["issue.created", "issue.status_changed", "issue.escalated", "feedback.submitted"] } }, take: 25, orderBy: { createdAt: "asc" } });
    for (const event of events) {
      try {
        const payload = event.payload as { notificationId?: string };
        if (payload.notificationId) {
          const recipients = await this.prisma.notificationRecipient.findMany({ where: { notificationId: payload.notificationId }, select: { userId: true } });
          const channels = await this.channelsForEvent(event.eventType, event.aggregateId);
          for (const recipient of recipients) {
            for (const channel of channels) {
              await this.queue.add(channel.toLowerCase(), { notificationId: payload.notificationId, recipientUserId: recipient.userId, channel }, { jobId: `${payload.notificationId}-${recipient.userId}-${channel}`, attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 500, removeOnFail: 1000 });
            }
          }
        }
        await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), attemptCount: { increment: 1 } } });
      } catch (error) {
        await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { attemptCount: { increment: 1 }, lastError: error instanceof Error ? error.message.slice(0, 2000) : "Unknown dispatch error", availableAt: new Date(Date.now() + 30_000) } });
      }
    }
  }

  async escalateOverdue(): Promise<void> {
    const now = new Date();
    const issues = await this.prisma.issue.findMany({
      where: { status: { notIn: ["RESOLVED", "VERIFIED", "CLOSED", "REJECTED", "CANCELLED"] }, OR: [{ acknowledgedAt: null, acknowledgementDueAt: { lt: now } }, { resolutionDueAt: { lt: now } }] },
      include: { routingRule: true, escalations: { orderBy: { escalatedAt: "desc" }, take: 1 } }, take: 50, orderBy: { priority: "desc" },
    });
    for (const issue of issues) {
      const previous = issue.escalations[0];
      if (issue.escalationLevel >= 3 || (previous?.nextEscalationAt && previous.nextEscalationAt > now)) continue;
      const kind = !issue.acknowledgedAt && issue.acknowledgementDueAt && issue.acknowledgementDueAt < now ? "ACKNOWLEDGEMENT_OVERDUE" : "RESOLUTION_OVERDUE";
      const level = issue.escalationLevel + 1; const deduplicationKey = `${issue.id}:${kind}:${level}`;
      if (await this.prisma.issueEscalation.findUnique({ where: { deduplicationKey } })) continue;
      let recipientUserId = level === 1 ? issue.routingRule?.backupUserId : issue.routingRule?.escalationUserId;
      if (!recipientUserId) {
        const admin = await this.prisma.user.findFirst({ where: { collegeId: issue.collegeId, status: "ACTIVE", roles: { some: { role: { code: level >= 2 ? "MAIN_ADMIN" : "MAINTENANCE_ADMIN" } } } }, select: { id: true } });
        recipientUserId = admin?.id ?? issue.assignedToId;
      }
      if (!recipientUserId) continue;
      await this.prisma.$transaction(async (tx) => {
        await tx.issueEscalation.create({ data: { issueId: issue.id, level, recipientUserId, reason: kind, deduplicationKey, nextEscalationAt: new Date(now.getTime() + 60 * 60_000), notificationStatus: "QUEUED" } });
        await tx.issue.update({ where: { id: issue.id }, data: { escalationLevel: level } });
        const notification = await tx.notification.create({ data: { type: "ISSUE_ESCALATED", title: `${issue.issueNumber} requires escalation`, body: kind.replaceAll("_", " "), priority: issue.priority, relatedEntityType: "Issue", relatedEntityId: issue.id, recipients: { create: { userId: recipientUserId } } } });
        await tx.outboxEvent.create({ data: { aggregateType: "Issue", aggregateId: issue.id, eventType: "issue.escalated", payload: { issueId: issue.id, notificationId: notification.id, level }, idempotencyKey: `issue.escalated:${deduplicationKey}` } });
      });
    }
  }

  async retryFailure(failure: RetryableFailure): Promise<{ queueJobId: string }> {
    const payload = failure.payloadRedacted as Partial<DeliveryJob>;
    if (!payload.notificationId || !payload.recipientUserId || !["PUSH", "WHATSAPP", "EMAIL"].includes(payload.channel ?? "")) {
      throw new Error("The failed job payload is incomplete and cannot be retried safely.");
    }
    const data = payload as DeliveryJob;
    const queueJobId = `manual-${failure.id}-${failure.retryCount + 1}`;
    await this.queue.add(data.channel.toLowerCase(), data, { jobId: queueJobId, attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 500, removeOnFail: 1000 });
    return { queueJobId };
  }

  private async deliver(job: Job<DeliveryJob, void, string>): Promise<void> {
    const { notificationId, recipientUserId, channel } = job.data;
    const idempotencyKey = `${notificationId}:${recipientUserId}:${channel}:${job.attemptsMade + 1}`;
    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    const user = await this.prisma.user.findUnique({ where: { id: recipientUserId } });
    if (!notification || !user) return;
    const recipient = channel === "WHATSAPP" ? user.whatsappNumber : channel === "EMAIL" ? user.email : user.id;
    try {
      const providerMessageId = channel === "WHATSAPP"
        ? await this.sendWhatsApp(notification, user.whatsappNumber)
        : channel === "EMAIL"
          ? await this.sendEmail(notification, user.email)
          : await this.sendPush(notification, user.id);
      const status = providerMessageId ? "SENT" : "DISABLED";
      await this.prisma.notificationDeliveryAttempt.create({ data: { notificationId, recipientUserId, channel, provider: this.provider(channel), status, attemptNumber: job.attemptsMade + 1, idempotencyKey, providerMessageId } });
      await this.trackFeedbackDelivery(notification, channel, recipient ?? recipientUserId, status, providerMessageId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message.slice(0, 2000) : "Unknown delivery error";
      await this.prisma.notificationDeliveryAttempt.create({ data: { notificationId, recipientUserId, channel, provider: this.provider(channel), status: "FAILED", attemptNumber: job.attemptsMade + 1, idempotencyKey, errorMessage } });
      await this.trackFeedbackDelivery(notification, channel, recipient ?? recipientUserId, "FAILED", undefined, errorMessage);
      throw error;
    }
  }

  private async sendWhatsApp(notification: { id: string; type: string; title: string; body: string; relatedEntityType?: string | null; relatedEntityId?: string | null }, number: string | null): Promise<string | undefined> {
    if (!this.config.get<boolean>("WHATSAPP_ENABLED", false) || !number) return undefined;
    const phoneId = this.config.getOrThrow<string>("WHATSAPP_PHONE_NUMBER_ID");
    const token = this.config.getOrThrow<string>("WHATSAPP_ACCESS_TOKEN");
    const feedback = notification.type === "FEEDBACK_ALERT";
    const templateName = feedback
      ? this.config.get<string>("WHATSAPP_FEEDBACK_TEMPLATE_NAME", "college_feedback_alert")
      : this.config.get<string>("WHATSAPP_ISSUE_TEMPLATE_NAME", "college_issue_assignment");
    const parameters = [
      { type: "text" as const, text: notification.title },
      { type: "text" as const, text: notification.body.slice(0, 500) },
      ...(feedback ? [{ type: "text" as const, text: this.notificationLink(notification.relatedEntityType, notification.relatedEntityId) }] : []),
    ];
    const response = await fetch(`https://graph.facebook.com/${this.config.get<string>("WHATSAPP_API_VERSION", "v23.0")}/${phoneId}/messages`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: number.replace(/\D/g, ""), type: "template", template: { name: templateName, language: { code: this.config.get<string>("WHATSAPP_TEMPLATE_LANGUAGE", "en") }, components: [{ type: "body", parameters }] } }) });
    if (!response.ok) throw new Error(`WhatsApp provider returned HTTP ${response.status}.`);
    const body = await response.json() as { messages?: Array<{ id: string }> };
    const providerMessageId = body.messages?.[0]?.id;
    if (!providerMessageId) throw new Error("WhatsApp provider did not return a message identifier.");
    await this.prisma.whatsAppMessage.create({ data: { notificationId: notification.id, recipientNumberHash: createHash("sha256").update(number).digest("hex"), providerMessageId, templateName, status: "SENT" } });
    return providerMessageId;
  }

  private async sendEmail(
    notification: { title: string; body: string; relatedEntityType?: string | null; relatedEntityId?: string | null },
    address: string | null,
  ): Promise<string | undefined> {
    if (!this.config.get<boolean>("EMAIL_ENABLED", false) || !address) return undefined;
    const link = this.notificationLink(notification.relatedEntityType, notification.relatedEntityId);
    const info = await this.getEmailTransport().sendMail({
      from: {
        name: this.config.get<string>("EMAIL_FROM_NAME", "AVS Engineering College"),
        address: this.config.getOrThrow<string>("EMAIL_FROM_ADDRESS"),
      },
      to: address,
      subject: notification.title,
      text: `${notification.body}\n\nOpen the secure AVS dashboard: ${link}`,
      html: `<p>${this.escapeHtml(notification.body)}</p><p><a href="${this.escapeHtml(link)}">Open the secure AVS dashboard</a></p>`,
    });
    return info.messageId || undefined;
  }

  private async sendPush(
    notification: { id: string; title: string; body: string; relatedEntityType?: string | null; relatedEntityId?: string | null },
    userId: string,
  ): Promise<string | undefined> {
    if (!this.firebaseConfigured()) return undefined;
    const registrations = await this.prisma.deviceRegistration.findMany({
      where: { userId, enabled: true },
      select: { id: true, encryptedToken: true },
      take: 500,
    });
    if (!registrations.length) return undefined;

    const valid: Array<{ id: string; token: string }> = [];
    const unreadable: string[] = [];
    for (const registration of registrations) {
      try {
        valid.push({ id: registration.id, token: this.devices.decrypt(registration.encryptedToken) });
      } catch {
        unreadable.push(registration.id);
      }
    }
    if (unreadable.length) {
      await this.prisma.deviceRegistration.updateMany({ where: { id: { in: unreadable } }, data: { enabled: false } });
    }
    if (!valid.length) return undefined;

    const link = this.notificationLink(notification.relatedEntityType, notification.relatedEntityId);
    const response = await getMessaging(this.getFirebaseApp()).sendEachForMulticast({
      tokens: valid.map((registration) => registration.token),
      notification: { title: notification.title, body: notification.body },
      data: { notificationId: notification.id, link },
      webpush: { fcmOptions: { link } },
      android: { priority: "high" },
      apns: { payload: { aps: { sound: "default" } } },
    });
    const invalidIds = response.responses.flatMap((item, index) => {
      const code = item.error?.code;
      return code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token"
        ? [valid[index]?.id].filter((id): id is string => Boolean(id))
        : [];
    });
    if (invalidIds.length) {
      await this.prisma.deviceRegistration.updateMany({ where: { id: { in: invalidIds } }, data: { enabled: false } });
    }
    const firstSuccess = response.responses.find((item) => item.success)?.messageId;
    if (!firstSuccess) {
      const firstError = response.responses.find((item) => item.error)?.error;
      throw new Error(firstError?.message ?? "Firebase rejected every registered device.");
    }
    return firstSuccess;
  }

  private async channelsForEvent(eventType: string, aggregateId: string): Promise<DeliveryChannel[]> {
    if (eventType !== "feedback.submitted") return ["PUSH", "WHATSAPP"];
    const submission = await this.prisma.feedbackSubmission.findUnique({ where: { id: aggregateId }, select: { collegeId: true } });
    if (!submission) return ["PUSH"];
    const setting = await this.prisma.appSetting.findUnique({
      where: { collegeId_key: { collegeId: submission.collegeId, key: "feedback.settings" } },
      select: { value: true },
    });
    const value = typeof setting?.value === "object" && setting.value !== null
      ? setting.value as Record<string, unknown>
      : {};
    return [
      "PUSH",
      ...(value.whatsAppAlertsEnabled === true ? ["WHATSAPP" as const] : []),
      ...(value.emailAlertsEnabled === true ? ["EMAIL" as const] : []),
    ];
  }

  private provider(channel: DeliveryChannel): string {
    if (channel === "WHATSAPP") return "META_CLOUD";
    if (channel === "EMAIL") return "SMTP";
    return "FIREBASE";
  }

  private getEmailTransport(): Transporter {
    if (this.emailTransport) return this.emailTransport;
    const username = this.config.get<string>("SMTP_USERNAME");
    const password = this.config.get<string>("SMTP_PASSWORD");
    this.emailTransport = nodemailer.createTransport({
      pool: true,
      host: this.config.getOrThrow<string>("SMTP_HOST"),
      port: this.config.get<number>("SMTP_PORT", 587),
      secure: this.config.get<boolean>("SMTP_SECURE", false),
      ...(username && password ? { auth: { user: username, pass: password } } : {}),
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    return this.emailTransport;
  }

  private async trackFeedbackDelivery(
    notification: { type: string; relatedEntityType?: string | null; relatedEntityId?: string | null },
    channel: DeliveryChannel,
    recipient: string,
    status: "SENT" | "DISABLED" | "FAILED",
    providerReference?: string,
    errorMessage?: string,
  ): Promise<void> {
    if (notification.relatedEntityType !== "FeedbackSubmission" || !notification.relatedEntityId) return;
    try {
      const existing = await this.prisma.feedbackNotification.findFirst({
        where: { submissionId: notification.relatedEntityId, channel, recipient },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const data = {
        status,
        providerReference,
        errorMessage,
        ...(status === "SENT" ? { sentAt: new Date() } : { sentAt: null }),
      };
      if (existing) {
        await this.prisma.feedbackNotification.update({ where: { id: existing.id }, data });
      } else {
        await this.prisma.feedbackNotification.create({
          data: {
            submissionId: notification.relatedEntityId,
            channel,
            recipient: recipient.slice(0, 254),
            notificationType: notification.type,
            ...data,
          },
        });
      }
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "Unknown tracking error", submissionId: notification.relatedEntityId, channel },
        "Could not update feedback delivery tracking",
      );
    }
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
  }

  private firebaseConfigured(): boolean {
    return Boolean(
      this.config.get<string>("FIREBASE_PROJECT_ID") &&
      this.config.get<string>("FIREBASE_CLIENT_EMAIL") &&
      this.config.get<string>("FIREBASE_PRIVATE_KEY") &&
      this.config.get<string>("DEVICE_TOKEN_ENCRYPTION_KEY"),
    );
  }

  private getFirebaseApp(): App {
    if (this.firebaseApp) return this.firebaseApp;
    const name = "college-notifications";
    const existing = getApps().find((app) => app.name === name);
    this.firebaseApp = existing ?? initializeApp({
      credential: cert({
        projectId: this.config.getOrThrow<string>("FIREBASE_PROJECT_ID"),
        clientEmail: this.config.getOrThrow<string>("FIREBASE_CLIENT_EMAIL"),
        privateKey: this.config.getOrThrow<string>("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
      }),
    }, name);
    return this.firebaseApp;
  }

  private notificationLink(entityType?: string | null, entityId?: string | null): string {
    const webUrl = this.config.get<string>("WEB_URL", "http://localhost:3000").replace(/\/$/, "");
    if (entityType === "Issue" && entityId) return `${webUrl}/issues/${entityId}`;
    if (entityType === "FeedbackSubmission") return `${webUrl}/admin/feedback/submissions`;
    if (entityType === "Conversation") return `${webUrl}/messages`;
    if (entityType === "Announcement") return `${webUrl}/announcements`;
    return `${webUrl}/notifications`;
  }

  private async recordPermanentFailure(job: Job<DeliveryJob, void, string>, error: Error): Promise<void> {
    const jobId = String(job.id ?? `${job.data.notificationId}-${job.data.recipientUserId}-${job.data.channel}`);
    const recipient = await this.prisma.user.findUnique({ where: { id: job.data.recipientUserId }, select: { collegeId: true } });
    await this.prisma.backgroundJobFailure.upsert({
      where: { queueName_jobId: { queueName: "notification-delivery", jobId } },
      create: {
        collegeId: recipient?.collegeId,
        queueName: "notification-delivery",
        jobId,
        jobName: job.name,
        payloadRedacted: {
          notificationId: job.data.notificationId,
          recipientUserId: job.data.recipientUserId,
          channel: job.data.channel,
        },
        errorMessage: error.message.slice(0, 2000),
        stackHash: error.stack ? createHash("sha256").update(error.stack).digest("hex") : undefined,
        retryCount: job.attemptsMade,
      },
      update: {
        errorMessage: error.message.slice(0, 2000),
        stackHash: error.stack ? createHash("sha256").update(error.stack).digest("hex") : undefined,
        failedAt: new Date(),
        resolvedAt: null,
        retryCount: job.attemptsMade,
      },
    });
  }
}
