import type { AuthPrincipal } from "../src/common/http/request-context";
import { ConversationsService } from "../src/modules/conversations/conversations.service";

describe("ConversationsService contact authorization", () => {
  const user: AuthPrincipal = {
    id: "00000000-0000-0000-0000-000000000001",
    publicId: "00000000-0000-0000-0000-000000000002",
    collegeId: "00000000-0000-0000-0000-000000000003",
    fullName: "Student",
    email: null,
    status: "ACTIVE",
    mustChangePassword: false,
    sessionId: "00000000-0000-0000-0000-000000000004",
    roles: ["STUDENT"],
    permissions: ["conversations.create_direct"],
    scopes: [{ type: "SECTION", id: "00000000-0000-0000-0000-000000000005", issueCategoryId: null }],
  };

  it("uses the same visibility predicate for contact discovery and direct creation", async () => {
    const ownProfile = {
      studentProfile: { sectionId: "00000000-0000-0000-0000-000000000005", departmentId: "00000000-0000-0000-0000-000000000006" },
      staffProfile: null,
      responsibleMemberships: [],
    };
    const target = { id: "00000000-0000-0000-0000-000000000007", publicId: "00000000-0000-0000-0000-000000000008" };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(ownProfile),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(target),
      },
      conversation: { upsert: jest.fn().mockResolvedValue({ id: "00000000-0000-0000-0000-000000000009" }) },
    };
    const service = new ConversationsService(prisma as never, {} as never, {} as never, {} as never);

    await service.contacts(user, "target");
    await service.createDirect(user, { participantPublicId: target.publicId });

    const contactsWhere = prisma.user.findMany.mock.calls[0]?.[0].where as { AND: unknown[] };
    const directWhere = prisma.user.findFirst.mock.calls[0]?.[0].where as { AND: unknown[] };
    expect(directWhere.AND[0]).toEqual(contactsWhere.AND[0]);
    expect(directWhere.AND[1]).toEqual({ publicId: target.publicId });
  });
});
