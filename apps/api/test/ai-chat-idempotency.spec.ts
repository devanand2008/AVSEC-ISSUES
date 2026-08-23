import type { AuthPrincipal } from "../src/common/http/request-context";
import type { PrismaService } from "../src/database/prisma.service";
import { AiChatService } from "../src/modules/ai/ai-chat.service";
import type { AiContextService } from "../src/modules/ai/ai-context.service";
import type { AiKnowledgeService } from "../src/modules/ai/ai-knowledge.service";
import type { AiProviderService } from "../src/modules/ai/ai-provider.service";
import type { AiSafetyService } from "../src/modules/ai/ai-safety.service";
import type { AiUsageService } from "../src/modules/ai/ai-usage.service";

const user: AuthPrincipal = {
  id: "user-id",
  publicId: "public-id",
  collegeId: "college-id",
  fullName: "Student",
  email: null,
  status: "ACTIVE",
  mustChangePassword: false,
  sessionId: "session-id",
  roles: ["STUDENT"],
  permissions: ["ai.use"],
  scopes: [],
};

describe("AVS Bot duplicate request protection", () => {
  it("replays a completed response for the same conversation request ID without calling OpenAI", async () => {
    const stream = jest.fn();
    const prisma = {
      aiBotSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      aiUserSetting: {
        upsert: jest.fn().mockResolvedValue({
          language: "AUTO",
          responseLength: "BALANCED",
          showSources: true,
          saveHistory: true,
          keepLocalCache: true,
          autoTitle: true,
          updatedAt: new Date(),
        }),
      },
      aiConversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: "conversation-id",
          title: "Attendance",
          status: "ACTIVE",
          lastMessageAt: new Date(),
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      aiMessage: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "user-message-id",
            createdAt: new Date("2026-07-26T10:00:00Z"),
          })
          .mockResolvedValueOnce({
            id: "assistant-message-id",
            status: "COMPLETED",
            content: "Your attendance is 82%.",
            suggestedActions: [],
            sources: [],
          }),
      },
    } as unknown as PrismaService;
    const service = new AiChatService(
      prisma,
      {
        assertAvailable: jest.fn(),
        configuration: () => ({
          provider: "openai",
          knowledgeProvider: "internal",
          vectorStoreConfigured: false,
        }),
        stream,
      } as unknown as AiProviderService,
      {} as AiContextService,
      {} as AiKnowledgeService,
      {} as AiSafetyService,
      {} as AiUsageService,
    );
    const events = [];
    for await (const event of service.chat(user, {
      conversationId: "conversation-id",
      message: "What is my attendance?",
      clientRequestId: "request-12345",
    })) {
      events.push(event);
    }

    expect(stream).not.toHaveBeenCalled();
    expect(events.map((event) => event.event)).toEqual([
      "conversation",
      "replace",
      "sources",
      "done",
    ]);
    expect(events.at(-1)?.data).toMatchObject({
      messageId: "assistant-message-id",
      replayed: true,
    });
  });

  it("propagates an already-aborted HTTP signal to the provider controller", () => {
    const service = new AiChatService(
      {} as PrismaService,
      {} as AiProviderService,
      {} as AiContextService,
      {} as AiKnowledgeService,
      {} as AiSafetyService,
      {} as AiUsageService,
    );
    const upstream = new AbortController();
    upstream.abort();
    const linked = (
      service as unknown as {
        linkedAbortController: (signal: AbortSignal) => {
          abortController: AbortController;
          disconnect: () => void;
        };
      }
    ).linkedAbortController(upstream.signal);

    expect(linked.abortController.signal.aborted).toBe(true);
  });

  it("fails closed for a stale per-college file-search setting on Gemini", async () => {
    const stream = jest.fn();
    const service = new AiChatService(
      {
        aiBotSetting: {
          findUnique: jest.fn().mockResolvedValue({
            enabled: true,
            model: null,
            maxOutputTokens: 1_200,
            knowledgeProvider: "openai_file_search",
          }),
        },
      } as unknown as PrismaService,
      {
        assertAvailable: jest.fn(),
        configuration: () => ({
          provider: "gemini",
          knowledgeProvider: "internal",
          vectorStoreConfigured: false,
        }),
        stream,
      } as unknown as AiProviderService,
      {} as AiContextService,
      {} as AiKnowledgeService,
      {} as AiSafetyService,
      {} as AiUsageService,
    );

    const consume = async () => {
      for await (const _event of service.chat(user, {
        message: "What is my attendance?",
        clientRequestId: "file-search-guard",
      })) {
        // Consume until configuration validation fails.
      }
    };
    await expect(consume()).rejects.toThrow(/file search is not available/i);
    expect(stream).not.toHaveBeenCalled();
  });
});
