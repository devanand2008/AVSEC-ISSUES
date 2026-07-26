import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsIn, IsOptional, IsUUID } from "class-validator";

export class AttendanceTemplateQueryDto {
  @ApiProperty() @IsUUID() sectionId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subjectId?: string;
  @ApiProperty() @IsDateString() dateFrom!: string;
  @ApiProperty() @IsDateString() dateTo!: string;
}

export class AttendanceImportUploadDto extends AttendanceTemplateQueryDto {
  @ApiProperty() @IsIn(["VALIDATE_ONLY", "CREATE_MISSING_SUMMARY", "UPDATE_EXISTING_SUMMARY", "CREATE_AND_UPDATE"]) importMode!: string;
  @ApiProperty() @IsIn(["OVERALL_PERCENTAGE", "SUBJECT_PERCENTAGE", "MONTHLY_SUMMARY", "WORKING_AND_PRESENT", "PERIOD_WISE"]) attendanceMode!: string;
}

export class ConfirmAttendanceImportDto {
  @ApiProperty() @IsUUID() batchId!: string;
}
