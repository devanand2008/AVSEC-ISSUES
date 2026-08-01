import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, IsUUID, Length, MaxLength } from "class-validator";
import { IssuePriority, IssueStatus } from "../../../generated/prisma/enums";

export class CreateIssueDto {
  @ApiProperty() @IsUUID() roomId!: string;
  @ApiProperty() @IsUUID() categoryId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() issueTypeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assetId?: string;
  @ApiProperty() @IsString() @Length(3, 160) title!: string;
  @ApiProperty() @IsString() @Length(10, 5000) description!: string;
  @ApiPropertyOptional({ enum: IssuePriority }) @IsOptional() @IsEnum(IssuePriority) prioritySuggestion?: IssuePriority;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) exactPosition?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) submissionSource?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) qrToken?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() createDespiteDuplicate?: boolean;
}

export class IssueStatusDto {
  @ApiProperty({ enum: IssueStatus }) @IsEnum(IssueStatus) status!: IssueStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 1000) comment?: string;
}

export class IssueCommentDto {
  @ApiProperty() @IsString() @Length(1, 5000) body!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isInternal?: boolean;
}

export class AssignIssueDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiProperty() @IsString() @Length(3, 1000) reason!: string;
}

export class SubscribeIssueDto {
  @ApiPropertyOptional({ description: "Short-lived proof returned with a probable-duplicate response." })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  duplicateSubscriptionProof?: string;
}

export class VerifyIssueDto {
  @ApiProperty() @IsBoolean() accepted!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

export class IssueTimelineDto {
  @ApiProperty() @IsDateString() expectedCompletionAt!: string;
  @ApiProperty() @IsString() @Length(3, 1000) reason!: string;
  @ApiProperty() @IsString() @Length(2, 2000) progressNote!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) requiredParts?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiredApproval?: boolean;
}

export class FinishIssueDto {
  @ApiProperty() @IsString() @Length(3, 5000) resolutionNote!: string;
  @ApiProperty() @IsUUID() completionPhotoFileId!: string;
  @ApiProperty() @IsDateString() completedAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) partsUsed?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) costNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) supervisorComment?: string;
}

export class CreateIssueCategoryDto {
  @ApiProperty() @IsString() @Length(2, 50) code!: string;
  @ApiProperty() @IsString() @Length(2, 120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class CreateIssueTypeDto {
  @ApiProperty() @IsUUID() categoryId!: string;
  @ApiProperty() @IsString() @Length(2, 60) code!: string;
  @ApiProperty() @IsString() @Length(2, 160) name!: string;
  @ApiPropertyOptional({ enum: IssuePriority }) @IsOptional() @IsEnum(IssuePriority) defaultPriority?: IssuePriority;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isOther?: boolean;
}

export class UpdateIssueCategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) icon?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() sortOrder?: number;
}

export class UpdateIssueTypeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 160) name?: string;
  @ApiPropertyOptional({ enum: IssuePriority }) @IsOptional() @IsEnum(IssuePriority) defaultPriority?: IssuePriority;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isOther?: boolean;
  @ApiPropertyOptional() @IsOptional() sortOrder?: number;
}
