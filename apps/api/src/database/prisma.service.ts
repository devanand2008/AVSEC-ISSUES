import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    let connectionString = config.getOrThrow<string>("DATABASE_URL");
    const max = config.get<number>("DATABASE_POOL_MAX", 50);
    const timeout = config.get<number>("DATABASE_POOL_TIMEOUT", 30);
    if (!connectionString.includes("connection_limit=")) {
      const separator = connectionString.includes("?") ? "&" : "?";
      connectionString = `${connectionString}${separator}connection_limit=${max}&pool_timeout=${timeout}`;
    }
    super({ adapter: new PrismaPg({ connectionString, max, connectionTimeoutMillis: timeout * 1000, idleTimeoutMillis: timeout * 1000 }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Connected to PostgreSQL");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
