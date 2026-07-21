import { Controller, Get, Headers, HttpCode, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Public } from "../../common/decorators/public.decorator";
import type { Request } from "express";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";

@Controller("webhooks/whatsapp")
export class WhatsAppController {
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService) {}
  @Public() @Get() verify(@Query("hub.mode") mode: string, @Query("hub.verify_token") token: string, @Query("hub.challenge") challenge: string) {
    if (mode !== "subscribe" || !token || token !== this.config.get<string>("WHATSAPP_VERIFY_TOKEN")) throw new UnauthorizedException();
    return challenge;
  }
  @Public() @Post() @HttpCode(200) async webhook(@Req() request: Request & { rawBody?: Buffer }, @Headers("x-hub-signature-256") signature?: string) {
    const secret = this.config.get<string>("WHATSAPP_APP_SECRET");
    if (!secret) throw new UnauthorizedException("Webhook signing is not configured.");
    const expected = `sha256=${createHmac("sha256", secret).update(request.rawBody ?? Buffer.from(JSON.stringify(request.body))).digest("hex")}`;
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new UnauthorizedException("Invalid webhook signature.");
    const body = request.body as { entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<{ id: string; status: string; timestamp?: string; errors?: unknown }> } }> }> };
    const raw = request.rawBody ?? Buffer.from(JSON.stringify(body));
    const payloadHash = createHash("sha256").update(raw).digest("hex");
    const status = body.entry?.[0]?.changes?.[0]?.value?.statuses?.[0];
    const eventKey = `${status?.id ?? "unknown"}:${status?.status ?? "event"}:${status?.timestamp ?? payloadHash.slice(0, 16)}`;
    await this.prisma.whatsAppWebhookEvent.upsert({ where: { eventKey }, create: { eventKey, eventType: status?.status ?? "delivery_status", payloadHash, payload: body as never, processedAt: new Date() }, update: {} });
    const deliveryStatus = status?.status ? ({ sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" } as const)[status.status as "sent" | "delivered" | "read" | "failed"] : undefined;
    if (status?.id && deliveryStatus) {
      const errorMessage = status.errors ? JSON.stringify(status.errors).slice(0, 2000) : undefined;
      await this.prisma.$transaction([
        this.prisma.whatsAppMessage.updateMany({ where: { providerMessageId: status.id }, data: { status: deliveryStatus, lastError: errorMessage } }),
        this.prisma.notificationDeliveryAttempt.updateMany({ where: { providerMessageId: status.id }, data: { status: deliveryStatus, errorMessage } }),
      ]);
    }
    return { received: true };
  }
}
