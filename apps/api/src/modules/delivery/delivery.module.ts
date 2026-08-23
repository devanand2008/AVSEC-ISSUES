import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { StorageModule } from "../storage/storage.module";
import { DeliveryService } from "./delivery.service";
import { WhatsAppController } from "./whatsapp.controller";

@Module({ imports: [NotificationsModule, StorageModule], controllers: [WhatsAppController], providers: [DeliveryService], exports: [DeliveryService] })
export class DeliveryModule {}
