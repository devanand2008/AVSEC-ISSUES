import { Module } from "@nestjs/common";
import { AcademicController } from "./academic.controller";
import { AcademicService } from "./academic.service";
import { ConversationsModule } from "../conversations/conversations.module";
import { DepartmentsController, ProgrammesController, SectionsController } from "./top-level-academic.controller";
import { SectionPlacementService } from "./section-placement.service";
import { StudentPromotionController } from "./student-promotion.controller";
import { StudentPromotionService } from "./student-promotion.service";

@Module({
  imports: [ConversationsModule],
  controllers: [AcademicController, DepartmentsController, ProgrammesController, SectionsController, StudentPromotionController],
  providers: [AcademicService, SectionPlacementService, StudentPromotionService],
  exports: [SectionPlacementService],
})
export class AcademicModule {}
