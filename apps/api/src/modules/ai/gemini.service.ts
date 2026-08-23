import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AiProviderStreamEvent } from "./ai.types";

export type GeminiErrorCategory =
  | "authentication"
  | "bad_request"
  | "cancelled"
  | "connection"
  | "model_not_available"
  | "permission"
  | "provider_unavailable"
  | "rate_limit"
  | "timeout";

export class GeminiRequestError extends Error {
  constructor(readonly category: GeminiErrorCategory) {
    super(`Gemini request failed: ${category}`);
    this.name = "GeminiRequestError";
  }
}

interface GeminiResponse {
  responseId?: unknown;
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: unknown }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    thoughtsTokenCount?: unknown;
  };
}

@Injectable()
export class GeminiService {
  private readonly enabled: boolean;
  private readonly apiKey: string | null;
  private readonly configuredModel: string | null;
  private readonly maxOutputTokens: number;
  private readonly requestTimeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.enabled = config.get<boolean>("AVS_BOT_ENABLED", false);
    this.apiKey = config.get<string>("GEMINI_API_KEY") ?? null;
    this.configuredModel = config.get<string>("GEMINI_MODEL") ?? null;
    this.maxOutputTokens = config.get<number>(
      "OPENAI_MAX_OUTPUT_TOKENS",
      1_200,
    );
    this.requestTimeoutMs = config.get<number>(
      "GEMINI_REQUEST_TIMEOUT_MS",
      45_000,
    );
  }

  configuration() {
    return {
      configured: Boolean(this.enabled && this.apiKey && this.configuredModel),
      model: this.configuredModel,
      api: "Gemini generateContent API",
    };
  }

  assertAvailable(): void {
    if (!this.enabled || !this.apiKey || !this.configuredModel) {
      throw new ServiceUnavailableException(
        "The Gemini provider is not configured for AVS Bot.",
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
    if (signal.aborted) throw new GeminiRequestError("cancelled");
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);

    try {
      const model = this.model(input.model);
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.apiKey!,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: input.instructions }],
            },
            contents: [
              {
                role: "user",
                parts: [{ text: input.prompt }],
              },
            ],
            generationConfig: {
              maxOutputTokens: Math.min(
                Math.max(input.maxOutputTokens ?? this.maxOutputTokens, 100),
                8_000,
              ),
            },
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new GeminiRequestError(this.statusCategory(response.status));
      }

      const payload = (await response.json()) as GeminiResponse;
      const text = (payload.candidates ?? [])
        .flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("");
      if (!text.trim()) {
        throw new GeminiRequestError("provider_unavailable");
      }
      yield { type: "delta", delta: text };
      yield {
        type: "completed",
        responseId:
          typeof payload.responseId === "string" ? payload.responseId : null,
        inputTokens: this.tokenCount(payload.usageMetadata?.promptTokenCount),
        outputTokens: Math.min(
          Number.MAX_SAFE_INTEGER,
          this.tokenCount(payload.usageMetadata?.candidatesTokenCount) +
            this.tokenCount(payload.usageMetadata?.thoughtsTokenCount),
        ),
      };
    } catch (error) {
      if (error instanceof GeminiRequestError) throw error;
      if (signal.aborted) throw new GeminiRequestError("cancelled");
      if (timedOut) throw new GeminiRequestError("timeout");
      throw new GeminiRequestError("connection");
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

  errorCategory(error: unknown): GeminiErrorCategory | null {
    return error instanceof GeminiRequestError ? error.category : null;
  }

  private statusCategory(status: number): GeminiErrorCategory {
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
