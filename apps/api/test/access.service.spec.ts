import { ForbiddenException } from "@nestjs/common";
import { AccessService } from "../src/common/access/access.service";
import type { AuthPrincipal } from "../src/common/http/request-context";

function principal(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return { id: "00000000-0000-0000-0000-000000000001", publicId: "00000000-0000-0000-0000-000000000002", collegeId: "00000000-0000-0000-0000-000000000003", fullName: "Student", email: null, status: "ACTIVE", mustChangePassword: false, sessionId: "00000000-0000-0000-0000-000000000004", roles: ["STUDENT"], permissions: ["issues.read_own"], scopes: [{ type: "ASSIGNED_ISSUES", id: null, issueCategoryId: null }], ...overrides };
}

describe("AccessService", () => {
  const service = new AccessService();
  it("limits a student issue predicate to reports owned by that student", () => {
    const user = principal();
    expect(service.issueWhere(user)).toEqual({ collegeId: user.collegeId, archivedAt: null, OR: [{ reporterId: user.id }, { affectedUsers: { some: { userId: user.id } } }] });
  });
  it("allows a principal with college scope to use the college predicate", () => {
    const user = principal({ roles: ["PRINCIPAL"], permissions: ["issues.read_all"], scopes: [{ type: "COLLEGE", id: "00000000-0000-0000-0000-000000000003", issueCategoryId: null }] });
    expect(service.issueWhere(user)).toEqual({ collegeId: user.collegeId, archivedAt: null });
  });
  it("unions scopes inside one dimension and intersects distinct dimensions", () => {
    const user = principal({
      permissions: ["issues.read_scope"],
      scopes: [
        { type: "BLOCK", id: "00000000-0000-0000-0000-000000000010", issueCategoryId: null },
        { type: "ROOM", id: "00000000-0000-0000-0000-000000000011", issueCategoryId: null },
        { type: "ISSUE_CATEGORY", id: null, issueCategoryId: "00000000-0000-0000-0000-000000000020" },
        { type: "ISSUE_CATEGORY", id: null, issueCategoryId: "00000000-0000-0000-0000-000000000021" },
      ],
    });
    expect(service.issueWhere(user)).toEqual({
      collegeId: user.collegeId,
      archivedAt: null,
      OR: [{
        AND: [
          { OR: [{ blockId: "00000000-0000-0000-0000-000000000010" }, { roomId: "00000000-0000-0000-0000-000000000011" }] },
          { OR: [{ categoryId: "00000000-0000-0000-0000-000000000020" }, { categoryId: "00000000-0000-0000-0000-000000000021" }] },
        ],
      }],
    });
  });
  it("treats college as the broad location scope while retaining category restrictions", () => {
    const categoryId = "00000000-0000-0000-0000-000000000020";
    const user = principal({
      permissions: ["issues.read_scope"],
      scopes: [
        { type: "COLLEGE", id: "00000000-0000-0000-0000-000000000003", issueCategoryId: null },
        { type: "ROOM", id: "00000000-0000-0000-0000-000000000011", issueCategoryId: null },
        { type: "ISSUE_CATEGORY", id: null, issueCategoryId: categoryId },
      ],
    });
    expect(service.issueWhere(user)).toEqual({ collegeId: user.collegeId, archivedAt: null, OR: [{ AND: [{ OR: [{ categoryId }] }] }] });
  });
  it("honors ASSIGNED_ISSUES as a scoped dimension", () => {
    const user = principal({ permissions: ["issues.read_scope"], scopes: [{ type: "ASSIGNED_ISSUES", id: null, issueCategoryId: null }] });
    expect(service.issueWhere(user)).toEqual({
      collegeId: user.collegeId,
      archivedAt: null,
      OR: [{ AND: [{ OR: [{ assignedToId: user.id }, { team: { members: { some: { userId: user.id, isActive: true } } } }] }] }],
    });
  });
  it("keeps ownership and assignment relationships as independent access branches", () => {
    const user = principal({ permissions: ["issues.read_own", "issues.read_assigned"], scopes: [] });
    expect(service.issueWhere(user)).toEqual({
      collegeId: user.collegeId,
      archivedAt: null,
      OR: [
        { reporterId: user.id },
        { affectedUsers: { some: { userId: user.id } } },
        { assignedToId: user.id },
        { team: { members: { some: { userId: user.id, isActive: true } } } },
      ],
    });
  });
  it("rejects a missing permission", () => {
    expect(() => service.requirePermission(principal(), "issues.assign")).toThrow(ForbiddenException);
  });
});
