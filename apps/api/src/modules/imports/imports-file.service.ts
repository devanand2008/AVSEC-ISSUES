import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parse } from "csv-parse/sync";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
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
import { RoomType } from "../../generated/prisma/enums";
import {
  IMPORT_ENTITY_TYPES,
  IMPORT_MODES,
  IMPORT_TEMPLATES,
  PEOPLE_IMPORT_HEADERS,
  importRowNumber,
  type ImportEntityType,
  type ImportResultReport,
  type ImportRow,
  type ImportRowError,
  type ImportStudyYear,
} from "./import.types";
import {
  readXlsxLexicalSheets,
  type XlsxLexicalCell,
  type XlsxLexicalSheet,
} from "./xlsx-lexical-reader";

const MAX_IMPORT_BYTES =
  Number(process.env.MAX_EXCEL_FILE_SIZE_MB || 10) * 1024 * 1024;
const MAX_IMPORT_ROWS = Number(process.env.MAX_EXCEL_ROWS || 5_000);
const PEOPLE_SOURCE_ENVELOPE_MAGIC = Buffer.from(
  "AVS-PEOPLE-IMPORT-SOURCE:v1\0",
  "utf8",
);
const PEOPLE_SOURCE_IV_BYTES = 12;
const PEOPLE_SOURCE_TAG_BYTES = 16;
const PEOPLE_SOURCE_KEY_CONTEXT = "avs-people-import-source-encryption-v1\0";
const PEOPLE_FIELD_LABELS: Record<string, string> = {
  full_name: "User Name",
  college_identity_id: "User ID",
  email: "Official College Email",
  temporary_password: "User Password",
  department_code: "Department",
  year: "Year",
  class_room_number: "Class Room Number",
  mobile: "Mobile Number",
};
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
  "total_semesters",
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
const ROOM_TYPES = new Set<string>(Object.values(RoomType));
const FORMULA_PREFIX = /^[=+@]/;
const IGNORED_COLUMN = "__IGNORED_IMPORT_COLUMN__";
const AVS_PASSWORD_PRECISION_ERROR =
  "Password value cannot be imported without losing precision.";
const HEADER_ALIASES: Record<string, string> = {
  admission_no: "admission_number",
  admission_year: "admission_year",
  class: "section_code",
  class_room_no: "class_room_number",
  class_room_number: "class_room_number",
  class_section: "section_code",
  classroom_no: "class_room_number",
  classroom_number: "class_room_number",
  contact_no: "mobile",
  contact_number: "mobile",
  date_of_joining: "joined_on",
  department: "department_code",
  department_code: "department_code",
  department_name: "department_code",
  dept: "department_code",
  dept_code: "department_code",
  degree_type: "degree_type_code",
  degree_type_code: "degree_type_code",
  degree_code: "degree_type_code",
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
  official_college_email: "email",
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
  user_password: "temporary_password",
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
  sourceHeaders?: string[];
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

interface AvsCredentialWorkbook {
  matrix: unknown[][];
  sheetNames: string[];
  sheetInspections: ImportSheetInspection[];
  detectedStudyYear?: ImportStudyYear;
  passwordWarnings: number;
  errors: ImportRowError[];
  credentialLayout: true;
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
        userId: z.string().max(60).optional(),
        userName: z.string().max(180).optional(),
        email: z.string().max(254).optional(),
        department: z.string().max(180).optional(),
        year: z.string().max(20).optional(),
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

  constructor(private readonly config: ConfigService) {
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
      forcePathStyle: this.booleanConfig(
        config.get<string | boolean>("S3_FORCE_PATH_STYLE", true),
      ),
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
    let credentialLayout = false;
    let genericPeopleLexicalSheet: XlsxLexicalSheet | undefined;
    try {
      if (extension === ".csv")
        matrix = parse(file.buffer, {
          bom: true,
          relax_column_count: true,
          skip_empty_lines: false,
          // Preserve PEOPLE identity/password bytes so surrounding whitespace can
          // be rejected explicitly instead of silently changing login data.
          trim: false,
        }) as unknown[][];
      else if (extension === ".xls") {
        if (entityType === "PEOPLE") {
          throw new BadRequestException(
            "Legacy .xls People imports cannot prove exact password characters. Save the workbook as .xlsx with passwords stored as text before uploading.",
          );
        }
        const parsed = this.parseLegacyWorkbook(file.buffer, options.sheetName);
        matrix = parsed.matrix;
        sheetNames = parsed.sheetNames;
        selectedSheetName = parsed.selectedSheetName;
      } else {
        const peopleLexicalSheets =
          entityType === "PEOPLE"
            ? await readXlsxLexicalSheets(file.buffer)
            : undefined;
        const avsEntityType =
          entityType === "PEOPLE" || entityType === "STUDENTS"
            ? entityType
            : undefined;
        const avsWorkbook =
          avsEntityType && !options.sheetName
            ? await this.parseAvsCredentialWorkbook(
                file.buffer,
                file.originalname,
                avsEntityType,
                options,
                peopleLexicalSheets,
              )
            : null;
        if (avsWorkbook) {
          matrix = avsWorkbook.matrix;
          sheetNames = avsWorkbook.sheetNames;
          sheetInspections = avsWorkbook.sheetInspections;
          detectedStudyYear = avsWorkbook.detectedStudyYear;
          passwordWarnings = avsWorkbook.passwordWarnings;
          workbookErrors = avsWorkbook.errors;
          credentialLayout = avsWorkbook.credentialLayout;
        } else {
          const parsed = await this.parseWorkbook(
            file.buffer,
            options.sheetName,
          );
          matrix = parsed.matrix;
          sheetNames = parsed.sheetNames;
          selectedSheetName = parsed.selectedSheetName;
          if (entityType === "PEOPLE") {
            genericPeopleLexicalSheet = selectedSheetName
              ? peopleLexicalSheets?.get(selectedSheetName)
              : undefined;
            if (!genericPeopleLexicalSheet) {
              throw new BadRequestException(
                "The selected People worksheet could not be matched to its exact XML values.",
              );
            }
          }
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
    if (entityType !== "PEOPLE" && new Set(headers).size !== headers.length)
      throw new BadRequestException("Import headers must be unique.");
    const template = IMPORT_TEMPLATES[entityType];
    const missing = template.required.filter(
      (header) =>
        !headers.includes(header) &&
        !this.canDeriveRequiredHeader(entityType, header, headers),
    );
    const allowed = new Set([...template.required, ...template.optional]);
    const unexpected = headers.filter((header) => !allowed.has(header));
    const genericHeaderMessages = [
      ...(missing.length
        ? [
            `Missing required headers: ${missing
              .map((field) => this.fieldLabel(entityType, field))
              .join(", ")}.`,
          ]
        : []),
      ...(unexpected.length
        ? [
            `Unexpected headers: ${unexpected.join(", ")}. Map or skip these columns before confirming.`,
          ]
        : []),
    ];
    const headerMessages =
      entityType === "PEOPLE" && !credentialLayout
        ? this.peopleHeaderMessages(rawHeaders)
        : genericHeaderMessages;
    const genericPeoplePasswordColumn =
      entityType === "PEOPLE" && genericPeopleLexicalSheet
        ? activeColumns.find((column) => column.header === "temporary_password")
        : undefined;

    const rows = matrix
      .slice(1)
      .map((source, index) => ({ source, sourceRowNumber: index + 2 }))
      .filter(({ source }) =>
        activeColumns.some((column) => this.cell(source[column.index])),
      )
      .map(({ source, sourceRowNumber }, aggregateIndex) => {
        const lexicalPassword = genericPeoplePasswordColumn
          ? this.normalizeLexicalTemporaryPassword(
              genericPeopleLexicalSheet?.cells.get(
                this.excelCellAddress(
                  genericPeoplePasswordColumn.index + 1,
                  sourceRowNumber,
                ),
              ),
            )
          : undefined;
        if (lexicalPassword?.warning) passwordWarnings += 1;
        if (lexicalPassword?.error) {
          workbookErrors.push({
            rowNumber: aggregateIndex + 2,
            field: "temporary_password",
            message: lexicalPassword.error,
          });
        }
        const row = this.prepareRow(
          entityType,
          Object.fromEntries(
            activeColumns.map((column) => [
              column.header,
              this.importCell(
                entityType,
                column.header,
                column.header === "temporary_password" && lexicalPassword
                  ? lexicalPassword.value
                  : source[column.index],
              ),
            ]),
          ) as ImportRow,
        );
        if (entityType === "PEOPLE") {
          row.import_row_number = String(aggregateIndex + 2);
          if (!row.source_row_number?.trim()) {
            row.source_row_number = String(sourceRowNumber);
          }
        }
        return row;
      });
    rows.forEach((row) =>
      this.applyDepartmentMapping(row, options.departmentMappings),
    );
    if (!rows.length)
      throw new BadRequestException(
        "The import file does not contain any data rows.",
      );
    const errors = this.enrichPeopleErrors(entityType, rows, [
      ...workbookErrors,
      ...this.headerErrors(entityType, rows, headerMessages),
      ...this.validateRows(
        entityType,
        rows,
        options.duplicateResolution ?? "KEEP_FIRST",
        options.officialEmailDomains,
      ),
    ]);
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
      duplicateGroups: this.duplicateEmailGroups(entityType, rows),
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
    key: string,
  ): Promise<{ key: string; sha256: string }> {
    const extension = extname(file.originalname).toLowerCase();
    this.requireSourceKey(collegeId, key);
    if (extname(key).toLowerCase() !== extension) {
      throw new BadRequestException(
        "The import source key does not match the uploaded file type.",
      );
    }
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const storedBody =
      entityType === "PEOPLE"
        ? this.encryptPeopleSource(file.buffer, key)
        : file.buffer;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: storedBody,
        ContentType:
          extension === ".csv"
            ? "text/csv"
            : extension === ".xls"
              ? "application/vnd.ms-excel"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Metadata: {
          entity: entityType,
          sha256,
          ...(entityType === "PEOPLE"
            ? { sourceEncryption: "aes-256-gcm-v1" }
            : {}),
        },
      }),
    );
    return { key, sha256 };
  }

  async loadSource(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const stored = await this.toBuffer(response.Body as Readable | undefined);
    return this.isEncryptedPeopleSource(stored)
      ? this.decryptPeopleSource(stored, key)
      : stored;
  }

  private peopleSourceKey(): Buffer {
    const pepper = this.config.get<string>("PASSWORD_PEPPER", "");
    if (pepper.length < 32) {
      throw new Error(
        "PASSWORD_PEPPER must contain at least 32 characters for People import source encryption.",
      );
    }
    return createHash("sha256")
      .update(PEOPLE_SOURCE_KEY_CONTEXT)
      .update(pepper, "utf8")
      .digest();
  }

  private peopleSourceAad(storageKey: string): Buffer {
    return Buffer.concat([
      PEOPLE_SOURCE_ENVELOPE_MAGIC,
      Buffer.from(storageKey, "utf8"),
    ]);
  }

  private encryptPeopleSource(content: Buffer, storageKey: string): Buffer {
    const iv = randomBytes(PEOPLE_SOURCE_IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.peopleSourceKey(), iv);
    cipher.setAAD(this.peopleSourceAad(storageKey));
    const ciphertext = Buffer.concat([cipher.update(content), cipher.final()]);
    return Buffer.concat([
      PEOPLE_SOURCE_ENVELOPE_MAGIC,
      iv,
      cipher.getAuthTag(),
      ciphertext,
    ]);
  }

  private isEncryptedPeopleSource(content: Buffer): boolean {
    return (
      content.length >= PEOPLE_SOURCE_ENVELOPE_MAGIC.length &&
      content
        .subarray(0, PEOPLE_SOURCE_ENVELOPE_MAGIC.length)
        .equals(PEOPLE_SOURCE_ENVELOPE_MAGIC)
    );
  }

  private decryptPeopleSource(content: Buffer, storageKey: string): Buffer {
    const payloadOffset =
      PEOPLE_SOURCE_ENVELOPE_MAGIC.length +
      PEOPLE_SOURCE_IV_BYTES +
      PEOPLE_SOURCE_TAG_BYTES;
    if (content.length <= payloadOffset) {
      throw new BadRequestException(
        "Stored People import source has an invalid encrypted envelope.",
      );
    }
    const ivStart = PEOPLE_SOURCE_ENVELOPE_MAGIC.length;
    const tagStart = ivStart + PEOPLE_SOURCE_IV_BYTES;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.peopleSourceKey(),
      content.subarray(ivStart, tagStart),
    );
    decipher.setAAD(this.peopleSourceAad(storageKey));
    decipher.setAuthTag(content.subarray(tagStart, payloadOffset));
    try {
      return Buffer.concat([
        decipher.update(content.subarray(payloadOffset)),
        decipher.final(),
      ]);
    } catch {
      throw new BadRequestException(
        "Stored People import source failed authenticated decryption.",
      );
    }
  }

  async deleteSource(collegeId: string, key: string): Promise<void> {
    this.requireSourceKey(collegeId, key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  sourceStorageKey(
    collegeId: string,
    importJobId: string,
    originalName: string,
  ): string {
    const extension = extname(originalName).toLowerCase();
    return `colleges/${collegeId}/imports/source/${importJobId}${extension}`;
  }

  private requireSourceKey(collegeId: string, key: string): void {
    const prefix = `colleges/${collegeId}/imports/source/`;
    const fileName = key.startsWith(prefix) ? key.slice(prefix.length) : "";
    if (
      !fileName ||
      fileName.includes("/") ||
      !/^[A-Za-z0-9._-]+\.(csv|xls|xlsx)$/i.test(fileName)
    ) {
      throw new BadRequestException(
        "The import source is outside the authorized college storage path.",
      );
    }
  }

  async saveReport(
    collegeId: string,
    report: ImportResultReport,
    storageKey = `colleges/${collegeId}/imports/results/${report.jobId}.json`,
  ): Promise<string> {
    this.requireResultKey(collegeId, report.jobId, storageKey);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: JSON.stringify(report, null, 2),
        ContentType: "application/json",
      }),
    );
    return storageKey;
  }

  resultStorageKey(
    collegeId: string,
    importJobId: string,
    processingAttemptToken: string,
  ): string {
    const attemptHash = createHash("sha256")
      .update(processingAttemptToken)
      .digest("hex");
    return `colleges/${collegeId}/imports/results/${importJobId}-${attemptHash}.json`;
  }

  async deleteReport(
    collegeId: string,
    importJobId: string,
    storageKey: string,
  ): Promise<void> {
    this.requireResultKey(collegeId, importJobId, storageKey);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }),
    );
  }

  private requireResultKey(
    collegeId: string,
    importJobId: string,
    storageKey: string,
  ): void {
    const prefix = `colleges/${collegeId}/imports/results/`;
    const fileName = storageKey.startsWith(prefix)
      ? storageKey.slice(prefix.length)
      : "";
    const escapedJobId = importJobId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (
      !fileName ||
      fileName.includes("/") ||
      !new RegExp(`^${escapedJobId}(?:-[a-f0-9]{64})?\\.json$`).test(fileName)
    ) {
      throw new BadRequestException(
        "The import result is outside the authorized job storage path.",
      );
    }
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
      ? new Set(
          configuredDomains
            .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
            .filter(Boolean),
        )
      : this.officialEmailDomains;
    const errors: ImportRowError[] = [];
    const seen = new Map<string, number>();
    const duplicateErrors = new Set<string>();
    rows.forEach((row, index) => {
      const rowNumber = importRowNumber(entityType, row, index + 2);
      for (const field of template.required) {
        if (
          !row[field]?.trim() &&
          !this.canDeriveRequiredValue(entityType, field, row)
        )
          errors.push({
            rowNumber,
            field,
            message: `${this.fieldLabel(entityType, field)} is required.`,
          });
      }
      if (entityType === "PEOPLE") {
        if (
          row.college_identity_id &&
          row.college_identity_id !== row.college_identity_id.trim()
        ) {
          errors.push({
            rowNumber,
            field: "college_identity_id",
            message: "User ID must not begin or end with whitespace.",
          });
        }
        if (row.college_identity_id?.trim().length > 60) {
          errors.push({
            rowNumber,
            field: "college_identity_id",
            message: "User ID must contain at most 60 characters.",
          });
        }
        if (row.full_name?.trim().length > 180) {
          errors.push({
            rowNumber,
            field: "full_name",
            message: "User Name must contain at most 180 characters.",
          });
        }
        if (
          row.temporary_password &&
          row.temporary_password !== row.temporary_password.trim()
        ) {
          errors.push({
            rowNumber,
            field: "temporary_password",
            message: "User Password must not begin or end with whitespace.",
          });
        }
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
      if (
        row.mobile &&
        (entityType === "PEOPLE"
          ? !this.validPeopleMobile(row.mobile)
          : !this.validPhone(row.mobile))
      )
        errors.push({
          rowNumber,
          field: "mobile",
          message:
            entityType === "PEOPLE"
              ? "Mobile Number must contain only 7 to 15 digits."
              : "mobile must contain 7 to 15 digits.",
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
        (entityType === "PEOPLE"
          ? !this.validPeopleTemporaryPassword(row.temporary_password)
          : !this.validTemporaryPassword(row.temporary_password))
      )
        errors.push({
          rowNumber,
          field: "temporary_password",
          message:
            entityType === "PEOPLE"
              ? this.peopleTemporaryPasswordMessage()
              : "temporary_password must be at least 6 characters and is accepted only as a first-login temporary password.",
        });
      if (
        row.room_type &&
        !ROOM_TYPES.has(
          row.room_type
            .trim()
            .toUpperCase()
            .replace(/[\s-]+/g, "_"),
        )
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
            entityType === "PEOPLE"
              ? rows.find(
                  (candidate, candidateIndex) =>
                    importRowNumber(
                      entityType,
                      candidate,
                      candidateIndex + 2,
                    ) === previous,
                )
              : rows[previous - 2],
            previous,
          );
          const currentError = `${rowNumber}:${key}`;
          if (!duplicateErrors.has(currentError)) {
            errors.push({
              rowNumber,
              field:
                entityType === "PEOPLE" && key.startsWith("identity:")
                  ? "college_identity_id"
                  : key.startsWith("email:")
                    ? "email"
                    : undefined,
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
                field:
                  entityType === "PEOPLE" && key.startsWith("identity:")
                    ? "college_identity_id"
                    : key.startsWith("email:")
                      ? "email"
                      : undefined,
                message: `Duplicate account at ${previousLocation}; both this row and ${currentLocation} will be skipped.`,
              });
              duplicateErrors.add(previousError);
            }
          }
        } else seen.set(key, rowNumber);
      }
      if (
        ["PEOPLE", "STUDENTS"].includes(entityType) &&
        row.year &&
        !this.normalizedStudyYear(row.year)
      ) {
        errors.push({
          rowNumber,
          field: "year",
          message:
            entityType === "PEOPLE"
              ? "Year must be an integer from 1 to 4."
              : "study_year must be an integer from 1 to 4.",
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
          message:
            "Study year was not detected. Select a study year from 1 to 4 before confirming.",
        });
      }
      if (
        entityType === "STUDENTS" &&
        (row.programme_code ||
          row.section_code ||
          row.student_id ||
          row.register_number ||
          row.roll_number) &&
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
    return !["false", "0", "no", "off"].includes(
      String(value ?? "true")
        .trim()
        .toLowerCase(),
    );
  }

  private logicalKeys(entityType: ImportEntityType, row: ImportRow): string[] {
    if (entityType === "PEOPLE") {
      const identity = row.college_identity_id
        ?.trim()
        .toLocaleUpperCase("en-US");
      const email = row.email?.trim().toLocaleLowerCase("en-US");
      const identityIsEmail =
        Boolean(identity) &&
        Boolean(email) &&
        identity?.toLocaleLowerCase("en-US") === email;
      return [
        identity && !identityIsEmail ? `identity:${identity}` : "",
        email ? `email:${email}` : "",
      ].filter(Boolean);
    }
    if (["PEOPLE", "USERS", "STUDENTS", "STAFF"].includes(entityType)) {
      if (row.subject_code) {
        return [
          [
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
            .toUpperCase(),
        ];
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
        row.register_number
          ? `register:${row.register_number.toUpperCase()}`
          : "",
        row.roll_number ? `roll:${row.roll_number.toUpperCase()}` : "",
      ].filter(Boolean);
    }
    if (entityType === "ASSETS")
      return row.code ? [row.code.toUpperCase()] : [];
    if (entityType === "RESPONSIBLE_PERSONS")
      return [`${row.team_code}|${row.college_identity_id}`.toUpperCase()];
    if (entityType === "ASSIGNMENT_RULES") return [];
    if (entityType === "ATTENDANCE")
      return [
        [
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
          .toUpperCase(),
      ];
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

  private async parseAvsCredentialWorkbook(
    buffer: Buffer,
    originalFileName: string,
    entityType: "PEOPLE" | "STUDENTS",
    options: ParseOptions,
    suppliedLexicalSheets?: ReadonlyMap<string, XlsxLexicalSheet>,
  ): Promise<AvsCredentialWorkbook | null> {
    const lexicalSheets =
      suppliedLexicalSheets ?? (await readXlsxLexicalSheets(buffer));
    const workbook = new Workbook();
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
    if (!sheetNames.length) return null;

    const sheetInspections: ImportSheetInspection[] = [];
    const dataRows: unknown[][] = [];
    const errors: ImportRowError[] = [];
    const fileStudyYear = this.studyYearFromFileName(originalFileName);
    const detectedStudyYear = options.forcedStudyYear ?? fileStudyYear;
    let passwordWarnings = 0;
    let recognizedSheets = 0;
    let avsLayoutDetected = false;

    for (const worksheet of workbook.worksheets) {
      const matrix = this.worksheetMatrix(worksheet);
      const hasContent = matrix.some((row) =>
        row.some((cell) => this.cell(cell)),
      );
      const sourceDepartmentCode = worksheet.name.trim();
      const lexicalSheet = lexicalSheets.get(worksheet.name);
      if (!lexicalSheet) {
        throw new BadRequestException(
          `The workbook XML for sheet ${worksheet.name} could not be resolved.`,
        );
      }
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
        const sourceHeaders = new Set(
          row.map((cell) => this.cell(cell).trim().toLocaleUpperCase("en-US")),
        );
        return [
          "FIRST NAME",
          "LAST NAME",
          "EMAIL ID",
          "PASSWORD",
          "/PATH",
        ].every((header) => sourceHeaders.has(header));
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
        this.normalizeHeader(header, entityType, options.columnMapping),
      );
      const emailIndex = headers.indexOf("email");
      const passwordIndex = headers.indexOf("temporary_password");
      const identityIndex = headers.indexOf("college_identity_id");
      const firstNameIndex = headers.indexOf("first_name");
      const lastNameIndex = headers.indexOf("last_name");
      const fullNameIndex = headers.indexOf("full_name");
      const departmentIndex = headers.indexOf("department_code");
      const yearIndex = headers.indexOf("year");
      const classroomIndex = headers.indexOf("class_room_number");
      const mobileIndex = headers.indexOf("mobile");
      const legacyPathIndex = headers.indexOf("legacy_path");
      if (firstNameIndex >= 0 || lastNameIndex >= 0 || fullNameIndex >= 0)
        avsLayoutDetected = true;
      let sheetRowCount = 0;

      for (
        let matrixIndex = headerIndex + 1;
        matrixIndex < matrix.length;
        matrixIndex += 1
      ) {
        const source = matrix[matrixIndex] ?? [];
        if (!source.some((cell) => this.cell(cell))) continue;
        const email = this.cell(source[emailIndex]).toLocaleLowerCase("en-US");
        const rawPasswordCell = worksheet
          .getRow(matrixIndex + 1)
          .getCell(passwordIndex + 1);
        const lexicalPasswordCell = lexicalSheet.cells.get(
          rawPasswordCell.address,
        );
        const password = this.normalizeTemporaryPassword(
          rawPasswordCell,
          lexicalPasswordCell,
        );
        const firstName = this.cell(source[firstNameIndex]);
        const lastName = this.cell(source[lastNameIndex]);
        const fullName =
          this.cell(source[fullNameIndex]) ||
          [firstName, lastName].filter(Boolean).join(" ").trim();
        const explicitCollegeIdentityId = this.cell(source[identityIndex]);
        const collegeIdentityId =
          explicitCollegeIdentityId || (entityType === "PEOPLE" ? email : "");
        const explicitDepartment = this.cell(source[departmentIndex]);
        const sourceDepartment = explicitDepartment || sourceDepartmentCode;
        const configuredDepartmentCode = this.departmentMapping(
          options.departmentMappings,
          sourceDepartment,
        );
        const mappedDepartmentCode =
          configuredDepartmentCode ?? sourceDepartment;
        const explicitYear = this.cell(source[yearIndex]);
        const normalizedExplicitYear = explicitYear
          ? this.normalizedStudyYear(explicitYear)
          : undefined;
        const rowYear =
          normalizedExplicitYear ?? (explicitYear || detectedStudyYear || "");
        const aggregateRowNumber = dataRows.length + 2;
        if (password.warning) passwordWarnings += 1;
        if (password.error) {
          errors.push({
            rowNumber: aggregateRowNumber,
            field: "temporary_password",
            message: `${password.error} (${worksheet.name}, row ${matrixIndex + 1}).`,
          });
        }
        if (
          explicitYear &&
          detectedStudyYear &&
          normalizedExplicitYear &&
          normalizedExplicitYear !== detectedStudyYear
        ) {
          errors.push({
            rowNumber: aggregateRowNumber,
            field: "year",
            message: `Study year conflicts with the workbook context (${worksheet.name}, row ${matrixIndex + 1}).`,
          });
        }
        if (
          fileStudyYear &&
          options.forcedStudyYear &&
          fileStudyYear !== options.forcedStudyYear
        ) {
          errors.push({
            rowNumber: aggregateRowNumber,
            field: "year",
            message: `Selected study year conflicts with the workbook filename (${worksheet.name}, row ${matrixIndex + 1}).`,
          });
        }
        const passwordStatus = password.error
          ? "Password value requires review"
          : password.warning
            ? "Password exact XML integer verified"
            : "Password text preserved";
        dataRows.push(
          entityType === "PEOPLE"
            ? [
                fullName,
                collegeIdentityId,
                email,
                password.value,
                mappedDepartmentCode,
                rowYear,
                this.cell(source[classroomIndex]),
                this.cell(source[mobileIndex]),
                worksheet.name,
                String(matrixIndex + 1),
                sourceDepartment,
                passwordStatus,
              ]
            : [
                firstName,
                lastName,
                fullName,
                email,
                password.value,
                mappedDepartmentCode,
                rowYear,
                this.cell(source[legacyPathIndex]),
                worksheet.name,
                String(matrixIndex + 1),
                sourceDepartment,
                passwordStatus,
              ],
        );
        sheetRowCount += 1;
      }
      sheetInspections.push({
        sheetName: worksheet.name,
        headerRowNumber: headerIndex + 1,
        sourceHeaders: rawHeaders.filter(Boolean),
        rowCount: sheetRowCount,
        sourceDepartmentCode,
        mappedDepartmentCode: this.departmentMapping(
          options.departmentMappings,
          sourceDepartmentCode,
        ),
        status: "READY",
      });
    }

    if (!recognizedSheets || !avsLayoutDetected) return null;
    return {
      matrix: [
        entityType === "PEOPLE"
          ? [
              "full_name",
              "college_identity_id",
              "email",
              "temporary_password",
              "department_code",
              "year",
              "class_room_number",
              "mobile",
              "source_sheet",
              "source_row_number",
              "source_department_code",
              "password_status",
            ]
          : [
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
      credentialLayout: true,
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
    if (
      cell.text !== undefined &&
      cell.text !== null &&
      String(cell.text).trim() !== ""
    ) {
      return String(cell.text);
    }
    const value = cell.value;
    if (value == null) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "object" && "richText" in value)
      return value.richText.map((part) => part.text).join("");
    if (typeof value === "object" && "text" in value) return String(value.text);
    return String(value);
  }

  private excelCellAddress(columnNumber: number, rowNumber: number): string {
    let remaining = columnNumber;
    let column = "";
    while (remaining > 0) {
      remaining -= 1;
      column = String.fromCharCode(65 + (remaining % 26)) + column;
      remaining = Math.floor(remaining / 26);
    }
    return `${column}${rowNumber}`;
  }

  private normalizeLexicalTemporaryPassword(lexical?: XlsxLexicalCell): {
    value: string;
    warning: boolean;
    error?: string;
  } {
    if (!lexical || lexical.kind === "BLANK") {
      return { value: "", warning: false };
    }
    if (lexical.hasFormula) {
      return { value: "", warning: true, error: AVS_PASSWORD_PRECISION_ERROR };
    }
    if (lexical.kind === "NUMBER") {
      return /^\d+$/.test(lexical.rawValue)
        ? { value: lexical.rawValue, warning: true }
        : {
            value: "",
            warning: true,
            error: AVS_PASSWORD_PRECISION_ERROR,
          };
    }
    if (["SHARED_STRING", "INLINE_STRING", "STRING"].includes(lexical.kind)) {
      return { value: lexical.text, warning: false };
    }
    return { value: "", warning: true, error: AVS_PASSWORD_PRECISION_ERROR };
  }

  private normalizeTemporaryPassword(
    cell: Cell,
    lexical?: XlsxLexicalCell,
  ): {
    value: string;
    warning: boolean;
    error?: string;
  } {
    if (lexical?.hasFormula || this.isFormulaCell(cell))
      return { value: "", warning: true, error: AVS_PASSWORD_PRECISION_ERROR };
    if (lexical) {
      if (lexical.kind === "NUMBER") {
        if (!/^\d+$/.test(lexical.rawValue)) {
          return {
            value: "",
            warning: true,
            error: AVS_PASSWORD_PRECISION_ERROR,
          };
        }
        return { value: lexical.rawValue, warning: true };
      }
      if (["SHARED_STRING", "INLINE_STRING", "STRING"].includes(lexical.kind)) {
        return { value: lexical.text, warning: false };
      }
      if (lexical.kind !== "BLANK") {
        return {
          value: "",
          warning: true,
          error: AVS_PASSWORD_PRECISION_ERROR,
        };
      }
    }
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
      return (
        headers.includes("college_identity_id") ||
        headers.includes("register_number") ||
        headers.includes("roll_number")
      );
    if (header === "college_identity_id" && entityType === "STAFF")
      return headers.includes("employee_id");
    if (header === "email" && entityType === "STAFF")
      return headers.includes("employee_id");
    if (header === "email" && entityType === "STUDENTS") return false;
    if (header === "department_code" && entityType === "STAFF") return true;
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
    row.temporary_password =
      entityType === "PEOPLE"
        ? (row.temporary_password ?? "")
        : row.temporary_password?.trim();
    row.class_room_number = row.class_room_number?.trim();
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
      row.college_identity_id =
        row.email.length <= 60 ? row.email : row.email.slice(0, 60);
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
      row.student_id =
        row.employee_or_student_id ||
        row.college_identity_id ||
        row.register_number ||
        row.roll_number;
    if (
      !row.college_identity_id &&
      entityType === "STUDENTS" &&
      !hasCollegeIdentityColumn
    )
      row.college_identity_id =
        row.student_id || row.register_number || row.roll_number;
    if (!row.student_id && entityType === "STUDENTS")
      row.student_id =
        row.college_identity_id || row.register_number || row.roll_number;
    if (entityType === "PEOPLE") {
      row.role_codes = "STUDENT";
      row.student_id = row.college_identity_id;
      row.year = this.normalizedStudyYear(row.year || "") ?? row.year?.trim();
      row.mobile = row.mobile?.trim();
      row.account_status = "ACTIVE";
    }
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
      ["PEOPLE", "USERS", "STUDENTS", "STAFF"].includes(entityType)
    )
      return "full_name";
    if (normalized === "name") return "name";
    if (
      normalized === "password" &&
      !["PEOPLE", "USERS", "STUDENTS", "STAFF"].includes(entityType)
    )
      return "password";
    return HEADER_ALIASES[normalized] ?? normalized;
  }

  private peopleHeaderMessages(rawHeaders: string[]): string[] {
    const canonicalByKey = new Map(
      PEOPLE_IMPORT_HEADERS.map((header) => [
        header.toLocaleLowerCase("en-US"),
        header,
      ]),
    );
    const suppliedHeaderKeys = rawHeaders.map((header) =>
      header.trim().toLocaleLowerCase("en-US"),
    );
    const suppliedKeys = new Set(suppliedHeaderKeys);
    const requiredHeaders = IMPORT_TEMPLATES.PEOPLE.required.map(
      (field) => PEOPLE_FIELD_LABELS[field] ?? field,
    );
    const missing = requiredHeaders.filter(
      (header) => !suppliedKeys.has(header.toLocaleLowerCase("en-US")),
    );
    const unexpected = rawHeaders.filter(
      (header) => !canonicalByKey.has(header.trim().toLocaleLowerCase("en-US")),
    );
    const seen = new Set<string>();
    const duplicateKeys = new Set<string>();
    for (const key of suppliedHeaderKeys) {
      if (seen.has(key)) duplicateKeys.add(key);
      seen.add(key);
    }
    const duplicates = [...duplicateKeys].map(
      (key) => canonicalByKey.get(key) ?? (key || "<blank header>"),
    );

    return [
      ...(missing.length
        ? [`Missing required headers: ${missing.join(", ")}.`]
        : []),
      ...(unexpected.length
        ? [
            `Unexpected headers: ${unexpected.map((header) => header || "<blank header>").join(", ")}. Use the downloaded People template without renaming or adding columns.`,
          ]
        : []),
      ...(duplicates.length
        ? [
            `Unexpected duplicate headers: ${duplicates.join(", ")}. Each People template column must appear exactly once.`,
          ]
        : []),
    ];
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

  private headerErrors(
    entityType: ImportEntityType,
    rows: ImportRow[],
    messages: string[],
  ): ImportRowError[] {
    if (!messages.length) return [];
    const message = messages.join(" ");
    return rows.map((row, index) => ({
      rowNumber: importRowNumber(entityType, row, index + 2),
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
    const words: ImportStudyYear[] = ["1", "2", "3", "4"];
    const names = ["FIRST", "SECOND", "THIRD", "FOURTH"];
    for (const [index, year] of words.entries()) {
      const ordinal =
        index === 0 ? "ST" : index === 1 ? "ND" : index === 2 ? "RD" : "TH";
      const numericOrdinal =
        year === "2" ? `${year}(?:ND|RD)` : `${year}${ordinal}`;
      if (
        new RegExp(`\\b(?:${numericOrdinal}|${names[index]})\\s+YEAR\\b`).test(
          name,
        ) ||
        new RegExp(`\\bYEAR\\s+${year}\\b`).test(name)
      ) {
        return year;
      }
    }
    return undefined;
  }

  private normalizedStudyYear(value: string): ImportStudyYear | undefined {
    const normalized = value
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
    if (/^[1-4]$/.test(normalized)) return normalized as ImportStudyYear;
    const aliases: Record<string, ImportStudyYear> = {
      "1ST": "1",
      "1ST_YEAR": "1",
      FIRST: "1",
      FIRST_YEAR: "1",
      "2ND": "2",
      "2RD": "2",
      "2ND_YEAR": "2",
      "2RD_YEAR": "2",
      SECOND: "2",
      SECOND_YEAR: "2",
      "3RD": "3",
      "3RD_YEAR": "3",
      THIRD: "3",
      THIRD_YEAR: "3",
      "4TH": "4",
      "4TH_YEAR": "4",
      FOURTH: "4",
      FOURTH_YEAR: "4",
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
    const source = (
      row.source_department_code ||
      row.department_code ||
      ""
    ).trim();
    if (!source) return;
    row.source_department_code = source;
    const mapped = this.departmentMapping(mappings, source);
    if (mapped) row.department_code = mapped;
  }

  private normalizeDepartmentKey(value: string): string {
    return value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  private rowLocation(row: ImportRow | undefined, fallback: number): string {
    const sourceRow = Number(row?.source_row_number);
    if (row?.source_sheet && Number.isInteger(sourceRow) && sourceRow > 0)
      return `${row.source_sheet}, row ${sourceRow}`;
    if (Number.isInteger(sourceRow) && sourceRow >= 2)
      return `row ${sourceRow}`;
    return `row ${fallback}`;
  }

  private enrichPeopleErrors(
    entityType: ImportEntityType,
    rows: ImportRow[],
    errors: ImportRowError[],
  ): ImportRowError[] {
    if (entityType !== "PEOPLE") return errors;
    const rowsByNumber = new Map(
      rows.map((row, index) => [
        importRowNumber(entityType, row, index + 2),
        row,
      ]),
    );
    return errors.map((error) => {
      const row = rowsByNumber.get(error.rowNumber);
      return {
        ...error,
        ...(row?.college_identity_id
          ? { userId: row.college_identity_id.slice(0, 60) }
          : {}),
        ...(row?.full_name ? { userName: row.full_name.slice(0, 180) } : {}),
        ...(row?.email ? { email: row.email.slice(0, 254) } : {}),
        ...(row?.department_code
          ? { department: row.department_code.slice(0, 180) }
          : {}),
        ...(row?.year ? { year: row.year.slice(0, 20) } : {}),
      };
    });
  }

  private duplicateEmailGroups(
    entityType: ImportEntityType,
    rows: ImportRow[],
  ): ImportDuplicateGroup[] {
    const groups = new Map<string, ImportDuplicateGroup["locations"]>();
    rows.forEach((row, index) => {
      const email = row.email?.trim().toLowerCase();
      if (!email) return;
      const locations = groups.get(email) ?? [];
      const sourceRow = Number(row.source_row_number);
      locations.push({
        rowNumber: importRowNumber(entityType, row, index + 2),
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
      const rowNumber = importRowNumber(entityType, row, index + 2);
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
  private importCell(
    entityType: ImportEntityType,
    field: string,
    value: unknown,
  ): string {
    if (
      entityType === "PEOPLE" &&
      ["college_identity_id", "temporary_password"].includes(field)
    ) {
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      return value == null ? "" : String(value);
    }
    return this.cell(value);
  }
  private fieldLabel(entityType: ImportEntityType, field: string): string {
    return entityType === "PEOPLE"
      ? (PEOPLE_FIELD_LABELS[field] ?? field)
      : field;
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
    const identity =
      row.college_identity_id ||
      row.student_id ||
      row.register_number ||
      row.employee_id ||
      row.user_id;
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
  private validPeopleMobile(value: string): boolean {
    return /^\d{7,15}$/.test(value.trim());
  }
  private validTemporaryPassword(value: string): boolean {
    const trimmed = value.trim();
    if (/^\d{6,}$/.test(trimmed)) return true;
    return (
      trimmed.length >= 10 &&
      /[a-z]/.test(trimmed) &&
      /[A-Z]/.test(trimmed) &&
      /\d/.test(trimmed) &&
      /[^A-Za-z0-9]/.test(trimmed)
    );
  }
  private validPeopleTemporaryPassword(value: string): boolean {
    const minimum = this.config.get<number>(
      "IMPORT_TEMP_PASSWORD_MIN_LENGTH",
      6,
    );
    const maximum = this.config.get<number>(
      "IMPORT_TEMP_PASSWORD_MAX_LENGTH",
      200,
    );
    const exact = value;
    if (exact.length < minimum || exact.length > maximum) return false;
    if (/^\d+$/.test(exact)) return true;
    return (
      exact.length >= 12 &&
      /[a-z]/.test(exact) &&
      /[A-Z]/.test(exact) &&
      /\d/.test(exact) &&
      /[^A-Za-z0-9\s]/.test(exact)
    );
  }
  private peopleTemporaryPasswordMessage(): string {
    const minimum = this.config.get<number>(
      "IMPORT_TEMP_PASSWORD_MIN_LENGTH",
      6,
    );
    const maximum = this.config.get<number>(
      "IMPORT_TEMP_PASSWORD_MAX_LENGTH",
      200,
    );
    return `User Password must be ${minimum} to ${maximum} exact characters. Numeric-only college temporary passwords are allowed; other passwords must contain uppercase, lowercase, number, and special characters.`;
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
