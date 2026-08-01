import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Multipart clients may send comma-separated role codes.
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export class CreateAiConversationDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(160)
  title?: string;
}

export class UpdateAiConversationDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsIn(["ACTIVE", "ARCHIVED"])
  status?: "ACTIVE" | "ARCHIVED";
}

export class StreamAiChatDto {
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @Transform(trimmed)
  @IsString()
  @Length(1, 8_000)
  message!: string;

  @Transform(trimmed)
  @IsString()
  @Length(8, 80)
  clientRequestId!: string;

  @IsOptional()
  @IsUUID()
  retryMessageId?: string;
}

export class AiFeedbackDto {
  @IsUUID()
  messageId!: string;

  @IsIn(["HELPFUL", "NOT_HELPFUL", "REPORTED"])
  rating!: "HELPFUL" | "NOT_HELPFUL" | "REPORTED";

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(1_000)
  comment?: string;
}

export class UpdateAiUserSettingDto {
  @IsOptional()
  @IsIn(["AUTO", "ENGLISH", "TAMIL"])
  language?: "AUTO" | "ENGLISH" | "TAMIL";

  @IsOptional()
  @IsIn(["SHORT", "BALANCED", "DETAILED"])
  responseLength?: "SHORT" | "BALANCED" | "DETAILED";

  @IsOptional()
  @IsBoolean()
  showSources?: boolean;

  @IsOptional()
  @IsBoolean()
  saveHistory?: boolean;

  @IsOptional()
  @IsBoolean()
  keepLocalCache?: boolean;

  @IsOptional()
  @IsBoolean()
  autoTitle?: boolean;
}

export class UploadAiKnowledgeDto {
  @Transform(trimmed)
  @IsString()
  @Length(1, 240)
  title!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(1_000)
  description?: string;

  @Transform(trimmed)
  @IsString()
  @Length(1, 100)
  category!: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  programmeId?: string;

  @IsOptional()
  @IsUUID()
  semesterId?: string;

  @IsOptional()
  @Transform(({ value }) => stringArray(value))
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  roleVisibility?: string[];

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  academicYear?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  version?: string;
}

export class CreateManualAiKnowledgeDto extends UploadAiKnowledgeDto {
  @Transform(trimmed)
  @IsString()
  @Length(20, 200_000)
  content!: string;
}

export class UpdateAiBotSettingDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(8_000)
  maxOutputTokens?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  monthlyBudget?: number;

  @IsOptional()
  @IsIn(["internal", "openai_file_search"])
  knowledgeProvider?: "internal" | "openai_file_search";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3_650)
  retentionDays?: number;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(160)
  safetyContactName?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(240)
  safetyContactRoute?: string;
}

export class AiUsageQueryDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  from?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  to?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

