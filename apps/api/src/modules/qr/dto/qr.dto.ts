import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsIn, IsObject, IsOptional, IsString, IsUUID, Length, MaxLength } from "class-validator";

export class ValidateQrDto {
  @ApiProperty()
  @IsString()
  @Length(3, 500)
  token!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  scanMethod?: string;
}

const qrCodeTypes = ["APPLICATION", "BLOCK", "FLOOR", "CLASS", "ANNOUNCEMENT", "LINK"] as const;
const qrCodeStatuses = ["ACTIVE", "DISABLED", "REVOKED"] as const;

export class CreateQrCodeDto {
  @ApiProperty({ enum: qrCodeTypes })
  @IsIn(qrCodeTypes)
  qrType!: (typeof qrCodeTypes)[number];

  @ApiProperty()
  @IsString()
  @Length(2, 180)
  label!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  destination?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateQrStatusDto {
  @ApiProperty({ enum: qrCodeStatuses })
  @IsIn(qrCodeStatuses)
  status!: (typeof qrCodeStatuses)[number];
}
