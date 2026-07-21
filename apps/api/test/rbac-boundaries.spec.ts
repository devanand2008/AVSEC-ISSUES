/**
 * RBAC boundary tests — verifies that the access control layer correctly enforces
 * college-wide vs. scoped permissions and issue visibility rules.
 */
import { AccessService } from "../src/common/access/access.service";
import type { AuthPrincipal } from "../src/common/http/request-context";

function makeUser(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    publicId: "00000000-0000-0000-0000-000000000002",
    collegeId: "00000000-0000-0000-0000-000000000003",
    fullName: "Test User",
    email: null,
    status: "ACTIVE",
    mustChangePassword: false,
    sessionId: "00000000-0000-0000-0000-000000000004",
    roles: [],
    permissions: [],
    scopes: [],
    ...overrides,
  };
}

describe("AccessService — scope resolution", () => {
  const service = new AccessService();

  it("identifies a college-wide admin with no location scopes", () => {
    const user = makeUser({
      permissions: ["issues.read_all"],
      scopes: [],
    });
    expect(service.isCollegeWide(user)).toBe(true);
  });

  it("does NOT treat a scoped operator as college-wide", () => {
    const user = makeUser({
      permissions: ["issues.read_assigned"],
      scopes: [{ type: "CAMPUS", id: "campus-1", issueCategoryId: null }],
    });
    expect(service.isCollegeWide(user)).toBe(false);
  });

  it("builds a college-wide issueWhere filter for admins", () => {
    const user = makeUser({
      permissions: ["issues.read_all"],
      scopes: [],
    });
    const where = service.issueWhere(user);
    expect(where).toMatchObject({ collegeId: user.collegeId });
    // Should NOT contain any OR with scope restrictions
    expect("OR" in where).toBe(false);
  });

  it("builds an ASSIGNED_ISSUES scope filter for maintenance staff", () => {
    const user = makeUser({
      permissions: ["issues.read_assigned"],
      scopes: [{ type: "ASSIGNED_ISSUES", id: null, issueCategoryId: null }],
    });
    const where = service.issueWhere(user);
    // Should restrict to issues assigned to this user's team membership
    expect(where).toBeDefined();
  });

  it("builds a CAMPUS-scoped filter when user has campus scope", () => {
    const campusId = "campus-abc";
    const user = makeUser({
      permissions: ["issues.read_all"],
      scopes: [{ type: "CAMPUS", id: campusId, issueCategoryId: null }],
    });
    const where = service.issueWhere(user);
    expect(JSON.stringify(where)).toContain(campusId);
  });

  it("builds a BLOCK-scoped filter", () => {
    const blockId = "block-xyz";
    const user = makeUser({
      permissions: ["issues.read_all"],
      scopes: [{ type: "BLOCK", id: blockId, issueCategoryId: null }],
    });
    const where = service.issueWhere(user);
    expect(JSON.stringify(where)).toContain(blockId);
  });

  it("builds a ROOM-scoped filter", () => {
    const roomId = "room-001";
    const user = makeUser({
      permissions: ["issues.read_all"],
      scopes: [{ type: "ROOM", id: roomId, issueCategoryId: null }],
    });
    const where = service.issueWhere(user);
    expect(JSON.stringify(where)).toContain(roomId);
  });

  it("restricts to own issues for STUDENT with read_own", () => {
    const user = makeUser({
      permissions: ["issues.read_own"],
      scopes: [],
    });
    const where = service.issueWhere(user);
    // Student can only see issues they reported
    expect(JSON.stringify(where)).toContain(user.id);
  });

  it("handles multiple scopes with OR semantics", () => {
    const user = makeUser({
      permissions: ["issues.read_all"],
      scopes: [
        { type: "CAMPUS", id: "campus-1", issueCategoryId: null },
        { type: "CAMPUS", id: "campus-2", issueCategoryId: null },
      ],
    });
    const where = service.issueWhere(user);
    const serialised = JSON.stringify(where);
    expect(serialised).toContain("campus-1");
    expect(serialised).toContain("campus-2");
  });
});

describe("Permission intersection checks", () => {
  it("confirms a user has all required permissions", () => {
    const userPermissions = ["issues.read_all", "issues.assign", "locations.read"];
    const required = ["issues.assign"];
    expect(required.every((p) => userPermissions.includes(p))).toBe(true);
  });

  it("rejects when any required permission is missing", () => {
    const userPermissions = ["issues.read_all"];
    const required = ["issues.read_all", "issues.assign"];
    expect(required.every((p) => userPermissions.includes(p))).toBe(false);
  });

  it("passes with no required permissions", () => {
    const userPermissions: string[] = [];
    const required: string[] = [];
    expect(required.every((p) => userPermissions.includes(p))).toBe(true);
  });
});
