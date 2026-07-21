import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches, MaxLength, MinLength } from "class-validator";

const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;

export class ForgotPasswordDto {
  @ApiProperty() @IsString() @Length(3, 254) identifier!: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @Length(32, 500) token!: string;
  @ApiProperty() @IsString() @MinLength(12) @MaxLength(200) @Matches(STRONG_PASSWORD, { message: "newPassword must include uppercase, lowercase, number and special character." }) newPassword!: string;
}
