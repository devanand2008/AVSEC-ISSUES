import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsDefined, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from "class-validator";

export class UpdateSettingDto {
  @ApiProperty() @IsDefined() value!: unknown;
}

export class SearchDto {
  @ApiProperty() @IsString() @Length(2, 100) query!: string;
}

export class AuditLogQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 50;
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @IsString() @MaxLength(80) entityType?: string;
  @IsOptional() @IsString() @MaxLength(180) actor?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class BackgroundJobQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 50;
  @IsOptional() @IsString() @MaxLength(100) queue?: string;
  @IsOptional() @IsIn(["true", "false"]) resolved?: string;
}

export class CreateNotificationTemplateDto {
  @ApiProperty() @IsString() @Length(2, 100) code!: string;
  @ApiProperty() @IsString() @IsIn(["IN_APP", "PUSH", "WHATSAPP", "EMAIL", "SMS"]) channel!: string;
  @ApiProperty() @IsString() @Length(1, 10) language!: string;
  @ApiProperty() @IsOptional() @IsString() @MaxLength(500) subjectTemplate?: string;
  @ApiProperty() @IsString() @Length(1, 4000) bodyTemplate!: string;
}

export class UpdateNotificationTemplateDto {
  @ApiProperty() @IsOptional() @IsString() @MaxLength(500) subjectTemplate?: string;
  @ApiProperty() @IsOptional() @IsString() @Length(1, 4000) bodyTemplate?: string;
  @ApiProperty() @IsOptional() @IsIn(["true", "false", true, false]) isActive?: boolean | string;
}

export class CreateAssetDto {
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() roomId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() areaId?: string;
  @ApiProperty() @IsUUID() categoryId!: string;
  @ApiProperty() @IsString() @Length(2, 60) code!: string;
  @ApiProperty() @IsString() @Length(2, 160) name!: string;
  @ApiProperty() @IsOptional() @IsString() @MaxLength(120) serialNumber?: string;
}

export class UpdateAssetStatusDto {
  @ApiProperty() isActive!: boolean;
}

export const DATA_MAINTENANCE_CATEGORIES = [
  "ARCHIVE_OLD_ACADEMIC_YEAR",
  "PROMOTE_STUDENTS",
  "MOVE_STUDENTS_TO_NEW_SEMESTER",
  "ARCHIVE_OLD_ATTENDANCE_SESSIONS",
  "ARCHIVE_OLD_COURSE_ASSIGNMENTS",
  "ARCHIVE_OLD_ANNOUNCEMENTS",
  "ARCHIVE_CLOSED_ISSUES",
  "DELETE_TEMPORARY_IMPORTS",
  "CLEAN_EXPIRED_SESSIONS",
  "CLEAN_ORPHANED_ATTACHMENTS",
  "PREPARE_NEW_ACADEMIC_YEAR",
] as const;

export type DataMaintenanceCategory = typeof DATA_MAINTENANCE_CATEGORIES[number];

export class DataMaintenanceDryRunDto {
  @ApiProperty({ enum: DATA_MAINTENANCE_CATEGORIES })
  @IsIn(DATA_MAINTENANCE_CATEGORIES) category!: DataMaintenanceCategory;

  @ApiProperty({ required: false }) @IsOptional() @IsDateString() beforeDate?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() academicYearId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() sourceSectionId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() targetSectionId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() targetAcademicYearId?: string;
}

export class DataMaintenanceBackupDto {
  @ApiProperty() @IsString() @Length(3, 255) backupReference!: string;
}

export class ExecuteDataMaintenanceDto extends DataMaintenanceBackupDto {
  @ApiProperty() @IsString() @Length(8, 300) confirmationPhrase!: string;
  @ApiProperty() @IsString() @Length(10, 500) reason!: string;
}
