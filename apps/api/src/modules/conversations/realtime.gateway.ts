import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import {
  isAllowedOrigin,
  parseAllowedOrigins,
} from "../../common/http/allowed-origins";
import { serializeForTransport } from "../../common/http/serialization.interceptor";
import { PrismaService } from "../../database/prisma.service";

interface SocketData {
  userId?: string;
}

const webUrl = process.env.WEB_URL ?? "http://localhost:3000";
const allowedOrigins = parseAllowedOrigins(
  process.env.CORS_ALLOWED_ORIGINS,
  webUrl,
);

@WebSocketGateway({
  namespace: "/realtime",
  cors: {
    origin: (origin, callback) => {
      if (!origin || isAllowedOrigin(origin, allowedOrigins, webUrl)) {
        callback(null, true);
        return;
      }
      callback(new Error("Request origin is not allowed."), false);
    },
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly typingThrottle = new Map<string, number>();
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const cookieHeader = client.handshake.headers.cookie ?? "";
      const cookieToken = cookieHeader
        .split("; ")
        .find((part) => part.startsWith("college_access="))
        ?.slice("college_access=".length);
      const token =
        cookieToken ??
        (typeof client.handshake.auth.token === "string"
          ? client.handshake.auth.token
          : undefined);
      if (!token) throw new Error("Missing session token");
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        sid: string;
        typ: string;
      }>(decodeURIComponent(token), {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
      });
      if (payload.typ !== "access") throw new Error("Invalid token type");
      const user = await this.prisma.user.findFirst({
        where: {
          id: payload.sub,
          status: "ACTIVE",
          sessions: {
            some: {
              id: payload.sid,
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
          },
        },
        select: { id: true },
      });
      if (!user) throw new Error("Session is inactive");
      (client.data as SocketData).userId = user.id;
      await client.join(`user:${user.id}`);
      await this.prisma.userPresence.upsert({ where: { userId: user.id }, create: { userId: user.id, isOnline: true }, update: { isOnline: true, lastSeenAt: new Date() } });
      await this.emitPresence(user.id, true);
    } catch (error) {
      this.logger.warn(
        `Rejected socket connection: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = (client.data as SocketData).userId;
    if (!userId) return;
    const sockets = await this.server.in(`user:${userId}`).fetchSockets();
    if (sockets.length > 0) return;
    const lastSeenAt = new Date();
    await this.prisma.userPresence.upsert({ where: { userId }, create: { userId, isOnline: false, lastSeenAt }, update: { isOnline: false, lastSeenAt } });
    await this.emitPresence(userId, false, lastSeenAt);
  }

  @SubscribeMessage("conversation.join")
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId: string },
  ) {
    const userId = (client.data as SocketData).userId;
    if (!userId) return { accepted: false };
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: { conversationId: body.conversationId, userId, leftAt: null },
    });
    if (!participant) return { accepted: false };
    await client.join(`conversation:${body.conversationId}`);
    return { accepted: true };
  }

  @SubscribeMessage("typing.changed")
  async typing(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId: string; typing: boolean },
  ) {
    const userId = (client.data as SocketData).userId;
    if (!userId || typeof body?.conversationId !== "string")
      return { accepted: false };
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: { conversationId: body.conversationId, userId, leftAt: null },
      select: { id: true },
    });
    if (!participant) return { accepted: false };
    const throttleKey = `${client.id}:${body.conversationId}`;
    const now = Date.now();
    if (body.typing && now - (this.typingThrottle.get(throttleKey) ?? 0) < 1500) return { accepted: true, throttled: true };
    this.typingThrottle.set(throttleKey, now);
    client.to(`conversation:${body.conversationId}`).emit("typing.changed", {
      conversationId: body.conversationId,
      userId,
      typing: Boolean(body.typing),
    });
    return { accepted: true };
  }

  messageCreated(conversationId: string, message: unknown): void {
    this.server
      .to(`conversation:${conversationId}`)
      .emit("message.created", serializeForTransport(message));
  }

  messageUpdated(conversationId: string, message: unknown): void {
    this.server
      .to(`conversation:${conversationId}`)
      .emit("message.updated", serializeForTransport(message));
  }

  readChanged(conversationId: string, receipt: unknown): void {
    this.server
      .to(`conversation:${conversationId}`)
      .emit("message.read", serializeForTransport(receipt));
  }

  private async emitPresence(userId: string, isOnline: boolean, lastSeenAt = new Date()): Promise<void> {
    const conversations = await this.prisma.conversationParticipant.findMany({ where: { userId, leftAt: null }, select: { conversationId: true } });
    for (const conversation of conversations) {
      this.server.to(`conversation:${conversation.conversationId}`).emit("presence.changed", { userId, isOnline, lastSeenAt });
    }
  }
}
