import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { StorageService } from "../storage/storage.service";
import type {
  CreateManualAiKnowledgeDto,
  UploadAiKnowledgeDto,
} from "./dto/ai.dto";
import type { AiSafeSource } from "./ai.types";
import { OpenAiService } from "./openai.service";

const DOCUMENT_INJECTION =
  /\b(ignore|override|bypass)\b.{0,80}\b(system|developer|previous instructions?|security rules?)\b/is;

@Injectable()
export class AiKnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly openai: OpenAiService,
  ) {}

  async upload(
    user: AuthPrincipal,
    input: UploadAiKnowledgeDto,
    file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException("A knowledge file is required.");
    await this.validateScope(user, input);
    const text = await this.extract(file);
    this.validateExtractedText(text);
    const duplicate = await this.prisma.aiKnowledgeDocument.findFirst({
      where: {
        collegeId: user.collegeId,
        sha256: this.sha256(file.buffer),
        status: { not: "ARCHIVED" },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException(
        "This knowledge file is already present in the active library.",
      );
    }
    const stored = await this.storage.storeAiKnowledgeFile(user, file);
    let providerFileId: string | null = null;
    let source: "UPLOAD" | "OPENAI_FILE_SEARCH" = "UPLOAD";
    try {
      if (
        this.config.get<string>("AI_KNOWLEDGE_PROVIDER", "internal") ===
        "openai_file_search"
      ) {
        if (
          input.departmentId ||
          input.programmeId ||
          input.semesterId ||
          (input.roleVisibility?.length ?? 0) > 0
        ) {
          throw new BadRequestException(
            "OpenAI file search accepts only college-wide documents in this installation. Use the internal provider for role, department, programme, or semester scoped knowledge.",
          );
        }
        const provider = await this.openai.uploadCollegeWideKnowledge(
          file.buffer,
          stored.originalName,
          user.collegeId,
        );
        providerFileId = provider.fileId;
        source = "OPENAI_FILE_SEARCH";
      }
      return await this.createPublishedDocument(user, input, text, {
        source,
        storageKey: stored.storageKey,
        providerFileId,
        mimeType: file.mimetype,
        sizeBytes: BigInt(file.size),
        sha256: stored.sha256,
      });
    } catch (error) {
      await this.storage.deleteMaintenanceObjects([stored.storageKey]);
      throw error;
    }
  }

  async createManual(
    user: AuthPrincipal,
    input: CreateManualAiKnowledgeDto,
  ) {
    await this.validateScope(user, input);
    this.validateExtractedText(input.content);
    return this.createPublishedDocument(user, input, input.content, {
      source: "MANUAL",
      storageKey: null,
      providerFileId: null,
      mimeType: "text/plain",
      sizeBytes: BigInt(Buffer.byteLength(input.content, "utf8")),
      sha256: this.sha256(Buffer.from(input.content, "utf8")),
    });
  }

  async list(user: AuthPrincipal, includeArchived = false) {
    const documents = await this.prisma.aiKnowledgeDocument.findMany({
      where: {
        collegeId: user.collegeId,
        ...(includeArchived ? {} : { status: { not: "ARCHIVED" } }),
      },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        departmentId: true,
        programmeId: true,
        semesterId: true,
        roleVisibility: true,
        academicYear: true,
        source: true,
        version: true,
        status: true,
        mimeType: true,
        sizeBytes: true,
        publishedAt: true,
        archivedAt: true,
        failureCategory: true,
        createdAt: true,
        _count: { select: { chunks: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    return documents.map((document) => ({
      ...document,
      sizeBytes: document.sizeBytes?.toString() ?? null,
    }));
  }

  async archive(user: AuthPrincipal, documentId: string) {
    const result = await this.prisma.aiKnowledgeDocument.updateMany({
      where: {
        id: documentId,
        collegeId: user.collegeId,
        status: { not: "ARCHIVED" },
      },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException("Knowledge document not found.");
    return { id: documentId, status: "ARCHIVED" };
  }

  async retrieve(
    user: AuthPrincipal,
    query: string,
  ): Promise<AiSafeSource[]> {
    const terms = [
      ...new Set(
        query
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, " ")
          .split(/\s+/)
          .filter((term) => term.length >= 3),
      ),
    ].slice(0, 10);
    if (!terms.length) return [];
    const scope = await this.knowledgeScope(user);
    const chunks = await this.prisma.aiKnowledgeChunk.findMany({
      where: {
        document: scope,
        OR: terms.map((term) => ({
          content: { contains: term, mode: "insensitive" },
        })),
      },
      select: {
        content: true,
        document: {
          select: {
            id: true,
            title: true,
            category: true,
            version: true,
            publishedAt: true,
          },
        },
      },
      take: 80,
    });
    const scored = chunks
      .map((chunk) => {
        const haystack =
          `${chunk.document.title} ${chunk.document.category} ${chunk.content}`.toLowerCase();
        const score = terms.reduce(
          (total, term) => total + (haystack.includes(term) ? 1 : 0),
          0,
        );
        return { chunk, score };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    const seen = new Set<string>();
    const results: AiSafeSource[] = [];
    for (const { chunk } of scored) {
      if (seen.has(chunk.document.id)) continue;
      seen.add(chunk.document.id);
      results.push({
        documentId: chunk.document.id,
        title: chunk.document.title,
        category: chunk.document.category,
        version: chunk.document.version,
        publishedAt: chunk.document.publishedAt,
        openRoute: null,
        excerpt: chunk.content.slice(0, 1_800),
      });
      if (results.length >= 5) break;
    }
    return results;
  }

  private async createPublishedDocument(
    user: AuthPrincipal,
    input: UploadAiKnowledgeDto,
    text: string,
    file: {
      source: "UPLOAD" | "MANUAL" | "OPENAI_FILE_SEARCH";
      storageKey: string | null;
      providerFileId: string | null;
      mimeType: string;
      sizeBytes: bigint;
      sha256: string;
    },
  ) {
    const chunks = this.chunk(text);
    const document = await this.prisma.aiKnowledgeDocument.create({
      data: {
        collegeId: user.collegeId,
        title: input.title,
        description: input.description || null,
        category: input.category,
        departmentId: input.departmentId,
        programmeId: input.programmeId,
        semesterId: input.semesterId,
        roleVisibility: input.roleVisibility ?? [],
        academicYear: input.academicYear || null,
        source: file.source,
        version: input.version || "1",
        status: "PUBLISHED",
        storageKey: file.storageKey,
        providerFileId: file.providerFileId,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        uploadedById: user.id,
        publishedAt: new Date(),
        chunks: {
          create: chunks.map((content, chunkIndex) => ({
            content,
            chunkIndex,
            tokenCount: Math.ceil(content.length / 4),
            metadata: {
              category: input.category,
              version: input.version || "1",
            },
          })),
        },
      },
      select: {
        id: true,
        title: true,
        category: true,
        version: true,
        status: true,
        source: true,
        publishedAt: true,
        _count: { select: { chunks: true } },
      },
    });
    return document;
  }

  private async knowledgeScope(user: AuthPrincipal) {
    const [student, staff, assignments] = await Promise.all([
      this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
        select: {
          departmentId: true,
          programmeId: true,
          section: {
            select: {
              semesterId: true,
              semester: {
                select: { academicYear: { select: { name: true } } },
              },
            },
          },
        },
      }),
      this.prisma.staffProfile.findUnique({
        where: { userId: user.id },
        select: { departmentId: true },
      }),
      this.prisma.facultySubjectAssignment.findMany({
        where: {
          facultyId: user.id,
          isActive: true,
          OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
        },
        select: {
          subject: {
            select: {
              semesterId: true,
              semester: { select: { programmeId: true } },
            },
          },
        },
      }),
    ]);
    const leadership = user.roles.some((role) =>
      ["SUPER_ADMIN", "MAIN_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"].includes(
        role,
      ),
    );
    const semesterIds = [
      ...new Set(
        [
          student?.section.semesterId,
          ...assignments.map((item) => item.subject.semesterId),
        ].filter((value): value is string => Boolean(value)),
      ),
    ];
    const programmeIds = [
      ...new Set(
        [
          student?.programmeId,
          ...assignments.map((item) => item.subject.semester.programmeId),
        ].filter((value): value is string => Boolean(value)),
      ),
    ];
    const departmentId =
      student?.departmentId ?? staff?.departmentId ?? undefined;
    return {
      collegeId: user.collegeId,
      status: "PUBLISHED" as const,
      archivedAt: null,
      OR: [
        { roleVisibility: { isEmpty: true } },
        { roleVisibility: { hasSome: user.roles } },
      ],
      ...(leadership
        ? {}
        : {
            AND: [
              {
                OR: [
                  { departmentId: null },
                  ...(departmentId ? [{ departmentId }] : []),
                ],
              },
              {
                OR: [
                  { programmeId: null },
                  ...(programmeIds.length
                    ? [{ programmeId: { in: programmeIds } }]
                    : []),
                ],
              },
              {
                OR: [
                  { semesterId: null },
                  ...(semesterIds.length
                    ? [{ semesterId: { in: semesterIds } }]
                    : []),
                ],
              },
              {
                OR: [
                  { academicYear: null },
                  ...(student?.section.semester.academicYear.name
                    ? [
                        {
                          academicYear:
                            student.section.semester.academicYear.name,
                        },
                      ]
                    : []),
                ],
              },
            ],
          }),
    };
  }

  private async validateScope(
    user: AuthPrincipal,
    input: UploadAiKnowledgeDto,
  ): Promise<void> {
    if (input.roleVisibility?.length) {
      const roles = await this.prisma.role.count({
        where: {
          collegeId: user.collegeId,
          code: { in: [...new Set(input.roleVisibility)] },
          isActive: true,
        },
      });
      if (roles !== new Set(input.roleVisibility).size) {
        throw new BadRequestException(
          "One or more knowledge role codes are invalid for this college.",
        );
      }
    }
    if (input.departmentId) {
      const department = await this.prisma.department.findFirst({
        where: {
          id: input.departmentId,
          collegeId: user.collegeId,
          archivedAt: null,
        },
        select: { id: true },
      });
      if (!department)
        throw new BadRequestException("Knowledge department is invalid.");
    }
    if (input.programmeId) {
      const programme = await this.prisma.programme.findFirst({
        where: {
          id: input.programmeId,
          collegeId: user.collegeId,
          ...(input.departmentId
            ? { departmentId: input.departmentId }
            : {}),
          isActive: true,
        },
        select: { id: true },
      });
      if (!programme)
        throw new BadRequestException("Knowledge programme is invalid.");
    }
    if (input.semesterId) {
      const semester = await this.prisma.semester.findFirst({
        where: {
          id: input.semesterId,
          ...(input.programmeId
            ? { programmeId: input.programmeId }
            : {
                programme: {
                  collegeId: user.collegeId,
                  ...(input.departmentId
                    ? { departmentId: input.departmentId }
                    : {}),
                },
              }),
          isActive: true,
        },
        select: { id: true },
      });
      if (!semester)
        throw new BadRequestException("Knowledge semester is invalid.");
    }
  }

  private async extract(file: Express.Multer.File): Promise<string> {
    const extension = extname(file.originalname).toLowerCase();
    if (extension === ".pdf") {
      const parser = new PDFParse({ data: file.buffer });
      try {
        return (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    }
    if (extension === ".docx") {
      return (await mammoth.extractRawText({ buffer: file.buffer })).value;
    }
    const value = file.buffer.toString("utf8");
    if (extension === ".html" || extension === ".htm") {
      return value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#39;/gi, "'")
        .replace(/&quot;/gi, '"');
    }
    return value;
  }

  private validateExtractedText(value: string): void {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length < 20) {
      throw new BadRequestException(
        "The knowledge document does not contain enough readable text.",
      );
    }
    if (normalized.length > 1_000_000) {
      throw new BadRequestException(
        "The extracted knowledge text is too large.",
      );
    }
    if (DOCUMENT_INJECTION.test(normalized)) {
      throw new BadRequestException(
        "The document contains instruction-like content that is not safe for the knowledge library.",
      );
    }
  }

  private chunk(value: string): string[] {
    const normalized = value
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const chunks: string[] = [];
    const max = 1_800;
    const overlap = 180;
    for (let start = 0; start < normalized.length && chunks.length < 600; ) {
      let end = Math.min(start + max, normalized.length);
      if (end < normalized.length) {
        const boundary = Math.max(
          normalized.lastIndexOf("\n", end),
          normalized.lastIndexOf(". ", end),
        );
        if (boundary > start + 900) end = boundary + 1;
      }
      const content = normalized.slice(start, end).trim();
      if (content) chunks.push(content);
      if (end >= normalized.length) break;
      start = Math.max(end - overlap, start + 1);
    }
    if (!chunks.length) {
      throw new BadRequestException(
        "The knowledge document could not be chunked.",
      );
    }
    return chunks;
  }

  private sha256(value: Buffer): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
