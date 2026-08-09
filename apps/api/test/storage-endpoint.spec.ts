import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import type { AccessService } from "../src/common/access/access.service";
import type { AuthPrincipal } from "../src/common/http/request-context";
import type { PrismaService } from "../src/database/prisma.service";
import type { AuditService } from "../src/modules/audit/audit.service";
import type { PresignProfilePhotoDto } from "../src/modules/storage/dto/storage.dto";
import { ProfilePhotoController } from "../src/modules/storage/storage.controller";
import { requestHostMinioEndpoint } from "../src/modules/storage/storage-endpoint";
import { StorageService } from "../src/modules/storage/storage.service";

const request = {
  protocol: "https",
  hostname: "portal.example.edu",
} as Request;

const user: AuthPrincipal = {
  id: "user-1",
  publicId: "AVS0001",
  collegeId: "college-1",
  fullName: "Test User",
  email: "test@example.edu",
  status: "ACTIVE",
  mustChangePassword: false,
  sessionId: "session-1",
  roles: ["STUDENT"],
  permissions: [],
  scopes: [],
};

const photo: PresignProfilePhotoDto = {
  fileName: "profile.png",
  mimeType: "image/png",
  sizeBytes: 1_024,
};

describe("requestHostMinioEndpoint", () => {
  it.each([
    "http://minio:9000",
    "http://localhost:9000",
    "http://127.0.0.1:9000",
    "http://[::1]:9000",
    "http://host.docker.internal:9000",
  ])("derives a request-host endpoint for local MinIO config %s", (endpoint) => {
    expect(requestHostMinioEndpoint(request, endpoint, "9443")).toBe(
      "https://portal.example.edu:9443",
    );
  });

  it("formats an IPv6 request hostname as a valid URL", () => {
    expect(
      requestHostMinioEndpoint(
        { protocol: "http", hostname: "::1" } as Request,
        "http://minio:9000",
      ),
    ).toBe("http://[::1]:9000");
  });

  it.each([
    undefined,
    "",
    "not a URL",
    "https://project.supabase.co/storage/v1/s3",
    "https://s3.amazonaws.com",
    "https://minio.example.edu",
  ])("does not override a missing, malformed, or remote endpoint %s", (endpoint) => {
    expect(requestHostMinioEndpoint(request, endpoint)).toBeUndefined();
  });

  it("falls back to MinIO's default port when the public port is invalid", () => {
    expect(
      requestHostMinioEndpoint(request, "http://minio:9000", "70000"),
    ).toBe("https://portal.example.edu:9000");
  });
});

describe("profile photo presigning endpoint selection", () => {
  it("keeps the configured Supabase hostname without making a network request", async () => {
    const endpoint = "https://project.supabase.co/storage/v1/s3";
    const controller = profileController({ S3_ENDPOINT: endpoint });

    const result = await controller.presign(user, photo, request);

    expect(new URL(result.uploadUrl).hostname).toBe("project.supabase.co");
  });

  it("uses the request hostname for locally configured MinIO", async () => {
    const controller = profileController({
      S3_ENDPOINT: "http://minio:9000",
      MINIO_API_HOST_PORT: "9443",
    });

    const result = await controller.presign(user, photo, request);
    const uploadUrl = new URL(result.uploadUrl);

    expect(uploadUrl.hostname).toBe("portal.example.edu");
    expect(uploadUrl.port).toBe("9443");
  });

  it("keeps S3_PUBLIC_ENDPOINT ahead of a derived local MinIO endpoint", async () => {
    const controller = profileController({
      S3_ENDPOINT: "http://minio:9000",
      S3_PUBLIC_ENDPOINT: "https://files.example.edu",
    });

    const result = await controller.presign(user, photo, request);

    expect(new URL(result.uploadUrl).hostname).toBe("files.example.edu");
  });
});

function profileController(overrides: Record<string, unknown>) {
  const config = new ConfigService({
    S3_BUCKET: "private",
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY: "test-access-key",
    S3_SECRET_KEY: "test-secret-key",
    S3_FORCE_PATH_STYLE: true,
    S3_SIGNED_URL_EXPIRY_SECONDS: 300,
    ...overrides,
  });
  const storage = new StorageService(
    {} as PrismaService,
    config,
    {} as AccessService,
    {} as AuditService,
  );
  return new ProfilePhotoController(storage, config);
}
