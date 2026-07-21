import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from "class-validator";

export class CreateDirectConversationDto {
  @ApiProperty() @IsUUID() participantPublicId!: string;
}

export class SendMessageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) body?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() replyToId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() forwardedFromId?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(["TEXT", "IMAGE", "DOCUMENT", "VIDEO", "AUDIO"]) messageType?: "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO" | "AUDIO";
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) clientId?: string;
}

export class EditMessageDto {
  @ApiProperty() @IsString() @Length(1, 5000) body!: string;
}

export class ReactionDto {
  @ApiProperty() @IsString() @Length(1, 30) emoji!: string;
}

export class ReportMessageDto {
  @ApiProperty() @IsString() @Length(5, 1000) reason!: string;
}

export class ConversationPreferenceDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() mutedUntil?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pinned?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() archived?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() markedUnread?: boolean;
}

export class CreateGroupConversationDto {
  @ApiProperty() @IsString() @Length(2, 180) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(250) @IsUUID(undefined, { each: true }) participantPublicIds!: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sendRestricted?: boolean;
}

export class UpdateConversationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 180) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sendRestricted?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() archived?: boolean;
}

export class MessageSearchDto {
  @ApiProperty() @IsString() @Length(2, 100) query!: string;
}

export class ModerateMessageReportDto {
  @ApiProperty() @IsIn(["REVIEWED", "DISMISSED", "ACTIONED"]) status!: "REVIEWED" | "DISMISSED" | "ACTIONED";
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
