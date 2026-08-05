import { Module } from "@nestjs/common";
import { AdminLocationsController, CampusHierarchyController, LocationsController } from "./locations.controller";
import { LocationsService } from "./locations.service";

@Module({ controllers: [LocationsController, CampusHierarchyController, AdminLocationsController], providers: [LocationsService], exports: [LocationsService] })
export class LocationsModule {}
