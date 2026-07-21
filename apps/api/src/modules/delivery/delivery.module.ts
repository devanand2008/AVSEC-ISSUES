import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { DeliveryService } from "./delivery.service";
import { WhatsAppController } from "./whatsapp.controller";

@Module({ imports: [NotificationsModule], controllers: [WhatsAppController], providers: [DeliveryService], exports: [DeliveryService] })
export class DeliveryModule {}
