import { Module } from "@nestjs/common";
import { RoutingAdminController } from "./routing-admin.controller";
import { RoutingAdminService } from "./routing-admin.service";

@Module({ controllers: [RoutingAdminController], providers: [RoutingAdminService] })
export class RoutingAdminModule {}
