import { Module } from "@nestjs/common";
import { AcademicController } from "./academic.controller";
import { AcademicService } from "./academic.service";
import { ConversationsModule } from "../conversations/conversations.module";
import { DepartmentsController, ProgrammesController, SectionsController } from "./top-level-academic.controller";
import { SectionPlacementService } from "./section-placement.service";

@Module({
  imports: [ConversationsModule],
  controllers: [AcademicController, DepartmentsController, ProgrammesController, SectionsController],
  providers: [AcademicService, SectionPlacementService],
  exports: [SectionPlacementService],
})
export class AcademicModule {}
