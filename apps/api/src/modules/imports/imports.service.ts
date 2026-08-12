import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job, Queue, Worker } from "bullmq";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import { Workbook } from "exceljs";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AVS_DEPARTMENT_IMPORT_ALIASES } from "../academic/avs-academic-structure";
import { IMPORT_ENTITY_TYPES, IMPORT_MODES, IMPORT_TEMPLATES, type CredentialExportRow, type ImportEntityType, type ImportMode, type ImportedRecord, type ImportResultReport, type ImportRow, type ImportRowError, type ImportStudyYear } from "./import.types";
import { ImportsFileService } from "./imports-file.service";
import { ImportsHandlerService } from "./imports-handler.service";

interface ImportQueueData { jobId: string }
interface PreviewOptionsInput {
  sheetName?: string;
  importMode?: string;
  columnMapping?: string;
  selectedRoleCode?: string;
  resetExistingPasswords?: string;
  departmentMappings?: string;
  detectedStudyYear?: string;
  duplicateResolution?: string;
}

interface PreviewOptions {
  sheetName?: string;
  importMode: ImportMode;
  columnMapping?: Record<string, string>;
  selectedRoleCode?: string;
  resetExistingPasswords: boolean;
  departmentMappings?: Record<string, string>;
  detectedStudyYear?: ImportStudyYear;
  duplicateResolution: "KEEP_FIRST" | "SKIP_ALL";
}

const SELECTED_IMPORT_ROLE_KEY = "__selected_import_role";
const RESET_EXISTING_PASSWORDS_KEY = "__reset_existing_passwords";
const DETECTED_STUDY_YEAR_KEY = "__detected_study_year";
const DUPLICATE_RESOLUTION_KEY = "__duplicate_resolution";
const DEPARTMENT_MAPPING_PREFIX = "__department_mapping:";
const EXPLICIT_DEPARTMENT_MAPPING_PREFIX = "__explicit_department_mapping:";
const DEPARTMENT_ALIAS_SETTING_KEY = "imports.department_aliases";

const ROLE_RANK: Record<string, number> = {
  SUPER_ADMIN: 100, MAIN_ADMIN: 90, PRINCIPAL: 80, VICE_PRINCIPAL: 75, HOD: 70, MAINTENANCE_ADMIN: 70,
  MAINTENANCE_SUPERVISOR: 60, CLASS_COORDINATOR: 60, FACULTY: 50, CLASS_REPRESENTATIVE: 40,
  MAINTENANCE_STAFF: 40, ELECTRICIAN: 40, PLUMBER: 40, IT_SUPPORT: 40, LAB_TECHNICIAN: 40, HOUSEKEEPING: 40, SECURITY: 40,
  OTHER_RESPONSIBLE: 40, STUDENT: 10,
};

@Injectable()
export class ImportsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportsService.name);
  private readonly connection: { host: string; port: number; username?: string; password?: string; tls?: Record<string, never> };
  private readonly queue: Queue<ImportQueueData, void, string>;
  private worker?: Worker<ImportQueueData, void, string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly files: ImportsFileService,
    private readonly handler: ImportsHandlerService,
    private readonly audit: AuditService,
  ) {
    const redisUrl = new URL(config.getOrThrow<string>("REDIS_URL"));
    this.connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379), ...(redisUrl.username ? { username: redisUrl.username } : {}), ...(redisUrl.password ? { password: redisUrl.password } : {}), ...(redisUrl.protocol === "rediss:" ? { tls: {} } : {}) };
    this.queue = new Queue<ImportQueueData, void, string>("data-imports", { connection: this.connection });
  }

  onModuleInit(): void {
    this.worker = new Worker<ImportQueueData, void, string>("data-imports", (job) => this.process(job), { connection: this.connection, concurrency: 1 });
    this.worker.on("failed", (job, error) => {
      this.logger.error({ jobId: job?.data.jobId, error: error.message }, "Data import failed");
      if (job) void this.recordFailure(job, error);
    });
    this.worker.on("error", (error) => this.logger.error({ error: error.message }, "Import worker connection error"));
    this.queue.on("error", (error) => this.logger.error({ error: error.message }, "Import queue connection error"));
  }

  async onModuleDestroy(): Promise<void> { await this.worker?.close(); await this.queue.close(); }

  async template(user: AuthPrincipal, value: string): Promise<{ fileName: string; content: Buffer }> {
    const entityType = this.entityType(value);
    this.assertPermission(user, entityType);
    const template = IMPORT_TEMPLATES[entityType];
    const headers = (template.downloadHeaders ?? [
      ...template.required,
      ...template.optional,
    ]).filter(
      (header) => entityType !== "STUDENTS" || header !== "programme_code",
    );
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet("Template");
    worksheet.addRows([
      headers,
      headers.map((header) => template.example[header] ?? ""),
    ]);
    const content = Buffer.from(await workbook.xlsx.writeBuffer());
    return { fileName: `${entityType.toLowerCase()}-import-template.xlsx`, content };
  }

  async preview(user: AuthPrincipal, value: string, file: Express.Multer.File | undefined, requestId: string, rawOptions: PreviewOptionsInput = {}) {
    const entityType = this.entityType(value);
    this.assertPermission(user, entityType);
    this.files.validateFile(file);
    const options = this.previewOptions(entityType, rawOptions);
    const departmentContext = await this.departmentImportContext(
      user.collegeId,
      options.departmentMappings,
    );
    const parsed = await this.files.parse(file, entityType, {
      sheetName: options.sheetName,
      columnMapping: options.columnMapping,
      departmentMappings: departmentContext.mappings,
      duplicateResolution: options.duplicateResolution,
      forcedStudyYear: options.detectedStudyYear,
      officialEmailDomains: await this.officialEmailDomains(user.collegeId),
    });
    this.applySelectedRole(entityType, parsed.rows, options.selectedRoleCode);
    const departmentMappingPreview = this.departmentMappingPreview(
      parsed.rows,
      departmentContext,
    );
    await this.assertRoleDelegation(user, entityType, parsed.rows);
    const databaseErrors = await this.handler.validate(
      entityType,
      user.collegeId,
      parsed.rows,
      options.importMode,
      new Set(parsed.errors.map((error) => error.rowNumber)),
    );
    const source = await this.files.saveSource(user.collegeId, entityType, file);
    const allErrors = [...parsed.errors, ...databaseErrors];
    const invalidRows = new Set(allErrors.map((error) => error.rowNumber));
    let persistedColumnMapping = options.selectedRoleCode
      ? { ...(options.columnMapping ?? {}), [SELECTED_IMPORT_ROLE_KEY]: options.selectedRoleCode }
      : options.columnMapping;
    persistedColumnMapping = {
      ...(persistedColumnMapping ?? {}),
      ...Object.fromEntries(
        Object.entries(departmentContext.mappings).map(([source, target]) => [
          `${DEPARTMENT_MAPPING_PREFIX}${source}`,
          target,
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(departmentContext.explicitMappings).map(([source, target]) => [
          `${EXPLICIT_DEPARTMENT_MAPPING_PREFIX}${source}`,
          target,
        ]),
      ),
      ...(parsed.detectedStudyYear
        ? { [DETECTED_STUDY_YEAR_KEY]: parsed.detectedStudyYear }
        : {}),
      [DUPLICATE_RESOLUTION_KEY]: options.duplicateResolution,
    };
    const persistedOptions = options.resetExistingPasswords
      ? { ...(persistedColumnMapping ?? {}), [RESET_EXISTING_PASSWORDS_KEY]: "true" }
      : persistedColumnMapping;
    const importJob = await this.prisma.importJob.create({ data: {
      collegeId: user.collegeId,
      requestedById: user.id,
      entityType,
      importMode: options.importMode,
      selectedSheetName: parsed.selectedSheetName,
      columnMapping: persistedOptions,
      sourceStorageKey: source.key,
      sourceSha256: source.sha256,
      status: "READY",
      totalRows: parsed.rows.length,
      validRows: parsed.rows.length - invalidRows.size,
      errorRows: invalidRows.size,
    } });
    if (options.importMode === "VALIDATE_ONLY") {
      await this.deleteSourceQuietly(source.key);
    }
    await this.audit.record({ actorId: user.id, action: "import.previewed", entityType: "ImportJob", entityId: importJob.id, afterValue: { importedEntity: entityType, importMode: options.importMode, selectedSheetName: parsed.selectedSheetName, totalRows: parsed.rows.length, validRows: parsed.rows.length - invalidRows.size, errorRows: invalidRows.size, sourceSha256: source.sha256 }, requestId });
    return {
      job: this.jobView(importJob),
      rawHeaders: parsed.rawHeaders,
      headers: parsed.headers,
      columnMapping: parsed.columnMapping,
      sheetNames: parsed.sheetNames,
      selectedSheetName: parsed.selectedSheetName,
      sheetInspections: parsed.sheetInspections,
      detectedStudyYear: parsed.detectedStudyYear,
      passwordWarnings: parsed.passwordWarnings,
      duplicateGroups: parsed.duplicateGroups,
      duplicateRowCount: parsed.duplicateRowCount,
      duplicateResolution: options.duplicateResolution,
      departmentOptions: departmentContext.departments,
      departmentMappings: departmentMappingPreview.mappings,
      unresolvedDepartmentMappings: departmentMappingPreview.unresolved,
      previewRows: parsed.rows.slice(0, 25).map((row, index) => ({
        rowNumber: index + 2,
        values: this.safePreviewRow(row),
      })),
      errors: allErrors.slice(0, 250),
      errorsTruncated: allErrors.length > 250,
    };
  }

  async list(user: AuthPrincipal) {
    const jobs = await this.prisma.importJob.findMany({ where: { collegeId: user.collegeId, ...(user.permissions.includes("audit.read") ? {} : { requestedById: user.id }) }, orderBy: { createdAt: "desc" }, take: 100 });
    return jobs.map((job) => this.jobView(job));
  }

  async get(user: AuthPrincipal, id: string) {
    const job = await this.findAuthorized(user, id);
    const recoverableRecords = await this.prisma.importJobRecord.count({ where: { importJobId: id, rolledBackAt: null, model: { not: "UserUpdate" } } });
    if (!job.resultStorageKey) return { ...this.jobView(job), recoverableRecords, credentialsAvailable: false };
    const result = await this.files.loadReport(job.resultStorageKey);
    const credentialsAvailable = Boolean(result.credentials?.length);
    const { credentials: _credentials, ...safeResult } = result;
    return { ...this.jobView(job), recoverableRecords, credentialsAvailable, result: safeResult };
  }

  async confirm(user: AuthPrincipal, id: string, requestId: string) {
    const job = await this.findAuthorized(user, id, true);
    this.assertPermission(user, this.entityType(job.entityType));
    if (job.importMode === "VALIDATE_ONLY") throw new ConflictException("This job was created in validate-only mode and cannot be confirmed.");
    if (job.status !== "READY") throw new ConflictException("Only a validated READY import can be confirmed.");
    if (job.validRows === 0) throw new BadRequestException("This import has no valid rows to process.");
    const explicitDepartmentMappings = this.explicitDepartmentMappingsFromColumnMapping(job.columnMapping);
    if (explicitDepartmentMappings) {
      await this.saveDepartmentMappings(user.collegeId, user.id, explicitDepartmentMappings);
    }
    await this.prisma.importJob.update({ where: { id }, data: { status: "QUEUED" } });
    try {
      await this.queue.add("process", { jobId: id }, { jobId: id, attempts: 1, removeOnComplete: 500, removeOnFail: 1000 });
    } catch (error) {
      await this.prisma.importJob.update({ where: { id }, data: { status: "READY" } });
      throw error;
    }
    await this.audit.record({ actorId: user.id, action: "import.confirmed", entityType: "ImportJob", entityId: id, afterValue: { importedEntity: job.entityType, validRows: job.validRows }, requestId });
    return { id, status: "QUEUED" };
  }

  async rollback(user: AuthPrincipal, id: string, requestId: string) {
    const job = await this.findAuthorized(user, id, true);
    this.assertPermission(user, this.entityType(job.entityType));
    if (!["COMPLETED", "FAILED"].includes(job.status)) throw new ConflictException("Only a completed or failed import can be rolled back.");
    const ledger = await this.prisma.importJobRecord.findMany({ where: { importJobId: id, rolledBackAt: null, model: { not: "UserUpdate" } }, orderBy: [{ createdAt: "asc" }, { rowNumber: "asc" }] });
    let records: ImportedRecord[] = ledger.map((record) => ({ rowNumber: record.rowNumber, model: record.model, id: record.recordId, label: record.label }));
    if (!records.length && job.resultStorageKey) {
      const expectedKey = `colleges/${job.collegeId}/imports/results/${job.id}.json`;
      if (job.resultStorageKey !== expectedKey) throw new ConflictException("The legacy result report is outside the authorized job storage path.");
      const report = await this.files.loadReport(job.resultStorageKey);
      if (report.jobId !== job.id || report.entityType !== job.entityType) throw new ConflictException("The stored result report does not match this import job.");
      records = report.successful.filter((record) => record.model !== "UserUpdate");
    }
    if (!records.length) throw new BadRequestException("This import did not create any recoverable records.");
    try {
      await this.handler.rollback(job.collegeId, records);
    } catch {
      throw new ConflictException("Rollback is no longer safe because one or more imported records are now referenced by other data.");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.importJob.update({ where: { id }, data: { status: "ROLLED_BACK" } });
      await tx.importJobRecord.updateMany({ where: { importJobId: id, rolledBackAt: null }, data: { rolledBackAt: new Date() } });
      await this.audit.record({ actorId: user.id, action: "import.rolled_back", entityType: "ImportJob", entityId: id, afterValue: { importedEntity: job.entityType, recordsRemoved: records.length }, reason: "Operator requested safe import rollback", requestId }, tx);
    });
    return { id, status: "ROLLED_BACK", recordsRemoved: records.length };
  }

  async credentials(user: AuthPrincipal, id: string, requestId: string): Promise<{ fileName: string; content: Buffer }> {
    const job = await this.findAuthorized(user, id, true);
    const entityType = this.entityType(job.entityType);
    if (!["USERS", "STUDENTS", "STAFF"].includes(entityType)) throw new BadRequestException("Credential export is available only for user imports.");
    this.assertPermission(user, entityType);
    if (job.status !== "COMPLETED" || !job.resultStorageKey) throw new ConflictException("Credentials can be exported only after a completed import.");
    const report = await this.files.loadReport(job.resultStorageKey);
    if (!report.credentials?.length) throw new ConflictException("Temporary credentials have already been exported or were not generated for this import.");
    const content = await this.credentialWorkbook(report.credentials);
    const exportedAt = new Date();
    const sanitized: ImportResultReport = { ...report, credentials: undefined, credentialsExportedAt: exportedAt.toISOString() };
    await this.files.saveReport(job.collegeId, sanitized);
    await this.prisma.importJob.update({ where: { id }, data: { credentialExportedAt: exportedAt } });
    await this.audit.record({
      actorId: user.id,
      action: "import.credentials_exported",
      entityType: "ImportJob",
      entityId: id,
      afterValue: { importedEntity: entityType, credentialRows: report.credentials.length },
      reason: "One-time temporary credential export",
      requestId,
    });
    return { fileName: `${entityType.toLowerCase()}-${id.slice(0, 8)}-credentials.xlsx`, content };
  }

  private async process(queueJob: Job<ImportQueueData, void, string>): Promise<void> {
    const importJob = await this.prisma.importJob.findUnique({ where: { id: queueJob.data.jobId } });
    if (!importJob || !["QUEUED", "PROCESSING"].includes(importJob.status)) return;
    try {
      const entityType = this.entityType(importJob.entityType);
      await this.prisma.importJob.update({ where: { id: importJob.id }, data: { status: "PROCESSING", validRows: 0, errorRows: 0 } });
      const buffer = await this.files.loadSource(importJob.sourceStorageKey);
      if (createHash("sha256").update(buffer).digest("hex") !== importJob.sourceSha256) throw new Error("Stored import source failed its integrity check.");
      const extension = extname(importJob.sourceStorageKey);
      const file = { buffer, originalname: `source${extension}`, size: buffer.length } as Express.Multer.File;
      const importMode = this.importMode(importJob.importMode);
      const parsed = await this.files.parse(file, entityType, {
        sheetName: importJob.selectedSheetName ?? undefined,
        columnMapping: this.asColumnMapping(importJob.columnMapping),
        departmentMappings: this.departmentMappingsFromColumnMapping(
          importJob.columnMapping,
        ),
        duplicateResolution: this.duplicateResolutionFromColumnMapping(
          importJob.columnMapping,
        ),
        forcedStudyYear: this.studyYearFromColumnMapping(
          importJob.columnMapping,
        ),
        officialEmailDomains: await this.officialEmailDomains(importJob.collegeId),
      });
      this.applySelectedRole(entityType, parsed.rows, this.selectedRoleFromColumnMapping(importJob.columnMapping));
      const resetExistingPasswords = this.resetExistingPasswordsFromColumnMapping(importJob.columnMapping);
      const databaseErrors = await this.handler.validate(
        entityType,
        importJob.collegeId,
        parsed.rows,
        importMode,
        new Set(parsed.errors.map((error) => error.rowNumber)),
      );
      const invalidRows = new Set([...parsed.errors, ...databaseErrors].map((error) => error.rowNumber));
      const errors: ImportRowError[] = [...parsed.errors, ...databaseErrors];
      const successful: ImportedRecord[] = [];
      const credentials: CredentialExportRow[] = [];
      for (let index = 0; index < parsed.rows.length; index += 1) {
        const rowNumber = index + 2;
        if (!invalidRows.has(rowNumber)) {
          try {
            const row = parsed.rows[index];
            if (!row) continue;
            const record = await this.handler.create(entityType, importJob.collegeId, row, rowNumber, importJob.id, importJob.requestedById, importMode, { resetExistingPasswords });
            const { credential, ...publicRecord } = record;
            successful.push(publicRecord);
            if (credential) credentials.push(credential);
          } catch (error) {
            errors.push({ rowNumber, message: this.rowError(error) });
          }
        }
        if ((index + 1) % 10 === 0 || index === parsed.rows.length - 1) {
          await this.prisma.importJob.update({ where: { id: importJob.id }, data: { validRows: successful.length, errorRows: new Set(errors.map((error) => error.rowNumber)).size } });
          await queueJob.updateProgress(Math.round(((index + 1) / parsed.rows.length) * 100));
        }
      }
      const report: ImportResultReport = { jobId: importJob.id, entityType, importMode, completedAt: new Date().toISOString(), successful, errors, ...(credentials.length ? { credentials } : {}) };
      const resultStorageKey = await this.files.saveReport(importJob.collegeId, report);
      await this.prisma.$transaction(async (tx) => {
        await tx.importJob.update({ where: { id: importJob.id }, data: { status: "COMPLETED", validRows: successful.length, errorRows: new Set(errors.map((error) => error.rowNumber)).size, resultStorageKey } });
        await this.audit.record({ actorId: importJob.requestedById, action: "import.completed", entityType: "ImportJob", entityId: importJob.id, afterValue: { importedEntity: entityType, successfulRows: successful.length, errorRows: new Set(errors.map((error) => error.rowNumber)).size }, requestId: `import-job:${importJob.id}` }, tx);
      });
    } finally {
      await this.deleteSourceQuietly(importJob.sourceStorageKey);
    }
  }

  private async deleteSourceQuietly(key: string): Promise<void> {
    try {
      await this.files.deleteSource(key);
    } catch (error) {
      this.logger.warn({ key, error: error instanceof Error ? error.message : "Unknown source cleanup error" }, "Temporary import source cleanup failed");
    }
  }

  private async recordFailure(job: Job<ImportQueueData, void, string>, error: Error): Promise<void> {
    const importJob = await this.prisma.importJob.findUnique({ where: { id: job.data.jobId }, select: { collegeId: true } });
    await this.prisma.importJob.updateMany({ where: { id: job.data.jobId, status: { in: ["QUEUED", "PROCESSING"] } }, data: { status: "FAILED" } });
    await this.prisma.backgroundJobFailure.upsert({
      where: { queueName_jobId: { queueName: "data-imports", jobId: String(job.id ?? job.data.jobId) } },
      create: { collegeId: importJob?.collegeId, queueName: "data-imports", jobId: String(job.id ?? job.data.jobId), jobName: job.name, payloadRedacted: { importJobId: job.data.jobId }, errorMessage: error.message.slice(0, 2000), stackHash: error.stack ? createHash("sha256").update(error.stack).digest("hex") : undefined, retryCount: job.attemptsMade },
      update: { failedAt: new Date(), resolvedAt: null, errorMessage: error.message.slice(0, 2000), stackHash: error.stack ? createHash("sha256").update(error.stack).digest("hex") : undefined, retryCount: job.attemptsMade },
    });
  }

  private async assertRoleDelegation(user: AuthPrincipal, entityType: ImportEntityType, rows: ImportRow[]): Promise<void> {
    if (!["USERS", "STUDENTS", "STAFF"].includes(entityType)) return;
    const roleCodes = [...new Set(entityType === "STUDENTS" ? ["STUDENT"] : rows.flatMap((row) => (row.role_codes || "").split(/[;,|]/).map((code) => code.trim().toUpperCase()).filter(Boolean)))];
    const roles = await this.prisma.role.findMany({ where: { code: { in: roleCodes }, isActive: true, OR: [{ collegeId: user.collegeId }, { collegeId: null }] }, include: { permissions: { include: { permission: true } } } });
    if (!roles.length) return;
    const actorRank = user.roles.reduce((rank, code) => Math.max(rank, ROLE_RANK[code] ?? 0), 0);
    const actorPermissions = new Set(user.permissions);
    if (roles.some((role) => {
      const requestedRank = ROLE_RANK[role.code];
      return requestedRank === undefined ? !user.roles.includes("SUPER_ADMIN") : requestedRank > actorRank;
    })) throw new ForbiddenException("The import assigns a role above your administrative level.");
    if (roles.some((role) => role.permissions.some((mapping) => !actorPermissions.has(mapping.permission.code)))) throw new ForbiddenException("The import would delegate permissions that you do not hold.");
  }

  private entityType(value: string): ImportEntityType {
    const normalized = value?.trim().toUpperCase() as ImportEntityType;
    if (!IMPORT_ENTITY_TYPES.includes(normalized)) throw new BadRequestException(`entityType must be one of: ${IMPORT_ENTITY_TYPES.join(", ")}.`);
    return normalized;
  }

  private previewOptions(entityType: ImportEntityType, raw: PreviewOptionsInput): PreviewOptions {
    const importMode = this.importMode(raw.importMode);
    if (!["USERS", "STUDENTS", "STAFF"].includes(entityType) && importMode !== "CREATE_ONLY") {
      throw new BadRequestException("Update import modes are available only for user imports.");
    }
    const selectedRoleCode = this.selectedRoleCode(entityType, raw.selectedRoleCode);
    return {
      importMode,
      sheetName: raw.sheetName?.trim() || undefined,
      columnMapping: this.parseColumnMapping(raw.columnMapping),
      selectedRoleCode,
      resetExistingPasswords: this.booleanOption(raw.resetExistingPasswords),
      departmentMappings: this.parseDepartmentMappings(
        raw.departmentMappings,
      ),
      detectedStudyYear: this.studyYearOption(raw.detectedStudyYear),
      duplicateResolution: this.duplicateResolution(
        raw.duplicateResolution,
      ),
    };
  }

  private selectedRoleCode(entityType: ImportEntityType, value?: string): string | undefined {
    if (entityType === "STUDENTS") return "STUDENT";
    if (entityType !== "USERS" && entityType !== "STAFF") return undefined;
    const normalized = (value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (!normalized) return undefined;
    const aliases: Record<string, string> = {
      STUDENT: "STUDENT",
      FACULTY: "FACULTY",
      HOD: "HOD",
      CLASS_COORDINATOR: "CLASS_COORDINATOR",
      PRINCIPAL: "PRINCIPAL",
      VICE_PRINCIPAL: "VICE_PRINCIPAL",
      CLASS_REPRESENTATIVE: "CLASS_REPRESENTATIVE",
      MAINTENANCE_ADMIN: "MAINTENANCE_ADMIN",
      MAINTENANCE_SUPERVISOR: "MAINTENANCE_SUPERVISOR",
      ELECTRICIAN: "ELECTRICIAN",
      PLUMBER: "PLUMBER",
      IT_SUPPORT: "IT_SUPPORT",
      LABORATORY_TECHNICIAN: "LAB_TECHNICIAN",
      LAB_TECHNICIAN: "LAB_TECHNICIAN",
      HOUSEKEEPING: "HOUSEKEEPING",
      HOUSEKEEPING_STAFF: "HOUSEKEEPING",
      SECURITY: "SECURITY",
      SECURITY_STAFF: "SECURITY",
      GENERAL_MAINTENANCE_STAFF: "MAINTENANCE_STAFF",
      MAINTENANCE_STAFF: "MAINTENANCE_STAFF",
      OTHER_STAFF: "OTHER_RESPONSIBLE",
    };
    const roleCode = aliases[normalized] ?? normalized;
    if (entityType === "STAFF" && roleCode === "STUDENT") throw new BadRequestException("Staff imports cannot assign the Student role.");
    if (!ROLE_RANK[roleCode]) throw new BadRequestException("Import User Type is not recognized.");
    return roleCode;
  }

  private importMode(value?: string): ImportMode {
    const aliases: Record<string, ImportMode> = {
      "": "VALIDATE_ONLY",
      VALIDATE: "VALIDATE_ONLY",
      VALIDATE_ONLY: "VALIDATE_ONLY",
      CREATE_NEW_STUDENTS_ONLY: "CREATE_ONLY",
      CREATE_NEW_USERS_ONLY: "CREATE_ONLY",
      CREATE_ONLY: "CREATE_ONLY",
      UPDATE_EXISTING_STUDENTS_ONLY: "UPDATE_ONLY",
      UPDATE_EXISTING_USERS_ONLY: "UPDATE_ONLY",
      UPDATE_ONLY: "UPDATE_ONLY",
      CREATE_AND_UPDATE: "CREATE_AND_UPDATE",
      CREATE_UPDATE: "CREATE_AND_UPDATE",
    };
    const normalizedInput = (value || "VALIDATE_ONLY").trim().toUpperCase().replace(/[\s-]+/g, "_");
    const normalized = (aliases[normalizedInput] ?? normalizedInput) as ImportMode;
    if (!IMPORT_MODES.includes(normalized)) {
      throw new BadRequestException(`importMode must be one of: ${IMPORT_MODES.join(", ")}.`);
    }
    return normalized;
  }

  private parseColumnMapping(value?: string): Record<string, string> | undefined {
    if (!value?.trim()) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new BadRequestException("columnMapping must be a JSON object.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BadRequestException("columnMapping must be a JSON object.");
    }
    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
      .map(([source, target]) => [source.trim(), target.trim()] as const)
      .filter(([source, target]) => source && target);
    if (entries.length > 100) throw new BadRequestException("columnMapping can contain at most 100 mapped columns.");
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  private parseDepartmentMappings(
    value?: string,
  ): Record<string, string> | undefined {
    if (!value?.trim()) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new BadRequestException(
        "departmentMappings must be a JSON object.",
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new BadRequestException(
        "departmentMappings must be a JSON object.",
      );
    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      )
      .map(([source, target]) => [source.trim(), target.trim()] as const)
      .filter(([source, target]) => source && target);
    if (entries.length > 50)
      throw new BadRequestException(
        "departmentMappings can contain at most 50 departments.",
      );
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  private studyYearOption(value?: string): ImportStudyYear | undefined {
    const normalized = (value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (!normalized) return undefined;
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
    if (aliases[normalized]) return aliases[normalized];
    throw new BadRequestException(
      "detectedStudyYear must be an integer from 1 to 8.",
    );
  }

  private duplicateResolution(
    value?: string,
  ): "KEEP_FIRST" | "SKIP_ALL" {
    const normalized = (value || "KEEP_FIRST").trim().toUpperCase();
    if (normalized === "KEEP_FIRST" || normalized === "SKIP_ALL")
      return normalized;
    throw new BadRequestException(
      "duplicateResolution must be KEEP_FIRST or SKIP_ALL.",
    );
  }

  private asColumnMapping(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([source]) => !source.startsWith("__"))
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([source, target]) => [source, target]),
    );
  }

  private departmentMappingsFromColumnMapping(
    value: unknown,
  ): Record<string, string> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const mappings = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          (entry): entry is [string, string] =>
            entry[0].startsWith(DEPARTMENT_MAPPING_PREFIX) &&
            typeof entry[1] === "string",
        )
        .map(([source, target]) => [
          source.slice(DEPARTMENT_MAPPING_PREFIX.length),
          target,
        ]),
    );
    return Object.keys(mappings).length ? mappings : undefined;
  }

  private explicitDepartmentMappingsFromColumnMapping(
    value: unknown,
  ): Record<string, string> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const mappings = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          (entry): entry is [string, string] =>
            entry[0].startsWith(EXPLICIT_DEPARTMENT_MAPPING_PREFIX) &&
            typeof entry[1] === "string",
        )
        .map(([source, target]) => [
          source.slice(EXPLICIT_DEPARTMENT_MAPPING_PREFIX.length),
          target,
        ]),
    );
    return Object.keys(mappings).length ? mappings : undefined;
  }

  private studyYearFromColumnMapping(
    value: unknown,
  ): ImportStudyYear | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const year = (value as Record<string, unknown>)[DETECTED_STUDY_YEAR_KEY];
    return typeof year === "string" && /^[1-8]$/.test(year)
      ? year as ImportStudyYear
      : undefined;
  }

  private duplicateResolutionFromColumnMapping(
    value: unknown,
  ): "KEEP_FIRST" | "SKIP_ALL" {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return "KEEP_FIRST";
    return (value as Record<string, unknown>)[DUPLICATE_RESOLUTION_KEY] ===
      "SKIP_ALL"
      ? "SKIP_ALL"
      : "KEEP_FIRST";
  }

  private selectedRoleFromColumnMapping(value: unknown): string | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const roleCode = (value as Record<string, unknown>)[SELECTED_IMPORT_ROLE_KEY];
    return typeof roleCode === "string" ? roleCode : undefined;
  }

  private resetExistingPasswordsFromColumnMapping(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return (value as Record<string, unknown>)[RESET_EXISTING_PASSWORDS_KEY] === "true";
  }

  private applySelectedRole(entityType: ImportEntityType, rows: ImportRow[], selectedRoleCode?: string): void {
    if (!["USERS", "STUDENTS", "STAFF"].includes(entityType)) return;
    const roleCode = selectedRoleCode || (entityType === "STUDENTS" ? "STUDENT" : undefined);
    if (!roleCode) return;
    rows.forEach((row) => {
      row.role_codes = roleCode;
    });
  }
  private booleanOption(value?: string): boolean {
    return ["true", "yes", "1", "on"].includes((value || "").trim().toLowerCase());
  }

  private async departmentImportContext(
    collegeId: string,
    requestedMappings?: Record<string, string>,
  ): Promise<{
    mappings: Record<string, string>;
    explicitMappings: Record<string, string>;
    departments: Array<{
      id: string;
      code: string;
      name: string;
      shortName: string | null;
    }>;
  }> {
    const departments = await this.prisma.department.findMany({
      where: { collegeId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, shortName: true },
    });
    const setting = await this.prisma.appSetting.findUnique({
      where: {
        collegeId_key: { collegeId, key: DEPARTMENT_ALIAS_SETTING_KEY },
      },
      select: { value: true },
    });
    const stored =
      setting?.value &&
      typeof setting.value === "object" &&
      !Array.isArray(setting.value)
        ? (setting.value as Record<string, unknown>)
        : {};
    const mappings: Record<string, string> = {};
    const explicitMappings: Record<string, string> = {};
    const builtInTargets: Record<string, string[]> = {
      CIVIL: ["CIVIL", "CE", "Civil Engineering"],
      CSE: ["CSE", "Computer Science and Engineering", "Computer Science & Engineering"],
      EEE: ["EEE", "Electrical and Electronics Engineering"],
      ECE: ["ECE", "Electronics and Communication Engineering", "Electronics & Communication"],
      MECH: ["MECH", "ME", "Mechanical Engineering"],
      BME: ["BME", "Biomedical Engineering"],
      IT: ["IT", "Information Technology"],
    };

    for (const [source, targets] of Object.entries(builtInTargets)) {
      const department = this.matchImportDepartment(departments, targets);
      if (department) mappings[source] = department.code;
    }
    for (const [source, target] of Object.entries(
      AVS_DEPARTMENT_IMPORT_ALIASES,
    )) {
      const department = this.matchImportDepartment(departments, [target]);
      if (department) mappings[source] = department.code;
    }
    for (const [source, rawTarget] of Object.entries(stored)) {
      if (typeof rawTarget !== "string") continue;
      const department = this.matchImportDepartment(departments, [rawTarget]);
      if (department) mappings[source] = department.code;
    }
    for (const [source, rawTarget] of Object.entries(
      requestedMappings ?? {},
    )) {
      const department = this.matchImportDepartment(departments, [rawTarget]);
      if (!department)
        throw new BadRequestException(
          `Department mapping for ${source} must select an active existing department.`,
        );
      mappings[source] = department.code;
      explicitMappings[source] = department.code;
    }
    return { mappings, explicitMappings, departments };
  }

  private departmentMappingPreview(
    rows: ImportRow[],
    context: {
      mappings: Record<string, string>;
      departments: Array<{
        id: string;
        code: string;
        name: string;
        shortName: string | null;
      }>;
    },
  ): {
    mappings: Record<string, string>;
    unresolved: Array<{ sourceCode: string; rowCount: number }>;
  } {
    const sourceCounts = new Map<string, number>();
    for (const row of rows) {
      const source = (row.source_department_code || row.department_code || "").trim();
      if (!source) continue;
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
    const mappings: Record<string, string> = {};
    const unresolved: Array<{ sourceCode: string; rowCount: number }> = [];
    for (const [sourceCode, rowCount] of sourceCounts) {
      const configured = Object.entries(context.mappings).find(
        ([candidate]) =>
          this.departmentToken(candidate) === this.departmentToken(sourceCode),
      )?.[1];
      const direct = this.exactImportDepartment(context.departments, sourceCode);
      const target = configured ?? direct?.code;
      if (target) mappings[sourceCode] = target;
      else unresolved.push({ sourceCode, rowCount });
    }
    return { mappings, unresolved };
  }

  private exactImportDepartment(
    departments: Array<{
      id: string;
      code: string;
      name: string;
      shortName: string | null;
    }>,
    value: string,
  ) {
    const exact = value.trim().toLocaleLowerCase("en-US");
    const matches = departments.filter((department) =>
      [department.id, department.code, department.name, department.shortName]
        .filter((candidate): candidate is string => Boolean(candidate))
        .some((candidate) => candidate.trim().toLocaleLowerCase("en-US") === exact),
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  private matchImportDepartment(
    departments: Array<{
      id: string;
      code: string;
      name: string;
      shortName: string | null;
    }>,
    values: string[],
  ) {
    const ids = new Set(values.map((value) => value.trim()));
    const tokens = new Set(
      values.map((value) => this.departmentToken(value)),
    );
    const matches = departments.filter(
      (department) =>
        ids.has(department.id) ||
        tokens.has(this.departmentToken(department.code)) ||
        tokens.has(this.departmentToken(department.name)) ||
        Boolean(
          department.shortName &&
            tokens.has(this.departmentToken(department.shortName)),
        ),
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  private departmentToken(value: string): string {
    return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  private async saveDepartmentMappings(
    collegeId: string,
    updatedById: string,
    mappings: Record<string, string>,
  ): Promise<void> {
    const current = await this.prisma.appSetting.findUnique({
      where: {
        collegeId_key: { collegeId, key: DEPARTMENT_ALIAS_SETTING_KEY },
      },
      select: { value: true },
    });
    const existingValue =
      current?.value &&
      typeof current.value === "object" &&
      !Array.isArray(current.value)
        ? (current.value as Record<string, unknown>)
        : {};
    const existing = Object.fromEntries(
      Object.entries(existingValue).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    await this.prisma.appSetting.upsert({
      where: {
        collegeId_key: { collegeId, key: DEPARTMENT_ALIAS_SETTING_KEY },
      },
      create: {
        collegeId,
        key: DEPARTMENT_ALIAS_SETTING_KEY,
        value: { ...existing, ...mappings },
        updatedById,
      },
      update: {
        value: { ...existing, ...mappings },
        updatedById,
        version: { increment: 1 },
      },
    });
  }

  private async officialEmailDomains(collegeId: string): Promise<string[] | undefined> {
    const setting = await this.prisma.appSetting.findUnique({
      where: { collegeId_key: { collegeId, key: "security.official_email_domains" } },
      select: { value: true },
    });
    const value = setting?.value;
    const domains = Array.isArray(value)
      ? value
      : value && typeof value === "object" && "domains" in value && Array.isArray((value as { domains?: unknown }).domains)
        ? (value as { domains: unknown[] }).domains
        : undefined;
    if (!domains) return undefined;
    return domains
      .filter((domain): domain is string => typeof domain === "string")
      .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
      .filter((domain) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain));
  }

  private assertPermission(user: AuthPrincipal, entityType: ImportEntityType): void { if (!user.permissions.includes(IMPORT_TEMPLATES[entityType].permission)) throw new ForbiddenException("You do not have permission to import this entity type."); }
  private async findAuthorized(user: AuthPrincipal, id: string, ownerOnly = false) {
    const job = await this.prisma.importJob.findFirst({ where: { id, collegeId: user.collegeId, ...(!ownerOnly && user.permissions.includes("audit.read") ? {} : { requestedById: user.id }) } });
    if (!job) throw new NotFoundException("Import job not found.");
    return job;
  }
  private jobView(job: { id: string; entityType: string; importMode?: string; selectedSheetName?: string | null; status: string; totalRows: number; validRows: number; errorRows: number; sourceSha256: string; resultStorageKey: string | null; createdAt: Date; updatedAt: Date }) { return { id: job.id, entityType: job.entityType, importMode: job.importMode ?? "CREATE_ONLY", selectedSheetName: job.selectedSheetName ?? null, status: job.status, totalRows: job.totalRows, validRows: job.validRows, errorRows: job.errorRows, sourceSha256: job.sourceSha256, resultAvailable: Boolean(job.resultStorageKey), createdAt: job.createdAt, updatedAt: job.updatedAt }; }
  private safePreviewRow(row: ImportRow): ImportRow {
    const { temporary_password: _temporaryPassword, ...safeRow } = row;
    return safeRow as ImportRow;
  }
  private async credentialWorkbook(rows: CredentialExportRow[]): Promise<Buffer> {
    const content = [
      ["AVS Engineering College"],
      ["Confidential Login Credentials"],
      ["This file contains temporary passwords. Store it securely and delete it after distribution."],
      [],
      ["user_id", "full_name", "role", "login_id", "temporary_password", "first_login_required"],
      ...rows.map((row) => [row.userId, row.fullName, row.role, row.loginId, row.temporaryPassword, row.firstLoginRequired ? "true" : "false"].map((value) => this.safeSpreadsheetText(String(value)))),
    ];
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet("Credentials");
    worksheet.addRows(content);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  private safeSpreadsheetText(value: string): string {
    return /^[=+\-@]/.test(value) ? `'${value}` : value;
  }
  private rowError(error: unknown): string {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      return typeof response === "string" ? response : (response as { message?: string | string[] }).message?.toString() ?? "Row validation failed.";
    }
    const code = (error as { code?: string }).code;
    if (code === "P2002") return "A record with the same unique value already exists.";
    if (code === "P2003") return "A referenced record does not exist or cannot be used.";
    if (this.config.get<string>("NODE_ENV", "development") !== "production" && error instanceof Error) {
      return error.message.slice(0, 500);
    }
    this.logger.warn({ error: error instanceof Error ? error.message : "Unknown row error" }, "Import row rejected");
    return "The row could not be imported. Check its values and references.";
  }
}
