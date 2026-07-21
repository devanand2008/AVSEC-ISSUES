import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Length } from "class-validator";

export class RegisterDeviceDto {
  @ApiProperty({ description: "Firebase Cloud Messaging registration token" })
  @IsString()
  @Length(20, 4096)
  token!: string;

  @ApiProperty({ enum: ["WEB", "ANDROID", "IOS"] })
  @IsIn(["WEB", "ANDROID", "IOS"])
  platform!: "WEB" | "ANDROID" | "IOS";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  deviceName?: string;
}
