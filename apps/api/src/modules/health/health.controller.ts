import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { HealthService } from "./health.service";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "System health check" })
  async root() {
    try {
      await this.health.dependencyReady();
      return { 
        success: true,
        backend: "online",
        status: "ok", 
        database: "connected",
        environment: process.env.NODE_ENV ?? "development",
        timestamp: new Date().toISOString() 
      };
    } catch {
      return { 
        success: false,
        backend: "online",
        status: "error", 
        database: "disconnected",
        environment: process.env.NODE_ENV ?? "development",
        timestamp: new Date().toISOString() 
      };
    }
  }

  @Public()
  @Get("live")
  @ApiOperation({ summary: "Process liveness" })
  live() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Get("ready")
  @RequirePermissions("system.health")
  @ApiOperation({ summary: "Dependency readiness for authorized operators" })
  ready() {
    return this.health.ready();
  }

  @Public()
  @Get("ready/dependencies")
  @ApiOperation({
    summary: "Minimal dependency readiness for an orchestrator healthcheck",
  })
  dependencyReady() {
    return this.health.dependencyReady();
  }
}
