import { Module } from "@nestjs/common";
import { ReportsModule } from "../reports/reports.module";
import { UsersModule } from "../users/users.module";
import { AttendanceController } from "./attendance.controller";
import { AttendanceService } from "./attendance.service";

@Module({ imports: [UsersModule, ReportsModule], controllers: [AttendanceController], providers: [AttendanceService], exports: [AttendanceService] })
export class AttendanceModule {}
