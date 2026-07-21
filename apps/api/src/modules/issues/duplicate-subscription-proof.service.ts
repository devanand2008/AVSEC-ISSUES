import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";

const PROOF_TTL_SECONDS = 10 * 60;
const PROOF_VERSION = "v1";

export interface DuplicateSubscriptionProof {
  duplicateSubscriptionProof: string;
  duplicateSubscriptionProofExpiresAt: string;
}

@Injectable()
export class DuplicateSubscriptionProofService {
  constructor(private readonly config: ConfigService) {}

  issue(userId: string, issueId: string, now = new Date()): DuplicateSubscriptionProof {
    const expiresAtSeconds = Math.floor(now.getTime() / 1000) + PROOF_TTL_SECONDS;
    const signature = this.sign(userId, issueId, expiresAtSeconds);
    return {
      duplicateSubscriptionProof: `${PROOF_VERSION}.${expiresAtSeconds}.${signature}`,
      duplicateSubscriptionProofExpiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
  }

  verify(userId: string, issueId: string, proof: string | undefined, now = new Date()): boolean {
    if (!proof) return false;
    const [version, rawExpiresAt, rawSignature, extra] = proof.split(".");
    if (version !== PROOF_VERSION || !rawExpiresAt || !rawSignature || extra !== undefined) return false;
    if (!/^\d{10}$/.test(rawExpiresAt)) return false;

    const expiresAtSeconds = Number(rawExpiresAt);
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= nowSeconds) return false;

    const expected = Buffer.from(this.sign(userId, issueId, expiresAtSeconds), "base64url");
    const received = Buffer.from(rawSignature, "base64url");
    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  private sign(userId: string, issueId: string, expiresAtSeconds: number): string {
    const secret = this.config.getOrThrow<string>("JWT_ACCESS_SECRET");
    return createHmac("sha256", secret)
      .update(`duplicate-subscription:${PROOF_VERSION}:${userId}:${issueId}:${expiresAtSeconds}`)
      .digest("base64url");
  }
}
