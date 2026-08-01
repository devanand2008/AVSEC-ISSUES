import {
  BadRequestException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { UpdateAiBotSettingDto } from "./dto/ai.dto";
import { AiUsageService } from "./ai-usage.service";
import { OpenAiService } from "./openai.service";

@Injectable()
export class AiAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly openai: OpenAiService,
    private readonly usage: AiUsageService,
    private readonly audit: AuditService,
  ) {}

  async settings(collegeId: string) {
    const stored = await this.prisma.aiBotSetting.findUnique({
      where: { collegeId },
      select: {
        id: true,
        enabled: true,
        model: true,
        maxOutputTokens: true,
        dailyRoleLimits: true,
        monthlyBudget: true,
        knowledgeProvider: true,
        allowedDocumentTypes: true,
        retentionDays: true,
        safetyContactName: true,
        safetyContactRoute: true,
        toolPermissions: true,
        lastSuccessAt: true,
        lastErrorCategory: true,
        updatedAt: true,
      },
    });
    return {
      stored,
      effective: {
        enabled:
          stored?.enabled ??
          this.config.get<boolean>("AVS_BOT_ENABLED", false),
        model:
          stored?.model ?? this.config.get<string>("OPENAI_MODEL") ?? null,
        maxOutputTokens:
          stored?.maxOutputTokens ??
          this.config.get<number>("OPENAI_MAX_OUTPUT_TOKENS", 1_200),
        dailyUserLimit: this.config.get<number>(
          "OPENAI_DAILY_USER_LIMIT",
          50,
        ),
        monthlyBudget:
          stored?.monthlyBudget?.toString() ??
          this.config.get<number>("OPENAI_MONTHLY_BUDGET_USD") ??
          null,
        knowledgeProvider:
          stored?.knowledgeProvider ??
          this.config.get<string>("AI_KNOWLEDGE_PROVIDER", "internal"),
        pricingConfigured: this.usage.pricingConfigured(),
      },
      provider: this.openai.configuration(),
      secrets: {
        apiKeyPresent: Boolean(this.config.get<string>("OPENAI_API_KEY")),
        apiKeyExposed: false,
      },
    };
  }

  async updateSettings(
    user: AuthPrincipal,
    input: UpdateAiBotSettingDto,
    requestId: string,
  ) {
    if (input.enabled && !this.openai.configuration().configured) {
      throw new BadRequestException(
        "Configure a new server-side OpenAI key and an available model before enabling AVS Bot.",
      );
    }
    if (
      input.knowledgeProvider === "openai_file_search" &&
      !this.openai.configuration().vectorStoreConfigured
    ) {
      throw new BadRequestException(
        "Configure OPENAI_VECTOR_STORE_ID before selecting OpenAI file search.",
      );
    }
    const before = await this.prisma.aiBotSetting.findUnique({
      where: { collegeId: user.collegeId },
    });
    const setting = await this.prisma.aiBotSetting.upsert({
      where: { collegeId: user.collegeId },
      create: {
        collegeId: user.collegeId,
        updatedById: user.id,
        ...input,
      },
      update: { ...input, updatedById: user.id },
      select: {
        id: true,
        enabled: true,
        model: true,
        maxOutputTokens: true,
        dailyRoleLimits: true,
        monthlyBudget: true,
        knowledgeProvider: true,
        allowedDocumentTypes: true,
        retentionDays: true,
        safetyContactName: true,
        safetyContactRoute: true,
        lastSuccessAt: true,
        lastErrorCategory: true,
        updatedAt: true,
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: "ai.settings.updated",
      entityType: "AiBotSetting",
      entityId: setting.id,
      beforeValue: this.safeSetting(before),
      afterValue: setting,
      requestId,
    });
    return setting;
  }

  async testConnection(user: AuthPrincipal, requestId: string) {
    const result = await this.openai.testConnection();
    await this.prisma.aiBotSetting.updateMany({
      where: { collegeId: user.collegeId },
      data: result.ok
        ? { lastSuccessAt: new Date(), lastErrorCategory: null }
        : { lastErrorCategory: result.category },
    });
    await this.audit.record({
      actorId: user.id,
      action: "ai.connection.tested",
      entityType: "AiBotSetting",
      afterValue: result,
      requestId,
    });
    return result;
  }

  async dashboard(user: AuthPrincipal) {
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - 30);
    const [usage, documents, feedback, safety] = await Promise.all([
      this.usage.summary(user.collegeId, {
        from: from.toISOString(),
        to: new Date().toISOString(),
      }),
      this.prisma.aiKnowledgeDocument.groupBy({
        by: ["status", "source"],
        where: { collegeId: user.collegeId },
        _count: { _all: true },
      }),
      this.prisma.aiFeedback.groupBy({
        by: ["rating"],
        where: {
          message: { conversation: { collegeId: user.collegeId } },
        },
        _count: { _all: true },
      }),
      this.prisma.aiSafetyEvent.groupBy({
        by: ["category", "severity"],
        where: { collegeId: user.collegeId, createdAt: { gte: from } },
        _count: { _all: true },
      }),
    ]);
    return {
      usage,
      knowledge: documents,
      feedback,
      safety,
      provider: this.openai.configuration(),
    };
  }

  async safetyEvents(user: AuthPrincipal) {
    return this.prisma.aiSafetyEvent.findMany({
      where: { collegeId: user.collegeId },
      select: {
        id: true,
        category: true,
        severity: true,
        requestId: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 250,
    });
  }

  private safeSetting(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    const {
      id,
      collegeId,
      updatedById,
      ...safe
    } = value as Record<string, unknown>;
    void id;
    void collegeId;
    void updatedById;
    return safe;
  }
}

