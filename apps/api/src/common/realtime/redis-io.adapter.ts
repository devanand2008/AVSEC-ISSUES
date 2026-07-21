import { Logger } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import type { Server, ServerOptions } from "socket.io";

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private publisher?: Redis;
  private subscriber?: Redis;
  private adapter?: ReturnType<typeof createAdapter>;

  async connect(redisUrl: string): Promise<void> {
    const publisher = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null, enableReadyCheck: true });
    const subscriber = publisher.duplicate();
    try {
      await Promise.all([publisher.connect(), subscriber.connect()]);
      this.publisher = publisher;
      this.subscriber = subscriber;
      this.adapter = createAdapter(publisher, subscriber);
      this.logger.log("Socket.IO Redis adapter connected.");
    } catch (error) {
      publisher.disconnect();
      subscriber.disconnect();
      this.logger.warn(`Socket.IO is using the local adapter because Redis is unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapter) server.adapter(this.adapter);
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    this.publisher?.disconnect();
    this.subscriber?.disconnect();
  }
}
