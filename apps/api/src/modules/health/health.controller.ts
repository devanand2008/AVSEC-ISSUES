import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { HealthService } from "./health.service";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "System health check" })
  async root() {
    return this.health.dependencyReady();
  }

  @Public()
  @Get("live")
  @ApiOperation({ summary: "Process liveness" })
  live() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Public()
  @Get("ready")
  @ApiOperation({ summary: "Orchestrator-safe application readiness" })
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
