import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsDateString, IsEmail, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from "class-validator";

export class CreateDepartmentDto {
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty() @IsString() @Length(1, 30) code!: string;
  @ApiProperty() @IsString() @Length(2, 180) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) shortName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() hodPublicId?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) officialEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) contactNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class UpdateDepartmentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 180) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) shortName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() hodPublicId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) officialEmail?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) contactNumber?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) location?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class CreateProgrammeDto {
  @ApiProperty() @IsUUID() departmentId!: string;
  @ApiProperty() @IsString() @Length(1, 30) code!: string;
  @ApiProperty() @IsString() @Length(2, 180) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) degreeType?: string;
  @ApiProperty() @IsInt() @Min(1) @Max(10) durationYears!: number;
}

export class UpdateProgrammeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 180) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10) durationYears?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) degreeType?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateAcademicYearDto {
  @ApiProperty() @IsString() @Length(2, 30) name!: string;
  @ApiProperty() @IsString() startsOn!: string;
  @ApiProperty() @IsString() endsOn!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isCurrent?: boolean;
}

export class CreateSemesterDto {
  @ApiProperty() @IsUUID() programmeId!: string;
  @ApiProperty() @IsUUID() academicYearId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(20) number!: number;
  @ApiProperty() @IsString() @Length(2, 80) name!: string;
}

export class CreateSectionDto {
  @ApiProperty() @IsUUID() semesterId!: string;
  @ApiProperty() @IsString() @Length(1, 30) code!: string;
  @ApiProperty() @IsString() @Length(1, 80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10) studyYear?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedRoomId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() officialGroupEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100_000) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() coordinatorPublicId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() representativePublicId?: string | null;
}

export class UpdateSectionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10) studyYear?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) displayName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedRoomId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() officialGroupEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100_000) capacity?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID() coordinatorPublicId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() representativePublicId?: string | null;
}

export class ArchiveDepartmentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 500) reason?: string;
}

export class CreateSubjectDto {
  @ApiProperty() @IsUUID() semesterId!: string;
  @ApiProperty() @IsString() @Length(1, 30) code!: string;
  @ApiProperty() @IsString() @Length(2, 180) name!: string;
}

export class UpdateEntityStatusDto {
  @ApiProperty() @IsBoolean() isActive!: boolean;
}

export class CreateFacultySubjectAssignmentDto {
  @ApiProperty() @IsUUID() facultyPublicId!: string;
  @ApiProperty() @IsUUID() subjectId!: string;
  @ApiProperty() @IsUUID() sectionId!: string;
  @ApiProperty() @IsDateString() validFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validUntil?: string;
}

export class CreateClassCoordinatorAssignmentDto {
  @ApiProperty() @IsUUID() coordinatorPublicId!: string;
  @ApiProperty() @IsUUID() sectionId!: string;
  @ApiProperty() @IsDateString() validFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validUntil?: string;
}

export class CreateClassRepresentativeAssignmentDto {
  @ApiProperty() @IsUUID() representativePublicId!: string;
  @ApiProperty() @IsUUID() sectionId!: string;
  @ApiProperty() @IsDateString() validFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validUntil?: string;
}

export class DeactivateAcademicAssignmentDto {
  @ApiProperty() @IsDateString() effectiveOn!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
