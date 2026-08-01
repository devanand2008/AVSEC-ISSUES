import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsOptional, IsString, Length, MaxLength } from "class-validator";

export const BROADCAST_AUDIENCE_TYPES = [
  "ALL",
  "ROLE",
  "DEPARTMENT",
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

  @ApiPropertyOptional({ maxLength: 180 })
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(180)
  audienceValue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
