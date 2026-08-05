import { Injectable } from "@nestjs/common";
import { toZonedTime } from "date-fns-tz";
import { PrismaService } from "../../database/prisma.service";
import type { IssuePriority, Prisma, RoomType } from "../../generated/prisma/client";

interface RouteInput {
  collegeId: string;
  campusId: string;
  blockId: string;
  floorId: string;
  roomId: string | null;
  areaId: string | null;
  roomType: RoomType | null;
  departmentId: string | null;
  categoryId: string;
  issueTypeId: string | null;
  assetId: string | null;
  priority: IssuePriority;
}

export interface RoutingDecision {
  teamId: string | null;
  assignedToId: string | null;
  routingRuleId: string | null;
  fallback: boolean;
  reason: string;
  snapshot: Prisma.InputJsonValue;
}

@Injectable()
export class RoutingService {
  constructor(private readonly prisma: PrismaService) {}

  async route(input: RouteInput): Promise<RoutingDecision> {
    const now = new Date();
    const candidates = await this.prisma.issueAssignmentRule.findMany({
      where: {
        collegeId: input.collegeId,
        isActive: true,
        AND: [
          { OR: [{ campusId: null }, { campusId: input.campusId }] },
          { OR: [{ blockId: null }, { blockId: input.blockId }] },
          { OR: [{ floorId: null }, { floorId: input.floorId }] },
          { OR: [{ roomId: null }, ...(input.roomId ? [{ roomId: input.roomId }] : [])] },
          { OR: [{ areaId: null }, ...(input.areaId ? [{ areaId: input.areaId }] : [])] },
          { OR: [{ roomType: null }, ...(input.roomType ? [{ roomType: input.roomType }] : [])] },
          { OR: [{ departmentId: null }, ...(input.departmentId ? [{ departmentId: input.departmentId }] : [])] },
          { OR: [{ categoryId: null }, { categoryId: input.categoryId }] },
          { OR: [{ issueTypeId: null }, ...(input.issueTypeId ? [{ issueTypeId: input.issueTypeId }] : [])] },
          { OR: [{ assetId: null }, ...(input.assetId ? [{ assetId: input.assetId }] : [])] },
          { OR: [{ priorityFilter: null }, { priorityFilter: input.priority }] },
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
        ],
      },
      include: { team: { include: { members: { where: { isActive: true }, include: { user: true } }, dutySchedules: { where: { isActive: true } } } } },
    });
    candidates.sort((a, b) => this.score(b, input) - this.score(a, input) || b.rulePriority - a.rulePriority || a.id.localeCompare(b.id));
    const selected = candidates[0];
    if (selected) {
      const member = this.selectMember(selected, now);
      const score = this.score(selected, input);
      const reason = `Matched routing rule ${selected.id} with specificity ${score} and priority ${selected.rulePriority}.`;
      return {
        teamId: selected.teamId,
        assignedToId: member,
        routingRuleId: selected.id,
        fallback: false,
        reason,
        snapshot: { ruleId: selected.id, teamId: selected.teamId, assignedToId: member, score, rulePriority: selected.rulePriority, reason },
      };
    }
    const fallback = await this.prisma.responsibleTeam.findFirst({
      where: { collegeId: input.collegeId, isDefaultMaintenance: true, isActive: true },
      include: { members: { where: { isActive: true }, orderBy: [{ isPrimary: "desc" }, { id: "asc" }] } },
    });
    const assignedToId = fallback?.members[0]?.userId ?? null;
    const reason = fallback ? "No routing rule matched; assigned to the default maintenance team for manual assignment." : "No routing rule or default maintenance team matched; manual assignment is required.";
    return { teamId: fallback?.id ?? null, assignedToId, routingRuleId: null, fallback: true, reason, snapshot: { fallback: true, teamId: fallback?.id ?? null, assignedToId, reason } };
  }

  private score(rule: { roomId: string | null; areaId: string | null; issueTypeId: string | null; categoryId: string | null; floorId: string | null; blockId: string | null; departmentId: string | null; campusId: string | null; assetId: string | null; roomType: RoomType | null }, input: RouteInput): number {
    if (input.roomId && rule.roomId === input.roomId && rule.issueTypeId === input.issueTypeId && rule.issueTypeId) return 900;
    if (input.roomId && rule.roomId === input.roomId && rule.categoryId === input.categoryId) return 800;
    if (input.areaId && rule.areaId === input.areaId && rule.categoryId === input.categoryId) return 780;
    if (input.roomId && rule.roomId === input.roomId) return 700;
    if (input.areaId && rule.areaId === input.areaId) return 680;
    if (rule.floorId === input.floorId && rule.categoryId === input.categoryId) return 600;
    if (rule.blockId === input.blockId && rule.categoryId === input.categoryId) return 500;
    if (rule.departmentId === input.departmentId && rule.departmentId && rule.categoryId === input.categoryId) return 400;
    if (rule.campusId === input.campusId && rule.categoryId === input.categoryId) return 300;
    if (rule.categoryId === input.categoryId) return 200;
    return 100 + Number(Boolean(rule.assetId)) * 20 + Number(Boolean(rule.roomType)) * 10;
  }

  private selectMember(rule: { primaryUserId: string | null; workloadBalancing: boolean; team: { members: Array<{ userId: string; maxOpenIssues: number | null }>; dutySchedules: Array<{ userId: string | null; dayOfWeek: number; startsAtMinutes: number; endsAtMinutes: number; timezone: string }> } }, now: Date): string | null {
    const onDuty = rule.team.members.filter((member) => rule.team.dutySchedules.some((schedule) => {
      if (schedule.userId && schedule.userId !== member.userId) return false;
      const zoned = toZonedTime(now, schedule.timezone);
      const minute = zoned.getHours() * 60 + zoned.getMinutes();
      return zoned.getDay() === schedule.dayOfWeek && minute >= schedule.startsAtMinutes && minute < schedule.endsAtMinutes;
    }));
    const pool = onDuty.length ? onDuty : rule.team.members;
    if (rule.primaryUserId && pool.some((member) => member.userId === rule.primaryUserId)) return rule.primaryUserId;
    return pool.sort((a, b) => a.userId.localeCompare(b.userId))[0]?.userId ?? null;
  }
}
