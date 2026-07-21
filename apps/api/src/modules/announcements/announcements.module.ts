import { Module } from "@nestjs/common";
import { AnnouncementsController, UserAnnouncementsController } from "./announcements.controller";
import { AnnouncementsService } from "./announcements.service";
import { AnnouncementRecipientsProcessor } from "./announcements-recipients.processor";

@Module({
  controllers: [AnnouncementsController, UserAnnouncementsController],
  providers: [AnnouncementsService, AnnouncementRecipientsProcessor],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
