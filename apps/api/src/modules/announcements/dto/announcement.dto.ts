import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { AnnouncementCategory, AnnouncementDeliveryStatus, IssuePriority, ScopeType } from "../../../generated/prisma/enums";

export class AnnouncementAudienceDto {
  @ApiProperty({ enum: ScopeType }) @IsEnum(ScopeType) scopeType!: ScopeType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() scopeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) roleCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
}

export class CreateAnnouncementDto {
  @ApiProperty({ minLength: 2, maxLength: 200 })
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @Length(2, 200)
  @Matches(/^[^<>]+$/u, { message: "title must not contain HTML markup" })
  title!: string;
  @ApiProperty() @IsString() @Length(3, 10000) message!: string;
  @ApiPropertyOptional({ enum: AnnouncementCategory }) @IsOptional() @IsEnum(AnnouncementCategory) category?: AnnouncementCategory;
  @ApiPropertyOptional({ enum: IssuePriority }) @IsOptional() @IsEnum(IssuePriority) priority?: IssuePriority;
  @ApiPropertyOptional() @IsOptional() @IsDateString() publishAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pinned?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresAcknowledgement?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showOnAppOpen?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showOnlyOnce?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sendPush?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sendEmail?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) idempotencyKey?: string;
  @ApiProperty({ type: [AnnouncementAudienceDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AnnouncementAudienceDto) audiences!: AnnouncementAudienceDto[];
}

export class UpdateAnnouncementDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 200 })
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @Length(2, 200)
  @Matches(/^[^<>]+$/u, { message: "title must not contain HTML markup" })
  title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 10000) message?: string;
  @ApiPropertyOptional({ enum: AnnouncementCategory }) @IsOptional() @IsEnum(AnnouncementCategory) category?: AnnouncementCategory;
  @ApiPropertyOptional({ enum: IssuePriority }) @IsOptional() @IsEnum(IssuePriority) priority?: IssuePriority;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pinned?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresAcknowledgement?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showOnAppOpen?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showOnlyOnce?: boolean;
}

export class PresignAnnouncementImageDto {
  @ApiProperty() @IsString() @MaxLength(255) fileName!: string;
  @ApiProperty() @IsString() mimeType!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(20 * 1024 * 1024) sizeBytes!: number;
}

export class CompleteAnnouncementImageDto {
  @ApiProperty() @IsString() storageKey!: string;
  @ApiProperty() @IsString() @MaxLength(255) fileName!: string;
  @ApiProperty() @IsString() mimeType!: string;
  @ApiProperty() @IsInt() @Min(1) sizeBytes!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) width?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) height?: number;
}

export class RecipientQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional({ enum: AnnouncementDeliveryStatus }) @IsOptional() @IsEnum(AnnouncementDeliveryStatus) deliveryStatus?: AnnouncementDeliveryStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() roleCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
