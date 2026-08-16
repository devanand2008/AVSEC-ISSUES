import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { AccountStatus, AdmissionType, ScopeType, StudentAcademicStatus } from "../../../generated/prisma/enums";

export class UserScopeDto {
  @ApiProperty({ enum: ScopeType }) @IsEnum(ScopeType) type!: ScopeType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() issueCategoryId?: string;
}

export class StudentProfileDto {
  @ApiProperty() @IsUUID() degreeTypeId!: string;
  @ApiProperty() @IsUUID() departmentId!: string;
  @ApiProperty() @IsUUID() programmeId!: string;
  @ApiProperty() @IsUUID() sectionId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 60) studentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1990) @Max(2200) admissionYear?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) rollNumber?: string;
  @ApiProperty() @IsString() @Length(2, 60) registerNumber!: string;
  @ApiProperty() @IsUUID() academicYearId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(4) studyYear!: number;
  @ApiProperty() @IsUUID() semesterId!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfBirth?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) personalEmail?: string;
  @ApiPropertyOptional({ enum: AdmissionType, default: AdmissionType.REGULAR }) @IsOptional() @IsEnum(AdmissionType) admissionType?: AdmissionType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1990) @Max(2200) expectedGraduationYear?: number;
  @ApiPropertyOptional({ enum: StudentAcademicStatus, default: StudentAcademicStatus.ACTIVE }) @IsOptional() @IsEnum(StudentAcademicStatus) academicStatus?: StudentAcademicStatus;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() academicOverride?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(10, 500) academicOverrideReason?: string;
}

export class StaffProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiProperty() @IsString() @Length(2, 60) employeeId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) designation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) specialization?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) shift?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) emergencyContact?: string;
}

export class CreateUserDto {
  @ApiProperty() @IsString() @Length(2, 60) collegeIdentityId!: string;
  @ApiProperty() @IsString() @Length(2, 180) fullName!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) mobile?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) whatsappNumber?: string;
  @ApiProperty({ minLength: 12 }) @IsString() @MinLength(12) @MaxLength(200) @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, { message: "temporaryPassword must include uppercase, lowercase, number and special character." }) temporaryPassword!: string;
  @ApiPropertyOptional({ enum: AccountStatus, default: AccountStatus.ACTIVE }) @IsOptional() @IsEnum(AccountStatus) accountStatus?: AccountStatus;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() mustChangePassword?: boolean;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsString({ each: true }) roleCodes!: string[];
  @ApiProperty({ type: [UserScopeDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => UserScopeDto) scopes!: UserScopeDto[];
  @ApiPropertyOptional({ type: StudentProfileDto }) @IsOptional() @ValidateNested() @Type(() => StudentProfileDto) studentProfile?: StudentProfileDto;
  @ApiPropertyOptional({ type: StaffProfileDto }) @IsOptional() @ValidateNested() @Type(() => StaffProfileDto) staffProfile?: StaffProfileDto;
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: AccountStatus }) @IsEnum(AccountStatus) status!: AccountStatus;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class UpdateUserAccessDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsString({ each: true }) roleCodes!: string[];
  @ApiProperty({ type: [UserScopeDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => UserScopeDto) scopes!: UserScopeDto[];
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class AssignUserRoleDto {
  @ApiProperty() @IsString() @Length(2, 60) roleCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validUntil?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPrimary?: boolean;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class RemoveUserRoleDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class CreateMaintenanceStaffDto {
  @ApiProperty() @IsString() @Length(2, 60) employeeId!: string;
  @ApiProperty() @IsString() @Length(2, 180) fullName!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiProperty() @IsString() @Length(7, 30) mobile!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) whatsappNumber?: string;
  @ApiProperty() @IsString() @Length(2, 60) roleCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) specialization?: string;
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() blockId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() floorId?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) roomIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) issueCategoryIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) shift?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) emergencyContact?: string;
  @ApiProperty({ minLength: 12 }) @IsString() @MinLength(12) @MaxLength(200) @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, { message: "temporaryPassword must include uppercase, lowercase, number and special character." }) temporaryPassword!: string;
  @ApiPropertyOptional({ enum: AccountStatus, default: AccountStatus.ACTIVE }) @IsOptional() @IsEnum(AccountStatus) accountStatus?: AccountStatus;
}

export class ResetUserPasswordDto {
  @ApiPropertyOptional({ minLength: 12 })
  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, { message: "temporaryPassword must include uppercase, lowercase, number and special character." })
  temporaryPassword?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  requirePasswordChange?: boolean;

  @ApiProperty()
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class ArchiveUserDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class DeleteUserDto extends ArchiveUserDto {
  @ApiProperty()
  @IsString()
  @Matches(/^(PERMANENTLY DELETE USER|DELETE USER [0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|DELETE STUDENT [^\r\n]{2,60})$/)
  confirmationPhrase!: string;
  @ApiProperty() @IsString() @Length(3, 255) backupReference!: string;
}

export class BulkPeopleDto extends ArchiveUserDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID(undefined, { each: true }) ids!: string[];
}

export class CreateRoleDto {
  @ApiProperty() @IsString() @Matches(/^[A-Z][A-Z0-9_]{2,59}$/) code!: string;
  @ApiProperty() @IsString() @Length(2, 120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(150) @IsString({ each: true }) permissionCodes!: string[];
}

export class UpdateRoleDto {
  @ApiProperty() @IsString() @Length(2, 120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(150) @IsString({ each: true }) permissionCodes!: string[];
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class NotificationChannelPreferencesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() in_app?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() push?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() email?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() whatsapp?: boolean;
}

export class NotificationCategoryPreferencesDto {
  @IsOptional() @ValidateNested() @Type(() => NotificationChannelPreferencesDto) issue_assignment?: NotificationChannelPreferencesDto;
  @IsOptional() @ValidateNested() @Type(() => NotificationChannelPreferencesDto) issue_updates?: NotificationChannelPreferencesDto;
  @IsOptional() @ValidateNested() @Type(() => NotificationChannelPreferencesDto) overdue_warnings?: NotificationChannelPreferencesDto;
  @IsOptional() @ValidateNested() @Type(() => NotificationChannelPreferencesDto) maintenance_alerts?: NotificationChannelPreferencesDto;
  @IsOptional() @ValidateNested() @Type(() => NotificationChannelPreferencesDto) escalations?: NotificationChannelPreferencesDto;
  @IsOptional() @ValidateNested() @Type(() => NotificationChannelPreferencesDto) attendance_alerts?: NotificationChannelPreferencesDto;
  @IsOptional() @ValidateNested() @Type(() => NotificationChannelPreferencesDto) announcements?: NotificationChannelPreferencesDto;
  @IsOptional() @ValidateNested() @Type(() => NotificationChannelPreferencesDto) messages?: NotificationChannelPreferencesDto;
  @IsOptional() @ValidateNested() @Type(() => NotificationChannelPreferencesDto) system_alerts?: NotificationChannelPreferencesDto;
  @IsOptional() @ValidateNested() @Type(() => NotificationChannelPreferencesDto) academic_alerts?: NotificationChannelPreferencesDto;
  @IsOptional() @ValidateNested() @Type(() => NotificationChannelPreferencesDto) avs_learn?: NotificationChannelPreferencesDto;
  @IsOptional() @ValidateNested() @Type(() => NotificationChannelPreferencesDto) avs_skill?: NotificationChannelPreferencesDto;
  @IsOptional() @ValidateNested() @Type(() => NotificationChannelPreferencesDto) import_failures?: NotificationChannelPreferencesDto;
  @IsOptional() @ValidateNested() @Type(() => NotificationChannelPreferencesDto) backup_alerts?: NotificationChannelPreferencesDto;
}

export class QuietHoursDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ example: "22:00" }) @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) start?: string;
  @ApiPropertyOptional({ example: "06:00" }) @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) end?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allow_critical?: boolean;
}

export class NotificationPreferencesDto extends NotificationChannelPreferencesDto {
  @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => NotificationCategoryPreferencesDto) categories?: NotificationCategoryPreferencesDto;
  @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => QuietHoursDto) quiet_hours?: QuietHoursDto;
  @ApiPropertyOptional({ enum: ["comfortable", "compact"] }) @IsOptional() @IsIn(["comfortable", "compact"]) display_density?: "comfortable" | "compact";
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() dismissed_banners?: Record<string, string>;
}
