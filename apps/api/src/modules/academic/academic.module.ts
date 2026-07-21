import { Module } from "@nestjs/common";
import { AcademicController } from "./academic.controller";
import { AcademicService } from "./academic.service";
import { ConversationsModule } from "../conversations/conversations.module";
import { DepartmentsController, ProgrammesController, SectionsController } from "./top-level-academic.controller";

@Module({ imports: [ConversationsModule], controllers: [AcademicController, DepartmentsController, ProgrammesController, SectionsController], providers: [AcademicService] })
export class AcademicModule {}
