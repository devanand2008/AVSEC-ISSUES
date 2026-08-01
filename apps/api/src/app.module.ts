import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { validateEnvironment } from "./config/environment";
import { RequestIdMiddleware } from "./common/http/request-id.middleware";
import { AllExceptionsFilter } from "./common/http/all-exceptions.filter";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { DatabaseModule } from "./database/database.module";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { AccessModule } from "./common/access/access.module";
import { IdempotencyModule } from "./common/idempotency/idempotency.module";
import { AcademicModule } from "./modules/academic/academic.module";
import { AnnouncementsModule } from "./modules/announcements/announcements.module";
import { AttendanceModule } from "./modules/attendance/attendance.module";
import { ConversationsModule } from "./modules/conversations/conversations.module";
import { DeliveryModule } from "./modules/delivery/delivery.module";
import { IssuesModule } from "./modules/issues/issues.module";
import { LocationsModule } from "./modules/locations/locations.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { RoutingAdminModule } from "./modules/routing/routing-admin.module";
import { StorageModule } from "./modules/storage/storage.module";
import { UsersModule } from "./modules/users/users.module";
import { AdminModule } from "./modules/admin/admin.module";
import { FeedbackModule } from "./modules/feedback/feedback.module";
import { QrModule } from "./modules/qr/qr.module";
import { CsrfGuard } from "./common/guards/csrf.guard";
import { PasswordChangeGuard } from "./common/guards/password-change.guard";
import { ProfileCompletionGuard } from "./common/guards/profile-completion.guard";
import { ImportsModule } from "./modules/imports/imports.module";
import { LearnModule } from "./modules/learn/learn.module";
import { resolve } from "node:path";
import { AiModule } from "./modules/ai/ai.module";
import { GoogleDriveModule } from "./modules/google-drive/google-drive.module";
import {
  GOOGLE_DRIVE_CONNECTION_STORE,
  GOOGLE_DRIVE_FOLDER_CACHE,
  GOOGLE_DRIVE_OAUTH_STATE_STORE,
  type GoogleDriveConfig,
} from "./modules/google-drive/google-drive.types";
import { PrismaConnectionStore } from "./modules/google-drive/connection-store";
import { InMemoryOAuthStateStore } from "./modules/google-drive/oauth-state-store";
import { InMemoryFolderCacheStore } from "./modules/google-drive/folder-cache-store";
import { BackupsModule } from "./modules/backups/backups.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(process.cwd(), ".env"),
        resolve(process.cwd(), "../../.env"),
      ],
      validate: validateEnvironment,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "res.headers.set-cookie",
            "password",
            "accessToken",
            "refreshToken",
            "refresh_token",
            "client_secret",
            "GOOGLE_OAUTH_CLIENT_SECRET",
            "GOOGLE_DRIVE_ENCRYPTION_KEY",
            "BACKUP_ENCRYPTION_KEY",
            "OPENAI_API_KEY",
            "openaiApiKey",
            "apiKey",
            "req.body.message",
            "req.body.prompt",
            "req.body.content",
          ],
          censor: "[REDACTED]",
        },
        customProps: (request) => ({ requestId: request.id }),
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.getOrThrow<number>("GLOBAL_RATE_LIMIT_TTL_MS"),
          limit: config.getOrThrow<number>("GLOBAL_RATE_LIMIT_MAX"),
        },
      ],
    }),
    DatabaseModule,
    AuditModule,
    AccessModule,
    IdempotencyModule,
    AuthModule,
    HealthModule,
    AcademicModule,
    UsersModule,
    LocationsModule,
    IssuesModule,
    RoutingAdminModule,
    AttendanceModule,
    NotificationsModule,
    ConversationsModule,
    AnnouncementsModule,
    ReportsModule,
    StorageModule,
    DeliveryModule,
    AdminModule,
    ImportsModule,
    FeedbackModule,
    QrModule,
    LearnModule,
    AiModule,
    GoogleDriveModule.registerAsync({
      imports: [DatabaseModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): GoogleDriveConfig => ({
        enabled: config.get<boolean>("GOOGLE_DRIVE_ENABLED", false),
        clientId: config.get<string>("GOOGLE_OAUTH_CLIENT_ID", ""),
        clientSecret: config.get<string>("GOOGLE_OAUTH_CLIENT_SECRET", ""),
        redirectUri: config.get<string>("GOOGLE_OAUTH_REDIRECT_URI", ""),
        tokenEncryptionKey: config.get<string>(
          "GOOGLE_DRIVE_ENCRYPTION_KEY",
          "",
        ),
        ownerEmail: config.get<string>("GOOGLE_DRIVE_OWNER_EMAIL"),
        rootFolderId: config.get<string>("GOOGLE_DRIVE_ROOT_FOLDER_ID"),
        maxDownloadBytes:
          config.get<number>("GOOGLE_DRIVE_MAX_FILE_SIZE_MB", 500) *
          1024 *
          1024,
        maxUploadBytes:
          config.get<number>("GOOGLE_DRIVE_MAX_FILE_SIZE_MB", 500) *
          1024 *
          1024,
        uploadChunkSizeBytes:
          config.get<number>("GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE_MB", 8) *
          1024 *
          1024,
      }),
      persistenceProviders: [
        {
          provide: GOOGLE_DRIVE_OAUTH_STATE_STORE,
          useClass: InMemoryOAuthStateStore,
        },
        {
          provide: GOOGLE_DRIVE_CONNECTION_STORE,
          useClass: PrismaConnectionStore,
        },
        {
          provide: GOOGLE_DRIVE_FOLDER_CACHE,
          useClass: InMemoryFolderCacheStore,
        },
      ],
    }),
    BackupsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: ProfileCompletionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
