import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";

function utcDayStart(value = new Date()): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function utcMonthStart(value = new Date()): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async begin(
    user: AuthPrincipal,
    messageId: string,
    model: string,
  ): Promise<string> {
    const settings = await this.prisma.aiBotSetting.findUnique({
      where: { collegeId: user.collegeId },
      select: { dailyRoleLimits: true, monthlyBudget: true },
    });
    const role = user.roles[0] ?? "UNKNOWN";
    const dailyLimit = this.dailyLimit(settings?.dailyRoleLimits, role);
    const [daily, monthly] = await Promise.all([
      this.prisma.aiUsageRecord.aggregate({
        where: {
          userId: user.id,
          usageDate: { gte: utcDayStart() },
        },
        _sum: { requests: true },
      }),
      this.prisma.aiUsageRecord.aggregate({
        where: {
          collegeId: user.collegeId,
          usageDate: { gte: utcMonthStart() },
        },
        _sum: { estimatedCost: true },
      }),
    ]);
    if ((daily._sum.requests ?? 0) >= dailyLimit) {
      throw new HttpException(
        "Your AVS Bot daily request limit has been reached. Try again after the daily reset or contact an administrator.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const configuredBudget = this.config.get<number>(
      "OPENAI_MONTHLY_BUDGET_USD",
    );
    const budget = settings?.monthlyBudget
      ? Number(settings.monthlyBudget)
      : configuredBudget;
    const cost = Number(monthly._sum.estimatedCost ?? 0);
    if (budget && cost >= budget) {
      throw new HttpException(
        "The college AVS Bot monthly budget limit has been reached.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const profiles = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        studentProfile: { select: { departmentId: true } },
        staffProfile: { select: { departmentId: true } },
      },
    });
    const record = await this.prisma.aiUsageRecord.create({
      data: {
        collegeId: user.collegeId,
        userId: user.id,
        departmentId:
          profiles?.studentProfile?.departmentId ??
          profiles?.staffProfile?.departmentId ??
          null,
        messageId,
        usageDate: utcDayStart(),
        model,
        role,
      },
      select: { id: true },
    });
    return record.id;
  }

  async complete(
    usageId: string,
    input: {
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      failed?: boolean;
      model?: string;
    },
  ): Promise<void> {
    await this.prisma.aiUsageRecord.update({
      where: { id: usageId },
      data: {
        inputTokens: Math.max(0, input.inputTokens),
        outputTokens: Math.max(0, input.outputTokens),
        estimatedCost: this.estimateCost(
          input.inputTokens,
          input.outputTokens,
          input.model,
        ),
        latencyMs: Math.max(0, input.latencyMs),
        failures: input.failed ? 1 : 0,
        ...(input.model ? { model: input.model } : {}),
      },
    });
  }

  pricingConfigured(): boolean {
    const primary = this.config.get<"gemini" | "openai">(
      "AVS_BOT_PRIMARY_PROVIDER",
      "openai",
    );
    const fallback = this.config.get<"gemini" | "openai" | "none">(
      "AVS_BOT_FALLBACK_PROVIDER",
      "none",
    );
    return [primary, ...(fallback === "none" ? [] : [fallback])].every(
      (provider) =>
        Boolean(
          this.config.get<number>(
            provider === "gemini"
              ? "GEMINI_INPUT_COST_PER_MILLION_USD"
              : "OPENAI_INPUT_COST_PER_MILLION_USD",
          ) &&
            this.config.get<number>(
              provider === "gemini"
                ? "GEMINI_OUTPUT_COST_PER_MILLION_USD"
                : "OPENAI_OUTPUT_COST_PER_MILLION_USD",
            ),
        ),
    );
  }

  async summary(
    collegeId: string,
    query: { from?: string; to?: string; departmentId?: string },
  ) {
    const from = query.from ? new Date(query.from) : utcMonthStart();
    const to = query.to ? new Date(query.to) : new Date();
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from > to
    ) {
      throw new HttpException(
        "Usage date range is invalid.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const records = await this.prisma.aiUsageRecord.findMany({
      where: {
        collegeId,
        usageDate: { gte: from, lte: to },
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      },
      select: {
        usageDate: true,
        departmentId: true,
        role: true,
        model: true,
        requests: true,
        inputTokens: true,
        outputTokens: true,
        estimatedCost: true,
        failures: true,
        latencyMs: true,
      },
      orderBy: { usageDate: "asc" },
      take: 10_000,
    });
    const totals = {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      failures: 0,
      latencyTotal: 0,
      latencySamples: 0,
    };
    const breakdown = new Map<
      string,
      {
        date: string;
        departmentId: string | null;
        role: string;
        model: string | null;
        requests: number;
        inputTokens: number;
        outputTokens: number;
        estimatedCostUsd: number;
        failures: number;
      }
    >();
    for (const record of records) {
      totals.requests += record.requests;
      totals.inputTokens += record.inputTokens;
      totals.outputTokens += record.outputTokens;
      totals.estimatedCostUsd += Number(record.estimatedCost);
      totals.failures += record.failures;
      if (record.latencyMs !== null) {
        totals.latencyTotal += record.latencyMs;
        totals.latencySamples += 1;
      }
      const date = record.usageDate.toISOString().slice(0, 10);
      const key = `${date}:${record.departmentId ?? "college"}:${record.role ?? "UNKNOWN"}:${record.model ?? "unknown"}`;
      const row = breakdown.get(key) ?? {
        date,
        departmentId: record.departmentId,
        role: record.role ?? "UNKNOWN",
        model: record.model,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        failures: 0,
      };
      row.requests += record.requests;
      row.inputTokens += record.inputTokens;
      row.outputTokens += record.outputTokens;
      row.estimatedCostUsd += Number(record.estimatedCost);
      row.failures += record.failures;
      breakdown.set(key, row);
    }
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      pricingConfigured: this.pricingConfigured(),
      totals: {
        requests: totals.requests,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        estimatedCostUsd: Number(totals.estimatedCostUsd.toFixed(6)),
        failures: totals.failures,
        averageLatencyMs: totals.latencySamples
          ? Math.round(totals.latencyTotal / totals.latencySamples)
          : null,
      },
      breakdown: [...breakdown.values()].map((row) => ({
        ...row,
        estimatedCostUsd: Number(row.estimatedCostUsd.toFixed(6)),
      })),
    };
  }

  private dailyLimit(value: unknown, role: string): number {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      role in value
    ) {
      const candidate = Number((value as Record<string, unknown>)[role]);
      if (Number.isInteger(candidate) && candidate > 0) return candidate;
    }
    return this.config.get<number>("OPENAI_DAILY_USER_LIMIT", 50);
  }

  private estimateCost(
    inputTokens: number,
    outputTokens: number,
    model?: string,
  ): number {
    const prefix = model?.startsWith("gemini-") ? "GEMINI" : "OPENAI";
    const inputRate = this.config.get<number>(
      `${prefix}_INPUT_COST_PER_MILLION_USD`,
    );
    const outputRate = this.config.get<number>(
      `${prefix}_OUTPUT_COST_PER_MILLION_USD`,
    );
    if (!inputRate || !outputRate) return 0;
    return Number(
      (
        (Math.max(0, inputTokens) * inputRate +
          Math.max(0, outputTokens) * outputRate) /
        1_000_000
      ).toFixed(6),
    );
  }
}
