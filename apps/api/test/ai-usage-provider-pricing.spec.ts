import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../src/database/prisma.service";
import { AiUsageService } from "../src/modules/ai/ai-usage.service";

describe("AVS Bot provider-aware usage pricing", () => {
  it("uses the rate family belonging to the completed provider model", async () => {
    const update = jest.fn().mockResolvedValue({});
    const values: Record<string, unknown> = {
      AVS_BOT_PRIMARY_PROVIDER: "gemini",
      AVS_BOT_FALLBACK_PROVIDER: "openai",
      GEMINI_INPUT_COST_PER_MILLION_USD: 1,
      GEMINI_OUTPUT_COST_PER_MILLION_USD: 2,
      OPENAI_INPUT_COST_PER_MILLION_USD: 3,
      OPENAI_OUTPUT_COST_PER_MILLION_USD: 4,
    };
    const service = new AiUsageService(
      { aiUsageRecord: { update } } as unknown as PrismaService,
      {
        get: (key: string, fallback?: unknown) => values[key] ?? fallback,
      } as ConfigService,
    );

    expect(service.pricingConfigured()).toBe(true);
    await service.complete("gemini-usage", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      latencyMs: 10,
      model: "gemini-test-model",
    });
    await service.complete("openai-usage", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      latencyMs: 10,
      model: "openai-test-model",
    });

    expect(update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ estimatedCost: 3 }),
      }),
    );
    expect(update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ estimatedCost: 7 }),
      }),
    );
  });

  it("does not claim complete pricing when a selected provider has no rates", () => {
    const service = new AiUsageService(
      {} as PrismaService,
      {
        get: (key: string, fallback?: unknown) =>
          ({
            AVS_BOT_PRIMARY_PROVIDER: "gemini",
            AVS_BOT_FALLBACK_PROVIDER: "openai",
            OPENAI_INPUT_COST_PER_MILLION_USD: 3,
            OPENAI_OUTPUT_COST_PER_MILLION_USD: 4,
          })[key] ?? fallback,
      } as ConfigService,
    );

    expect(service.pricingConfigured()).toBe(false);
  });
});
