import type { ConfigService } from "@nestjs/config";
import { DuplicateSubscriptionProofService } from "../src/modules/issues/duplicate-subscription-proof.service";

describe("DuplicateSubscriptionProofService", () => {
  const userId = "00000000-0000-0000-0000-000000000001";
  const issueId = "00000000-0000-0000-0000-000000000002";
  const issuedAt = new Date("2026-07-15T10:00:00.000Z");
  const config = { getOrThrow: jest.fn(() => "a-secure-test-secret-that-is-at-least-32-characters") } as unknown as ConfigService;
  const service = new DuplicateSubscriptionProofService(config);

  it("issues a proof that verifies only for its bound user and issue", () => {
    const result = service.issue(userId, issueId, issuedAt);

    expect(service.verify(userId, issueId, result.duplicateSubscriptionProof, issuedAt)).toBe(true);
    expect(service.verify("00000000-0000-0000-0000-000000000003", issueId, result.duplicateSubscriptionProof, issuedAt)).toBe(false);
    expect(service.verify(userId, "00000000-0000-0000-0000-000000000004", result.duplicateSubscriptionProof, issuedAt)).toBe(false);
  });

  it("rejects tampered and expired proofs", () => {
    const result = service.issue(userId, issueId, issuedAt);
    const parts = result.duplicateSubscriptionProof.split(".");
    const signature = parts[2] ?? "";
    const tampered = `${parts[0]}.${parts[1]}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;

    expect(service.verify(userId, issueId, tampered, issuedAt)).toBe(false);
    expect(service.verify(userId, issueId, result.duplicateSubscriptionProof, new Date("2026-07-15T10:10:01.000Z"))).toBe(false);
  });
});
