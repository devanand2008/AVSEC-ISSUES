import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { BackupCryptoService } from "./backup-crypto.service";
import { BackupManifestService } from "./backup-manifest.service";
import { BackupRetentionService } from "./backup-retention.service";
import { BackupSchedulerService } from "./backup-scheduler.service";
import { BackupsController } from "./backups.controller";
import { BackupsService } from "./backups.service";
import { PostgresToolsService } from "./postgres-tools.service";
import { SafeProcessRunner } from "./safe-process-runner.service";

@Module({
  imports: [AuditModule],
  controllers: [BackupsController],
  providers: [
    BackupCryptoService,
    BackupManifestService,
    BackupRetentionService,
    BackupSchedulerService,
    SafeProcessRunner,
    PostgresToolsService,
    BackupsService,
  ],
  exports: [BackupsService],
})
export class BackupsModule {}
