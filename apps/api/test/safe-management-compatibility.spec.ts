import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AnnouncementsService } from "../src/modules/announcements/announcements.service";
import { DeleteUserDto } from "../src/modules/users/dto/user.dto";

describe("safe management compatibility", () => {
  it("uses the Announcement fallback for a legacy null title", async () => {
    const service = Object.create(AnnouncementsService.prototype) as AnnouncementsService;
    Object.assign(service, { getSignedImageUrl: jest.fn().mockResolvedValue(undefined) });
    const result = await (service as unknown as {
      formatAnnouncementWithImage(value: Record<string, unknown>, receipt: unknown): Promise<Record<string, unknown>>;
    }).formatAnnouncementWithImage({ id: "legacy", title: null, imageStorageKey: null }, null);
    expect(result.title).toBe("Announcement");
  });

  it("accepts the user-bound permanent deletion phrase", async () => {
    const dto = plainToInstance(DeleteUserDto, {
      confirmationPhrase: "DELETE USER 20000000-0000-4000-8000-000000000002",
      backupReference: "BACKUP-2026-07-27",
      reason: "Duplicate test account",
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it("accepts the student-bound phrase submitted by the People UI", async () => {
    const dto = plainToInstance(DeleteUserDto, {
      confirmationPhrase: "DELETE STUDENT AVS-TEST-001",
      backupReference: "BACKUP-2026-08-09",
      reason: "Remove the production acceptance account",
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it("rejects an uncontrolled permanent deletion phrase", async () => {
    const dto = plainToInstance(DeleteUserDto, {
      confirmationPhrase: "DELETE EVERYONE",
      backupReference: "BACKUP-2026-07-27",
      reason: "Invalid operation",
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
