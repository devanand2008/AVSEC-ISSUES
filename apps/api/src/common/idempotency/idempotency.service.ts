import { ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  hash(body: unknown): string {
    return createHash("sha256").update(JSON.stringify(body)).digest("hex");
  }

  async replay(actorId: string, endpoint: string, key: string, requestHash: string): Promise<unknown | undefined> {
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { actorId_endpoint_key: { actorId, endpoint, key } },
    });
    if (!existing) return undefined;
    if (existing.requestHash !== requestHash) {
      throw new ConflictException("This idempotency key was already used with a different request.");
    }
    if (existing.responseBody !== null) return existing.responseBody;
    throw new ConflictException("A request with this idempotency key is already in progress.");
  }
}
