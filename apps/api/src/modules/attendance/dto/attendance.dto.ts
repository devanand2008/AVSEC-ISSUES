import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsEmail, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { AttendanceCode } from "../../../generated/prisma/enums";

export class CreateAttendanceSessionDto {
  @ApiProperty() @IsUUID() academicYearId!: string;
  @ApiProperty() @IsUUID() sectionId!: string;
  @ApiProperty() @IsUUID() subjectId!: string;
  @ApiProperty() @IsDateString({ strict: true }) sessionDate!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(20) periodNumber!: number;
}

export class AttendanceRecordDto {
  @ApiProperty() @IsUUID() studentUserId!: string;
  @ApiProperty({ enum: AttendanceCode }) @IsEnum(AttendanceCode) status!: AttendanceCode;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class SubmitAttendanceDto {
  @ApiProperty({ description: "Current attendance-session version used for optimistic concurrency control." })
  @IsInt() @Min(1)
  expectedVersion!: number;

  @ApiProperty({ type: [AttendanceRecordDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => AttendanceRecordDto)
  records!: AttendanceRecordDto[];
}

export class RequestCorrectionDto {
  @ApiProperty() @IsUUID() recordId!: string;
  @ApiProperty({ enum: AttendanceCode }) @IsEnum(AttendanceCode) requestedStatus!: AttendanceCode;
  @ApiProperty() @IsString() @Length(5, 1000) reason!: string;
}

export class ReviewCorrectionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

export class AddClassStudentDto {
  @ApiProperty() @IsString() @Length(2, 180) fullName!: string;
  @ApiProperty() @IsString() @Length(2, 60) studentId!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) mobile?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) rollNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1990) @Max(2200) admissionYear?: number;
  @ApiProperty({ minLength: 12 }) @IsString() @MinLength(12) @MaxLength(200) temporaryPassword!: string;
}
