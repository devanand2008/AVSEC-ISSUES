import {
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
import { z } from "zod";
import {
  IMPORT_ENTITY_TYPES,
  IMPORT_MODES,
  IMPORT_TEMPLATES,
  type ImportEntityType,
  type ImportResultReport,
  type ImportRow,
  type ImportRowError,
} from "./import.types";

const MAX_IMPORT_BYTES =
  Number(process.env.MAX_EXCEL_FILE_SIZE_MB || 10) * 1024 * 1024;
const MAX_IMPORT_ROWS = Number(process.env.MAX_EXCEL_ROWS || 5_000);
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
const HEADER_ALIASES: Record<string, string> = {
  admission_no: "admission_number",
  admission_year: "admission_year",
  class: "section_code",
  class_section: "section_code",
  contact_no: "mobile",
  contact_number: "mobile",
  date_of_joining: "joined_on",
  department: "department_code",
  department_name: "department_code",
  dept: "department_code",
  dept_code: "department_code",
  dob: "date_of_birth",
  employee_name: "full_name",
  employee_or_student_id: "employee_or_student_id",
  full_name: "full_name",
  login_id: "college_identity_id",
  college_id: "college_identity_id",
  college_email: "email",
  email_address: "email",
  email_password: "__IGNORED_IMPORT_COLUMN__",
  mailbox_password: "__IGNORED_IMPORT_COLUMN__",
  original_password: "__IGNORED_IMPORT_COLUMN__",
  real_password: "__IGNORED_IMPORT_COLUMN__",
  register_number: "roll_number",
  register_no: "roll_number",
  reg_no: "roll_number",
  roll_no: "roll_number",
  study_year: "year",
  academic_year_or_study_year: "year",
  mobile_no: "mobile",
  mobile_number: "mobile",
  name_of_student: "full_name",
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
  student_roll_number: "roll_number",
  temp_password: "temporary_password",
  temporary_pwd: "temporary_password",
  temporary_password: "temporary_password",
  user_id: "college_identity_id",
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

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>("S3_BUCKET");
    this.client = new S3Client({
      endpoint: config.getOrThrow<string>("S3_ENDPOINT"),
      region: config.get<string>("S3_REGION", "us-east-1"),
      forcePathStyle: config.get<boolean>("S3_FORCE_PATH_STYLE", true),
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
    if (![".csv", ".xlsx"].includes(extension))
      throw new BadRequestException(
        "Only .csv and .xlsx imports are supported. Save legacy .xls files as .xlsx before uploading.",
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
  }> {
    const extension = extname(file.originalname).toLowerCase();
    let matrix: unknown[][];
    let sheetNames: string[] = [];
    let selectedSheetName: string | undefined;
    try {
      if (extension === ".csv")
        matrix = parse(file.buffer, {
          bom: true,
          relax_column_count: true,
          skip_empty_lines: true,
          trim: true,
        }) as unknown[][];
      else {
        const parsed = await this.parseWorkbook(
          file.buffer,
          options.sheetName,
        );
        matrix = parsed.matrix;
        sheetNames = parsed.sheetNames;
        selectedSheetName = parsed.selectedSheetName;
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
    if (!rows.length)
      throw new BadRequestException(
        "The import file does not contain any data rows.",
      );
    const errors = [
      ...this.headerErrors(rows.length, headerMessages),
      ...this.validateRows(entityType, rows),
    ];
    return {
      rawHeaders,
      headers,
      rows,
      errors,
      sheetNames,
      selectedSheetName,
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
  ): ImportRowError[] {
    const template = IMPORT_TEMPLATES[entityType];
    const errors: ImportRowError[] = [];
    const seen = new Map<string, number>();
    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      for (const field of template.required) {
        if (field === "temporary_password" && entityType !== "STUDENTS") continue;
        if (!row[field]?.trim())
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
        ].includes(row.room_type.toUpperCase())
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
        if (previous)
          errors.push({
            rowNumber,
            message: `This row duplicates row ${previous} within the file.`,
          });
        else seen.set(key, rowNumber);
      }
      if (entityType === "STUDENTS" && row.year && !["2", "3", "SECOND_YEAR", "THIRD_YEAR"].includes(row.year.toUpperCase().trim())) {
        errors.push({
          rowNumber,
          field: "year",
          message: "study_year must be 2, 3, SECOND_YEAR, or THIRD_YEAR.",
        });
      }
      if (entityType === "STUDENTS" && !row.college_identity_id && !row.student_id && !row.roll_number) {
        errors.push({
          rowNumber,
          field: "college_identity_id",
          message: "college_id, student_id, or register_number is required.",
        });
      }
    });
    return errors;
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
      return [
        row.college_identity_id ? `identity:${row.college_identity_id.toUpperCase()}` : "",
        row.email ? `email:${row.email.toLowerCase()}` : "",
        row.student_id ? `student:${row.student_id.toUpperCase()}` : "",
        row.roll_number ? `register:${row.roll_number.toUpperCase()}` : "",
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

  private canDeriveRequiredHeader(
    entityType: ImportEntityType,
    header: string,
    headers: string[],
  ): boolean {
    if (header === "college_identity_id" && entityType === "STUDENTS")
      return headers.includes("student_id") || headers.includes("roll_number");
    if (header === "student_id" && entityType === "STUDENTS")
      return headers.includes("college_identity_id") || headers.includes("roll_number");
    if (header === "college_identity_id" && entityType === "STAFF")
      return headers.includes("employee_id");
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
    if (row.role_codes)
      row.role_codes = this.normalizeRoleCodes(row.role_codes);
    if (!row.college_identity_id && entityType === "STUDENTS")
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
      row.student_id = row.employee_or_student_id || row.college_identity_id || row.roll_number;
    if (!row.college_identity_id && entityType === "STUDENTS")
      row.college_identity_id = row.student_id || row.roll_number;
    if (!row.student_id && entityType === "STUDENTS")
      row.student_id = row.college_identity_id || row.roll_number;
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
  private yearFromAcademicValue(value: string): string {
    return value.match(/\b(19|20|21|22)\d{2}\b/)?.[0] ?? "";
  }
  private admissionYearForStudyYear(
    academicYearValue: string,
    studyYearValue: string,
  ): string {
    const academicStart = this.yearFromAcademicValue(academicYearValue);
    if (!academicStart || !studyYearValue) return "";
    const aliases: Record<string, number> = {
      "2": 2,
      "2ND": 2,
      SECOND_YEAR: 2,
      "3": 3,
      "3RD": 3,
      THIRD_YEAR: 3,
    };
    const studyYear = aliases[studyYearValue.toUpperCase().trim()];
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
