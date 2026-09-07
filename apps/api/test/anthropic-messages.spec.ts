import type { ConfigService } from "@nestjs/config";
import { AiProviderService } from "../src/modules/ai/ai-provider.service";
import { AnthropicService } from "../src/modules/ai/anthropic.service";
import type { GeminiService } from "../src/modules/ai/gemini.service";
import type { OpenAiService } from "../src/modules/ai/openai.service";

function config(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as ConfigService;
}

describe("AVS Bot Anthropic provider", () => {
  afterEach(() => jest.restoreAllMocks());

  it("calls the Messages API from the backend without exposing the key", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_test",
          content: [{ type: "text", text: "Hello from Claude" }],
          usage: { input_tokens: 12, output_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const service = new AnthropicService(
      config({
        AVS_BOT_ENABLED: true,
        ANTHROPIC_API_KEY: "test-only-anthropic-server-key-12345",
        ANTHROPIC_MODEL: "claude-test-model",
        ANTHROPIC_REQUEST_TIMEOUT_MS: 45_000,
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
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect((request?.headers as Record<string, string>)["x-api-key"]).toBe(
      "test-only-anthropic-server-key-12345",
    );
    expect(
      (request?.headers as Record<string, string>)["anthropic-version"],
    ).toBe("2023-06-01");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: "claude-test-model",
      system: "Safe instruction",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(events).toEqual([
      { type: "delta", delta: "Hello from Claude" },
      {
        type: "completed",
        responseId: "msg_test",
        inputTokens: 12,
        outputTokens: 4,
      },
    ]);
    expect(JSON.stringify(service.configuration())).not.toContain(
      "test-only-anthropic-server-key",
    );
  });

  it.each([
    [400, "bad_request"],
    [401, "authentication"],
    [403, "permission"],
    [404, "model_not_available"],
    [429, "rate_limit"],
    [500, "provider_unavailable"],
  ])("maps Anthropic HTTP %i to %s", async (status, expectedCategory) => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("provider detail", { status }));
    const service = new AnthropicService(
      config({
        AVS_BOT_ENABLED: true,
        ANTHROPIC_API_KEY: "test-only-anthropic-server-key-12345",
        ANTHROPIC_MODEL: "claude-test-model",
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

  it("does not contact Anthropic after cancellation", async () => {
    const fetchMock = jest.spyOn(global, "fetch");
    const service = new AnthropicService(
      config({
        AVS_BOT_ENABLED: true,
        ANTHROPIC_API_KEY: "test-only-anthropic-server-key-12345",
        ANTHROPIC_MODEL: "claude-test-model",
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

  it("routes Anthropic as the primary provider and ignores incompatible model overrides", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_routed",
          content: [{ type: "text", text: "Routed answer" }],
          usage: { input_tokens: 9, output_tokens: 3 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const values = {
      AVS_BOT_ENABLED: true,
      AVS_BOT_PRIMARY_PROVIDER: "anthropic",
      AVS_BOT_FALLBACK_PROVIDER: "none",
      ANTHROPIC_API_KEY: "test-only-anthropic-server-key-12345",
      ANTHROPIC_MODEL: "claude-test-model",
    };
    const anthropic = new AnthropicService(config(values));
    const provider = new AiProviderService(
      config(values),
      {
        configuration: () => ({
          configured: false,
          model: null,
          knowledgeProvider: "internal",
          vectorStoreConfigured: false,
          api: "Responses API",
        }),
        errorCategory: () => null,
      } as unknown as OpenAiService,
      {
        configuration: () => ({
          configured: false,
          model: null,
          api: "Gemini generateContent API",
        }),
        errorCategory: () => null,
      } as unknown as GeminiService,
      anthropic,
    );

    expect(provider.model("legacy-openai-model")).toBe("claude-test-model");
    const events = [];
    for await (const event of provider.stream(
      {
        instructions: "Safe instruction",
        prompt: "Hello",
        model: "legacy-openai-model",
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "completed",
      provider: "anthropic",
      model: "claude-test-model",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toMatchObject(
      {
        model: "claude-test-model",
      },
    );
  });
});
