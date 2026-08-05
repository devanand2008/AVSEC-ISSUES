import { Module } from "@nestjs/common";
import { LearningResourceDownloadController, LearningStorageController, LearnSubjectResourceUploadController, ProfilePhotoController, StorageController } from "./storage.controller";
import { StorageService } from "./storage.service";
import { MessageStorageController, PendingMessageStorageController } from "./message-storage.controller";

@Module({ controllers: [StorageController, ProfilePhotoController, MessageStorageController, PendingMessageStorageController, LearningStorageController, LearnSubjectResourceUploadController, LearningResourceDownloadController], providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
