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
import { ImportsModule } from "./modules/imports/imports.module";
import { LearnModule } from "./modules/learn/learn.module";
import { resolve } from "node:path";

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
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
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
