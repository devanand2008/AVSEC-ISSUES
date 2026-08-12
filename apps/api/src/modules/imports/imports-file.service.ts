import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parse } from "csv-parse/sync";
import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import type { Readable } from "node:stream";
import {
  ValueType,
  Workbook,
  type Cell,
  type CellValue,
  type Worksheet,
} from "exceljs";
import * as XLSX from "xlsx";
import { z } from "zod";
import {
  IMPORT_ENTITY_TYPES,
  IMPORT_MODES,
  IMPORT_TEMPLATES,
  type ImportEntityType,
  type ImportResultReport,
  type ImportRow,
  type ImportRowError,
  type ImportStudyYear,
} from "./import.types";

const MAX_IMPORT_BYTES =
  Number(process.env.MAX_EXCEL_FILE_SIZE_MB || 10) * 1024 * 1024;
const MAX_IMPORT_ROWS = Number(process.env.MAX_EXCEL_ROWS || 5_000);
const ALLOWED_MIME_TYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);
const INTEGER_FIELDS = new Set([
  "admission_year",
  "duration_years",
  "semester_number",
  "period_number",
  "capacity",
  "sort_order",
  "level",
  "max_open_issues",
  "rule_priority",
]);
const DATE_FIELDS = new Set([
  "joined_on",
  "installed_on",
  "session_date",
  "date_of_birth",
]);
const BOOLEAN_FIELDS = new Set(["is_primary", "workload_balancing"]);
const ATTENDANCE_CODES = new Set([
  "P",
  "A",
  "L",
  "OD",
  "ML",
  "AL",
  "PRESENT",
  "ABSENT",
  "LATE",
  "ON_DUTY",
  "MEDICAL_LEAVE",
  "AUTHORIZED_LEAVE",
]);
const ACCOUNT_STATUSES = new Set([
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
  "DISABLED",
  "GRADUATED",
  "RESIGNED",
  "ARCHIVED",
]);
const FORMULA_PREFIX = /^[=+@]/;
const IGNORED_COLUMN = "__IGNORED_IMPORT_COLUMN__";
const AVS_PASSWORD_PRECISION_ERROR =
  "Password value cannot be imported without losing precision.";
const HEADER_ALIASES: Record<string, string> = {
  admission_no: "admission_number",
  admission_year: "admission_year",
  class: "section_code",
  class_section: "section_code",
  contact_no: "mobile",
  contact_number: "mobile",
  date_of_joining: "joined_on",
  department: "department_code",
  department_code: "department_code",
  department_name: "department_code",
  dept: "department_code",
  dept_code: "department_code",
  dob: "date_of_birth",
  employee_name: "full_name",
  employee_or_student_id: "employee_or_student_id",
  first_name: "first_name",
  full_name: "full_name",
  initial_password: "temporary_password",
  last_name: "last_name",
  login_id: "college_identity_id",
  college_id: "college_identity_id",
  college_email: "email",
  official_email: "email",
  email_address: "email",
  email_id: "email",
  mail_id: "email",
  email_password: "__IGNORED_IMPORT_COLUMN__",
  mailbox_password: "__IGNORED_IMPORT_COLUMN__",
  original_password: "__IGNORED_IMPORT_COLUMN__",
  path: "legacy_path",
  real_password: "__IGNORED_IMPORT_COLUMN__",
  register_number: "register_number",
  register_no: "register_number",
  reg_no: "register_number",
  roll_no: "roll_number",
  study_year: "year",
  academic_year_or_study_year: "year",
  mobile_no: "mobile",
  mobile_number: "mobile",
  name: "full_name",
  name_of_student: "full_name",
  password: "temporary_password",
  programme: "programme_code",
  program: "programme_code",
  program_code: "programme_code",
  phone: "mobile",
  phone_no: "mobile",
  phone_number: "mobile",
  role: "role_codes",
  role_code: "role_codes",
  roles: "role_codes",
  semester: "semester_number",
  section: "section_code",
  section_name: "section_code",
  staff_name: "full_name",
  student_name: "full_name",
  student_email: "email",
  student_roll_number: "roll_number",
  temp_password: "temporary_password",
  temporary_password_plain: "__IGNORED_IMPORT_COLUMN__",
  temporary_password_plain_text: "__IGNORED_IMPORT_COLUMN__",
  temporary_password_plaintext: "__IGNORED_IMPORT_COLUMN__",
  temporary_pwd: "temporary_password",
  temporary_password: "temporary_password",
  user_email: "email",
  user_id: "college_identity_id",
  user_name: "full_name",
  whatsapp: "whatsapp_number",
  whatsapp_mobile: "whatsapp_number",
  whatsapp_no: "whatsapp_number",
  whatsapp_number_mobile: "whatsapp_number",
};
const ROLE_ALIASES: Record<string, string> = {
  CC: "CLASS_COORDINATOR",
  CLASS_COORDINATOR_CC: "CLASS_COORDINATOR",
  CR: "CLASS_REPRESENTATIVE",
  CLASS_REP: "CLASS_REPRESENTATIVE",
  CLASS_REPRESENTATIVE_REP: "CLASS_REPRESENTATIVE",
  CLASS_REPRESENTATIVE_OR_REP: "CLASS_REPRESENTATIVE",
  COLLEGE_STAFF: "OTHER_RESPONSIBLE",
  LABORATORY_TECHNICIAN: "LAB_TECHNICIAN",
  MAINTENANCE_STAFF: "MAINTENANCE_STAFF",
  OTHER_AUTHORIZED_COLLEGE_STAFF: "OTHER_RESPONSIBLE",
  OTHER_STAFF: "OTHER_RESPONSIBLE",
  REP: "CLASS_REPRESENTATIVE",
  SECURITY_STAFF: "SECURITY",
};

interface ParseOptions {
  sheetName?: string;
  columnMapping?: Record<string, string>;
  departmentMappings?: Record<string, string>;
  duplicateResolution?: "KEEP_FIRST" | "SKIP_ALL";
  forcedStudyYear?: ImportStudyYear;
  officialEmailDomains?: string[];
}

export interface ImportSheetInspection {
  sheetName: string;
  headerRowNumber?: number;
  rowCount: number;
  sourceDepartmentCode: string;
  mappedDepartmentCode?: string;
  status: "READY" | "HEADER_NOT_FOUND" | "EMPTY";
}

export interface ImportDuplicateGroup {
  normalizedEmail: string;
  locations: Array<{
    rowNumber: number;
    sheetName?: string;
    sourceRowNumber?: number;
  }>;
}

interface AvsStudentWorkbook {
  matrix: unknown[][];
  sheetNames: string[];
  sheetInspections: ImportSheetInspection[];
  detectedStudyYear?: ImportStudyYear;
  passwordWarnings: number;
  errors: ImportRowError[];
}

const credentialExportRowSchema = z
  .object({
    rowNumber: z.number().int().min(2),
    userId: z.uuid(),
    fullName: z.string().min(1).max(180),
    role: z.string().min(1).max(300),
    loginId: z.string().min(1).max(80),
    temporaryPassword: z.string().min(10).max(200),
    firstLoginRequired: z.boolean(),
  })
  .strict();
const importResultReportSchema = z
  .object({
    jobId: z.uuid(),
    entityType: z.enum(IMPORT_ENTITY_TYPES),
    importMode: z.enum(IMPORT_MODES).optional(),
    completedAt: z.string(),
    successful: z.array(
      z.object({
        rowNumber: z.number().int().min(2),
        model: z.string().min(1).max(80),
        id: z.uuid(),
        label: z.string().max(300),
      }),
    ),
    errors: z.array(
      z.object({
        rowNumber: z.number().int().min(2),
        field: z.string().optional(),
        message: z.string(),
      }),
    ),
    credentials: z.array(credentialExportRowSchema).optional(),
    credentialsExportedAt: z.string().optional(),
  })
  .strict();

@Injectable()
export class ImportsFileService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly officialEmailDomains: Set<string>;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>("S3_BUCKET");
    this.officialEmailDomains = new Set(
      (config.get<string>("OFFICIAL_EMAIL_DOMAINS", "") || "")
        .split(",")
        .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean),
    );
    this.client = new S3Client({
      endpoint: config.getOrThrow<string>("S3_ENDPOINT"),
      region: config.get<string>("S3_REGION", "us-east-1"),
      forcePathStyle: this.booleanConfig(config.get<string | boolean>("S3_FORCE_PATH_STYLE", true)),
      credentials: {
        accessKeyId: config.getOrThrow<string>("S3_ACCESS_KEY"),
        secretAccessKey: config.getOrThrow<string>("S3_SECRET_KEY"),
      },
    });
  }

  validateFile(
    file?: Express.Multer.File,
  ): asserts file is Express.Multer.File {
    if (!file)
      throw new BadRequestException(
        "Attach a CSV or Excel file in the file field.",
      );
    const extension = extname(file.originalname).toLowerCase();
    if (![".csv", ".xlsx", ".xls"].includes(extension))
      throw new BadRequestException(
        "Only .csv, .xlsx and .xls imports are supported.",
      );
    if (file.mimetype && !ALLOWED_MIME_TYPES.has(file.mimetype))
      throw new BadRequestException(
        "The uploaded file MIME type is not supported for CSV or Excel imports.",
      );
    if (!file.size || file.size > MAX_IMPORT_BYTES)
      throw new BadRequestException(
        `Import files must be between 1 byte and ${Math.floor(MAX_IMPORT_BYTES / 1024 / 1024)} MB.`,
      );
  }

  async parse(
    file: Express.Multer.File,
    entityType: ImportEntityType,
    options: ParseOptions = {},
  ): Promise<{
    rawHeaders: string[];
    headers: string[];
    rows: ImportRow[];
    errors: ImportRowError[];
    sheetNames: string[];
    selectedSheetName?: string;
    columnMapping: Record<string, string>;
    sheetInspections: ImportSheetInspection[];
    detectedStudyYear?: ImportStudyYear;
    passwordWarnings: number;
    duplicateGroups: ImportDuplicateGroup[];
    duplicateRowCount: number;
  }> {
    const extension = extname(file.originalname).toLowerCase();
    let matrix: unknown[][];
    let sheetNames: string[] = [];
    let selectedSheetName: string | undefined;
    let sheetInspections: ImportSheetInspection[] = [];
    let detectedStudyYear: ImportStudyYear | undefined;
    let passwordWarnings = 0;
    let workbookErrors: ImportRowError[] = [];
    try {
      if (extension === ".csv")
        matrix = parse(file.buffer, {
          bom: true,
          relax_column_count: true,
          skip_empty_lines: true,
          trim: true,
        }) as unknown[][];
      else if (extension === ".xls") {
        const parsed = this.parseLegacyWorkbook(file.buffer, options.sheetName);
        matrix = parsed.matrix;
        sheetNames = parsed.sheetNames;
        selectedSheetName = parsed.selectedSheetName;
      } else {
        const avsWorkbook =
          entityType === "STUDENTS" && !options.sheetName
            ? await this.parseAvsStudentWorkbook(
                file.buffer,
                file.originalname,
                options,
              )
            : null;
        if (avsWorkbook) {
          matrix = avsWorkbook.matrix;
          sheetNames = avsWorkbook.sheetNames;
          sheetInspections = avsWorkbook.sheetInspections;
          detectedStudyYear = avsWorkbook.detectedStudyYear;
          passwordWarnings = avsWorkbook.passwordWarnings;
          workbookErrors = avsWorkbook.errors;
        } else {
          const parsed = await this.parseWorkbook(
            file.buffer,
            options.sheetName,
          );
          matrix = parsed.matrix;
          sheetNames = parsed.sheetNames;
          selectedSheetName = parsed.selectedSheetName;
        }
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        "The import file could not be parsed. Check that it is a valid CSV or XLSX workbook.",
      );
    }
    if (matrix.length < 2)
      throw new BadRequestException(
        "The import file must contain a header row and at least one data row.",
      );
    if (matrix.length - 1 > MAX_IMPORT_ROWS)
      throw new BadRequestException(
        `A single import can contain at most ${MAX_IMPORT_ROWS} rows.`,
      );

    const headerRow = matrix[0];
    if (!headerRow)
      throw new BadRequestException(
        "The import file does not contain a header row.",
      );
    const rawHeaders = headerRow.map((cell) => this.cell(cell));
    const normalizedHeaders = rawHeaders.map((header) =>
      this.normalizeHeader(header, entityType, options.columnMapping),
    );
    if (normalizedHeaders.some((header) => !header))
      throw new BadRequestException("Every import column must have a header.");
    const activeColumns = normalizedHeaders
      .map((header, index) => ({ header, index }))
      .filter((column) => column.header !== IGNORED_COLUMN);
    const headers = activeColumns.map((column) => column.header);
    if (new Set(headers).size !== headers.length)
      throw new BadRequestException("Import headers must be unique.");
    const template = IMPORT_TEMPLATES[entityType];
    const missing = template.required.filter(
      (header) =>
        !headers.includes(header) &&
        !this.canDeriveRequiredHeader(entityType, header, headers),
    );
    const allowed = new Set([...template.required, ...template.optional]);
    const unexpected = headers.filter((header) => !allowed.has(header));
    const headerMessages = [
      ...(missing.length
        ? [`Missing required headers: ${missing.join(", ")}.`]
        : []),
      ...(unexpected.length
        ? [
            `Unexpected headers: ${unexpected.join(", ")}. Map or skip these columns before confirming.`,
          ]
        : []),
    ];

    const rows = matrix
      .slice(1)
      .filter((source) =>
        activeColumns.some((column) => this.cell(source[column.index])),
      )
      .map((source) =>
        this.prepareRow(
          entityType,
          Object.fromEntries(
            activeColumns.map((column) => [
              column.header,
              this.cell(source[column.index]),
            ]),
          ) as ImportRow,
        ),
      );
    rows.forEach((row) =>
      this.applyDepartmentMapping(row, options.departmentMappings),
    );
    if (!rows.length)
      throw new BadRequestException(
        "The import file does not contain any data rows.",
      );
    const errors = [
      ...workbookErrors,
      ...this.headerErrors(rows.length, headerMessages),
      ...this.validateRows(
        entityType,
        rows,
        options.duplicateResolution ?? "KEEP_FIRST",
        options.officialEmailDomains,
      ),
    ];
    return {
      rawHeaders,
      headers,
      rows,
      errors,
      sheetNames,
      selectedSheetName,
      sheetInspections,
      detectedStudyYear,
      passwordWarnings,
      duplicateGroups: this.duplicateEmailGroups(rows),
      duplicateRowCount: this.duplicateRowNumbers(
        entityType,
        rows,
        options.duplicateResolution ?? "KEEP_FIRST",
      ).size,
      columnMapping: Object.fromEntries(
        rawHeaders.map((rawHeader, index) => [
          rawHeader,
          normalizedHeaders[index] === IGNORED_COLUMN
            ? "__IGNORE__"
            : (normalizedHeaders[index] ?? ""),
        ]),
      ),
    };
  }

  async saveSource(
    collegeId: string,
    entityType: ImportEntityType,
    file: Express.Multer.File,
  ): Promise<{ key: string; sha256: string }> {
    const extension = extname(file.originalname).toLowerCase();
    const key = `colleges/${collegeId}/imports/source/${randomUUID()}${extension}`;
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType:
          extension === ".csv"
            ? "text/csv"
            : extension === ".xls"
              ? "application/vnd.ms-excel"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Metadata: { entity: entityType, sha256 },
      }),
    );
    return { key, sha256 };
  }

  async loadSource(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return this.toBuffer(response.Body as Readable | undefined);
  }

  async deleteSource(key: string): Promise<void> {
    if (!key.includes("/imports/source/")) return;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async saveReport(
    collegeId: string,
    report: ImportResultReport,
  ): Promise<string> {
    const key = `colleges/${collegeId}/imports/results/${report.jobId}.json`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(report, null, 2),
        ContentType: "application/json",
      }),
    );
    return key;
  }

  async loadReport(key: string): Promise<ImportResultReport> {
    const body = await this.loadSource(key);
    try {
      return importResultReportSchema.parse(JSON.parse(body.toString("utf8")));
    } catch {
      throw new BadRequestException(
        "The stored import result failed validation.",
      );
    }
  }

  private validateRows(
    entityType: ImportEntityType,
    rows: ImportRow[],
    duplicateResolution: "KEEP_FIRST" | "SKIP_ALL" = "KEEP_FIRST",
    configuredDomains?: string[],
  ): ImportRowError[] {
    const template = IMPORT_TEMPLATES[entityType];
    const officialEmailDomains = configuredDomains
      ? new Set(configuredDomains.map((domain) => domain.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))
      : this.officialEmailDomains;
    const errors: ImportRowError[] = [];
    const seen = new Map<string, number>();
    const duplicateErrors = new Set<string>();
    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      for (const field of template.required) {
        if (!row[field]?.trim() && !this.canDeriveRequiredValue(entityType, field, row))
          errors.push({ rowNumber, field, message: `${field} is required.` });
      }
      for (const [field, value] of Object.entries(row)) {
        if (!value) continue;
        if (INTEGER_FIELDS.has(field) && !/^-?\d+$/.test(value))
          errors.push({
            rowNumber,
            field,
            message: `${field} must be a whole number.`,
          });
        if (DATE_FIELDS.has(field) && !/^\d{4}-\d{2}-\d{2}$/.test(value))
          errors.push({
            rowNumber,
            field,
            message: `${field} must use YYYY-MM-DD.`,
          });
        if (
          BOOLEAN_FIELDS.has(field) &&
          !["true", "false", "yes", "no", "1", "0"].includes(
            value.toLowerCase(),
          )
        )
          errors.push({
            rowNumber,
            field,
            message: `${field} must be true or false.`,
          });
        if (this.looksLikeFormula(field, value))
          errors.push({
            rowNumber,
            field,
            message: `${field} cannot begin with a spreadsheet formula character.`,
          });
      }
      if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))
        errors.push({
          rowNumber,
          field: "email",
          message: "email is not valid.",
        });
      if (
        row.email &&
        officialEmailDomains.size > 0 &&
        !officialEmailDomains.has(
          row.email.slice(row.email.lastIndexOf("@") + 1).toLowerCase(),
        )
      )
        errors.push({
          rowNumber,
          field: "email",
          message: "email must use an approved official college domain.",
        });
      if (row.mobile && !this.validPhone(row.mobile))
        errors.push({
          rowNumber,
          field: "mobile",
          message: "mobile must contain 7 to 15 digits.",
        });
      if (row.whatsapp_number && !this.validPhone(row.whatsapp_number))
        errors.push({
          rowNumber,
          field: "whatsapp_number",
          message: "whatsapp_number must contain 7 to 15 digits.",
        });
      if (
        row.account_status &&
        !ACCOUNT_STATUSES.has(row.account_status.toUpperCase())
      )
        errors.push({
          rowNumber,
          field: "account_status",
          message: "account_status is not recognized.",
        });
      if (
        row.temporary_password &&
        !this.validTemporaryPassword(row.temporary_password)
      )
        errors.push({
          rowNumber,
          field: "temporary_password",
          message:
            "temporary_password must be at least 6 characters and is accepted only as a first-login temporary password.",
        });
      if (
        row.room_type &&
        ![
          "CLASSROOM",
          "LABORATORY",
          "SEMINAR_HALL",
          "AUDITORIUM",
          "STAFF_ROOM",
          "HOD_ROOM",
          "PRINCIPAL_OFFICE",
          "ADMINISTRATIVE_OFFICE",
          "LIBRARY",
          "WORKSHOP",
          "RESTROOM",
          "CANTEEN",
          "HOSTEL_ROOM",
          "CORRIDOR",
          "STAIRCASE",
          "PARKING_AREA",
          "PLAYGROUND",
          "OTHER",
        ].includes(row.room_type.trim().toUpperCase().replace(/[\s-]+/g, "_"))
      )
        errors.push({
          rowNumber,
          field: "room_type",
          message: "room_type is not recognized.",
        });
      if (
        row.priority &&
        !["LOW", "MEDIUM", "HIGH", "CRITICAL", "EMERGENCY"].includes(
          row.priority.toUpperCase(),
        )
      )
        errors.push({
          rowNumber,
          field: "priority",
          message: "priority is not recognized.",
        });
      if (
        entityType === "ATTENDANCE" &&
        row.status &&
        !ATTENDANCE_CODES.has(row.status.toUpperCase())
      )
        errors.push({
          rowNumber,
          field: "status",
          message:
            "status must be P, A, L, OD, ML, AL, or a supported full attendance status.",
        });
      for (const key of this.logicalKeys(entityType, row)) {
        const previous = seen.get(key);
        if (previous) {
          const currentLocation = this.rowLocation(row, rowNumber);
          const previousLocation = this.rowLocation(
            rows[previous - 2],
            previous,
          );
          const currentError = `${rowNumber}:${key}`;
          if (!duplicateErrors.has(currentError)) {
            errors.push({
              rowNumber,
              field: key.startsWith("email:") ? "email" : undefined,
              message:
                duplicateResolution === "SKIP_ALL"
                  ? `This row duplicates ${previousLocation} within the file; both ${currentLocation} and ${previousLocation} will be skipped.`
                  : `This row duplicates ${previousLocation} within the file; ${previousLocation} is kept.`,
            });
            duplicateErrors.add(currentError);
          }
          if (duplicateResolution === "SKIP_ALL") {
            const previousError = `${previous}:${key}`;
            if (!duplicateErrors.has(previousError)) {
              errors.push({
                rowNumber: previous,
                field: key.startsWith("email:") ? "email" : undefined,
                message: `Duplicate account at ${previousLocation}; both this row and ${currentLocation} will be skipped.`,
              });
              duplicateErrors.add(previousError);
            }
          }
        } else seen.set(key, rowNumber);
      }
      if (
        entityType === "STUDENTS" &&
        row.year &&
        !this.normalizedStudyYear(row.year)
      ) {
        errors.push({
          rowNumber,
          field: "year",
          message: "study_year must be an integer from 1 to 8.",
        });
      }
      if (entityType === "STUDENTS" && row.source_sheet && !row.first_name) {
        errors.push({
          rowNumber,
          field: "first_name",
          message: "first_name is required.",
        });
      }
      if (entityType === "STUDENTS" && row.source_sheet && !row.year) {
        errors.push({
          rowNumber,
          field: "year",
          message: "Study year was not detected. Select a study year from 1 to 8 before confirming.",
        });
      }
      if (
        entityType === "STUDENTS" &&
        (row.programme_code || row.section_code || row.student_id || row.register_number || row.roll_number) &&
        !row.college_identity_id &&
        !row.student_id &&
        !row.register_number &&
        !row.roll_number
      ) {
        errors.push({
          rowNumber,
          field: "college_identity_id",
          message: "college_id, student_id, or register_number is required.",
        });
      }
    });
    return errors;
  }

  private booleanConfig(value: string | boolean | undefined): boolean {
    if (typeof value === "boolean") return value;
    return !["false", "0", "no", "off"].includes(String(value ?? "true").trim().toLowerCase());
  }

  private logicalKeys(entityType: ImportEntityType, row: ImportRow): string[] {
    if (["USERS", "STUDENTS", "STAFF"].includes(entityType)) {
      if (row.subject_code) {
        return [[
          row.college_identity_id,
          row.employee_id,
          row.academic_year,
          row.programme_code,
          row.semester_number,
          row.section_code,
          row.subject_code,
        ]
          .filter(Boolean)
          .join("|")
          .toUpperCase()];
      }
      const identityIsEmail =
        row.email &&
        row.college_identity_id?.toLowerCase() === row.email.toLowerCase();
      return [
        row.college_identity_id && !identityIsEmail
          ? `identity:${row.college_identity_id.toUpperCase()}`
          : "",
        row.email ? `email:${row.email.toLowerCase()}` : "",
        row.student_id ? `student:${row.student_id.toUpperCase()}` : "",
        row.register_number ? `register:${row.register_number.toUpperCase()}` : "",
        row.roll_number ? `roll:${row.roll_number.toUpperCase()}` : "",
      ].filter(Boolean);
    }
    if (entityType === "ASSETS") return row.code ? [row.code.toUpperCase()] : [];
    if (entityType === "RESPONSIBLE_PERSONS")
      return [`${row.team_code}|${row.college_identity_id}`.toUpperCase()];
    if (entityType === "ASSIGNMENT_RULES") return [];
    if (entityType === "ATTENDANCE")
      return [[
        row.academic_year,
        row.programme_code,
        row.semester_number,
        row.section_code,
        row.subject_code,
        row.session_date,
        row.period_number,
        row.student_id || row.legacy_id,
      ]
        .join("|")
        .toUpperCase()];
    const key = [
      row.campus_code,
      row.block_code,
      row.floor_code,
      row.department_code,
      row.programme_code,
      row.academic_year,
      row.semester_number,
      row.code,
    ]
      .filter(Boolean)
      .join("|")
      .toUpperCase();
    return key ? [key] : [];
  }

  private canDeriveRequiredValue(
    entityType: ImportEntityType,
    field: string,
    row: ImportRow,
  ): boolean {
    if (field === "email" && entityType === "STAFF")
      return Boolean(row.employee_id || row.college_identity_id);
    if (field === "email" && entityType === "STUDENTS") return false;
    if (field === "department_code" && entityType === "STAFF") return true;
    return false;
  }

  private async parseWorkbook(
    buffer: Buffer,
    sheetName?: string,
  ): Promise<{
    matrix: unknown[][];
    sheetNames: string[];
    selectedSheetName?: string;
  }> {
    const workbook = new Workbook();
    // ExcelJS 4 predates the generic Buffer type shipped by @types/node 24.
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
    if (!sheetNames.length)
      throw new BadRequestException(
        "The workbook does not contain any sheets.",
      );
    if (sheetName) {
      if (!sheetNames.includes(sheetName))
        throw new BadRequestException(
          `The workbook does not contain a sheet named ${sheetName}.`,
        );
      const worksheet = workbook.getWorksheet(sheetName);
      if (!worksheet)
        throw new BadRequestException(
          `The workbook sheet ${sheetName} could not be read.`,
        );
      const matrix = this.worksheetMatrix(worksheet);
      if (!matrix.some((row) => row.some((cell) => this.cell(cell))))
        throw new BadRequestException(
          `The selected sheet ${sheetName} does not contain any import rows.`,
        );
      return { matrix, sheetNames, selectedSheetName: sheetName };
    }
    for (const selectedSheetName of sheetNames) {
      const worksheet = workbook.getWorksheet(selectedSheetName);
      if (!worksheet) continue;
      const matrix = this.worksheetMatrix(worksheet);
      if (matrix.some((row) => row.some((cell) => this.cell(cell))))
        return { matrix, sheetNames, selectedSheetName };
    }
    return { matrix: [], sheetNames, selectedSheetName: sheetNames[0] };
  }

  private async parseAvsStudentWorkbook(
    buffer: Buffer,
    originalFileName: string,
    options: ParseOptions,
  ): Promise<AvsStudentWorkbook | null> {
    const workbook = new Workbook();
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
    if (!sheetNames.length) return null;

    const sheetInspections: ImportSheetInspection[] = [];
    const dataRows: unknown[][] = [];
    const errors: ImportRowError[] = [];
    const detectedStudyYear =
      options.forcedStudyYear ?? this.studyYearFromFileName(originalFileName);
    let passwordWarnings = 0;
    let recognizedSheets = 0;
    let avsLayoutDetected = false;

    for (const worksheet of workbook.worksheets) {
      const matrix = this.worksheetMatrix(worksheet);
      const hasContent = matrix.some((row) =>
        row.some((cell) => this.cell(cell)),
      );
      const sourceDepartmentCode = worksheet.name.trim();
      if (!hasContent) {
        sheetInspections.push({
          sheetName: worksheet.name,
          rowCount: 0,
          sourceDepartmentCode,
          status: "EMPTY",
        });
        continue;
      }
      const headerIndex = matrix.slice(0, 10).findIndex((row) => {
        const headers = row.map((cell) =>
          this.normalizeHeader(this.cell(cell), "STUDENTS"),
        );
        return (
          headers.includes("email") &&
          headers.includes("temporary_password")
        );
      });
      if (headerIndex < 0) {
        sheetInspections.push({
          sheetName: worksheet.name,
          rowCount: 0,
          sourceDepartmentCode,
          status: "HEADER_NOT_FOUND",
        });
        continue;
      }

      recognizedSheets += 1;
      const rawHeaders =
        matrix[headerIndex]?.map((cell) => this.cell(cell)) ?? [];
      const headers = rawHeaders.map((header) =>
        this.normalizeHeader(header, "STUDENTS", options.columnMapping),
      );
      const emailIndex = headers.indexOf("email");
      const passwordIndex = headers.indexOf("temporary_password");
      const firstNameIndex = headers.indexOf("first_name");
      const lastNameIndex = headers.indexOf("last_name");
      const fullNameIndex = headers.indexOf("full_name");
      const legacyPathIndex = headers.indexOf("legacy_path");
      const configuredDepartmentCode = this.departmentMapping(
        options.departmentMappings,
        sourceDepartmentCode,
      );
      const mappedDepartmentCode =
        configuredDepartmentCode ?? sourceDepartmentCode;
      if (firstNameIndex >= 0 || lastNameIndex >= 0) avsLayoutDetected = true;
      let sheetRowCount = 0;

      for (
        let matrixIndex = headerIndex + 1;
        matrixIndex < matrix.length;
        matrixIndex += 1
      ) {
        const source = matrix[matrixIndex] ?? [];
        if (!source.some((cell) => this.cell(cell))) continue;
        const email = this.cell(source[emailIndex]);
        const rawPasswordCell = worksheet
          .getRow(matrixIndex + 1)
          .getCell(passwordIndex + 1);
        const password = this.normalizeTemporaryPassword(rawPasswordCell);
        const firstName = this.cell(source[firstNameIndex]);
        const lastName = this.cell(source[lastNameIndex]);
        const fullName =
          this.cell(source[fullNameIndex]) ||
          [firstName, lastName].filter(Boolean).join(" ").trim();
        const aggregateRowNumber = dataRows.length + 2;
        if (password.warning) passwordWarnings += 1;
        if (password.error) {
          errors.push({
            rowNumber: aggregateRowNumber,
            field: "temporary_password",
            message: `${password.error} (${worksheet.name}, row ${matrixIndex + 1}).`,
          });
        }
        dataRows.push([
          firstName,
          lastName,
          fullName,
          email,
          password.value,
          mappedDepartmentCode,
          detectedStudyYear ?? "",
          this.cell(source[legacyPathIndex]),
          worksheet.name,
          String(matrixIndex + 1),
          sourceDepartmentCode,
          password.error
            ? "Password value requires review"
            : password.warning
              ? "Password exact numeric format verified"
              : "Password format valid",
        ]);
        sheetRowCount += 1;
      }
      sheetInspections.push({
        sheetName: worksheet.name,
        headerRowNumber: headerIndex + 1,
        rowCount: sheetRowCount,
        sourceDepartmentCode,
        mappedDepartmentCode: configuredDepartmentCode,
        status: "READY",
      });
    }

    if (!recognizedSheets || !avsLayoutDetected) return null;
    return {
      matrix: [
        [
          "first_name",
          "last_name",
          "full_name",
          "email",
          "temporary_password",
          "department_code",
          "year",
          "legacy_path",
          "source_sheet",
          "source_row_number",
          "source_department_code",
          "password_status",
        ],
        ...dataRows,
      ],
      sheetNames,
      sheetInspections,
      detectedStudyYear,
      passwordWarnings,
      errors,
    };
  }

  private parseLegacyWorkbook(
    buffer: Buffer,
    sheetName?: string,
  ): {
    matrix: unknown[][];
    sheetNames: string[];
    selectedSheetName?: string;
  } {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, {
        type: "buffer",
        cellDates: true,
        cellFormula: true,
      });
    } catch {
      throw new BadRequestException(
        "The legacy XLS workbook could not be parsed. Check that it is a valid Excel file.",
      );
    }
    const sheetNames = workbook.SheetNames;
    if (!sheetNames.length)
      throw new BadRequestException(
        "The workbook does not contain any sheets.",
      );
    const readSheet = (name: string) => {
      const worksheet = workbook.Sheets[name];
      if (!worksheet)
        throw new BadRequestException(
          `The workbook sheet ${name} could not be read.`,
        );
      this.rejectLegacyFormulaCells(worksheet);
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        raw: false,
        defval: "",
        blankrows: true,
      });
      if (matrix.length - 1 > MAX_IMPORT_ROWS)
        throw new BadRequestException(
          `A single import can contain at most ${MAX_IMPORT_ROWS} rows.`,
        );
      return matrix;
    };

    if (sheetName) {
      if (!sheetNames.includes(sheetName))
        throw new BadRequestException(
          `The workbook does not contain a sheet named ${sheetName}.`,
        );
      const matrix = readSheet(sheetName);
      if (!matrix.some((row) => row.some((cell) => this.cell(cell))))
        throw new BadRequestException(
          `The selected sheet ${sheetName} does not contain any import rows.`,
        );
      return { matrix, sheetNames, selectedSheetName: sheetName };
    }

    for (const selectedSheetName of sheetNames) {
      const matrix = readSheet(selectedSheetName);
      if (matrix.some((row) => row.some((cell) => this.cell(cell))))
        return { matrix, sheetNames, selectedSheetName };
    }
    return { matrix: [], sheetNames, selectedSheetName: sheetNames[0] };
  }

  private rejectLegacyFormulaCells(worksheet: XLSX.WorkSheet): void {
    const range = worksheet["!ref"];
    if (!range) return;
    const decoded = XLSX.utils.decode_range(range);
    for (let row = decoded.s.r; row <= decoded.e.r; row += 1) {
      for (let column = decoded.s.c; column <= decoded.e.c; column += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        const cell = worksheet[address] as XLSX.CellObject | undefined;
        if (cell?.f)
          throw new BadRequestException(
            `Excel formulas are not allowed in imports. Paste values only before uploading. First formula: ${address}.`,
          );
      }
    }
  }

  private worksheetMatrix(worksheet: Worksheet): unknown[][] {
    if (worksheet.rowCount - 1 > MAX_IMPORT_ROWS)
      throw new BadRequestException(
        `A single import can contain at most ${MAX_IMPORT_ROWS} rows.`,
      );
    const matrix: unknown[][] = [];
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const worksheetRow = worksheet.getRow(rowNumber);
      const row: unknown[] = [];
      for (
        let columnNumber = 1;
        columnNumber <= worksheetRow.cellCount;
        columnNumber += 1
      ) {
        const cell = worksheetRow.getCell(columnNumber);
        if (this.isFormulaCell(cell))
          throw new BadRequestException(
            `Excel formulas are not allowed in imports. Paste values only before uploading. First formula: ${cell.address}.`,
          );
        row.push(this.excelCellValue(cell));
      }
      matrix.push(row);
    }
    return matrix;
  }

  private isFormulaCell(cell: Cell): boolean {
    if (cell.type === ValueType.Formula) return true;
    const value = cell.value;
    return Boolean(
      value &&
        typeof value === "object" &&
        ("formula" in value || "sharedFormula" in value),
    );
  }

  private excelCellValue(cell: Cell): CellValue | string {
    if (cell.isMerged && cell.master.address !== cell.address) return "";
    if (typeof cell.value === "number") {
      const zeroMask = cell.numFmt?.split(";")[0]?.trim();
      if (zeroMask && /^0+$/.test(zeroMask)) {
        return String(cell.value).padStart(zeroMask.length, "0");
      }
    }
    if (cell.text !== undefined && cell.text !== null && String(cell.text).trim() !== "") {
      return String(cell.text).trim();
    }
    const value = cell.value;
    if (value == null) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "object" && "richText" in value)
      return value.richText.map((part) => part.text).join("").trim();
    if (typeof value === "object" && "text" in value) return String(value.text).trim();
    return String(value).trim();
  }

  private normalizeTemporaryPassword(cell: Cell): {
    value: string;
    warning: boolean;
    error?: string;
  } {
    if (this.isFormulaCell(cell))
      return { value: "", warning: true, error: AVS_PASSWORD_PRECISION_ERROR };
    const value = cell.value;
    const formatted = String(cell.text ?? "").trim();
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value))
        return {
          value: "",
          warning: true,
          error: AVS_PASSWORD_PRECISION_ERROR,
        };
      const zeroMask = cell.numFmt?.split(";")[0]?.trim();
      if (zeroMask && /^0+$/.test(zeroMask))
        return {
          value: String(value).padStart(zeroMask.length, "0"),
          warning: true,
        };
      if (formatted && !/[eE]/.test(formatted))
        return {
          value: formatted.replace(/\.0$/, ""),
          warning: true,
        };
      return {
        value: value.toLocaleString("fullwide", {
          useGrouping: false,
          maximumFractionDigits: 0,
        }),
        warning: true,
      };
    }
    const exact = formatted || this.cell(value);
    if (/^\d+(?:\.0)?[eE][+-]?\d+$/.test(exact))
      return {
        value: "",
        warning: true,
        error: AVS_PASSWORD_PRECISION_ERROR,
      };
    return { value: exact, warning: false };
  }

  private canDeriveRequiredHeader(
    entityType: ImportEntityType,
    header: string,
    headers: string[],
  ): boolean {
    if (header === "college_identity_id" && entityType === "STUDENTS")
      return false;
    if (header === "student_id" && entityType === "STUDENTS")
      return headers.includes("college_identity_id") || headers.includes("register_number") || headers.includes("roll_number");
    if (header === "college_identity_id" && entityType === "STAFF")
      return headers.includes("employee_id");
    if (header === "email" && entityType === "STAFF")
      return headers.includes("employee_id");
    if (header === "email" && entityType === "STUDENTS") return false;
    if (header === "department_code" && entityType === "STAFF")
      return true;
    if (header === "college_identity_id" && entityType === "USERS")
      return headers.some((candidate) =>
        [
          "user_id",
          "employee_or_student_id",
          "employee_id",
          "student_id",
        ].includes(candidate),
      );
    if (header === "admission_year" && entityType === "STUDENTS")
      return headers.some((candidate) =>
        ["academic_year", "batch"].includes(candidate),
      );
    return false;
  }

  private prepareRow(entityType: ImportEntityType, row: ImportRow): ImportRow {
    const hasCollegeIdentityColumn = Object.prototype.hasOwnProperty.call(
      row,
      "college_identity_id",
    );
    if (!row.full_name?.trim() && (row.first_name || row.last_name))
      row.full_name = [row.first_name, row.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
    row.full_name = row.full_name?.trim();
    row.email = row.email?.trim().toLowerCase();
    row.department_code = row.department_code?.trim();
    row.temporary_password = row.temporary_password?.trim();
    if (!row.full_name?.trim() && ["USERS", "STAFF"].includes(entityType)) {
      row.full_name = this.displayNameFromAccount(row);
    }
    if (row.role_codes)
      row.role_codes = this.normalizeRoleCodes(row.role_codes);
    if (
      !row.college_identity_id &&
      entityType === "STUDENTS" &&
      !hasCollegeIdentityColumn
    )
      row.college_identity_id = row.student_id;
    if (!row.college_identity_id && entityType === "STAFF")
      row.college_identity_id = row.employee_id;
    if (!row.college_identity_id && entityType === "USERS")
      row.college_identity_id =
        row.user_id ||
        row.employee_or_student_id ||
        row.employee_id ||
        row.student_id;
    if (
      !row.college_identity_id &&
      ["USERS", "STAFF"].includes(entityType) &&
      row.email
    )
      row.college_identity_id = row.email.length <= 60 ? row.email : row.email.slice(0, 60);
    if (
      entityType === "USERS" &&
      !row.employee_id &&
      row.role_codes &&
      !row.role_codes.split(/[;,|]/).includes("STUDENT")
    )
      row.employee_id = row.employee_or_student_id || row.college_identity_id;
    if (
      entityType === "USERS" &&
      !row.student_id &&
      row.role_codes?.split(/[;,|]/).includes("STUDENT")
    )
      row.student_id = row.employee_or_student_id || row.college_identity_id || row.register_number || row.roll_number;
    if (
      !row.college_identity_id &&
      entityType === "STUDENTS" &&
      !hasCollegeIdentityColumn
    )
      row.college_identity_id = row.student_id || row.register_number || row.roll_number;
    if (!row.student_id && entityType === "STUDENTS")
      row.student_id = row.college_identity_id || row.register_number || row.roll_number;
    if (!row.admission_year && entityType === "STUDENTS") {
      const derivedYear =
        this.admissionYearForStudyYear(row.academic_year, row.year) ||
        this.yearFromAcademicValue(row.batch || row.academic_year);
      if (derivedYear) {
        row.admission_year = derivedYear;
      }
    }
    if (
      !row.admission_year &&
      entityType === "USERS" &&
      row.role_codes?.split(/[;,|]/).includes("STUDENT")
    )
      row.admission_year = this.yearFromAcademicValue(
        row.academic_year || row.batch,
      );
    if (!row.semester_number && row.semester)
      row.semester_number = row.semester;
    if (entityType === "STUDENTS" && row.year) {
      row.year = this.normalizedStudyYear(row.year) ?? row.year;
    }
    if (!row.joined_on && row.date_of_joining)
      row.joined_on = row.date_of_joining;
    return row;
  }

  private normalizeHeader(
    value: string,
    entityType: ImportEntityType,
    columnMapping?: Record<string, string>,
  ): string {
    const normalized = this.normalizeToken(value);
    const mapped = this.mappedHeader(value, normalized, columnMapping);
    if (mapped) return mapped;
    if (
      normalized === "name" &&
      ["USERS", "STUDENTS", "STAFF"].includes(entityType)
    )
      return "full_name";
    if (normalized === "name") return "name";
    if (normalized === "password" && !["USERS", "STUDENTS", "STAFF"].includes(entityType))
      return "password";
    return HEADER_ALIASES[normalized] ?? normalized;
  }

  private mappedHeader(
    rawHeader: string,
    normalizedHeader: string,
    columnMapping?: Record<string, string>,
  ): string | undefined {
    if (!columnMapping) return undefined;
    const entry = Object.entries(columnMapping).find(
      ([source]) =>
        source === rawHeader ||
        this.normalizeToken(source) === normalizedHeader,
    );
    if (!entry) return undefined;
    const target = entry[1].trim();
    if (
      ["__IGNORE__", "IGNORE", "SKIP", "DO_NOT_IMPORT"].includes(
        target.toUpperCase(),
      )
    )
      return IGNORED_COLUMN;
    const mapped = this.normalizeToken(target);
    if (!mapped) return undefined;
    return HEADER_ALIASES[mapped] ?? mapped;
  }

  private headerErrors(rowCount: number, messages: string[]): ImportRowError[] {
    if (!messages.length) return [];
    const message = messages.join(" ");
    return Array.from({ length: rowCount }, (_unused, index) => ({
      rowNumber: index + 2,
      message,
    }));
  }

  private normalizeToken(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[\s./-]+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .replace(/^_+|_+$/g, "");
  }

  private studyYearFromFileName(value: string): ImportStudyYear | undefined {
    const name = value
      .replace(extname(value), "")
      .toUpperCase()
      .replace(/[_-]+/g, " ");
    const words: ImportStudyYear[] = ["1", "2", "3", "4", "5", "6", "7", "8"];
    const names = [
      "FIRST",
      "SECOND",
      "THIRD",
      "FOURTH",
      "FIFTH",
      "SIXTH",
      "SEVENTH",
      "EIGHTH",
    ];
    for (const [index, year] of words.entries()) {
      const ordinal = index === 0 ? "ST" : index === 1 ? "ND" : index === 2 ? "RD" : "TH";
      const numericOrdinal = year === "2" ? `${year}(?:ND|RD)` : `${year}${ordinal}`;
      if (
        new RegExp(`\\b(?:${numericOrdinal}|${names[index]})\\s+YEAR\\b`).test(name) ||
        new RegExp(`\\bYEAR\\s+${year}\\b`).test(name)
      ) {
        return year;
      }
    }
    return undefined;
  }

  private normalizedStudyYear(value: string): ImportStudyYear | undefined {
    const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (/^[1-8]$/.test(normalized)) return normalized as ImportStudyYear;
    const aliases: Record<string, ImportStudyYear> = {
      "1ST": "1", "1ST_YEAR": "1", FIRST: "1", FIRST_YEAR: "1",
      "2ND": "2", "2RD": "2", "2ND_YEAR": "2", "2RD_YEAR": "2", SECOND: "2", SECOND_YEAR: "2",
      "3RD": "3", "3RD_YEAR": "3", THIRD: "3", THIRD_YEAR: "3",
      "4TH": "4", "4TH_YEAR": "4", FOURTH: "4", FOURTH_YEAR: "4",
      "5TH": "5", "5TH_YEAR": "5", FIFTH: "5", FIFTH_YEAR: "5",
      "6TH": "6", "6TH_YEAR": "6", SIXTH: "6", SIXTH_YEAR: "6",
      "7TH": "7", "7TH_YEAR": "7", SEVENTH: "7", SEVENTH_YEAR: "7",
      "8TH": "8", "8TH_YEAR": "8", EIGHTH: "8", EIGHTH_YEAR: "8",
    };
    return aliases[normalized];
  }

  private departmentMapping(
    mappings: Record<string, string> | undefined,
    source: string,
  ): string | undefined {
    if (!mappings) return undefined;
    const normalizedSource = this.normalizeDepartmentKey(source);
    const entry = Object.entries(mappings).find(
      ([candidate]) =>
        this.normalizeDepartmentKey(candidate) === normalizedSource,
    );
    return entry?.[1]?.trim() || undefined;
  }

  private applyDepartmentMapping(
    row: ImportRow,
    mappings: Record<string, string> | undefined,
  ): void {
    const source = (row.source_department_code || row.department_code || "").trim();
    if (!source) return;
    row.source_department_code = source;
    const mapped = this.departmentMapping(mappings, source);
    if (mapped) row.department_code = mapped;
  }

  private normalizeDepartmentKey(value: string): string {
    return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  private rowLocation(row: ImportRow | undefined, fallback: number): string {
    const sourceRow = Number(row?.source_row_number);
    if (row?.source_sheet && Number.isInteger(sourceRow) && sourceRow > 0)
      return `${row.source_sheet}, row ${sourceRow}`;
    return `row ${fallback}`;
  }

  private duplicateEmailGroups(rows: ImportRow[]): ImportDuplicateGroup[] {
    const groups = new Map<string, ImportDuplicateGroup["locations"]>();
    rows.forEach((row, index) => {
      const email = row.email?.trim().toLowerCase();
      if (!email) return;
      const locations = groups.get(email) ?? [];
      const sourceRow = Number(row.source_row_number);
      locations.push({
        rowNumber: index + 2,
        ...(row.source_sheet ? { sheetName: row.source_sheet } : {}),
        ...(Number.isInteger(sourceRow) && sourceRow > 0
          ? { sourceRowNumber: sourceRow }
          : {}),
      });
      groups.set(email, locations);
    });
    return [...groups.entries()]
      .filter(([, locations]) => locations.length > 1)
      .map(([normalizedEmail, locations]) => ({
        normalizedEmail,
        locations,
      }));
  }

  private duplicateRowNumbers(
    entityType: ImportEntityType,
    rows: ImportRow[],
    resolution: "KEEP_FIRST" | "SKIP_ALL",
  ): Set<number> {
    const seen = new Map<string, number>();
    const duplicateRows = new Set<number>();
    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      for (const key of this.logicalKeys(entityType, row)) {
        const previous = seen.get(key);
        if (previous) {
          duplicateRows.add(rowNumber);
          if (resolution === "SKIP_ALL") duplicateRows.add(previous);
        } else {
          seen.set(key, rowNumber);
        }
      }
    });
    return duplicateRows;
  }

  private cell(value: unknown): string {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return value == null ? "" : String(value).trim();
  }
  private normalizeRoleCodes(value: string): string {
    return value
      .split(/[;,|/]/)
      .map((code) => {
        const normalized = code
          .trim()
          .toUpperCase()
          .replace(/[\s-]+/g, "_");
        return ROLE_ALIASES[normalized] ?? normalized;
      })
      .filter(Boolean)
      .join(";");
  }
  private yearFromAcademicValue(value?: string): string {
    return value?.match(/\b(19|20|21|22)\d{2}\b/)?.[0] ?? "";
  }
  private displayNameFromAccount(row: ImportRow): string {
    const emailPrefix = row.email?.split("@")[0]?.replace(/[._-]+/g, " ");
    const identity = row.college_identity_id || row.student_id || row.register_number || row.employee_id || row.user_id;
    const value = emailPrefix || identity || "Imported User";
    return value
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
      .slice(0, 180);
  }
  private admissionYearForStudyYear(
    academicYearValue?: string,
    studyYearValue?: string,
  ): string {
    const academicStart = this.yearFromAcademicValue(academicYearValue);
    if (!academicStart || !studyYearValue) return "";
    const normalizedStudyYear = this.normalizedStudyYear(studyYearValue);
    const studyYear = normalizedStudyYear
      ? Number(normalizedStudyYear)
      : undefined;
    if (!studyYear) return "";
    return String(Number(academicStart) - studyYear + 1);
  }
  private validPhone(value: string): boolean {
    const digits = value.replace(/[^\d]/g, "");
    return digits.length >= 7 && digits.length <= 15;
  }
  private validTemporaryPassword(value: string): boolean {
    const trimmed = value.trim();
    if (/^\d{6,}$/.test(trimmed)) return true;
    return trimmed.length >= 10 && /[a-z]/.test(trimmed) && /[A-Z]/.test(trimmed) && /\d/.test(trimmed) && /[^A-Za-z0-9]/.test(trimmed);
  }
  private looksLikeFormula(field: string, value: string): boolean {
    const trimmed = value.trim();
    return (
      FORMULA_PREFIX.test(trimmed) ||
      (trimmed.startsWith("-") && !INTEGER_FIELDS.has(field))
    );
  }
  private async toBuffer(stream?: Readable): Promise<Buffer> {
    if (!stream)
      throw new BadRequestException("Stored import content is unavailable.");
    const chunks: Buffer[] = [];
    for await (const chunk of stream)
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array),
      );
    return Buffer.concat(chunks);
  }
}
