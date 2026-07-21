import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { IssuePriority, RoomType } from "../../../generated/prisma/enums";

export class CreateTeamDto {
  @ApiProperty() @IsString() @Length(2, 50) code!: string;
  @ApiProperty() @IsString() @Length(2, 140) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefaultMaintenance?: boolean;
}

export class CreateRoutingRuleDto {
  @ApiProperty() @IsUUID() teamId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() campusId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() blockId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() floorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() roomId?: string;
  @ApiPropertyOptional({ enum: RoomType }) @IsOptional() @IsEnum(RoomType) roomType?: RoomType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() issueTypeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assetId?: string;
  @ApiPropertyOptional({ enum: IssuePriority }) @IsOptional() @IsEnum(IssuePriority) priorityFilter?: IssuePriority;
  @ApiPropertyOptional() @IsOptional() @IsUUID() primaryUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() backupUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() escalationUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10000) rulePriority?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() workloadBalancing?: boolean;
}

export class UpsertSlaDto {
  @ApiProperty({ enum: IssuePriority }) @IsEnum(IssuePriority) priority!: IssuePriority;
  @ApiProperty() @IsInt() @Min(1) @Max(525600) acknowledgementMinutes!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(5256000) resolutionMinutes!: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() workingHoursOnly?: boolean;
}
