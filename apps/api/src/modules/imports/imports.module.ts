import { Module } from "@nestjs/common";
import { AdminUserImportsController } from "./admin-user-imports.controller";
import { ImportsController } from "./imports.controller";
import { ImportsFileService } from "./imports-file.service";
import { ImportsHandlerService } from "./imports-handler.service";
import { ImportsService } from "./imports.service";

@Module({ controllers: [ImportsController, AdminUserImportsController], providers: [ImportsService, ImportsFileService, ImportsHandlerService] })
export class ImportsModule {}
