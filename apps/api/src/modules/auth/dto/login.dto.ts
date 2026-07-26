import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "deva1253@college.com" })
  @IsString()
  @Length(3, 254)
  identifier!: string;

  @ApiProperty({ minLength: 6 })
  @IsString()
  @MinLength(6)
  @MaxLength(200)
  password!: string;

  @ApiPropertyOptional({ description: "Required when a college ID is not globally unique" })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  collegeCode?: string;
}
