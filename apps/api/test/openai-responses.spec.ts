const create = jest.fn();

jest.mock("openai", () => {
  class ApiError extends Error {}
  class MockOpenAi {
    static APIConnectionTimeoutError = class extends ApiError {};
    static APIConnectionError = class extends ApiError {};
    static RateLimitError = class extends ApiError {};
    static AuthenticationError = class extends ApiError {};
    static PermissionDeniedError = class extends ApiError {};
    static NotFoundError = class extends ApiError {};
    static BadRequestError = class extends ApiError {};
    responses = { create };
  }
  return {
    __esModule: true,
    default: MockOpenAi,
    toFile: jest.fn(),
  };
});

import type { ConfigService } from "@nestjs/config";
import { OpenAiService } from "../src/modules/ai/openai.service";

describe("OpenAI Responses API backend adapter", () => {
  beforeEach(() => create.mockReset());

  it("streams Responses API text deltas and usage without exposing the key", async () => {
    create.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "response.output_text.delta", delta: "Hello" };
        yield {
          type: "response.completed",
          response: {
            id: "response-id",
            usage: { input_tokens: 12, output_tokens: 3 },
          },
        };
      },
    });
    const values: Record<string, unknown> = {
      AVS_BOT_ENABLED: true,
      OPENAI_API_KEY: "test-only-server-key-value-12345",
      OPENAI_MODEL: "available-model",
      OPENAI_MAX_OUTPUT_TOKENS: 1200,
      OPENAI_REQUEST_TIMEOUT_MS: 45000,
      AI_KNOWLEDGE_PROVIDER: "internal",
    };
    const service = new OpenAiService({
      get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    } as ConfigService);
    const events = [];
    for await (const event of service.stream(
      {
        instructions: "Safe system instruction",
        prompt: "Authenticated prompt",
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "available-model",
        input: "Authenticated prompt",
        stream: true,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(events).toEqual([
      { type: "delta", delta: "Hello" },
      {
        type: "completed",
        responseId: "response-id",
        inputTokens: 12,
        outputTokens: 3,
      },
    ]);
    expect(JSON.stringify(service.configuration())).not.toContain(
      "test-only-server-key",
    );
  });

  it("fails closed when the server integration is disabled", () => {
    const service = new OpenAiService({
      get: (_key: string, fallback?: unknown) => fallback,
    } as ConfigService);
    expect(() => service.assertAvailable()).toThrow(
      /administrator must configure/i,
    );
  });

  it("rejects an explicitly incomplete Responses API event", async () => {
    create.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "response.output_text.delta", delta: "Partial" };
        yield { type: "response.incomplete", response: { id: "incomplete" } };
      },
    });
    const service = new OpenAiService({
      get: (key: string, fallback?: unknown) =>
        ({
          AVS_BOT_ENABLED: true,
          OPENAI_API_KEY: "test-only-server-key-value-12345",
          OPENAI_MODEL: "available-model",
        })[key] ?? fallback,
    } as ConfigService);

    const consume = async () => {
      for await (const _event of service.stream(
        { instructions: "Safe instruction", prompt: "Hello" },
        new AbortController().signal,
      )) {
        // Consume until the provider reports an incomplete response.
      }
    };
    await expect(consume()).rejects.toThrow(/ended before completion/i);
  });
});
