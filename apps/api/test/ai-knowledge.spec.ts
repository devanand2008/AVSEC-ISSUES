import type { AuthPrincipal } from "../src/common/http/request-context";
import type { PrismaService } from "../src/database/prisma.service";
import { AiKnowledgeService } from "../src/modules/ai/ai-knowledge.service";
import type { OpenAiService } from "../src/modules/ai/openai.service";
import type { StorageService } from "../src/modules/storage/storage.service";
import type { ConfigService } from "@nestjs/config";

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

describe("AVS Bot knowledge metadata filtering", () => {
  it("applies college, role, department, programme and semester filters before reading chunks", async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        content: "The published attendance policy applies to this semester.",
        document: {
          id: "document-id",
          title: "Attendance Policy",
          category: "POLICY",
          version: "2",
          publishedAt: new Date("2026-07-01T00:00:00Z"),
        },
      },
    ]);
    const service = new AiKnowledgeService(
      {
        studentProfile: {
          findUnique: jest.fn().mockResolvedValue({
            departmentId: "department-id",
            programmeId: "programme-id",
            section: {
              semesterId: "semester-id",
              semester: { academicYear: { name: "2026-27" } },
            },
          }),
        },
        staffProfile: { findUnique: jest.fn().mockResolvedValue(null) },
        facultySubjectAssignment: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        aiKnowledgeChunk: { findMany },
      } as unknown as PrismaService,
      {} as StorageService,
      { get: jest.fn().mockReturnValue("internal") } as unknown as ConfigService,
      {} as OpenAiService,
    );

    const sources = await service.retrieve(user, "attendance policy");

    const documentWhere = findMany.mock.calls[0]?.[0].where.document;
    expect(documentWhere).toMatchObject({
      collegeId: user.collegeId,
      status: "PUBLISHED",
      archivedAt: null,
      OR: [
        { roleVisibility: { isEmpty: true } },
        { roleVisibility: { hasSome: ["STUDENT"] } },
      ],
    });
    expect(JSON.stringify(documentWhere)).toContain("department-id");
    expect(JSON.stringify(documentWhere)).toContain("programme-id");
    expect(JSON.stringify(documentWhere)).toContain("semester-id");
    expect(sources[0]).toMatchObject({
      title: "Attendance Policy",
      category: "POLICY",
    });
  });

  it("returns no knowledge when the query has no searchable terms", async () => {
    const service = new AiKnowledgeService(
      {} as PrismaService,
      {} as StorageService,
      {} as ConfigService,
      {} as OpenAiService,
    );
    await expect(service.retrieve(user, "a to is")).resolves.toEqual([]);
  });
});

