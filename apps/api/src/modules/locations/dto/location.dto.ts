import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from "class-validator";
import { RoomType } from "../../../generated/prisma/enums";

function normalizeRoomType({ value }: { value: unknown }): unknown {
  return typeof value === "string"
    ? value.trim().toUpperCase().replace(/[\s-]+/g, "_")
    : value;
}

export class CreateCampusDto {
  @ApiProperty() @IsString() @Length(1, 30) code!: string;
  @ApiProperty() @IsString() @Length(2, 160) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) contactNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class CreateBlockDto {
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty() @IsString() @Length(1, 30) code!: string;
  @ApiProperty() @IsString() @Length(2, 120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class CreateFloorDto {
  @ApiProperty() @IsUUID() blockId!: string;
  @ApiProperty() @IsString() @Length(1, 30) code!: string;
  @ApiProperty() @IsString() @Length(2, 100) name!: string;
  @ApiProperty() @IsInt() @Min(-10) @Max(200) level!: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class CreateRoomDto {
  @ApiProperty() @IsUUID() floorId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiProperty() @IsString() @Length(1, 40) code!: string;
  @ApiProperty() @IsString() @Length(2, 140) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) roomNumber?: string;
  @ApiProperty({ enum: RoomType }) @Transform(normalizeRoomType) @IsEnum(RoomType) roomType!: RoomType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100_000) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateLocationStatusDto {
  @ApiProperty() @IsBoolean() isActive!: boolean;
}

export class UpdateCampusDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 160) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) address?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) contactNumber?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isTestData?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class UpdateBlockDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() campusId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isTestData?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class UpdateFloorDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() blockId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-10) @Max(200) level?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isTestData?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class UpdateRoomDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() floorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 140) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) roomNumber?: string | null;
  @ApiPropertyOptional({ enum: RoomType }) @IsOptional() @Transform(normalizeRoomType) @IsEnum(RoomType) roomType?: RoomType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100_000) capacity?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isTestData?: boolean;
}

export class ArchiveLocationDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class DeleteLocationDto extends ArchiveLocationDto {
  @ApiProperty() @IsString() @IsIn(["PERMANENTLY DELETE LOCATION"]) confirmationPhrase!: string;
}

export class BulkLocationDto extends ArchiveLocationDto {
  @ApiProperty({ type: [String] }) @IsArray() @Length(1, 100, { each: true }) @IsUUID(undefined, { each: true }) ids!: string[];
}
