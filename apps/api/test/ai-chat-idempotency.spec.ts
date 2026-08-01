import type { AuthPrincipal } from "../src/common/http/request-context";
import type { PrismaService } from "../src/database/prisma.service";
import { AiChatService } from "../src/modules/ai/ai-chat.service";
import type { AiContextService } from "../src/modules/ai/ai-context.service";
import type { AiKnowledgeService } from "../src/modules/ai/ai-knowledge.service";
import type { AiSafetyService } from "../src/modules/ai/ai-safety.service";
import type { AiUsageService } from "../src/modules/ai/ai-usage.service";
import type { OpenAiService } from "../src/modules/ai/openai.service";

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
        stream,
      } as unknown as OpenAiService,
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
});

