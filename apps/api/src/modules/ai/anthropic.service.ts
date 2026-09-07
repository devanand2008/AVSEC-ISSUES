import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AiProviderStreamEvent } from "./ai.types";

export type AnthropicErrorCategory =
  | "authentication"
  | "bad_request"
  | "cancelled"
  | "connection"
  | "model_not_available"
  | "permission"
  | "provider_unavailable"
  | "rate_limit"
  | "timeout";

export class AnthropicRequestError extends Error {
  constructor(readonly category: AnthropicErrorCategory) {
    super(`Anthropic request failed: ${category}`);
    this.name = "AnthropicRequestError";
  }
}

interface AnthropicMessageResponse {
  id?: unknown;
  content?: Array<{
    type?: unknown;
    text?: unknown;
  }>;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
  };
}

@Injectable()
export class AnthropicService {
  private readonly enabled: boolean;
  private readonly apiKey: string | null;
  private readonly configuredModel: string | null;
  private readonly maxOutputTokens: number;
  private readonly requestTimeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.enabled = config.get<boolean>("AVS_BOT_ENABLED", false);
    this.apiKey = config.get<string>("ANTHROPIC_API_KEY") ?? null;
    this.configuredModel = config.get<string>("ANTHROPIC_MODEL") ?? null;
    this.maxOutputTokens = config.get<number>(
      "OPENAI_MAX_OUTPUT_TOKENS",
      1_200,
    );
    this.requestTimeoutMs = config.get<number>(
      "ANTHROPIC_REQUEST_TIMEOUT_MS",
      45_000,
    );
  }

  configuration() {
    return {
      configured: Boolean(this.enabled && this.apiKey && this.configuredModel),
      model: this.configuredModel,
      api: "Anthropic Messages API",
    };
  }

  assertAvailable(): void {
    if (!this.enabled || !this.apiKey || !this.configuredModel) {
      throw new ServiceUnavailableException(
        "The Anthropic provider is not configured for AVS Bot.",
      );
    }
  }

  model(override?: string | null): string {
    this.assertAvailable();
    return override?.trim() || this.configuredModel!;
  }

  async *stream(
    input: {
      instructions: string;
      prompt: string;
      model?: string | null;
      maxOutputTokens?: number;
    },
    signal: AbortSignal,
  ): AsyncGenerator<AiProviderStreamEvent> {
    this.assertAvailable();
    if (signal.aborted) throw new AnthropicRequestError("cancelled");
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "x-api-key": this.apiKey!,
        },
        body: JSON.stringify({
          model: this.model(input.model),
          max_tokens: Math.min(
            Math.max(input.maxOutputTokens ?? this.maxOutputTokens, 100),
            8_000,
          ),
          system: input.instructions,
          messages: [{ role: "user", content: input.prompt }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new AnthropicRequestError(this.statusCategory(response.status));
      }

      const payload = (await response.json()) as AnthropicMessageResponse;
      const text = (payload.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => (typeof block.text === "string" ? block.text : ""))
        .join("");
      if (!text.trim()) {
        throw new AnthropicRequestError("provider_unavailable");
      }
      yield { type: "delta", delta: text };
      yield {
        type: "completed",
        responseId: typeof payload.id === "string" ? payload.id : null,
        inputTokens: this.tokenCount(payload.usage?.input_tokens),
        outputTokens: this.tokenCount(payload.usage?.output_tokens),
      };
    } catch (error) {
      if (error instanceof AnthropicRequestError) throw error;
      if (signal.aborted) throw new AnthropicRequestError("cancelled");
      if (timedOut) throw new AnthropicRequestError("timeout");
      throw new AnthropicRequestError("connection");
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
    }
  }

  async testConnection(): Promise<{
    ok: boolean;
    model: string | null;
    category?: string;
  }> {
    this.assertAvailable();
    try {
      for await (const _event of this.stream(
        {
          instructions:
            "This is an authenticated backend connectivity check. Reply only with OK.",
          prompt: "Reply with OK.",
          maxOutputTokens: 16,
        },
        new AbortController().signal,
      )) {
        // Consuming the provider response is the connectivity assertion.
      }
      return { ok: true, model: this.model() };
    } catch (error) {
      return {
        ok: false,
        model: this.configuredModel,
        category: this.errorCategory(error) ?? "provider_unavailable",
      };
    }
  }

  errorCategory(error: unknown): AnthropicErrorCategory | null {
    return error instanceof AnthropicRequestError ? error.category : null;
  }

  private statusCategory(status: number): AnthropicErrorCategory {
    if (status === 400) return "bad_request";
    if (status === 401) return "authentication";
    if (status === 403) return "permission";
    if (status === 404) return "model_not_available";
    if (status === 408) return "timeout";
    if (status === 429) return "rate_limit";
    return "provider_unavailable";
  }

  private tokenCount(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.trunc(value))
      : 0;
  }
}
