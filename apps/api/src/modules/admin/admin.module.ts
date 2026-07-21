import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { DeliveryModule } from "../delivery/delivery.module";
import { TemplatesController } from "./top-level-templates.controller";

@Module({ imports: [DeliveryModule], controllers: [AdminController, TemplatesController], providers: [AdminService] })
export class AdminModule {}
