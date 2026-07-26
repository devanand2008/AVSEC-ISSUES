import { Module } from "@nestjs/common";
import { LearningResourceDownloadController, LearningStorageController, StorageController } from "./storage.controller";
import { StorageService } from "./storage.service";
import { MessageStorageController, PendingMessageStorageController } from "./message-storage.controller";

@Module({ controllers: [StorageController, MessageStorageController, PendingMessageStorageController, LearningStorageController, LearningResourceDownloadController], providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
