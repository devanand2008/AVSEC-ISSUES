import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AiProviderStreamEvent } from "./ai.types";
import { GeminiService } from "./gemini.service";
import { OpenAiService } from "./openai.service";

export type AiProviderName = "gemini" | "openai";

@Injectable()
export class AiProviderService {
  private readonly enabled: boolean;
  private readonly primaryProvider: AiProviderName;
  private readonly fallbackProvider: AiProviderName | null;

  constructor(
    private readonly config: ConfigService,
    private readonly openai: OpenAiService,
    private readonly gemini: GeminiService,
  ) {
    this.enabled = config.get<boolean>("AVS_BOT_ENABLED", false);
    this.primaryProvider = config.get<AiProviderName>(
      "AVS_BOT_PRIMARY_PROVIDER",
      "openai",
    );
    const fallback = config.get<AiProviderName | "none">(
      "AVS_BOT_FALLBACK_PROVIDER",
      "none",
    );
    this.fallbackProvider = fallback === "none" ? null : fallback;
  }

  configuration() {
    const openai = this.openai.configuration();
    const gemini = this.gemini.configuration();
    const primary = this.primaryProvider === "gemini" ? gemini : openai;
    const fallback = this.fallbackProvider
      ? this.fallbackProvider === "gemini"
        ? gemini
        : openai
      : null;
    return {
      enabled: this.enabled,
      configured: Boolean(
        this.enabled &&
          primary.configured &&
          (!fallback || fallback.configured),
      ),
      provider: this.primaryProvider,
      model: primary.model,
      fallbackProvider: this.fallbackProvider,
      fallbackConfigured: fallback ? fallback.configured : false,
      providers: { gemini, openai },
      knowledgeProvider: openai.knowledgeProvider,
      vectorStoreConfigured: openai.vectorStoreConfigured,
      api: primary.api,
      streaming: "SSE",
    };
  }

  assertAvailable(): void {
    if (!this.configuration().configured) {
      throw new ServiceUnavailableException(
        "AVS Bot is not enabled. An administrator must configure its server-side AI providers and models.",
      );
    }
  }

  model(override?: string | null): string {
    this.assertAvailable();
    return this.providerModel(this.primaryProvider, override);
  }

  async *stream(
    input: {
      instructions: string;
      prompt: string;
      model?: string | null;
      maxOutputTokens?: number;
      useFileSearch?: boolean;
      fileSearchCollegeId?: string;
    },
    signal: AbortSignal,
  ): AsyncGenerator<AiProviderStreamEvent> {
    this.assertAvailable();
    const providers = [
      this.primaryProvider,
      ...(this.fallbackProvider ? [this.fallbackProvider] : []),
    ];
    let lastError: unknown;

    for (const [index, provider] of providers.entries()) {
      const model = this.providerModel(provider, input.model);
      let emittedText = false;
      let completion: AiProviderStreamEvent | null = null;
      try {
        const stream =
          provider === "gemini"
            ? this.gemini.stream(
                {
                  instructions: input.instructions,
                  prompt: input.prompt,
                  model,
                  maxOutputTokens: input.maxOutputTokens,
                },
                signal,
              )
            : this.openai.stream({ ...input, model }, signal);
        for await (const event of stream) {
          if (event.type === "delta") {
            if (!event.delta) continue;
            emittedText = true;
            yield event;
          } else {
            completion = {
              ...event,
              provider,
              model,
            };
          }
        }
        if (!emittedText) {
          throw new ServiceUnavailableException(
            "The AI provider returned an empty response.",
          );
        }
        if (!completion || completion.type !== "completed") {
          throw new ServiceUnavailableException(
            "The AI provider response ended before completion.",
          );
        }
        yield completion;
        return;
      } catch (error) {
        lastError = error;
        const category = this.errorCategory(error);
        if (
          emittedText ||
          signal.aborted ||
          category === "cancelled" ||
          index === providers.length - 1
        ) {
          throw error;
        }
      }
    }
    throw (
      lastError ?? new ServiceUnavailableException("AVS Bot is unavailable.")
    );
  }

  async testConnection() {
    this.assertAvailable();
    const names = [
      this.primaryProvider,
      ...(this.fallbackProvider ? [this.fallbackProvider] : []),
    ];
    const results = await Promise.all(
      names.map(async (provider) => ({
        provider,
        ...(provider === "gemini"
          ? await this.gemini.testConnection()
          : await this.openai.testConnection()),
      })),
    );
    const failed = results.find((result) => !result.ok);
    return {
      ok: !failed,
      provider: this.primaryProvider,
      model: results[0]?.model ?? null,
      ...(failed?.category ? { category: failed.category } : {}),
      providers: results,
    };
  }

  errorCategory(error: unknown): string {
    return this.gemini.errorCategory(error) ?? this.openai.errorCategory(error);
  }

  private providerModel(
    provider: AiProviderName,
    override?: string | null,
  ): string {
    const candidate = override?.trim();
    const compatible = candidate
      ? provider === "gemini"
        ? candidate.startsWith("gemini-")
        : !candidate.startsWith("gemini-")
      : false;
    return provider === "gemini"
      ? this.gemini.model(compatible ? candidate : undefined)
      : this.openai.model(compatible ? candidate : undefined);
  }
}
