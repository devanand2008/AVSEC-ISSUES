import { Module } from "@nestjs/common";
import { StorageController } from "./storage.controller";
import { StorageService } from "./storage.service";
import { MessageStorageController } from "./message-storage.controller";

@Module({ controllers: [StorageController, MessageStorageController], providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
