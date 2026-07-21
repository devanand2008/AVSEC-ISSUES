import { Module } from "@nestjs/common";
import { AccessModule } from "../../common/access/access.module";
import { AuditModule } from "../audit/audit.module";
import { AdminFeedbackController } from "./admin-feedback.controller";
import { FeedbackController } from "./feedback.controller";
import { FeedbackService } from "./feedback.service";

@Module({
  imports: [AccessModule, AuditModule],
  controllers: [FeedbackController, AdminFeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
