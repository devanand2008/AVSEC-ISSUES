import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsInt, IsString, Length, Max, Min } from "class-validator";
import { AttachmentPurpose } from "../../../generated/prisma/enums";

export class PresignIssueAttachmentDto {
  @ApiProperty() @IsString() @Length(1, 255) fileName!: string;
  @ApiProperty() @IsString() @Length(3, 120) mimeType!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100_000_000) sizeBytes!: number;
  @ApiProperty({ enum: AttachmentPurpose }) @IsEnum(AttachmentPurpose) purpose!: AttachmentPurpose;
}

export class CompleteIssueAttachmentDto extends PresignIssueAttachmentDto {
  @ApiProperty() @IsString() @Length(20, 500) storageKey!: string;
}
