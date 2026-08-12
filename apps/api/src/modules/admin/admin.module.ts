import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { DeliveryModule } from "../delivery/delivery.module";
import { TemplatesController } from "./top-level-templates.controller";
import { StorageModule } from "../storage/storage.module";
import { DataMaintenanceController } from "./data-maintenance.controller";
import { DataMaintenanceService } from "./data-maintenance.service";
import { AcademicModule } from "../academic/academic.module";

@Module({
  imports: [DeliveryModule, StorageModule, AcademicModule],
  controllers: [AdminController, TemplatesController, DataMaintenanceController],
  providers: [AdminService, DataMaintenanceService],
})
export class AdminModule {}
