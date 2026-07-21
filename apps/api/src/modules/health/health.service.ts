import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import Redis from "ioredis";
import { PrismaService } from "../../database/prisma.service";

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async ready() {
    return this.checkDependencies(true);
  }

  async dependencyReady() {
    await this.checkDependencies(false);
    return { status: "ready", timestamp: new Date().toISOString() };
  }

  private async checkDependencies(includeComponents: boolean) {
    const checks = await Promise.allSettled([
      this.database(),
      this.redis(),
      this.storage(),
    ]);
    const names = ["postgres", "redis", "objectStorage"] as const;
    const components = Object.fromEntries(
      checks.map((check, index) => [
        names[index],
        check.status === "fulfilled" ? "up" : "down",
      ]),
    );
    if (checks.some((check) => check.status === "rejected")) {
      throw new ServiceUnavailableException({
        message: "One or more required dependencies are unavailable.",
        ...(includeComponents ? { components } : {}),
      });
    }
    return {
      status: "ready",
      ...(includeComponents ? { components } : {}),
      timestamp: new Date().toISOString(),
    };
  }

  private async database(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  private async redis(): Promise<void> {
    const client = new Redis(this.config.getOrThrow<string>("REDIS_URL"), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    try {
      await client.connect();
      await client.ping();
    } finally {
      client.disconnect();
    }
  }

  private async storage(): Promise<void> {
    const client = new S3Client({
      endpoint: this.config.getOrThrow<string>("S3_ENDPOINT"),
      region: this.config.get<string>("S3_REGION", "us-east-1"),
      forcePathStyle: this.config.get<boolean>("S3_FORCE_PATH_STYLE", true),
      credentials: {
        accessKeyId: this.config.getOrThrow<string>("S3_ACCESS_KEY"),
        secretAccessKey: this.config.getOrThrow<string>("S3_SECRET_KEY"),
      },
    });
    await client.send(
      new HeadBucketCommand({
        Bucket: this.config.getOrThrow<string>("S3_BUCKET"),
      }),
    );
  }
}
