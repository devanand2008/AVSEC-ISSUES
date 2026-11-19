import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const connectionString = config.getOrThrow<string>("DATABASE_URL");
    const max = config.getOrThrow<number>("DATABASE_POOL_MAX");
    const timeout = config.getOrThrow<number>("DATABASE_POOL_TIMEOUT");
    super({
      adapter: new PrismaPg({
        connectionString,
        min: 1,
        max,
        connectionTimeoutMillis: timeout * 1_000,
        idleTimeoutMillis: 60_000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 15_000,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("PostgreSQL pool initialized");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
