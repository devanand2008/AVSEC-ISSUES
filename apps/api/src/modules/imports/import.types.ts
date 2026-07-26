export const IMPORT_ENTITY_TYPES = [
  "USERS",
  "STUDENTS",
  "STAFF",
  "DEPARTMENTS",
  "PROGRAMMES",
  "CLASSES",
  "ATTENDANCE",
  "BLOCKS",
  "FLOORS",
  "ROOMS",
  "ASSETS",
  "RESPONSIBLE_PERSONS",
  "ASSIGNMENT_RULES",
] as const;

export type ImportEntityType = (typeof IMPORT_ENTITY_TYPES)[number];

export const IMPORT_MODES = [
  "VALIDATE_ONLY",
  "CREATE_ONLY",
  "CREATE_AND_UPDATE",
  "UPDATE_ONLY",
] as const;

export type ImportMode = (typeof IMPORT_MODES)[number];

export interface ImportRow {
  [key: string]: string;
  first_name: string; last_name: string; legacy_path: string;
  source_sheet: string; source_row_number: string; source_department_code: string; password_status: string;
  college_identity_id: string; full_name: string; temporary_password: string; role_codes: string;
  email: string; mobile: string; whatsapp_number: string; scope_type: string; scope_code: string;
  account_status: string; user_id: string; employee_or_student_id: string; gender: string; date_of_birth: string;
  parent_name: string; parent_mobile_number: string; blood_group: string; address: string; profile_photo_url: string; batch: string;
  student_id: string; legacy_id: string; department_code: string; programme_code: string; section_code: string; admission_year: string; roll_number: string;
  academic_year: string; year: string; semester: string; admission_number: string;
  employee_id: string; designation: string; joined_on: string; campus_scope: string; assigned_year: string; assigned_semester: string;
  assigned_section: string; assigned_block: string; assigned_floor: string; assigned_room: string; specialization: string; assigned_issue_category: string; shift: string;
  code: string; name: string; campus_code: string; sort_order: string; duration_years: string;
  semester_number: string; capacity: string; block_code: string; floor_code: string; level: string;
  room_number: string; room_type: string; room_code: string; category_name: string; serial_number: string; installed_on: string;
  team_code: string; is_primary: string; max_open_issues: string; category_code: string; issue_type_code: string;
  asset_code: string; priority: string; primary_user_identity: string; backup_user_identity: string;
  escalation_user_identity: string; rule_priority: string; workload_balancing: string;
  subject_code: string; session_date: string; period_number: string; faculty_identity: string; status: string; note: string; marked_by: string;
}

export interface ImportTemplate {
  entityType: ImportEntityType;
  permission: string;
  required: string[];
  optional: string[];
  example: Partial<ImportRow>;
}

export interface ImportRowError {
  rowNumber: number;
  field?: string;
  message: string;
}

export interface ImportedRecord {
  rowNumber: number;
  model: string;
  id: string;
  label: string;
  credential?: CredentialExportRow;
}

export interface CredentialExportRow {
  rowNumber: number;
  userId: string;
  fullName: string;
  role: string;
  loginId: string;
  temporaryPassword: string;
  firstLoginRequired: boolean;
}

export interface ImportResultReport {
  jobId: string;
  entityType: ImportEntityType;
  importMode?: ImportMode;
  completedAt: string;
  successful: ImportedRecord[];
  errors: ImportRowError[];
  credentials?: CredentialExportRow[];
  credentialsExportedAt?: string;
}

export const IMPORT_TEMPLATES: Record<ImportEntityType, ImportTemplate> = {
  USERS: {
    entityType: "USERS",
    permission: "users.import",
    required: ["full_name", "email", "temporary_password", "department_code"],
    optional: ["role_codes", "college_identity_id", "mobile", "whatsapp_number", "scope_type", "scope_code", "account_status", "user_id", "employee_or_student_id", "student_id", "employee_id", "programme_code", "academic_year", "year", "semester_number", "section_code"],
    example: { full_name: "Sample Student One", temporary_password: "001234", role_codes: "STUDENT", email: "sample1@example.edu", department_code: "CSE-AIML", account_status: "ACTIVE" },
  },
  STUDENTS: {
    entityType: "STUDENTS",
    permission: "users.import",
    required: ["email", "temporary_password"],
    optional: ["first_name", "last_name", "full_name", "department_code", "role_codes", "college_identity_id", "student_id", "email", "mobile", "whatsapp_number", "roll_number", "legacy_id", "legacy_path", "programme_code", "section_code", "academic_year", "year", "semester_number", "admission_year", "account_status", "admission_number", "gender", "date_of_birth", "parent_name", "parent_mobile_number", "blood_group", "address", "profile_photo_url", "batch", "source_sheet", "source_row_number", "source_department_code", "password_status"],
    example: { full_name: "Sample Student One", email: "sample1@example.edu", temporary_password: "001234", department_code: "CSE-AIML", account_status: "ACTIVE" },
  },
  STAFF: {
    entityType: "STAFF",
    permission: "users.import",
    required: ["full_name", "email", "temporary_password", "department_code"],
    optional: ["role_codes", "college_identity_id", "employee_id", "temporary_password", "email", "mobile", "whatsapp_number", "department_code", "designation", "joined_on", "account_status", "campus_scope", "programme_code", "academic_year", "year", "semester_number", "section_code", "assigned_year", "assigned_semester", "assigned_section", "assigned_block", "assigned_floor", "assigned_room", "specialization", "assigned_issue_category", "shift", "profile_photo_url"],
    example: { full_name: "Sample Faculty One", email: "faculty1@example.edu", temporary_password: "005678", role_codes: "FACULTY", department_code: "CSE", account_status: "ACTIVE" },
  },
  DEPARTMENTS: {
    entityType: "DEPARTMENTS",
    permission: "academic.manage",
    required: ["code", "name"], optional: ["campus_code", "sort_order"],
    example: { code: "CSE", name: "Computer Science and Engineering", campus_code: "MAIN", sort_order: "10" },
  },
  PROGRAMMES: {
    entityType: "PROGRAMMES",
    permission: "academic.manage",
    required: ["department_code", "code", "name", "duration_years"], optional: [],
    example: { department_code: "CSE", code: "BTECH-CSE", name: "B.Tech Computer Science", duration_years: "4" },
  },
  CLASSES: {
    entityType: "CLASSES",
    permission: "academic.manage",
    required: ["programme_code", "academic_year", "semester_number", "code", "name"], optional: ["capacity"],
    example: { programme_code: "BTECH-CSE", academic_year: "2026-27", semester_number: "1", code: "A", name: "Section A", capacity: "60" },
  },
  ATTENDANCE: {
    entityType: "ATTENDANCE",
    permission: "attendance.import",
    required: ["academic_year", "programme_code", "semester_number", "section_code", "subject_code", "session_date", "period_number", "faculty_identity", "student_id", "status"],
    optional: ["legacy_id", "note", "marked_by"],
    example: { academic_year: "2025-26", programme_code: "BTECH-CSE", semester_number: "2", section_code: "A", subject_code: "CS201", session_date: "2026-01-15", period_number: "3", faculty_identity: "FAC101", student_id: "2025CSE001", legacy_id: "LEGACY-0001", status: "P", note: "Migrated from legacy register", marked_by: "Legacy Clerk" },
  },
  BLOCKS: {
    entityType: "BLOCKS",
    permission: "locations.import",
    required: ["campus_code", "code", "name"], optional: ["sort_order"],
    example: { campus_code: "MAIN", code: "A", name: "Academic Block A", sort_order: "10" },
  },
  FLOORS: {
    entityType: "FLOORS",
    permission: "locations.import",
    required: ["campus_code", "block_code", "code", "name", "level"], optional: ["sort_order"],
    example: { campus_code: "MAIN", block_code: "A", code: "F1", name: "First Floor", level: "1", sort_order: "10" },
  },
  ROOMS: {
    entityType: "ROOMS",
    permission: "locations.import",
    required: ["campus_code", "block_code", "floor_code", "code", "name", "room_type"],
    optional: ["department_code", "room_number", "capacity", "sort_order"],
    example: { campus_code: "MAIN", block_code: "A", floor_code: "F1", code: "A-101", name: "Classroom 101", room_type: "CLASSROOM", department_code: "CSE", room_number: "101", capacity: "60" },
  },
  ASSETS: {
    entityType: "ASSETS",
    permission: "assets.import",
    required: ["room_code", "category_name", "code", "name"], optional: ["serial_number", "installed_on"],
    example: { room_code: "A-101", category_name: "Projector", code: "PROJ-101", name: "Ceiling projector", serial_number: "SN12345", installed_on: "2026-06-01" },
  },
  RESPONSIBLE_PERSONS: {
    entityType: "RESPONSIBLE_PERSONS",
    permission: "routing.manage",
    required: ["team_code", "college_identity_id"], optional: ["is_primary", "max_open_issues"],
    example: { team_code: "ELECTRICAL", college_identity_id: "EMP-201", is_primary: "true", max_open_issues: "12" },
  },
  ASSIGNMENT_RULES: {
    entityType: "ASSIGNMENT_RULES",
    permission: "routing.manage",
    required: ["team_code"],
    optional: ["campus_code", "block_code", "floor_code", "room_code", "room_type", "department_code", "category_code", "issue_type_code", "asset_code", "priority", "primary_user_identity", "backup_user_identity", "escalation_user_identity", "rule_priority", "workload_balancing"],
    example: { team_code: "ELECTRICAL", campus_code: "MAIN", block_code: "A", category_code: "ELECTRICAL", priority: "HIGH", primary_user_identity: "EMP-201", rule_priority: "100", workload_balancing: "false" },
  },
};
