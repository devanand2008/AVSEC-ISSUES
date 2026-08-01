import { ApiProperty, ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { FeedbackCycleStatus, FeedbackPriority, FeedbackQrStatus, FeedbackQuestionType, FeedbackSentiment, FeedbackSubmissionRule, FeedbackSubmissionStatus, FeedbackTargetType } from "../../../generated/prisma/enums";

function optionalBoolean(value: unknown): unknown {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}

export class FeedbackHistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class FeedbackDashboardQueryDto {
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsEnum(FeedbackTargetType) targetType?: FeedbackTargetType;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class FeedbackSubmissionQueryDto extends FeedbackHistoryQueryDto {
  @IsOptional() @IsEnum(FeedbackSubmissionStatus) status?: FeedbackSubmissionStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number;
  @IsOptional() @IsEnum(FeedbackSentiment) sentiment?: FeedbackSentiment;
  @IsOptional() @IsEnum(FeedbackPriority) priority?: FeedbackPriority;
  @IsOptional() @IsEnum(FeedbackTargetType) targetType?: FeedbackTargetType;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(["submittedAt", "overallRating", "status", "priority"]) sortBy: "submittedAt" | "overallRating" | "status" | "priority" = "submittedAt";
  @IsOptional() @IsIn(["asc", "desc"]) sortOrder: "asc" | "desc" = "desc";
}

export class FeedbackQrQueryDto extends FeedbackHistoryQueryDto {
  @IsOptional() @IsEnum(FeedbackQrStatus) status?: FeedbackQrStatus;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}

export class FeedbackRatingDto {
  @ApiProperty()
  @IsUUID()
  questionId!: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;
}

export class SubmitFeedbackDto {
  @ApiProperty({ description: "Short-lived signed ticket returned by feedback scan or authorized target lookup." })
  @IsString()
  @Length(40, 2000)
  submissionTicket!: string;

  @ApiProperty({ description: "Public feedback target UUID returned by scan or target lookup." })
  @IsUUID()
  targetId!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  overallRating?: number;

  @ApiProperty({ type: [FeedbackRatingDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FeedbackRatingDto)
  ratings!: FeedbackRatingDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  positiveComment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  improvementComment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  generalComment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  complaintText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;
}

export class SubmitFeedbackByTokenDto extends OmitType(SubmitFeedbackDto, ["submissionTicket", "targetId"] as const) {}

export class FeedbackTargetQueryDto {
  @ApiPropertyOptional({ enum: FeedbackTargetType })
  @IsOptional()
  @IsEnum(FeedbackTargetType)
  targetType?: FeedbackTargetType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class CreateFeedbackTargetDto {
  @ApiProperty({ enum: FeedbackTargetType })
  @IsEnum(FeedbackTargetType)
  targetType!: FeedbackTargetType;

  @ApiProperty()
  @IsString()
  @Length(2, 180)
  targetName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  staffPublicId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campusId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  blockId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  floorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  serviceCode?: string;
}

export class CreateFeedbackQrDto {
  @ApiProperty({ description: "Public feedback target UUID." })
  @IsUUID()
  targetId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}

export class BulkGenerateQrDto {
  @ApiPropertyOptional({ enum: FeedbackTargetType, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(FeedbackTargetType, { each: true })
  targetTypes?: FeedbackTargetType[];
}

export class FeedbackQrStatusDto {
  @ApiProperty({ enum: FeedbackQrStatus })
  @IsEnum(FeedbackQrStatus)
  status!: FeedbackQrStatus;
}

export class FeedbackSubmissionStatusDto {
  @ApiProperty({ enum: FeedbackSubmissionStatus })
  @IsEnum(FeedbackSubmissionStatus)
  status!: FeedbackSubmissionStatus;

  @ApiPropertyOptional({ enum: FeedbackPriority })
  @IsOptional()
  @IsEnum(FeedbackPriority)
  priority?: FeedbackPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  internalNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  actionNote?: string;
}

export class ReopenFeedbackDto {
  @ApiProperty()
  @IsString()
  @Length(3, 1000)
  reason!: string;
}

export class AssignFeedbackDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedToPublicId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedDepartmentId?: string;

  @ApiPropertyOptional({ enum: FeedbackPriority })
  @IsOptional()
  @IsEnum(FeedbackPriority)
  priority?: FeedbackPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiProperty()
  @IsString()
  @Length(3, 1000)
  actionNote!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  internalNote?: string;
}

export class FeedbackSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  requiredAttendancePercentage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  attendanceWarningPercentage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  attendanceCriticalPercentage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  anonymousMode?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  commentsRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  staffCanViewComments?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  studentIdentityVisibleToManagement?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  negativeFeedbackRequiresInvestigation?: boolean;

  @ApiPropertyOptional({ enum: FeedbackSubmissionRule })
  @IsOptional()
  @IsEnum(FeedbackSubmissionRule)
  defaultSubmissionRule?: FeedbackSubmissionRule;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailAlertsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  whatsAppAlertsEnabled?: boolean;
}

export class FeedbackCycleQueryDto extends FeedbackHistoryQueryDto {
  @IsOptional() @IsEnum(FeedbackCycleStatus) status?: FeedbackCycleStatus;
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsOptional() @IsUUID() semesterId?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}

export class CreateFeedbackCycleDto {
  @ApiProperty() @IsString() @Length(2, 160) cycleName!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() academicYearId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() semesterId?: string;
  @ApiProperty() @IsDateString() startDate!: string;
  @ApiProperty() @IsDateString() endDate!: string;
  @ApiPropertyOptional({ enum: FeedbackSubmissionRule }) @IsOptional() @IsEnum(FeedbackSubmissionRule) submissionRule?: FeedbackSubmissionRule;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() anonymousMode?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() commentsRequired?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() staffCanViewComments?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() studentIdentityVisibleToManagement?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() negativeFeedbackRequiresInvestigation?: boolean;
  @ApiPropertyOptional({ enum: FeedbackCycleStatus }) @IsOptional() @IsEnum(FeedbackCycleStatus) status?: FeedbackCycleStatus;
}

export class UpdateFeedbackCycleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 160) cycleName?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() academicYearId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() semesterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional({ enum: FeedbackSubmissionRule }) @IsOptional() @IsEnum(FeedbackSubmissionRule) submissionRule?: FeedbackSubmissionRule;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() anonymousMode?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() commentsRequired?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() staffCanViewComments?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() studentIdentityVisibleToManagement?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() negativeFeedbackRequiresInvestigation?: boolean;
  @ApiPropertyOptional({ enum: FeedbackCycleStatus }) @IsOptional() @IsEnum(FeedbackCycleStatus) status?: FeedbackCycleStatus;
}

export class FeedbackCycleStatusDto {
  @ApiProperty({ enum: FeedbackCycleStatus }) @IsEnum(FeedbackCycleStatus) status!: FeedbackCycleStatus;
}

export class FeedbackQuestionQueryDto extends FeedbackHistoryQueryDto {
  @IsOptional() @IsEnum(FeedbackTargetType) targetType?: FeedbackTargetType;
  @IsOptional() @Transform(({ value }) => optionalBoolean(value)) @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}

export class CreateFeedbackQuestionDto {
  @ApiProperty({ enum: FeedbackTargetType }) @IsEnum(FeedbackTargetType) targetType!: FeedbackTargetType;
  @ApiProperty() @IsString() @Length(2, 120) category!: string;
  @ApiProperty() @IsString() @Length(2, 300) questionText!: string;
  @ApiPropertyOptional({ enum: ["RATING"] }) @IsOptional() @IsIn(["RATING"]) questionType?: FeedbackQuestionType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) displayOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRequired?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateFeedbackQuestionDto {
  @ApiPropertyOptional({ enum: FeedbackTargetType }) @IsOptional() @IsEnum(FeedbackTargetType) targetType?: FeedbackTargetType;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 300) questionText?: string;
  @ApiPropertyOptional({ enum: ["RATING"] }) @IsOptional() @IsIn(["RATING"]) questionType?: FeedbackQuestionType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) displayOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRequired?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class FeedbackQuestionStatusDto {
  @ApiProperty() @IsBoolean() isActive!: boolean;
}

export class UpdateFeedbackTargetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 180) targetName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
