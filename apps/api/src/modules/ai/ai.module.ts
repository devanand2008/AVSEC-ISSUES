import { Module } from "@nestjs/common";
import { AccessModule } from "../../common/access/access.module";
import { AuditModule } from "../audit/audit.module";
import { StorageModule } from "../storage/storage.module";
import { AiAdminController } from "./ai-admin.controller";
import { AiAdminService } from "./ai-admin.service";
import { AiChatService } from "./ai-chat.service";
import { AiContextService } from "./ai-context.service";
import { AiController } from "./ai.controller";
import { AiKnowledgeService } from "./ai-knowledge.service";
import { AiProviderService } from "./ai-provider.service";
import { AiSafetyService } from "./ai-safety.service";
import { AiUsageService } from "./ai-usage.service";
import { GeminiService } from "./gemini.service";
import { OpenAiService } from "./openai.service";

@Module({
  imports: [AccessModule, AuditModule, StorageModule],
  controllers: [AiController, AiAdminController],
  providers: [
    OpenAiService,
    GeminiService,
    AiProviderService,
    AiSafetyService,
    AiUsageService,
    AiContextService,
    AiKnowledgeService,
    AiChatService,
    AiAdminService,
  ],
  exports: [AiChatService],
})
export class AiModule {}
