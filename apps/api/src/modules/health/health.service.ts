import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
    return this.checkDependencies(false);
  }

  private async checkDependencies(includeComponents: boolean) {
    const database = await Promise.allSettled([this.database()]);
    if (database[0]?.status === "rejected") {
      throw new ServiceUnavailableException({
        status: "not_ready",
        message: "PostgreSQL is unavailable.",
        ...(includeComponents
          ? { components: { prismaClient: "generated", postgres: "down", configuration: "valid" } }
          : {}),
      });
    }
    const databaseMode = this.config.get<string>(
      "DATABASE_MODE",
      "EXTERNAL_PERSISTENT",
    );
    const driveEnabled = this.config.get<boolean>(
      "GOOGLE_DRIVE_ENABLED",
      false,
    );
    return {
      status: "ready",
      databaseMode,
      ...(includeComponents
        ? {
            components: {
              prismaClient: "generated",
              postgres: "up",
              configuration: "valid",
            },
            backups: {
              googleDrive: driveEnabled ? "configured" : "disabled",
              degraded: !driveEnabled,
            },
          }
        : {}),
      timestamp: new Date().toISOString(),
    };
  }

  private async database(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

}
