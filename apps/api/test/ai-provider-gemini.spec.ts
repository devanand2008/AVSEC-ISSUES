import type { ConfigService } from "@nestjs/config";
import { AiProviderService } from "../src/modules/ai/ai-provider.service";
import {
  GeminiRequestError,
  GeminiService,
} from "../src/modules/ai/gemini.service";
import type { OpenAiService } from "../src/modules/ai/openai.service";

function config(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as ConfigService;
}

describe("AVS Bot Gemini provider", () => {
  afterEach(() => jest.restoreAllMocks());

  it("calls Gemini from the backend without exposing the API key", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini-response",
          candidates: [{ content: { parts: [{ text: "Hello from Gemini" }] } }],
          usageMetadata: {
            promptTokenCount: 14,
            candidatesTokenCount: 4,
            thoughtsTokenCount: 2,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const service = new GeminiService(
      config({
        AVS_BOT_ENABLED: true,
        GEMINI_API_KEY: "test-only-gemini-server-key-12345",
        GEMINI_MODEL: "gemini-test-model",
        GEMINI_REQUEST_TIMEOUT_MS: 45_000,
        OPENAI_MAX_OUTPUT_TOKENS: 1_200,
      }),
    );
    const events = [];
    for await (const event of service.stream(
      { instructions: "Safe instruction", prompt: "Hello" },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("gemini-test-model:generateContent");
    expect((request?.headers as Record<string, string>)["x-goog-api-key"]).toBe(
      "test-only-gemini-server-key-12345",
    );
    expect(events).toEqual([
      { type: "delta", delta: "Hello from Gemini" },
      {
        type: "completed",
        responseId: "gemini-response",
        inputTokens: 14,
        outputTokens: 6,
      },
    ]);
    expect(JSON.stringify(service.configuration())).not.toContain(
      "test-only-gemini-server-key",
    );
  });

  it("maps provider authentication failures without returning response data", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response("sensitive provider detail", { status: 401 }),
      );
    const service = new GeminiService(
      config({
        AVS_BOT_ENABLED: true,
        GEMINI_API_KEY: "test-only-gemini-server-key-12345",
        GEMINI_MODEL: "gemini-test-model",
      }),
    );

    const consume = async () => {
      for await (const _event of service.stream(
        { instructions: "Safe instruction", prompt: "Hello" },
        new AbortController().signal,
      )) {
        // Consume the stream.
      }
    };
    await expect(consume()).rejects.toMatchObject({
      category: "authentication",
    });
  });

  it.each([
    [403, "permission"],
    [404, "model_not_available"],
    [429, "rate_limit"],
  ])("maps Gemini HTTP %i to %s", async (status, expectedCategory) => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(null, { status }));
    const service = new GeminiService(
      config({
        AVS_BOT_ENABLED: true,
        GEMINI_API_KEY: "test-only-gemini-server-key-12345",
        GEMINI_MODEL: "gemini-test-model",
      }),
    );
    const consume = async () => {
      for await (const _event of service.stream(
        { instructions: "Safe instruction", prompt: "Hello" },
        new AbortController().signal,
      )) {
        // Consume the stream.
      }
    };

    await expect(consume()).rejects.toMatchObject({
      category: expectedCategory,
    });
  });

  it("does not contact Gemini when the request was already cancelled", async () => {
    const fetchMock = jest.spyOn(global, "fetch");
    const service = new GeminiService(
      config({
        AVS_BOT_ENABLED: true,
        GEMINI_API_KEY: "test-only-gemini-server-key-12345",
        GEMINI_MODEL: "gemini-test-model",
      }),
    );
    const controller = new AbortController();
    controller.abort();

    const consume = async () => {
      for await (const _event of service.stream(
        { instructions: "Safe instruction", prompt: "Hello" },
        controller.signal,
      )) {
        // Consume the stream.
      }
    };
    await expect(consume()).rejects.toMatchObject({ category: "cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("AVS Bot provider fallback", () => {
  it("uses OpenAI when Gemini fails before emitting text", async () => {
    const openAiStream = jest.fn(async function* () {
      yield { type: "delta" as const, delta: "Fallback answer" };
      yield {
        type: "completed" as const,
        responseId: "openai-response",
        inputTokens: 8,
        outputTokens: 3,
      };
    });
    const provider = new AiProviderService(
      config({
        AVS_BOT_ENABLED: true,
        AVS_BOT_PRIMARY_PROVIDER: "gemini",
        AVS_BOT_FALLBACK_PROVIDER: "openai",
      }),
      {
        configuration: () => ({
          configured: true,
          model: "openai-test-model",
          knowledgeProvider: "internal",
          vectorStoreConfigured: false,
          api: "Responses API",
        }),
        model: () => "openai-test-model",
        stream: openAiStream,
        errorCategory: () => "provider_unavailable",
      } as unknown as OpenAiService,
      {
        configuration: () => ({
          configured: true,
          model: "gemini-test-model",
          api: "Gemini generateContent API",
        }),
        model: () => "gemini-test-model",
        stream: async function* () {
          yield* [];
          throw new GeminiRequestError("rate_limit");
        },
        errorCategory: (error: unknown) =>
          error instanceof GeminiRequestError ? error.category : null,
      } as unknown as GeminiService,
    );
    const events = [];
    for await (const event of provider.stream(
      { instructions: "Safe instruction", prompt: "Hello" },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(openAiStream).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { type: "delta", delta: "Fallback answer" },
      {
        type: "completed",
        responseId: "openai-response",
        inputTokens: 8,
        outputTokens: 3,
        provider: "openai",
        model: "openai-test-model",
      },
    ]);
  });

  it("does not switch providers after response text has started", async () => {
    const openAiStream = jest.fn(async function* () {
      yield { type: "delta" as const, delta: "must not run" };
    });
    const provider = new AiProviderService(
      config({
        AVS_BOT_ENABLED: true,
        AVS_BOT_PRIMARY_PROVIDER: "gemini",
        AVS_BOT_FALLBACK_PROVIDER: "openai",
      }),
      {
        configuration: () => ({
          configured: true,
          model: "openai-test-model",
          knowledgeProvider: "internal",
          vectorStoreConfigured: false,
          api: "Responses API",
        }),
        model: () => "openai-test-model",
        stream: openAiStream,
        errorCategory: () => "provider_unavailable",
      } as unknown as OpenAiService,
      {
        configuration: () => ({
          configured: true,
          model: "gemini-test-model",
          api: "Gemini generateContent API",
        }),
        model: () => "gemini-test-model",
        stream: async function* () {
          yield { type: "delta" as const, delta: "partial" };
          throw new GeminiRequestError("connection");
        },
        errorCategory: (error: unknown) =>
          error instanceof GeminiRequestError ? error.category : null,
      } as unknown as GeminiService,
    );

    const consume = async () => {
      for await (const _event of provider.stream(
        { instructions: "Safe instruction", prompt: "Hello" },
        new AbortController().signal,
      )) {
        // Consume until the provider fails.
      }
    };
    await expect(consume()).rejects.toMatchObject({ category: "connection" });
    expect(openAiStream).not.toHaveBeenCalled();
  });

  it("rejects a stream that ends without a provider completion event", async () => {
    const openAiStream = jest.fn(async function* () {
      yield { type: "delta" as const, delta: "must not run" };
    });
    const provider = new AiProviderService(
      config({
        AVS_BOT_ENABLED: true,
        AVS_BOT_PRIMARY_PROVIDER: "gemini",
        AVS_BOT_FALLBACK_PROVIDER: "openai",
      }),
      {
        configuration: () => ({
          configured: true,
          model: "openai-test-model",
          knowledgeProvider: "internal",
          vectorStoreConfigured: false,
          api: "Responses API",
        }),
        model: () => "openai-test-model",
        stream: openAiStream,
        errorCategory: () => "provider_unavailable",
      } as unknown as OpenAiService,
      {
        configuration: () => ({
          configured: true,
          model: "gemini-test-model",
          api: "Gemini generateContent API",
        }),
        model: () => "gemini-test-model",
        stream: async function* () {
          yield { type: "delta" as const, delta: "truncated answer" };
        },
        errorCategory: () => null,
      } as unknown as GeminiService,
    );

    const consume = async () => {
      for await (const _event of provider.stream(
        { instructions: "Safe instruction", prompt: "Hello" },
        new AbortController().signal,
      )) {
        // Consume until completion validation fails.
      }
    };
    await expect(consume()).rejects.toThrow(/ended before completion/i);
    expect(openAiStream).not.toHaveBeenCalled();
  });

  it("supports OpenAI primary with Gemini fallback", async () => {
    const geminiStream = jest.fn(async function* () {
      yield { type: "delta" as const, delta: "Gemini fallback" };
      yield {
        type: "completed" as const,
        responseId: "gemini-response",
        inputTokens: 6,
        outputTokens: 2,
      };
    });
    const provider = new AiProviderService(
      config({
        AVS_BOT_ENABLED: true,
        AVS_BOT_PRIMARY_PROVIDER: "openai",
        AVS_BOT_FALLBACK_PROVIDER: "gemini",
      }),
      {
        configuration: () => ({
          configured: true,
          model: "openai-test-model",
          knowledgeProvider: "internal",
          vectorStoreConfigured: false,
          api: "Responses API",
        }),
        model: () => "openai-test-model",
        stream: async function* () {
          yield* [];
          throw new Error("OpenAI unavailable");
        },
        errorCategory: () => "connection",
      } as unknown as OpenAiService,
      {
        configuration: () => ({
          configured: true,
          model: "gemini-test-model",
          api: "Gemini generateContent API",
        }),
        model: () => "gemini-test-model",
        stream: geminiStream,
        errorCategory: () => null,
      } as unknown as GeminiService,
    );
    const events = [];
    for await (const event of provider.stream(
      { instructions: "Safe instruction", prompt: "Hello" },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(geminiStream).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      provider: "gemini",
      model: "gemini-test-model",
    });
  });

  it("tests both selected providers and ignores incompatible model overrides", async () => {
    const provider = new AiProviderService(
      config({
        AVS_BOT_ENABLED: true,
        AVS_BOT_PRIMARY_PROVIDER: "gemini",
        AVS_BOT_FALLBACK_PROVIDER: "openai",
      }),
      {
        configuration: () => ({
          configured: true,
          model: "openai-test-model",
          knowledgeProvider: "internal",
          vectorStoreConfigured: false,
          api: "Responses API",
        }),
        model: () => "openai-test-model",
        testConnection: jest.fn().mockResolvedValue({
          ok: true,
          model: "openai-test-model",
        }),
        errorCategory: () => "provider_unavailable",
      } as unknown as OpenAiService,
      {
        configuration: () => ({
          configured: true,
          model: "gemini-test-model",
          api: "Gemini generateContent API",
        }),
        model: (override?: string) => override || "gemini-test-model",
        testConnection: jest.fn().mockResolvedValue({
          ok: true,
          model: "gemini-test-model",
        }),
        errorCategory: () => null,
      } as unknown as GeminiService,
    );

    expect(provider.model("legacy-openai-model")).toBe("gemini-test-model");
    await expect(provider.testConnection()).resolves.toMatchObject({
      ok: true,
      provider: "gemini",
      providers: [
        { provider: "gemini", ok: true, model: "gemini-test-model" },
        { provider: "openai", ok: true, model: "openai-test-model" },
      ],
    });
  });
});
