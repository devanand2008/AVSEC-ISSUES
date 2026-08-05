import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "../http/request-context";
import type { Prisma } from "../../generated/prisma/client";

@Injectable()
export class AccessService {
  isCollegeWide(user: AuthPrincipal): boolean {
    return user.scopes.length === 0 || user.scopes.some((scope) => scope.type === "COLLEGE" && (!scope.id || scope.id === user.collegeId));
  }

  requireCollege(resourceCollegeId: string, user: AuthPrincipal): void {
    if (resourceCollegeId !== user.collegeId) throw new NotFoundException("Resource not found.");
  }

  issueWhere(user: AuthPrincipal): Prisma.IssueWhereInput {
    const base: Prisma.IssueWhereInput = { collegeId: user.collegeId, archivedAt: null };
    if (user.permissions.includes("issues.read_all") && this.isCollegeWide(user)) return base;

    const conditions: Prisma.IssueWhereInput[] = [];
    if (user.permissions.includes("issues.read_own")) {
      conditions.push({ reporterId: user.id }, { affectedUsers: { some: { userId: user.id } } });
    }
    if (user.permissions.includes("issues.read_assigned")) {
      conditions.push(...this.assignedIssueConditions(user.id));
    }
    if (user.permissions.includes("issues.read_all") || user.permissions.includes("issues.read_scope")) {
      const scoped = this.issueScopeWhere(user);
      if (scoped) conditions.push(scoped);
    }
    return { ...base, OR: conditions.length ? conditions : [{ id: "00000000-0000-0000-0000-000000000000" }] };
  }

  assignedIssueWhere(user: AuthPrincipal): Prisma.IssueWhereInput {
    const conditions = this.assignedIssueConditions(user.id);
    const mapped = this.mappedIssueCondition(user);
    if (mapped) conditions.push(mapped);
    return {
      collegeId: user.collegeId,
      archivedAt: null,
      OR: conditions,
    };
  }

  private issueScopeWhere(user: AuthPrincipal): Prisma.IssueWhereInput | undefined {
    const collegeWide = this.isCollegeWide(user);
    const location: Prisma.IssueWhereInput[] = [];
    const academic: Prisma.IssueWhereInput[] = [];
    const category: Prisma.IssueWhereInput[] = [];
    const assignment: Prisma.IssueWhereInput[] = [];

    for (const scope of user.scopes) {
      if (!collegeWide && scope.type === "CAMPUS" && scope.id) location.push({ campusId: scope.id });
      if (!collegeWide && scope.type === "BLOCK" && scope.id) location.push({ blockId: scope.id });
      if (!collegeWide && scope.type === "FLOOR" && scope.id) location.push({ floorId: scope.id });
      if (!collegeWide && scope.type === "ROOM" && scope.id) location.push({ roomId: scope.id });
      if (!collegeWide && scope.type === "AREA" && scope.id) location.push({ areaId: scope.id });

      if (scope.type === "DEPARTMENT" && scope.id) academic.push({ departmentId: scope.id });
      if (scope.type === "PROGRAMME" && scope.id) academic.push({ reporter: { studentProfile: { programmeId: scope.id } } });
      if (scope.type === "ACADEMIC_YEAR" && scope.id) academic.push({ reporter: { studentProfile: { section: { semester: { academicYearId: scope.id } } } } });
      if (scope.type === "SEMESTER" && scope.id) academic.push({ reporter: { studentProfile: { section: { semesterId: scope.id } } } });
      if (scope.type === "SECTION" && scope.id) academic.push({ reporter: { studentProfile: { sectionId: scope.id } } });

      if (scope.type === "ISSUE_CATEGORY" && scope.issueCategoryId) category.push({ categoryId: scope.issueCategoryId });
      if (scope.type === "ASSIGNED_ISSUES") assignment.push(...this.assignedIssueConditions(user.id));
    }

    const dimensions = [location, academic, category, assignment].filter((dimension) => dimension.length > 0);
    if (!dimensions.length) return collegeWide ? {} : undefined;
    return { AND: dimensions.map((dimension) => ({ OR: dimension })) };
  }

  private assignedIssueConditions(userId: string): Prisma.IssueWhereInput[] {
    return [
      { assignedToId: userId },
      { team: { members: { some: { userId, isActive: true } } } },
    ];
  }

  private mappedIssueCondition(user: AuthPrincipal): Prisma.IssueWhereInput | undefined {
    const location: Prisma.IssueWhereInput[] = [];
    const category: Prisma.IssueWhereInput[] = [];
    for (const scope of user.scopes) {
      if (scope.type === "CAMPUS" && scope.id) location.push({ campusId: scope.id });
      if (scope.type === "BLOCK" && scope.id) location.push({ blockId: scope.id });
      if (scope.type === "FLOOR" && scope.id) location.push({ floorId: scope.id });
      if (scope.type === "ROOM" && scope.id) location.push({ roomId: scope.id });
      if (scope.type === "AREA" && scope.id) location.push({ areaId: scope.id });
      if (scope.type === "ISSUE_CATEGORY") {
        const categoryId = scope.issueCategoryId ?? scope.id;
        if (categoryId) category.push({ categoryId });
      }
    }
    const dimensions = [location, category].filter((dimension) => dimension.length > 0);
    if (!dimensions.length) return undefined;
    return { AND: dimensions.map((dimension) => ({ OR: dimension })) };
  }

  canWorkIssue(user: AuthPrincipal, issue: { collegeId: string; assignedToId: string | null; teamId: string | null }, teamMember: boolean): boolean {
    this.requireCollege(issue.collegeId, user);
    return user.permissions.includes("issues.assign") || issue.assignedToId === user.id || (Boolean(issue.teamId) && teamMember);
  }

  requirePermission(user: AuthPrincipal, permission: string): void {
    if (!user.permissions.includes(permission)) throw new ForbiddenException("You do not have permission to perform this action.");
  }
}
