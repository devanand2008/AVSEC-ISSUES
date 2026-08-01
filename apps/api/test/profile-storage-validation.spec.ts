import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CompleteProfilePhotoDto, PresignProfilePhotoDto } from "../src/modules/storage/dto/storage.dto";
import { NotificationPreferencesDto } from "../src/modules/users/dto/user.dto";

describe("profile persistence validation", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("accepts supported profile photo type %s", async (mimeType) => {
    const dto = plainToInstance(PresignProfilePhotoDto, {
      fileName: mimeType === "image/jpeg" ? "profile.jpg" : `profile.${mimeType.split("/")[1]}`,
      mimeType,
      sizeBytes: 512_000,
    });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
  });

  it("rejects executable types, oversized photos, and incomplete completion data", async () => {
    const executable = plainToInstance(PresignProfilePhotoDto, {
      fileName: "profile.svg",
      mimeType: "image/svg+xml",
      sizeBytes: 512_000,
    });
    const oversized = plainToInstance(PresignProfilePhotoDto, {
      fileName: "profile.png",
      mimeType: "image/png",
      sizeBytes: 10 * 1024 * 1024 + 1,
    });
    const incomplete = plainToInstance(CompleteProfilePhotoDto, {
      fileName: "profile.png",
      mimeType: "image/png",
      sizeBytes: 512_000,
    });
    expect((await validate(executable)).length).toBeGreaterThan(0);
    expect((await validate(oversized)).length).toBeGreaterThan(0);
    expect((await validate(incomplete)).length).toBeGreaterThan(0);
  });

  it("requires explicit booleans for every persisted notification channel", async () => {
    const valid = plainToInstance(NotificationPreferencesDto, {
      in_app: true,
      push: true,
      email: false,
      whatsapp: false,
    });
    const missing = plainToInstance(NotificationPreferencesDto, {
      in_app: true,
      push: true,
    });
    expect(await validate(valid, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    expect((await validate(missing)).length).toBeGreaterThan(0);
  });
});
