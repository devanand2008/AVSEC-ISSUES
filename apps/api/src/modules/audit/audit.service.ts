import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { Prisma } from "../../generated/prisma/client";

export interface AuditInput {
  collegeId?: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  reason?: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput, client: Prisma.TransactionClient = this.prisma): Promise<void> {
    const collegeId = input.collegeId ?? (input.actorId ? (await client.user.findUnique({ where: { id: input.actorId }, select: { collegeId: true } }))?.collegeId : undefined);
    await client.auditLog.create({
      data: {
        collegeId,
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeValue: this.json(input.beforeValue),
        afterValue: this.json(input.afterValue),
        reason: input.reason,
        requestId: input.requestId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  private json(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
