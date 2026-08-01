import { Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";

interface SafetyAssessment {
  blocked: boolean;
  category: string | null;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  safeResponse: string | null;
}

const BLOCK_RULES: Array<{
  category: string;
  severity: SafetyAssessment["severity"];
  pattern: RegExp;
}> = [
  {
    category: "prompt_injection",
    severity: "HIGH",
    pattern:
      /\b(ignore|forget|override|bypass)\b.{0,80}\b(previous|system|developer|security|instructions?|rules?)\b/is,
  },
  {
    category: "prompt_exfiltration",
    severity: "HIGH",
    pattern:
      /\b(reveal|show|print|repeat|dump|translate)\b.{0,80}\b(system prompt|developer message|hidden instructions?|chain of thought|internal reasoning)\b/is,
  },
  {
    category: "credential_theft",
    severity: "CRITICAL",
    pattern:
      /\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|private key|cookie)\b.{0,100}\b(reveal|steal|extract|dump|send|show|give)\b/is,
  },
  {
    category: "data_exfiltration",
    severity: "CRITICAL",
    pattern:
      /(?:\b(show|list|dump|reveal|extract|give)\b.{0,100}\b(all users?|another (student|staff|user)|database dump|export private|personal data|phone numbers?|email addresses?)\b|\b(all users?|another (student|staff|user)|database dump|export private|personal data|phone numbers?|email addresses?)\b.{0,100}\b(show|list|dump|reveal|extract|give)\b)/is,
  },
  {
    category: "impersonation",
    severity: "HIGH",
    pattern:
      /\b(impersonate|pretend to be|login as|act as)\b.{0,80}\b(admin|principal|hod|faculty|student|staff)\b/is,
  },
  {
    category: "unsafe_execution",
    severity: "HIGH",
    pattern:
      /\b(drop table|truncate table|delete from|update users set|powershell -enc|curl.+token|reverse shell|credential harvester)\b/is,
  },
];

const EMERGENCY_PATTERN =
  /\b(suicide|kill myself|self[- ]?harm|immediate danger|weapon|bomb|medical emergency)\b|தற்கொலை|உடனடி ஆபத்து/iu;

@Injectable()
export class AiSafetyService {
  constructor(private readonly prisma: PrismaService) {}

  assess(message: string): SafetyAssessment {
    if (EMERGENCY_PATTERN.test(message)) {
      return {
        blocked: true,
        category: "safeguarding_emergency",
        severity: "CRITICAL",
        safeResponse:
          "I’m sorry you’re dealing with this. If anyone is in immediate danger, contact local emergency services now and alert an authorised campus staff member, security officer, counsellor, or trusted person nearby. AVS Bot cannot manage an emergency.",
      };
    }
    for (const rule of BLOCK_RULES) {
      if (rule.pattern.test(message)) {
        return {
          blocked: true,
          category: rule.category,
          severity: rule.severity,
          safeResponse:
            "I can’t help reveal protected instructions, credentials, private data, or bypass access controls. I can still help with information available to your authorised AVS role.",
        };
      }
    }
    return {
      blocked: false,
      category: null,
      severity: "LOW",
      safeResponse: null,
    };
  }

  async record(
    user: AuthPrincipal,
    assessment: SafetyAssessment,
    options: {
      requestId?: string;
      messageId?: string;
      messageLength: number;
    },
  ): Promise<void> {
    if (!assessment.category) return;
    await this.prisma.aiSafetyEvent.create({
      data: {
        collegeId: user.collegeId,
        userId: user.id,
        messageId: options.messageId,
        category: assessment.category,
        severity: assessment.severity,
        requestId: options.requestId,
        metadata: {
          blocked: assessment.blocked,
          messageLength: options.messageLength,
        },
      },
    });
  }

  postFilter(value: string): { content: string; changed: boolean } {
    let content = value;
    const replacements: Array<[RegExp, string]> = [
      [/\bsk-(?:proj-)?[a-zA-Z0-9_-]{20,}\b/g, "[protected credential]"],
      [
        /\b(?:Bearer\s+)[a-zA-Z0-9._~+/-]{20,}=*\b/gi,
        "[protected credential]",
      ],
      [
        /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g,
        "[protected private key]",
      ],
      [
        /\b(?:my|the) (?:system prompt|developer instructions?|chain of thought|internal reasoning) (?:is|are|says?)\b[\s\S]*/gi,
        "I can’t provide hidden instructions or internal reasoning.",
      ],
    ];
    for (const [pattern, replacement] of replacements) {
      content = content.replace(pattern, replacement);
    }
    return { content: content.trim(), changed: content.trim() !== value.trim() };
  }
}
