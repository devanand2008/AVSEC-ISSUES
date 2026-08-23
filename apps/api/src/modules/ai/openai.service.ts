import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI, { toFile } from "openai";
import type { AiProviderStreamEvent } from "./ai.types";

@Injectable()
export class OpenAiService {
  private readonly enabled: boolean;
  private readonly client: OpenAI | null;
  private readonly configuredModel: string | null;
  private readonly maxOutputTokens: number;
  private readonly vectorStoreId: string | null;
  private readonly knowledgeProvider: "internal" | "openai_file_search";

  constructor(private readonly config: ConfigService) {
    this.enabled = config.get<boolean>("AVS_BOT_ENABLED", false);
    this.configuredModel = config.get<string>("OPENAI_MODEL") ?? null;
    this.maxOutputTokens = config.get<number>(
      "OPENAI_MAX_OUTPUT_TOKENS",
      1_200,
    );
    this.vectorStoreId = config.get<string>("OPENAI_VECTOR_STORE_ID") ?? null;
    this.knowledgeProvider = config.get<"internal" | "openai_file_search">(
      "AI_KNOWLEDGE_PROVIDER",
      "internal",
    );
    const apiKey = config.get<string>("OPENAI_API_KEY");
    this.client =
      this.enabled && apiKey
        ? new OpenAI({
            apiKey,
            timeout: config.get<number>("OPENAI_REQUEST_TIMEOUT_MS", 45_000),
            maxRetries: 2,
          })
        : null;
  }

  configuration() {
    return {
      enabled: this.enabled,
      configured: Boolean(this.client && this.configuredModel),
      model: this.configuredModel,
      knowledgeProvider: this.knowledgeProvider,
      vectorStoreConfigured: Boolean(this.vectorStoreId),
      api: "Responses API",
      streaming: "SSE",
    };
  }

  assertAvailable(): void {
    if (!this.enabled || !this.client || !this.configuredModel) {
      throw new ServiceUnavailableException(
        "AVS Bot is not enabled. An administrator must configure a new server-side OpenAI key and an available model.",
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
      useFileSearch?: boolean;
      fileSearchCollegeId?: string;
    },
    signal: AbortSignal,
  ): AsyncGenerator<AiProviderStreamEvent> {
    this.assertAvailable();
    const useFileSearch =
      input.useFileSearch &&
      this.knowledgeProvider === "openai_file_search" &&
      Boolean(this.vectorStoreId) &&
      Boolean(input.fileSearchCollegeId);
    const responseStream = await this.client!.responses.create(
      {
        model: this.model(input.model),
        instructions: input.instructions,
        input: input.prompt,
        max_output_tokens: Math.min(
          Math.max(input.maxOutputTokens ?? this.maxOutputTokens, 100),
          8_000,
        ),
        stream: true,
        ...(useFileSearch
          ? {
              tools: [
                {
                  type: "file_search" as const,
                  vector_store_ids: [this.vectorStoreId!],
                  max_num_results: 5,
                  filters: {
                    type: "eq" as const,
                    key: "college_id",
                    value: input.fileSearchCollegeId!,
                  },
                },
              ],
            }
          : {}),
      },
      { signal },
    );

    for await (const event of responseStream) {
      if (event.type === "response.output_text.delta") {
        yield { type: "delta", delta: event.delta };
      } else if (event.type === "response.completed") {
        yield {
          type: "completed",
          responseId: event.response.id ?? null,
          inputTokens: event.response.usage?.input_tokens ?? 0,
          outputTokens: event.response.usage?.output_tokens ?? 0,
        };
      } else if (
        event.type === "response.failed" ||
        event.type === "response.incomplete"
      ) {
        throw new ServiceUnavailableException(
          "The OpenAI response ended before completion.",
        );
      }
    }
  }

  async uploadCollegeWideKnowledge(
    file: Buffer,
    fileName: string,
    collegeId: string,
  ): Promise<{ fileId: string; status: string }> {
    this.assertAvailable();
    if (!this.vectorStoreId) {
      throw new ServiceUnavailableException(
        "The OpenAI vector store is not configured.",
      );
    }
    const uploaded = await this.client!.files.create({
      file: await toFile(file, fileName),
      purpose: "assistants",
    });
    const attached = await this.client!.vectorStores.files.createAndPoll(
      this.vectorStoreId,
      {
        file_id: uploaded.id,
        attributes: {
          college_id: collegeId,
          access_scope: "college_wide_published",
        },
      },
    );
    if (attached.status !== "completed") {
      throw new ServiceUnavailableException(
        "The knowledge provider could not process this file.",
      );
    }
    return { fileId: uploaded.id, status: attached.status };
  }

  async testConnection(): Promise<{
    ok: boolean;
    model: string | null;
    category?: string;
  }> {
    this.assertAvailable();
    try {
      await this.client!.responses.create({
        model: this.model(),
        input: "Reply with OK.",
        instructions:
          "This is an authenticated backend connectivity check. Reply only with OK.",
        max_output_tokens: 16,
      });
      return { ok: true, model: this.model() };
    } catch (error) {
      return {
        ok: false,
        model: this.configuredModel,
        category: this.errorCategory(error),
      };
    }
  }

  errorCategory(error: unknown): string {
    if (error instanceof OpenAI.APIConnectionTimeoutError) return "timeout";
    if (error instanceof OpenAI.APIConnectionError) return "connection";
    if (error instanceof OpenAI.RateLimitError) return "rate_limit";
    if (error instanceof OpenAI.AuthenticationError) return "authentication";
    if (error instanceof OpenAI.PermissionDeniedError) return "permission";
    if (error instanceof OpenAI.NotFoundError) return "model_not_available";
    if (error instanceof OpenAI.BadRequestError) return "bad_request";
    if (
      error instanceof Error &&
      (error.name === "AbortError" || /abort/i.test(error.message))
    )
      return "cancelled";
    return "provider_unavailable";
  }
}
