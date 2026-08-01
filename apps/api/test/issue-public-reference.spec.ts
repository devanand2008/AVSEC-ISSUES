import { NotFoundException } from "@nestjs/common";
import { IssuesService } from "../src/modules/issues/issues.service";

const user = { collegeId: "10000000-0000-4000-8000-000000000001" };

describe("public issue reference resolution", () => {
  it("preserves legacy UUID references without a database lookup", async () => {
    const prisma = { issue: { findFirst: jest.fn() } };
    const service = Object.create(IssuesService.prototype) as IssuesService;
    Object.assign(service, { prisma });

    await expect((service as unknown as { resolveIssueReference(u: typeof user, ref: string): Promise<string> }).resolveIssueReference(
      user,
      "20000000-0000-4000-8000-000000000002",
    )).resolves.toBe("20000000-0000-4000-8000-000000000002");
    expect(prisma.issue.findFirst).not.toHaveBeenCalled();
  });

  it("resolves an AVS issue number only inside the authenticated college", async () => {
    const prisma = { issue: { findFirst: jest.fn().mockResolvedValue({ id: "20000000-0000-4000-8000-000000000002" }) } };
    const service = Object.create(IssuesService.prototype) as IssuesService;
    Object.assign(service, { prisma });

    await expect((service as unknown as { resolveIssueReference(u: typeof user, ref: string): Promise<string> }).resolveIssueReference(
      user,
      "AVS-ISS-2026-000123",
    )).resolves.toBe("20000000-0000-4000-8000-000000000002");
    expect(prisma.issue.findFirst).toHaveBeenCalledWith({
      where: { issueNumber: "AVS-ISS-2026-000123", collegeId: user.collegeId },
      select: { id: true },
    });
  });

  it("rejects malformed public references before querying", async () => {
    const prisma = { issue: { findFirst: jest.fn() } };
    const service = Object.create(IssuesService.prototype) as IssuesService;
    Object.assign(service, { prisma });

    await expect((service as unknown as { resolveIssueReference(u: typeof user, ref: string): Promise<string> }).resolveIssueReference(
      user,
      "../another-college",
    )).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.issue.findFirst).not.toHaveBeenCalled();
  });
});
