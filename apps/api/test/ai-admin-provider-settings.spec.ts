import type { ConfigService } from "@nestjs/config";
import type { AuthPrincipal } from "../src/common/http/request-context";
import type { PrismaService } from "../src/database/prisma.service";
import { AiAdminService } from "../src/modules/ai/ai-admin.service";
import type { AiProviderService } from "../src/modules/ai/ai-provider.service";
import type { AiUsageService } from "../src/modules/ai/ai-usage.service";
import type { AuditService } from "../src/modules/audit/audit.service";

const user = {
  id: "user-id",
  collegeId: "college-id",
} as AuthPrincipal;

describe("AVS Bot admin provider settings", () => {
  it("rejects per-college OpenAI file search when Gemini is primary", async () => {
    const service = new AiAdminService(
      {} as PrismaService,
      {} as ConfigService,
      {
        configuration: () => ({
          configured: true,
          provider: "gemini",
          knowledgeProvider: "internal",
          vectorStoreConfigured: true,
        }),
      } as AiProviderService,
      {} as AiUsageService,
      {} as AuditService,
    );

    await expect(
      service.updateSettings(
        user,
        { knowledgeProvider: "openai_file_search" },
        "request-id",
      ),
    ).rejects.toThrow(/configure OpenAI as the primary provider/i);
  });
});
