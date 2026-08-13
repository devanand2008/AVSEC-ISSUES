import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from "class-validator";

export class CreateDepartmentDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() campusId?: string;
  @ApiProperty() @IsString() @Length(1, 30) code!: string;
  @ApiProperty() @IsString() @Length(2, 180) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) shortName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() hodPublicId?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) officialEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) contactNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateDepartmentDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() campusId?: string | null;
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
  @ApiProperty() @IsUUID() degreeTypeId!: string;
  @ApiProperty() @IsString() @Length(1, 30) code!: string;
  @ApiProperty() @IsString() @Length(2, 180) name!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(4) durationYears!: number;
  @ApiPropertyOptional({ default: 8 }) @IsOptional() @IsInt() @Min(1) @Max(8) totalSemesters?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateProgrammeDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() degreeTypeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 180) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(4) durationYears?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(8) totalSemesters?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateDegreeTypeDto {
  @ApiProperty() @IsString() @Length(1, 30) code!: string;
  @ApiProperty() @IsString() @Length(2, 80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateDegreeTypeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateAcademicYearDto {
  @ApiProperty() @IsString() @Length(2, 30) name!: string;
  @ApiProperty() @IsDateString() startsOn!: string;
  @ApiProperty() @IsDateString() endsOn!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isCurrent?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateAcademicYearDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 30) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startsOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateSemesterDto {
  @ApiProperty() @IsUUID() programmeId!: string;
  @ApiProperty() @IsUUID() academicYearId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(8) number!: number;
  @ApiProperty() @IsString() @Length(2, 80) name!: string;
}

export class CreateSectionDto {
  @ApiProperty() @IsUUID() semesterId!: string;
  @ApiProperty() @IsString() @Length(1, 30) code!: string;
  @ApiProperty() @IsString() @Length(1, 80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(4) studyYear?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedRoomId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() officialGroupEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(70) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() coordinatorPublicId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() representativePublicId?: string | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID(undefined, { each: true }) prospectiveClassStaffPublicIds?: string[];
}

export class UpdateSectionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(4) studyYear?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) displayName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedRoomId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() officialGroupEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(70) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID() coordinatorPublicId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() representativePublicId?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID(undefined, { each: true }) prospectiveClassStaffPublicIds?: string[];
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
  @ApiPropertyOptional() @IsOptional() @IsIn(["PRIMARY_FACULTY", "SUPPORTING_FACULTY", "LABORATORY_FACULTY", "CLASS_COORDINATOR", "PROSPECTIVE_CLASS_STAFF", "GUEST_FACULTY"]) assignmentType?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() attendancePermission?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() learningResourcePermission?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() assessmentPermission?: boolean;
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

export class CreateClassStaffAssignmentDto {
  @ApiProperty() @IsUUID() staffPublicId!: string;
  @ApiProperty() @IsUUID() sectionId!: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(["PROSPECTIVE_CLASS_STAFF", "SUPPORTING_CLASS_STAFF"]) assignmentType?: string;
  @ApiProperty() @IsDateString() validFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validUntil?: string;
}

export class AssignSectionStudentDto {
  @ApiProperty() @IsUUID() studentPublicId!: string;
  @ApiProperty() @IsDateString() startsOn!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 500) reason?: string;
}

export class DeactivateAcademicAssignmentDto {
  @ApiProperty() @IsDateString() effectiveOn!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
