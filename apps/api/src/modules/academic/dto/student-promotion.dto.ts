import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";

export const STUDENT_COMPLETION_STATUSES = [
  "COMPLETED",
  "GRADUATED",
  "ALUMNI",
  "DISCONTINUED",
  "TRANSFERRED",
] as const;

export type StudentCompletionStatus =
  (typeof STUDENT_COMPLETION_STATUSES)[number];

export class StudentPromotionDto {
  @ApiProperty()
  @IsUUID()
  sourceSectionId!: string;

  @ApiProperty({ type: [String], minItems: 1, maxItems: 500 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  studentPublicIds!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetSectionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetAcademicYearId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  targetStudyYear?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetSemesterId?: string;

  @ApiPropertyOptional({ enum: STUDENT_COMPLETION_STATUSES })
  @IsOptional()
  @IsIn(STUDENT_COMPLETION_STATUSES)
  completionStatus?: StudentCompletionStatus;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  academicOverride?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(10, 500)
  academicOverrideReason?: string;
}

export class PreviewStudentPromotionDto extends StudentPromotionDto {}

export class ConfirmStudentPromotionDto extends StudentPromotionDto {}
