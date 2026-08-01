import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
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

export class PresignProfilePhotoDto {
  @ApiProperty() @IsString() @Length(1, 255) fileName!: string;
  @ApiProperty({ enum: ["image/jpeg", "image/png", "image/webp"] })
  @IsIn(["image/jpeg", "image/png", "image/webp"])
  mimeType!: "image/jpeg" | "image/png" | "image/webp";
  @ApiProperty() @IsInt() @Min(1) @Max(10 * 1024 * 1024) sizeBytes!: number;
}

export class CompleteProfilePhotoDto extends PresignProfilePhotoDto {
  @ApiProperty() @IsString() @Length(20, 500) storageKey!: string;
}

export class PresignMessageAttachmentDto extends PresignIssueAttachmentDto {
  @ApiProperty() @IsUUID() conversationId!: string;
}

export class CompleteMessageAttachmentUploadDto extends CompleteIssueAttachmentDto {
  @ApiProperty() @IsUUID() conversationId!: string;
}

export class PresignLearningFileDto {
  @ApiProperty() @IsString() @Length(1, 255) fileName!: string;
  @ApiProperty() @IsString() @Length(3, 120) mimeType!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100_000_000) sizeBytes!: number;
}

export class CompleteSubjectResourceDto extends PresignLearningFileDto {
  @ApiProperty() @IsString() @Length(20, 500) storageKey!: string;
  @ApiProperty() @IsString() @Length(1, 180) title!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(0, 1000) description?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(0, 120) unitOrModule?: string;
  @ApiProperty() @IsIn(["SUBJECT_NOTES", "UNIT_NOTES", "LECTURE_PDF", "PRESENTATION", "PREVIOUS_YEAR_QUESTION_PAPER", "QUESTION_BANK", "ANSWER_KEY", "LABORATORY_MANUAL", "PROGRAMMING_EXERCISE", "ASSIGNMENT", "REFERENCE_MATERIAL", "SYLLABUS_COPY"]) resourceType!: string;
  @ApiProperty({ type: [String], required: false }) @IsOptional() @IsArray() @IsUUID("4", { each: true }) targetSectionIds?: string[];
  @ApiProperty({ required: false }) @IsOptional() @IsIn(["DRAFT", "PUBLISHED"]) status?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() publishAt?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() expiresAt?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() allowDownload?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() notifyStudents?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() sendToSubjectGroup?: boolean;
}

export class CompleteModelQuestionPaperDto extends PresignLearningFileDto {
  @ApiProperty() @IsString() @Length(20, 500) storageKey!: string;
  @ApiProperty() @IsString() @Length(1, 180) title!: string;
  @ApiProperty() @IsString() @Length(1, 60) examType!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(0, 30) academicYear?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) @Max(1000) maximumMarks?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) @Max(1440) durationMinutes?: number;
  @ApiProperty({ type: [String], required: false }) @IsOptional() @IsArray() @IsUUID("4", { each: true }) targetSectionIds?: string[];
  @ApiProperty({ required: false }) @IsOptional() @IsIn(["DRAFT", "PUBLISHED"]) status?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() publishAt?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() expiresAt?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() answerKeyReleaseAt?: string;
}
