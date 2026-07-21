import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { DeviceRegistrationService } from "./device-registration.service";

@Module({ controllers: [NotificationsController], providers: [NotificationsService, DeviceRegistrationService], exports: [NotificationsService, DeviceRegistrationService] })
export class NotificationsModule {}
