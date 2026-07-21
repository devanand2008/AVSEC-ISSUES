import { ConfigService } from "@nestjs/config";
import type { AccessService } from "../src/common/access/access.service";
import type { PrismaService } from "../src/database/prisma.service";
import type { AuditService } from "../src/modules/audit/audit.service";
import { StorageService } from "../src/modules/storage/storage.service";

describe("StorageService content signatures", () => {
  const service = new StorageService(
    {} as PrismaService,
    new ConfigService({ S3_BUCKET: "private", S3_ENDPOINT: "http://127.0.0.1:9000", S3_REGION: "us-east-1", S3_ACCESS_KEY: "test", S3_SECRET_KEY: "test-secret", S3_FORCE_PATH_STYLE: true }),
    {} as AccessService,
    {} as AuditService,
  );
  const matches = (service as unknown as { matchesSignature: (mimeType: string, content: Buffer) => boolean }).matchesSignature.bind(service);

  it("accepts known image and document signatures", () => {
    expect(matches("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(matches("application/pdf", Buffer.from("%PDF-1.7\n"))).toBe(true);
    expect(matches("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
  });

  it("rejects content that is only labelled as an allowed MIME type", () => {
    expect(matches("image/png", Buffer.from("this is not a png"))).toBe(false);
    expect(matches("application/pdf", Buffer.from("plain text"))).toBe(false);
  });
});

