import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { AnnouncementsController } from "../src/modules/announcements/announcements.controller";
import {
  CompleteAnnouncementImageDto,
  CreateAnnouncementDto,
  PresignAnnouncementImageDto,
  RecipientQueryDto,
  UpdateAnnouncementDto,
} from "../src/modules/announcements/dto/announcement.dto";

function parameterTypes(method: string): unknown[] {
  return Reflect.getMetadata(
    "design:paramtypes",
    AnnouncementsController.prototype,
    method,
  ) as unknown[];
}

describe("AnnouncementsController runtime DTO metadata", () => {
  it("retains every DTO used by validation and transformation", () => {
    expect(parameterTypes("create")[1]).toBe(CreateAnnouncementDto);
    expect(parameterTypes("update")[2]).toBe(UpdateAnnouncementDto);
    expect(parameterTypes("patch")[2]).toBe(UpdateAnnouncementDto);
    expect(parameterTypes("getRecipients")[2]).toBe(RecipientQueryDto);
    expect(parameterTypes("exportRecipients")[2]).toBe(RecipientQueryDto);
    expect(parameterTypes("presignImage")[2]).toBe(PresignAnnouncementImageDto);
    expect(parameterTypes("completeImage")[2]).toBe(
      CompleteAnnouncementImageDto,
    );
  });

  it("accepts the valid selected-user payload used by the production UI", async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const transformed = await pipe.transform(
      {
        title: "AVS Production Test Announcement",
        message: "Temporary production persistence verification.",
        category: "GENERAL",
        priority: "LOW",
        pinned: false,
        requiresAcknowledgement: false,
        showOnAppOpen: false,
        showOnlyOnce: true,
        sendPush: false,
        sendEmail: false,
        idempotencyKey: "55f04164-8f35-40d1-9b7d-3f98e8758780",
        audiences: [
          {
            scopeType: "COLLEGE",
            userId: "d8f78877-b21e-4618-8dc9-b2140b44d1b3",
          },
        ],
      },
      {
        type: "body",
        metatype: parameterTypes("create")[1] as new () => object,
      },
    );

    expect(transformed).toBeInstanceOf(CreateAnnouncementDto);
    expect(transformed).toMatchObject({
      title: "AVS Production Test Announcement",
      audiences: [{ scopeType: "COLLEGE" }],
    });
  });

  it("transforms recipient pagination query strings before integer validation", async () => {
    const pipe = new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const transformed = await pipe.transform(
      { page: "1", pageSize: "2" },
      {
        type: "query",
        metatype: parameterTypes("getRecipients")[2] as new () => object,
      },
    );

    expect(transformed).toBeInstanceOf(RecipientQueryDto);
    expect(transformed).toMatchObject({ page: 1, pageSize: 2 });
  });
});
