import { BadRequestException } from "@nestjs/common";
import type { AuthPrincipal } from "../src/common/http/request-context";
import { UsersService } from "../src/modules/users/users.service";

const user: AuthPrincipal = {
  id: "00000000-0000-4000-8000-000000000001",
  publicId: "00000000-0000-4000-8000-000000000002",
  collegeId: "00000000-0000-4000-8000-000000000003",
  fullName: "User",
  email: "user@example.edu",
  status: "ACTIVE",
  mustChangePassword: false,
  sessionId: "00000000-0000-4000-8000-000000000004",
  roles: ["STUDENT"],
  permissions: ["notifications.read_own"],
  scopes: [],
};

describe("notification preference persistence", () => {
  function setup() {
    const tx = {
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({
            notificationPreferences: {
              in_app: true,
              push: false,
              email: true,
              whatsapp: false,
            },
          }),
        update: jest.fn(
          async (input: { data: { notificationPreferences: unknown } }) => ({
            notificationPreferences: input.data.notificationPreferences,
          }),
        ),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new UsersService(
      prisma as never,
      {} as never,
      audit as never,
      {} as never,
      {} as never,
    );
    return { service, prisma, tx, audit };
  }

  it("merges a dismissal-only PATCH without resetting existing channels", async () => {
    const { service, tx, audit } = setup();
    const dismissedAt = "2026-08-15T02:00:00.000Z";

    const result = await service.updateNotificationPreferences(
      user,
      {
        dismissed_banners: { "push-not-configured": dismissedAt },
      },
      "request-1",
    );

    expect(result).toEqual(
      expect.objectContaining({
        in_app: true,
        push: false,
        email: true,
        whatsapp: false,
        dismissed_banners: { "push-not-configured": dismissedAt },
      }),
    );
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: { increment: 1 } }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "profile.notification_preferences_updated",
      }),
      tx,
    );
  });

  it("does not persist a permanent dismissal for a critical alert", async () => {
    const { service, prisma } = setup();

    await expect(
      service.updateNotificationPreferences(
        user,
        {
          dismissed_banners: {
            "critical-overdue-issues": "2026-08-15T02:00:00.000Z",
          },
        },
        "request-2",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a far-future dismissal that could hide a warning indefinitely", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-15T02:00:00.000Z"));
    const { service, prisma } = setup();

    await expect(
      service.updateNotificationPreferences(
        user,
        {
          dismissed_banners: {
            "push-not-configured": "2099-08-15T02:00:00.000Z",
          },
        },
        "request-3",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
