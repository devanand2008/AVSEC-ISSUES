import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { RoomType } from "../../../generated/prisma/enums";

function normalizeRoomType({ value }: { value: unknown }): unknown {
  return typeof value === "string"
    ? value
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_")
    : value;
}

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? value.trim() : value;
}

const validateIfDefined = (_object: object, value: unknown): boolean =>
  value !== undefined;

const validateCustomRoomTypeLabel = (
  object: { roomType?: RoomType },
  value: unknown,
): boolean =>
  object.roomType === RoomType.OTHER ||
  (object.roomType === undefined && value !== undefined && value !== null);

export class CreateCampusDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(1, 30)
  code!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 160)
  name!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  address?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class CreateBlockDto {
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(1, 30)
  code!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 120)
  name!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class CreateFloorDto {
  @ApiProperty() @IsUUID() blockId!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(1, 30)
  code!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 100)
  name!: string;
  @ApiProperty() @IsInt() @Min(-10) @Max(200) level!: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class CreateRoomDto {
  @ApiProperty() @IsUUID() floorId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(1, 40)
  code!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 140)
  name!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 40)
  roomNumber?: string;
  @ApiProperty({ enum: RoomType })
  @Transform(normalizeRoomType)
  @IsEnum(RoomType)
  roomType!: RoomType;
  @ApiPropertyOptional({
    description: "Required when roomType is OTHER.",
    minLength: 2,
    maxLength: 80,
    nullable: true,
  })
  @ValidateIf(validateCustomRoomTypeLabel)
  @Transform(trimString)
  @IsString()
  @Length(2, 80)
  customRoomTypeLabel?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  capacity?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateAreaDto {
  @ApiProperty() @IsUUID() floorId!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(1, 40)
  code!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 150)
  name!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateLocationStatusDto {
  @ApiProperty() @IsBoolean() isActive!: boolean;
}

export class UpdateCampusDto {
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @Transform(trimString)
  @IsString()
  @Length(1, 30)
  code?: string;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @Transform(trimString)
  @IsString()
  @Length(2, 160)
  name?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) address?:
    | string
    | null;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactNumber?: string | null;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsBoolean()
  isActive?: boolean;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsBoolean()
  isTestData?: boolean;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class UpdateBlockDto {
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsUUID()
  campusId?: string;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @Transform(trimString)
  @IsString()
  @Length(1, 30)
  code?: string;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @Transform(trimString)
  @IsString()
  @Length(2, 120)
  name?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsBoolean()
  isActive?: boolean;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsBoolean()
  isTestData?: boolean;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class UpdateFloorDto {
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsUUID()
  blockId?: string;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @Transform(trimString)
  @IsString()
  @Length(1, 30)
  code?: string;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @Transform(trimString)
  @IsString()
  @Length(2, 100)
  name?: string;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsInt()
  @Min(-10)
  @Max(200)
  level?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsBoolean()
  isActive?: boolean;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsBoolean()
  isTestData?: boolean;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class UpdateRoomDto {
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsUUID()
  floorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string | null;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @Transform(trimString)
  @IsString()
  @Length(1, 40)
  code?: string;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @Transform(trimString)
  @IsString()
  @Length(2, 140)
  name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) roomNumber?:
    | string
    | null;
  @ApiPropertyOptional({ enum: RoomType })
  @ValidateIf(validateIfDefined)
  @Transform(normalizeRoomType)
  @IsEnum(RoomType)
  roomType?: RoomType;
  @ApiPropertyOptional({
    description: "Required when roomType is OTHER.",
    minLength: 2,
    maxLength: 80,
    nullable: true,
  })
  @ValidateIf(validateCustomRoomTypeLabel)
  @Transform(trimString)
  @IsString()
  @Length(2, 80)
  customRoomTypeLabel?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  capacity?: number | null;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsBoolean()
  isActive?: boolean;
  @ApiPropertyOptional()
  @ValidateIf(validateIfDefined)
  @IsBoolean()
  isTestData?: boolean;
}

export class ArchiveLocationDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class DeleteLocationDto extends ArchiveLocationDto {
  @ApiProperty()
  @IsString()
  @IsIn(["PERMANENTLY DELETE LOCATION"])
  confirmationPhrase!: string;
}

export class BulkLocationDto extends ArchiveLocationDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  ids!: string[];
}

export class AdminLocationListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;
  @ApiPropertyOptional({
    enum: ["ACTIVE", "INACTIVE", "ARCHIVED", "TEST_DATA"],
  })
  @IsOptional()
  @IsIn(["ACTIVE", "INACTIVE", "ARCHIVED", "TEST_DATA"])
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() campusId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() blockId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() floorId?: string;
  @ApiPropertyOptional({ enum: RoomType })
  @IsOptional()
  @Transform(normalizeRoomType)
  @IsEnum(RoomType)
  roomType?: RoomType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class PresignLocationImageDto {
  @ApiProperty() @IsString() @Length(1, 255) fileName!: string;
  @ApiProperty({ enum: ["image/jpeg", "image/png", "image/webp"] })
  @IsIn(["image/jpeg", "image/png", "image/webp"])
  mimeType!: "image/jpeg" | "image/png" | "image/webp";
  @ApiProperty() @IsInt() @Min(1) @Max(10 * 1024 * 1024) sizeBytes!: number;
}

export class CompleteLocationImageDto extends PresignLocationImageDto {
  @ApiProperty() @IsString() @Length(20, 500) storageKey!: string;
}
