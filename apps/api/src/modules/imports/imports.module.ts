import { Module } from "@nestjs/common";
import { AcademicModule } from "../academic/academic.module";
import { AdminPeopleImportsController } from "./admin-people-imports.controller";
import { AdminUserImportsController } from "./admin-user-imports.controller";
import { ImportsController } from "./imports.controller";
import { ImportsFileService } from "./imports-file.service";
import { ImportsHandlerService } from "./imports-handler.service";
import { ImportsService } from "./imports.service";

@Module({ imports: [AcademicModule], controllers: [ImportsController, AdminUserImportsController, AdminPeopleImportsController], providers: [ImportsService, ImportsFileService, ImportsHandlerService] })
export class ImportsModule {}
