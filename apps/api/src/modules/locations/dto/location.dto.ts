import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { RoomType } from "../../../generated/prisma/enums";

export class CreateBlockDto {
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty() @IsString() @Length(1, 30) code!: string;
  @ApiProperty() @IsString() @Length(2, 120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class CreateFloorDto {
  @ApiProperty() @IsUUID() blockId!: string;
  @ApiProperty() @IsString() @Length(1, 30) code!: string;
  @ApiProperty() @IsString() @Length(2, 100) name!: string;
  @ApiProperty() @IsInt() @Min(-10) @Max(200) level!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class CreateRoomDto {
  @ApiProperty() @IsUUID() floorId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiProperty() @IsString() @Length(1, 40) code!: string;
  @ApiProperty() @IsString() @Length(2, 140) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) roomNumber?: string;
  @ApiProperty({ enum: RoomType }) @IsEnum(RoomType) roomType!: RoomType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100_000) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class UpdateLocationStatusDto {
  @ApiProperty() @IsBoolean() isActive!: boolean;
}
