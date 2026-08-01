import { DynamicModule, Module } from "@nestjs/common";
import { GoogleDriveApiClient } from "./google-drive-api.client";
import { GoogleDriveTokenCipher } from "./google-drive.crypto";
import { GoogleDriveController } from "./google-drive.controller";
import { GoogleDriveOAuthService } from "./google-drive-oauth.service";
import { GoogleDriveStorageService } from "./google-drive-storage.service";
import { GoogleDriveHierarchyService } from "./google-drive-hierarchy.service";
import {
  GOOGLE_DRIVE_CLOCK,
  GOOGLE_DRIVE_CONFIG,
  GOOGLE_DRIVE_FETCH,
  GOOGLE_DRIVE_SLEEP,
  type GoogleDriveModuleAsyncOptions,
} from "./google-drive.types";

@Module({})
export class GoogleDriveModule {
  static registerAsync(options: GoogleDriveModuleAsyncOptions): DynamicModule {
    const providers = [
      ...options.persistenceProviders,
      {
        provide: GOOGLE_DRIVE_CONFIG,
        inject: options.inject ?? [],
        useFactory: options.useFactory,
      },
      {
        provide: GOOGLE_DRIVE_FETCH,
        useValue: globalThis.fetch.bind(globalThis),
      },
      {
        provide: GOOGLE_DRIVE_CLOCK,
        useValue: () => new Date(),
      },
      {
        provide: GOOGLE_DRIVE_SLEEP,
        useValue: (milliseconds: number) =>
          new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
      },
      GoogleDriveTokenCipher,
      GoogleDriveApiClient,
      GoogleDriveOAuthService,
      GoogleDriveStorageService,
      GoogleDriveHierarchyService,
    ];
    return {
      module: GoogleDriveModule,
      global: true,
      imports: options.imports ?? [],
      controllers: [GoogleDriveController],
      providers,
      exports: [
        GoogleDriveOAuthService,
        GoogleDriveStorageService,
        GoogleDriveHierarchyService,
        GOOGLE_DRIVE_CONFIG,
      ],
    };
  }
}
