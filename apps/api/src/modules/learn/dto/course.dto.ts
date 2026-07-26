import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import {
  AssessmentType,
  CourseStatus,
  ResourceType,
} from "../../../generated/prisma/enums";

export class CreateCourseDto {
  @ApiProperty()
  @IsString()
  @MaxLength(60)
  code!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(180)
  title!: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  programmeId?: string;

  @ApiProperty({ enum: CourseStatus, required: false })
  @IsEnum(CourseStatus)
  @IsOptional()
  status?: CourseStatus;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  thumbnailUrl?: string;
}

export class UpdateCourseDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: CourseStatus, required: false })
  @IsEnum(CourseStatus)
  @IsOptional()
  status?: CourseStatus;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  thumbnailUrl?: string;
}

export class CreateCourseModuleDto {
  @ApiProperty()
  @IsString()
  @MaxLength(180)
  title!: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class CreateCourseLessonDto {
  @ApiProperty()
  @IsString()
  @MaxLength(180)
  title!: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  content?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  videoUrl?: string;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class CreateCourseResourceDto {
  @ApiProperty()
  @IsString()
  @MaxLength(180)
  title!: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: ResourceType })
  @IsEnum(ResourceType)
  type!: ResourceType;

  @ApiProperty()
  @IsString()
  url!: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  moduleId?: string;
}

export class CreateCourseAssessmentDto {
  @ApiProperty()
  @IsString()
  @MaxLength(180)
  title!: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: AssessmentType, required: false })
  @IsEnum(AssessmentType)
  @IsOptional()
  type?: AssessmentType;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(1)
  @Max(1000)
  @IsOptional()
  maxScore?: number;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(0)
  @Max(1000)
  @IsOptional()
  passingScore?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  questionsJson?: unknown;
}

export class CompleteLessonDto {
  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  completed?: boolean;
}

export class RecordLearningProgressDto {
  @ApiProperty()
  @IsUUID()
  courseId!: string;

  @ApiProperty()
  @IsUUID()
  lessonId!: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  completed?: boolean;
}

export class SubmitAssessmentDto {
  @ApiProperty({ description: "Question IDs mapped to selected option indexes or source code." })
  @IsObject()
  answersJson!: Record<string, string | number>;
}

export class RunLearningCodeDto {
  @ApiProperty({ enum: ["c", "cpp", "java", "python", "javascript", "sql"] })
  @IsString()
  @IsIn(["c", "cpp", "java", "python", "javascript", "sql"])
  language!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(20_000)
  sourceCode!: string;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(2_000)
  @IsOptional()
  stdin?: string;
}
