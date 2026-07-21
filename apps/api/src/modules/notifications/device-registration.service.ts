import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import type { RegisterDeviceDto } from "./dto/device-registration.dto";

@Injectable()
export class DeviceRegistrationService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  list(user: AuthPrincipal) {
    return this.prisma.deviceRegistration.findMany({
      where: { userId: user.id, enabled: true },
      select: { id: true, platform: true, deviceName: true, lastSeenAt: true, createdAt: true },
      orderBy: { lastSeenAt: "desc" },
    });
  }

  async register(user: AuthPrincipal, input: RegisterDeviceDto) {
    this.assertConfigured();
    const token = input.token.trim();
    if (!token) throw new BadRequestException("Push token is required.");
    const tokenHash = this.hash(token);
    const encryptedToken = this.encrypt(token);
    return this.prisma.deviceRegistration.upsert({
      where: { tokenHash },
      create: {
        userId: user.id,
        tokenHash,
        encryptedToken,
        platform: input.platform,
        deviceName: input.deviceName?.trim(),
      },
      update: {
        userId: user.id,
        encryptedToken,
        platform: input.platform,
        deviceName: input.deviceName?.trim(),
        enabled: true,
        lastSeenAt: new Date(),
      },
      select: { id: true, platform: true, deviceName: true, lastSeenAt: true, createdAt: true },
    });
  }

  async disable(user: AuthPrincipal, id: string): Promise<void> {
    const result = await this.prisma.deviceRegistration.updateMany({
      where: { id, userId: user.id, enabled: true },
      data: { enabled: false },
    });
    if (result.count !== 1) throw new NotFoundException("Push device not found.");
  }

  decrypt(value: string): string {
    const [ivValue, tagValue, ciphertextValue] = value.split(".");
    if (!ivValue || !tagValue || !ciphertextValue) throw new Error("Encrypted device token is malformed.");
    const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
  }

  private key(): Buffer {
    return createHash("sha256").update(this.config.getOrThrow<string>("DEVICE_TOKEN_ENCRYPTION_KEY")).digest();
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private assertConfigured(): void {
    if (!this.config.get<string>("DEVICE_TOKEN_ENCRYPTION_KEY")) {
      throw new ServiceUnavailableException("Push registration is not configured.");
    }
  }
}
