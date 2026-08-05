import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from "class-validator";

export const BROADCAST_AUDIENCE_TYPES = [
  "ALL",
  "ROLE",
  "DEPARTMENT",
  "PROGRAMME",
  "ACADEMIC_YEAR",
  "SEMESTER",
  "SECTION",
  "INDIVIDUAL",
] as const;

export type BroadcastAudienceType = (typeof BROADCAST_AUDIENCE_TYPES)[number];

export class CreateBroadcastDto {
  @ApiProperty({ minLength: 1, maxLength: 180 })
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @Length(1, 180)
  title!: string;

  @ApiProperty({ minLength: 1, maxLength: 10000 })
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @Length(1, 10000)
  body!: string;

  @ApiProperty({ enum: BROADCAST_AUDIENCE_TYPES })
  @IsIn(BROADCAST_AUDIENCE_TYPES)
  audienceType!: BroadcastAudienceType;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(120)
  audienceValue?: string;

  @ApiPropertyOptional({ type: [String], description: "Selected active user IDs for an INDIVIDUAL broadcast." })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID("4", { each: true })
  recipientIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
