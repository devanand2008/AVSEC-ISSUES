import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { QrController } from "./qr.controller";
import { QrService } from "./qr.service";

@Module({
  imports: [AuditModule],
  controllers: [QrController],
  providers: [QrService],
})
export class QrModule {}
