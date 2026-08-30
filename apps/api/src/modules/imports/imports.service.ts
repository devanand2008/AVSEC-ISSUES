import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job, Queue, Worker } from "bullmq";
import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { Workbook } from "exceljs";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AVS_DEPARTMENT_IMPORT_ALIASES } from "../academic/avs-academic-structure";
import {
  IMPORT_ENTITY_TYPES,
  IMPORT_MODES,
  IMPORT_TEMPLATES,
  importRowNumber,
  type CredentialExportRow,
  type ImportEntityType,
  type ImportMode,
  type ImportedRecord,
  type ImportResultReport,
  type ImportRow,
  type ImportRowError,
  type ImportStudyYear,
} from "./import.types";
import { ImportsFileService } from "./imports-file.service";
import { ImportsHandlerService } from "./imports-handler.service";
import { decryptImportCredential } from "./import-credential.crypto";
import {
  isRetryableImportInfrastructureError,
  RetryableImportInfrastructureError,
} from "./import-infrastructure-error";

interface ImportQueueData {
  jobId: string;
  recovery?: boolean;
}
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
const PEOPLE_SOURCE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SOURCE_TTL_MS = 24 * 60 * 60 * 1000;
const SOURCE_CLEANUP_INTERVAL_MS = 60 * 1000;

const ROLE_RANK: Record<string, number> = {
  SUPER_ADMIN: 100,
  MAIN_ADMIN: 90,
  PRINCIPAL: 80,
  VICE_PRINCIPAL: 75,
  HOD: 70,
  MAINTENANCE_ADMIN: 70,
  MAINTENANCE_SUPERVISOR: 60,
  CLASS_COORDINATOR: 60,
  FACULTY: 50,
  CLASS_REPRESENTATIVE: 40,
  MAINTENANCE_STAFF: 40,
  ELECTRICIAN: 40,
  PLUMBER: 40,
  IT_SUPPORT: 40,
  LAB_TECHNICIAN: 40,
  HOUSEKEEPING: 40,
  SECURITY: 40,
  OTHER_RESPONSIBLE: 40,
  STUDENT: 10,
};

@Injectable()
export class ImportsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportsService.name);
  private readonly connection: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    tls?: Record<string, never>;
  };
  private readonly queue: Queue<ImportQueueData, void, string>;
  private worker?: Worker<ImportQueueData, void, string>;
  private sourceCleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly files: ImportsFileService,
    private readonly handler: ImportsHandlerService,
    private readonly audit: AuditService,
  ) {
    const redisUrl = new URL(config.getOrThrow<string>("REDIS_URL"));
    this.connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      ...(redisUrl.username ? { username: redisUrl.username } : {}),
      ...(redisUrl.password ? { password: redisUrl.password } : {}),
      ...(redisUrl.protocol === "rediss:" ? { tls: {} } : {}),
    };
    this.queue = new Queue<ImportQueueData, void, string>("data-imports", {
      connection: this.connection,
    });
  }

  onModuleInit(): void {
    this.worker = new Worker<ImportQueueData, void, string>(
      "data-imports",
      (job, token) => this.process(job, token),
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on("failed", (job, error) => {
      this.logger.error(
        { jobId: job?.data.jobId, error: error.message },
        "Data import failed",
      );
    });
    this.worker.on("error", (error) =>
      this.logger.error(
        { error: error.message },
        "Import worker connection error",
      ),
    );
    this.queue.on("error", (error) =>
      this.logger.error(
        { error: error.message },
        "Import queue connection error",
      ),
    );
    void this.runImportMaintenance();
    this.sourceCleanupTimer = setInterval(() => {
      void this.runImportMaintenance();
    }, SOURCE_CLEANUP_INTERVAL_MS);
    this.sourceCleanupTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sourceCleanupTimer) clearInterval(this.sourceCleanupTimer);
    await this.worker?.close();
    await this.queue.close();
  }

  async template(
    user: AuthPrincipal,
    value: string,
  ): Promise<{ fileName: string; content: Buffer }> {
    const entityType = this.entityType(value);
    this.assertPermission(user, entityType);
    const template = IMPORT_TEMPLATES[entityType];
    const headers = (
      template.downloadHeaders ?? [...template.required, ...template.optional]
    ).filter(
      (header) => entityType !== "STUDENTS" || header !== "programme_code",
    );
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet("Template");
    worksheet.addRow(headers);
    if (template.includeExampleRow !== false) {
      worksheet.addRow(headers.map((header) => template.example[header] ?? ""));
    }
    const content = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      fileName: `${entityType.toLowerCase()}-import-template.xlsx`,
      content,
    };
  }

  async preview(
    user: AuthPrincipal,
    value: string,
    file: Express.Multer.File | undefined,
    requestId: string,
    rawOptions: PreviewOptionsInput = {},
  ) {
    const entityType = this.entityType(value);
    this.assertPermission(user, entityType);
    this.files.validateFile(file);
    const options = this.previewOptions(entityType, rawOptions);
    const departmentContext = await this.departmentImportContext(
      user.collegeId,
      options.departmentMappings,
    );
    const officialEmailDomains = await this.officialEmailDomains(
      user.collegeId,
    );
    const parsed = await this.files.parse(file, entityType, {
      sheetName: options.sheetName,
      columnMapping: options.columnMapping,
      departmentMappings: departmentContext.mappings,
      duplicateResolution: options.duplicateResolution,
      forcedStudyYear: options.detectedStudyYear,
      officialEmailDomains,
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
      officialEmailDomains,
    );
    const allErrors = [...parsed.errors, ...databaseErrors];
    const invalidRows = new Set(allErrors.map((error) => error.rowNumber));
    let persistedColumnMapping = options.selectedRoleCode
      ? {
          ...(options.columnMapping ?? {}),
          [SELECTED_IMPORT_ROLE_KEY]: options.selectedRoleCode,
        }
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
        Object.entries(departmentContext.explicitMappings).map(
          ([source, target]) => [
            `${EXPLICIT_DEPARTMENT_MAPPING_PREFIX}${source}`,
            target,
          ],
        ),
      ),
      ...(parsed.detectedStudyYear
        ? { [DETECTED_STUDY_YEAR_KEY]: parsed.detectedStudyYear }
        : {}),
      [DUPLICATE_RESOLUTION_KEY]: options.duplicateResolution,
    };
    const persistedOptions = options.resetExistingPasswords
      ? {
          ...(persistedColumnMapping ?? {}),
          [RESET_EXISTING_PASSWORDS_KEY]: "true",
        }
      : persistedColumnMapping;
    const sourceSha256 = createHash("sha256").update(file.buffer).digest("hex");
    const importJobId = randomUUID();
    const storesSource = options.importMode !== "VALIDATE_ONLY";
    const sourceStorageKey = storesSource
      ? this.files.sourceStorageKey(
          user.collegeId,
          importJobId,
          file.originalname,
        )
      : null;
    let importJob = await this.prisma.importJob.create({
      data: {
        id: importJobId,
        collegeId: user.collegeId,
        requestedById: user.id,
        entityType,
        importMode: options.importMode,
        selectedSheetName: parsed.selectedSheetName,
        columnMapping: persistedOptions,
        sourceStorageKey,
        sourceSha256,
        sourceExpiresAt: storesSource
          ? new Date(
              Date.now() +
                (entityType === "PEOPLE"
                  ? PEOPLE_SOURCE_TTL_MS
                  : DEFAULT_SOURCE_TTL_MS),
            )
          : null,
        status: storesSource ? "VALIDATING" : "READY",
        totalRows: parsed.rows.length,
        validRows: parsed.rows.length - invalidRows.size,
        errorRows: invalidRows.size,
      },
    });
    if (sourceStorageKey) {
      try {
        const source = await this.files.saveSource(
          user.collegeId,
          entityType,
          file,
          sourceStorageKey,
        );
        if (source.key !== sourceStorageKey || source.sha256 !== sourceSha256) {
          throw new Error(
            "The stored import source failed its integrity check.",
          );
        }
        importJob = await this.prisma.importJob.update({
          where: { id: importJob.id },
          data: { status: "READY" },
        });
      } catch (error) {
        // The READY update may have committed even when its response was lost.
        // Reconcile the exact durable state before any cleanup so a usable
        // preview never loses its only source workbook.
        let reconciledReady: typeof importJob | null;
        try {
          reconciledReady = await this.prisma.importJob.findFirst({
            where: {
              id: importJob.id,
              collegeId: user.collegeId,
              status: "READY",
              sourceStorageKey,
              sourceSha256,
            },
          });
        } catch {
          // Database state is uncertain. Leave the persisted key discoverable
          // for the expiry worker instead of risking deletion after a commit.
          throw error;
        }
        if (reconciledReady) {
          importJob = reconciledReady;
        } else {
          await this.prisma.importJob.updateMany({
            where: {
              id: importJob.id,
              collegeId: user.collegeId,
              status: "VALIDATING",
            },
            data: { status: "FAILED" },
          });
          // The key is persisted before upload, so a failed immediate cleanup
          // remains discoverable for the expiry worker to retry durably.
          await this.deleteSourceQuietly(
            importJob.id,
            user.collegeId,
            sourceStorageKey,
          );
          throw error;
        }
      }
    }
    await this.audit.record({
      actorId: user.id,
      action: "import.previewed",
      entityType: "ImportJob",
      entityId: importJob.id,
      afterValue: {
        importedEntity: entityType,
        importMode: options.importMode,
        selectedSheetName: parsed.selectedSheetName,
        totalRows: parsed.rows.length,
        validRows: parsed.rows.length - invalidRows.size,
        errorRows: invalidRows.size,
        sourceSha256,
      },
      requestId,
    });
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
        rowNumber: importRowNumber(entityType, row, index + 2),
        values: this.safePreviewRow(entityType, row),
      })),
      errors: allErrors.slice(0, 250),
      errorsTruncated: allErrors.length > 250,
    };
  }

  async list(user: AuthPrincipal, expectedEntityType?: ImportEntityType) {
    const permittedEntityTypes = expectedEntityType
      ? [expectedEntityType]
      : this.permittedEntityTypes(user);
    if (expectedEntityType) this.assertPermission(user, expectedEntityType);
    if (!permittedEntityTypes.length)
      throw new ForbiddenException(
        "You do not have permission to view import jobs.",
      );
    const jobs = await this.prisma.importJob.findMany({
      where: {
        collegeId: user.collegeId,
        entityType: { in: permittedEntityTypes },
        ...(user.permissions.includes("audit.read")
          ? {}
          : { requestedById: user.id }),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return jobs.map((job) => this.jobView(job));
  }

  async get(
    user: AuthPrincipal,
    id: string,
    expectedEntityType?: ImportEntityType,
  ) {
    const job = await this.findAuthorized(user, id, false, expectedEntityType);
    const entityType = this.entityType(job.entityType);
    if (expectedEntityType && entityType !== expectedEntityType)
      throw new NotFoundException("Import job not found.");
    this.assertPermission(user, entityType);
    const [recoverableRecords, credentialRecords] = await Promise.all([
      this.prisma.importJobRecord.count({
        where: {
          importJobId: id,
          rolledBackAt: null,
          model: { not: "UserUpdate" },
        },
      }),
      this.prisma.importJobRecord.count({
        where: { importJobId: id, credentialCiphertext: { not: null } },
      }),
    ]);
    const escrowCredentialsAvailable =
      job.credentialExportedAt === null && credentialRecords > 0;
    const credentialExportClaimId =
      job.requestedById === user.id ? job.credentialExportClaimId : null;
    if (!job.resultStorageKey)
      return {
        ...this.jobView(job),
        recoverableRecords,
        credentialsAvailable: escrowCredentialsAvailable,
        credentialExportClaimId,
      };
    this.assertAuthorizedResultKey(job.collegeId, job.id, job.resultStorageKey);
    const result = await this.files.loadReport(job.resultStorageKey);
    const credentialsAvailable =
      job.credentialExportedAt === null &&
      (credentialRecords > 0 || Boolean(result.credentials?.length));
    const { credentials: _credentials, ...safeResult } = result;
    return {
      ...this.jobView(job),
      recoverableRecords,
      credentialsAvailable,
      credentialExportClaimId,
      result: safeResult,
    };
  }

  async confirm(
    user: AuthPrincipal,
    id: string,
    requestId: string,
    expectedEntityType?: ImportEntityType,
  ) {
    const job = await this.findAuthorized(user, id, true, expectedEntityType);
    this.assertPermission(user, this.entityType(job.entityType));
    if (job.importMode === "VALIDATE_ONLY")
      throw new ConflictException(
        "This job was created in validate-only mode and cannot be confirmed.",
      );
    if (job.status === "QUEUED") {
      this.assertUsableImportSource(job);
      try {
        await this.ensureQueueJobScheduled(id);
      } catch (error) {
        this.logger.error(
          {
            jobId: id,
            error:
              error instanceof Error
                ? error.message
                : "Unknown queue scheduling error",
          },
          "Confirmed import is awaiting queue reconciliation",
        );
        throw new ServiceUnavailableException(
          "The import was accepted and is awaiting background scheduling. Retry this confirmation shortly.",
        );
      }
      return { id, status: "QUEUED" };
    }
    if (job.status !== "READY")
      throw new ConflictException(
        "Only a validated READY import can be confirmed.",
      );
    this.assertUsableImportSource(job);
    if (job.validRows === 0)
      throw new BadRequestException(
        "This import has no valid rows to process.",
      );
    const explicitDepartmentMappings =
      this.explicitDepartmentMappingsFromColumnMapping(job.columnMapping);
    if (explicitDepartmentMappings) {
      await this.saveDepartmentMappings(
        user.collegeId,
        user.id,
        explicitDepartmentMappings,
      );
    }
    const claimed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.importJob.updateMany({
        where: {
          id,
          collegeId: user.collegeId,
          requestedById: user.id,
          status: "READY",
        },
        data: { status: "QUEUED", processingAttemptToken: null },
      });
      if (updated.count !== 1) return updated;
      await this.audit.record(
        {
          actorId: user.id,
          action: "import.confirmed",
          entityType: "ImportJob",
          entityId: id,
          afterValue: {
            importedEntity: job.entityType,
            validRows: job.validRows,
          },
          requestId,
        },
        tx,
      );
      return updated;
    });
    if (claimed.count !== 1) {
      throw new ConflictException("The import is no longer READY to confirm.");
    }
    try {
      await this.ensureQueueJobScheduled(id);
    } catch (error) {
      this.logger.error(
        {
          jobId: id,
          error:
            error instanceof Error
              ? error.message
              : "Unknown queue scheduling error",
        },
        "Confirmed import is awaiting queue reconciliation",
      );
      throw new ServiceUnavailableException(
        "The import was accepted and is awaiting background scheduling. Retry this confirmation shortly.",
      );
    }
    return { id, status: "QUEUED" };
  }

  async cancel(
    user: AuthPrincipal,
    id: string,
    requestId: string,
    expectedEntityType?: ImportEntityType,
  ) {
    const job = await this.findAuthorized(user, id, true, expectedEntityType);
    const entityType = this.entityType(job.entityType);
    this.assertPermission(user, entityType);
    if (job.status !== "READY" && job.status !== "CANCELLED") {
      throw new ConflictException("Only a READY import can be cancelled.");
    }
    if (job.status === "READY") {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.importJob.updateMany({
          where: {
            id,
            collegeId: user.collegeId,
            requestedById: user.id,
            status: "READY",
          },
          data: { status: "CANCELLED" },
        });
        if (claimed.count !== 1) {
          throw new ConflictException(
            "The import is no longer READY to cancel.",
          );
        }
        await this.audit.record(
          {
            collegeId: user.collegeId,
            actorId: user.id,
            action: "import.cancelled",
            entityType: "ImportJob",
            entityId: id,
            afterValue: { importedEntity: entityType, status: "CANCELLED" },
            reason: "Operator cancelled validated import before processing",
            requestId,
          },
          tx,
        );
      });
    }
    try {
      await this.deleteSourceAndClear(
        job.id,
        user.collegeId,
        job.sourceStorageKey,
      );
    } catch (error) {
      this.logger.error(
        {
          jobId: id,
          error:
            error instanceof Error
              ? error.message
              : "Unknown source cleanup error",
        },
        "Cancelled import source cleanup failed",
      );
      throw new ConflictException(
        "The import was cancelled, but its temporary source cleanup must be retried.",
      );
    }
    return { id, status: "CANCELLED" };
  }

  async rollback(user: AuthPrincipal, id: string, requestId: string) {
    const job = await this.findAuthorized(user, id, true);
    this.assertPermission(user, this.entityType(job.entityType));
    if (!["COMPLETED", "FAILED"].includes(job.status))
      throw new ConflictException(
        "Only a completed or failed import can be rolled back.",
      );
    const ledger = await this.prisma.importJobRecord.findMany({
      where: {
        importJobId: id,
        rolledBackAt: null,
        model: { not: "UserUpdate" },
      },
      orderBy: [{ createdAt: "asc" }, { rowNumber: "asc" }],
    });
    let records: ImportedRecord[] = ledger.map((record) => ({
      rowNumber: record.rowNumber,
      model: record.model,
      id: record.recordId,
      label: record.label,
    }));
    if (!records.length && job.resultStorageKey) {
      this.assertAuthorizedResultKey(
        job.collegeId,
        job.id,
        job.resultStorageKey,
      );
      const report = await this.files.loadReport(job.resultStorageKey);
      if (report.jobId !== job.id || report.entityType !== job.entityType)
        throw new ConflictException(
          "The stored result report does not match this import job.",
        );
      records = report.successful.filter(
        (record) => record.model !== "UserUpdate",
      );
    }
    if (!records.length)
      throw new BadRequestException(
        "This import did not create any recoverable records.",
      );
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await this.handler.rollback(
            job.collegeId,
            records,
            {
              entityType: this.entityType(job.entityType),
              importJobId: job.id,
              unchangedBefore: job.updatedAt,
            },
            tx,
          );
          const completed = await tx.importJob.updateMany({
            where: {
              id,
              collegeId: user.collegeId,
              status: job.status,
            },
            data: { status: "ROLLED_BACK" },
          });
          if (completed.count !== 1) {
            throw new ConflictException(
              "The import changed while rollback was running.",
            );
          }
          await tx.importJobRecord.updateMany({
            where: { importJobId: id, rolledBackAt: null },
            data: {
              rolledBackAt: new Date(),
              credentialCiphertext: null,
            },
          });
          await this.audit.record(
            {
              actorId: user.id,
              action: "import.rolled_back",
              entityType: "ImportJob",
              entityId: id,
              afterValue: {
                importedEntity: job.entityType,
                recordsRemoved: records.length,
              },
              reason: "Operator requested safe import rollback",
              requestId,
            },
            tx,
          );
        },
        {
          isolationLevel: "Serializable",
          maxWait: 5_000,
          timeout: 60_000,
        },
      );
    } catch {
      throw new ConflictException(
        "Rollback is no longer safe because one or more imported records are now referenced by other data.",
      );
    }
    return { id, status: "ROLLED_BACK", recordsRemoved: records.length };
  }

  async credentials(
    user: AuthPrincipal,
    id: string,
    requestId: string,
    requestedExportId: string,
  ): Promise<{ fileName: string; content: Buffer; exportId: string }> {
    const job = await this.findAuthorized(user, id, true);
    const entityType = this.entityType(job.entityType);
    if (!["USERS", "STUDENTS", "STAFF"].includes(entityType))
      throw new BadRequestException(
        "Credential export is available only for user imports.",
      );
    this.assertPermission(user, entityType);
    const exportId = this.credentialExportId(requestedExportId);
    if (!["COMPLETED", "FAILED"].includes(job.status))
      throw new ConflictException(
        "Credentials can be exported only after a completed or terminally failed import.",
      );
    if (job.resultStorageKey) {
      this.assertAuthorizedResultKey(
        job.collegeId,
        job.id,
        job.resultStorageKey,
      );
    }
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const claim = await tx.importJob.updateMany({
            where: {
              id,
              collegeId: user.collegeId,
              requestedById: user.id,
              status: job.status,
              credentialExportedAt: null,
              OR: [
                { credentialExportClaimId: null },
                {
                  credentialExportClaimId: exportId,
                  credentialExportClaimedById: user.id,
                },
              ],
            },
            data: {
              credentialExportClaimId: exportId,
              credentialExportClaimedById: user.id,
              credentialExportClaimedAt: new Date(),
            },
          });
          if (claim.count !== 1) {
            throw new ConflictException(
              "Credential export is already claimed or has been acknowledged.",
            );
          }
          if (!job.credentialExportClaimId) {
            await this.audit.record(
              {
                actorId: user.id,
                action: "import.credentials_export_claimed",
                entityType: "ImportJob",
                entityId: id,
                afterValue: { importedEntity: entityType },
                reason: "Retry-safe one-time credential delivery claimed",
                requestId,
              },
              tx,
            );
          }
        },
        { isolationLevel: "Serializable", maxWait: 5_000, timeout: 30_000 },
      );
    } catch (error) {
      // A failed compare-and-set is an intentional ownership conflict, not an
      // ambiguous transaction outcome. Never let a later read reinterpret a
      // competing export claim as this request's successful claim.
      if (error instanceof ConflictException) throw error;
      const reconciled = await this.prisma.importJob.findFirst({
        where: {
          id,
          collegeId: user.collegeId,
          requestedById: user.id,
          status: job.status,
          credentialExportedAt: null,
          credentialExportClaimId: exportId,
          credentialExportClaimedById: user.id,
        },
        select: { id: true },
      });
      if (!reconciled) throw error;
    }

    const escrow = await this.prisma.importJobRecord.findMany({
      where: { importJobId: id, credentialCiphertext: { not: null } },
      orderBy: [{ rowNumber: "asc" }, { createdAt: "asc" }],
      select: { rowNumber: true, credentialCiphertext: true },
    });
    const credentials = escrow.flatMap((record) =>
      record.credentialCiphertext
        ? [
            decryptImportCredential(
              this.config.getOrThrow<string>("PASSWORD_PEPPER"),
              id,
              record.rowNumber,
              record.credentialCiphertext,
            ),
          ]
        : [],
    );
    if (!credentials.length) {
      // Backward compatibility for reports produced before encrypted escrow.
      if (job.resultStorageKey) {
        const legacy = await this.files.loadReport(job.resultStorageKey);
        credentials.push(...(legacy.credentials ?? []));
      }
    }
    if (!credentials.length)
      throw new ConflictException(
        "Temporary credentials have already been exported or were not generated for this import.",
      );
    return {
      fileName: `${entityType.toLowerCase()}-${id.slice(0, 8)}-credentials.xlsx`,
      content: await this.credentialWorkbook(credentials),
      exportId,
    };
  }

  async acknowledgeCredentials(
    user: AuthPrincipal,
    id: string,
    requestId: string,
    requestedExportId: string,
  ): Promise<{ id: string; status: "ACKNOWLEDGED" }> {
    const job = await this.findAuthorized(user, id, true);
    const entityType = this.entityType(job.entityType);
    this.assertPermission(user, entityType);
    const exportId = this.credentialExportId(requestedExportId);
    const exportedAt = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.importJob.updateMany({
          where: {
            id,
            collegeId: user.collegeId,
            requestedById: user.id,
            status: job.status,
            credentialExportedAt: null,
            credentialExportClaimId: exportId,
            credentialExportClaimedById: user.id,
          },
          data: { credentialExportClaimedAt: job.credentialExportClaimedAt },
        });
        if (locked.count !== 1) {
          const completed = await tx.importJob.findFirst({
            where: {
              id,
              collegeId: user.collegeId,
              requestedById: user.id,
              credentialExportedAt: { not: null },
              credentialExportClaimId: exportId,
              credentialExportClaimedById: user.id,
            },
            select: { id: true },
          });
          if (completed) return;
          throw new ConflictException(
            "Credential export acknowledgement does not match the active claim.",
          );
        }

        let legacyCredentialRows = 0;
        if (job.resultStorageKey) {
          this.assertAuthorizedResultKey(
            job.collegeId,
            job.id,
            job.resultStorageKey,
          );
          const report = await this.files.loadReport(job.resultStorageKey);
          legacyCredentialRows = report.credentials?.length ?? 0;
          if (legacyCredentialRows) {
            await this.files.saveReport(
              job.collegeId,
              {
                ...report,
                credentials: undefined,
                credentialsExportedAt: exportedAt.toISOString(),
              },
              job.resultStorageKey,
            );
          }
        }
        const escrow = await tx.importJobRecord.updateMany({
          where: { importJobId: id, credentialCiphertext: { not: null } },
          data: { credentialCiphertext: null },
        });
        const completed = await tx.importJob.updateMany({
          where: {
            id,
            credentialExportedAt: null,
            credentialExportClaimId: exportId,
            credentialExportClaimedById: user.id,
          },
          data: { credentialExportedAt: exportedAt },
        });
        if (completed.count !== 1) {
          throw new ConflictException(
            "Credential export acknowledgement changed while completing.",
          );
        }
        await this.audit.record(
          {
            actorId: user.id,
            action: "import.credentials_exported",
            entityType: "ImportJob",
            entityId: id,
            afterValue: {
              importedEntity: entityType,
              credentialRows: escrow.count || legacyCredentialRows,
            },
            reason: "Credential workbook delivery acknowledged",
            requestId,
          },
          tx,
        );
      },
      { isolationLevel: "Serializable", maxWait: 5_000, timeout: 30_000 },
    );
    return { id, status: "ACKNOWLEDGED" };
  }

  private credentialExportId(value: string): string {
    const normalized = value?.trim().toLowerCase();
    if (
      !normalized ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        normalized,
      )
    ) {
      throw new BadRequestException(
        "A valid credential export ID is required.",
      );
    }
    return normalized;
  }

  private assertUsableImportSource(job: {
    sourceStorageKey: string | null;
    sourceExpiresAt: Date | null;
  }): void {
    if (
      !job.sourceStorageKey ||
      !job.sourceExpiresAt ||
      job.sourceExpiresAt <= new Date()
    ) {
      throw new ConflictException(
        "This import preview has expired. Upload the workbook again.",
      );
    }
  }

  private assertAuthorizedResultKey(
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
      throw new ConflictException(
        "The stored result report is outside the authorized job storage path.",
      );
    }
  }

  private async ensureQueueJobScheduled(
    importJobId: string,
    recovery = false,
  ): Promise<void> {
    const scheduledStates = new Set([
      "active",
      "waiting",
      "delayed",
      "prioritized",
      "waiting-children",
    ]);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const existing = await this.queue.getJob(importJobId);
        if (existing) {
          const state = await existing.getState();
          if (scheduledStates.has(state)) return;
          await existing.remove();
        }
        await this.queue.add(
          "process",
          { jobId: importJobId, ...(recovery ? { recovery: true } : {}) },
          {
            jobId: importJobId,
            attempts: 3,
            backoff: { type: "exponential", delay: 5_000 },
            removeOnComplete: 500,
            removeOnFail: 1000,
          },
        );
        // Confirm the durable Redis state even when Queue.add resolves. This
        // also catches rare cases where a terminal job ID was retained and the
        // replacement was not actually scheduled.
        const scheduled = await this.queue.getJob(importJobId);
        if (scheduled && scheduledStates.has(await scheduled.getState())) {
          return;
        }
        lastError = new Error(
          "The import queue did not retain the scheduled replacement job.",
        );
      } catch (error) {
        lastError = error;
      }

      // Queue.add can succeed in Redis while the client observes a network
      // error. Re-read by the stable ID before deciding scheduling failed.
      try {
        const reconciled = await this.queue.getJob(importJobId);
        if (reconciled && scheduledStates.has(await reconciled.getState())) {
          return;
        }
      } catch (error) {
        lastError = error;
      }
    }
    throw (
      lastError ??
      new Error("The confirmed import could not be reconciled with BullMQ.")
    );
  }

  private async reconcileQueuedImports(): Promise<void> {
    const now = new Date();
    let cursor: string | undefined;
    do {
      const jobs = await this.prisma.importJob.findMany({
        where: {
          status: { in: ["QUEUED", "PROCESSING"] },
          sourceStorageKey: { not: null },
          sourceExpiresAt: { gt: now },
        },
        orderBy: { id: "asc" },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, status: true },
      });
      for (const job of jobs) {
        try {
          await this.ensureQueueJobScheduled(
            job.id,
            job.status === "PROCESSING",
          );
        } catch (error) {
          this.logger.error(
            {
              jobId: job.id,
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown queue reconciliation error",
            },
            "Queued import reconciliation failed",
          );
        }
      }
      cursor = jobs.length === 100 ? jobs.at(-1)?.id : undefined;
    } while (cursor);
  }

  private async runImportMaintenance(): Promise<void> {
    try {
      await this.reconcileQueuedImports();
    } catch (error) {
      this.logger.error(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unknown queue reconciliation error",
        },
        "Queued import reconciliation pass failed",
      );
    }
    // cleanupExpiredSources contains its own pass-level catch so a transient
    // queue-reconciliation failure never starves retention cleanup and no
    // detached timer promise is left rejected.
    await this.cleanupExpiredSources();
    await this.cleanupTerminalPendingResults();
  }

  private async reservePendingResult(
    importJobId: string,
    collegeId: string,
    attemptToken: string,
  ): Promise<string> {
    const attemptHash = createHash("sha256").update(attemptToken).digest("hex");
    const storageKey =
      `colleges/${collegeId}/imports/results/` +
      `${importJobId}-${attemptHash}.json`;
    try {
      const reserved = await this.prisma.importJob.updateMany({
        where: {
          id: importJobId,
          collegeId,
          status: "PROCESSING",
          processingAttemptToken: attemptToken,
          pendingResultStorageKey: null,
        },
        data: { pendingResultStorageKey: storageKey },
      });
      if (reserved.count === 1) return storageKey;
    } catch (error) {
      const reconciled = await this.prisma.importJob.findFirst({
        where: {
          id: importJobId,
          collegeId,
          status: "PROCESSING",
          processingAttemptToken: attemptToken,
          pendingResultStorageKey: storageKey,
        },
        select: { id: true },
      });
      if (reconciled) return storageKey;
      throw error;
    }
    throw new ConflictException(
      "Import processing was stopped before report finalization.",
    );
  }

  private async deletePendingResultAndClear(
    importJobId: string,
    collegeId: string,
    storageKey: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // Lock and re-prove orphan status before touching storage. A local
        // pending-key variable is not authority after an ambiguous completion
        // commit: the winning job may already reference this exact object.
        const orphan = await tx.importJob.updateMany({
          where: {
            id: importJobId,
            collegeId,
            pendingResultStorageKey: storageKey,
            OR: [
              { resultStorageKey: null },
              { resultStorageKey: { not: storageKey } },
            ],
          },
          data: { pendingResultStorageKey: storageKey },
        });
        if (orphan.count !== 1) return;
        await this.files.deleteReport(collegeId, importJobId, storageKey);
        await tx.importJob.updateMany({
          where: {
            id: importJobId,
            collegeId,
            pendingResultStorageKey: storageKey,
            OR: [
              { resultStorageKey: null },
              { resultStorageKey: { not: storageKey } },
            ],
          },
          data: { pendingResultStorageKey: null },
        });
      },
      { isolationLevel: "Serializable", maxWait: 5_000, timeout: 30_000 },
    );
  }

  private async deletePendingResultQuietly(
    importJobId: string,
    collegeId: string,
    storageKey: string,
  ): Promise<void> {
    try {
      await this.deletePendingResultAndClear(
        importJobId,
        collegeId,
        storageKey,
      );
    } catch (error) {
      this.logger.warn(
        {
          jobId: importJobId,
          error:
            error instanceof Error
              ? error.message
              : "Unknown result cleanup error",
        },
        "Uncommitted import result cleanup failed",
      );
    }
  }

  private async cleanupTerminalPendingResults(): Promise<void> {
    try {
      const jobs = await this.prisma.importJob.findMany({
        where: {
          pendingResultStorageKey: { not: null },
          status: {
            in: ["COMPLETED", "FAILED", "ROLLED_BACK", "CANCELLED"],
          },
        },
        orderBy: { updatedAt: "asc" },
        take: 100,
        select: {
          id: true,
          collegeId: true,
          pendingResultStorageKey: true,
        },
      });
      for (const job of jobs) {
        if (!job.pendingResultStorageKey) continue;
        await this.deletePendingResultQuietly(
          job.id,
          job.collegeId,
          job.pendingResultStorageKey,
        );
      }
    } catch (error) {
      this.logger.error(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unknown result cleanup error",
        },
        "Pending import result cleanup pass failed",
      );
    }
  }

  private async persistedImportRecords(
    importJobId: string,
    rowNumbers?: number[],
  ): Promise<ImportedRecord[]> {
    const records = await this.prisma.importJobRecord.findMany({
      where: {
        importJobId,
        rolledBackAt: null,
        ...(rowNumbers?.length ? { rowNumber: { in: rowNumbers } } : {}),
      },
      orderBy: [{ rowNumber: "asc" }, { createdAt: "asc" }],
      select: {
        rowNumber: true,
        model: true,
        recordId: true,
        label: true,
        credentialCiphertext: true,
      },
    });
    return records.map((record) => ({
      rowNumber: record.rowNumber,
      model: record.model,
      id: record.recordId,
      label: record.label,
      ...(record.credentialCiphertext
        ? {
            credential: decryptImportCredential(
              this.config.getOrThrow<string>("PASSWORD_PEPPER"),
              importJobId,
              record.rowNumber,
              record.credentialCiphertext,
            ),
          }
        : {}),
    }));
  }

  private async process(
    queueJob: Job<ImportQueueData, void, string>,
    workerToken?: string,
  ): Promise<void> {
    const importJob = await this.prisma.importJob.findUnique({
      where: { id: queueJob.data.jobId },
    });
    if (!importJob) return;
    const entityType = this.entityType(importJob.entityType);
    const isRecoveredAttempt =
      importJob.status === "PROCESSING" &&
      (queueJob.data.recovery === true ||
        queueJob.stalledCounter > 0 ||
        queueJob.attemptsStarted > 1);
    if (importJob.status !== "QUEUED" && !isRecoveredAttempt) return;
    if (!importJob.sourceStorageKey) {
      throw new Error(
        "The temporary import source has expired or was already removed.",
      );
    }
    const attemptToken = workerToken || randomUUID();
    let claimed = false;
    try {
      const result = await this.prisma.importJob.updateMany({
        where: {
          id: importJob.id,
          collegeId: importJob.collegeId,
          status: importJob.status,
          sourceStorageKey: importJob.sourceStorageKey,
          sourceExpiresAt: { gt: new Date() },
          ...(isRecoveredAttempt
            ? { processingAttemptToken: importJob.processingAttemptToken }
            : {}),
        },
        data: {
          status: "PROCESSING",
          processingAttemptToken: attemptToken,
          ...(!isRecoveredAttempt ? { validRows: 0, errorRows: 0 } : {}),
        },
      });
      claimed = result.count === 1;
    } catch (error) {
      // PostgreSQL may commit the token claim while the client loses the
      // response. Re-read the exact token before treating this attempt as a
      // failure; maintenance can re-enqueue any unresolved PROCESSING owner.
      const reconciled = await this.prisma.importJob.findFirst({
        where: {
          id: importJob.id,
          collegeId: importJob.collegeId,
          status: "PROCESSING",
          processingAttemptToken: attemptToken,
          sourceStorageKey: importJob.sourceStorageKey,
        },
        select: { id: true },
      });
      if (!reconciled) throw error;
      claimed = true;
    }
    if (!claimed) return;
    let ownsTerminalTransition = false;
    let pendingResultStorageKey: string | null = null;
    try {
      const claimedState = await this.prisma.importJob.findFirst({
        where: {
          id: importJob.id,
          collegeId: importJob.collegeId,
          status: "PROCESSING",
          processingAttemptToken: attemptToken,
        },
        select: { pendingResultStorageKey: true },
      });
      if (!claimedState) return;
      if (claimedState.pendingResultStorageKey) {
        try {
          await this.deletePendingResultAndClear(
            importJob.id,
            importJob.collegeId,
            claimedState.pendingResultStorageKey,
          );
        } catch (error) {
          throw new RetryableImportInfrastructureError(
            error instanceof Error
              ? error.message
              : "Pending result cleanup must be retried.",
          );
        }
      }
      const buffer = await this.files.loadSource(importJob.sourceStorageKey);
      if (
        createHash("sha256").update(buffer).digest("hex") !==
        importJob.sourceSha256
      )
        throw new Error("Stored import source failed its integrity check.");
      const extension = extname(importJob.sourceStorageKey);
      const file = {
        buffer,
        originalname: `source${extension}`,
        size: buffer.length,
      } as Express.Multer.File;
      const importMode = this.importMode(importJob.importMode);
      const officialEmailDomains = await this.officialEmailDomains(
        importJob.collegeId,
      );
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
        officialEmailDomains,
      });
      this.applySelectedRole(
        entityType,
        parsed.rows,
        this.selectedRoleFromColumnMapping(importJob.columnMapping),
      );
      const resetExistingPasswords =
        this.resetExistingPasswordsFromColumnMapping(importJob.columnMapping);
      const persistedRecords = await this.persistedImportRecords(importJob.id);
      const persistedRowNumbers = new Set(
        persistedRecords.map((record) => record.rowNumber),
      );
      const databaseErrors = await this.handler.validate(
        entityType,
        importJob.collegeId,
        parsed.rows,
        importMode,
        new Set(parsed.errors.map((error) => error.rowNumber)),
        officialEmailDomains,
      );
      const errors: ImportRowError[] = [
        ...parsed.errors,
        ...databaseErrors,
      ].filter((error) => !persistedRowNumbers.has(error.rowNumber));
      const invalidRows = new Set(errors.map((error) => error.rowNumber));
      const successful: ImportedRecord[] = [];
      const successfulKeys = new Set<string>();
      const recordSuccess = (record: ImportedRecord) => {
        const { credential, ...publicRecord } = record;
        const key = `${publicRecord.rowNumber}:${publicRecord.model}:${publicRecord.id}`;
        if (successfulKeys.has(key)) return;
        successfulKeys.add(key);
        successful.push(publicRecord);
        // Credential material is kept only in encrypted database escrow and
        // never copied into a JSON result object (including People passwords).
        void credential;
      };
      persistedRecords.forEach(recordSuccess);
      if (entityType === "PEOPLE") {
        for (let offset = 0; offset < parsed.rows.length; offset += 10) {
          const slice = parsed.rows.slice(offset, offset + 10);
          const batch = slice.flatMap((row, sliceIndex) => {
            const rowNumber = importRowNumber(
              entityType,
              row,
              offset + sliceIndex + 2,
            );
            return row &&
              !invalidRows.has(rowNumber) &&
              !persistedRowNumbers.has(rowNumber)
              ? [{ row, rowNumber }]
              : [];
          });
          if (batch.length) {
            try {
              const records = await this.handler.createPeopleBatch(
                importJob.collegeId,
                batch,
                importJob.id,
                importJob.requestedById,
                importMode,
                { resetExistingPasswords, officialEmailDomains },
                attemptToken,
              );
              records.forEach(recordSuccess);
            } catch (batchError) {
              // A connection can fail after PostgreSQL committed the bounded
              // transaction. The durable per-row ledger is the authority:
              // reconcile it first and retry only rows proven absent.
              const committed = await this.persistedImportRecords(
                importJob.id,
                batch.map((item) => item.rowNumber),
              );
              committed.forEach(recordSuccess);
              const committedRows = new Set(
                committed.map((record) => record.rowNumber),
              );
              if (
                committedRows.size !== batch.length &&
                isRetryableImportInfrastructureError(batchError)
              ) {
                throw batchError;
              }
              for (const item of batch) {
                if (committedRows.has(item.rowNumber)) continue;
                try {
                  recordSuccess(
                    await this.handler.create(
                      entityType,
                      importJob.collegeId,
                      item.row,
                      item.rowNumber,
                      importJob.id,
                      importJob.requestedById,
                      importMode,
                      { resetExistingPasswords, officialEmailDomains },
                      attemptToken,
                    ),
                  );
                } catch (error) {
                  const reconciled = await this.persistedImportRecords(
                    importJob.id,
                    [item.rowNumber],
                  );
                  if (reconciled.length) {
                    reconciled.forEach(recordSuccess);
                    continue;
                  }
                  if (isRetryableImportInfrastructureError(error)) {
                    throw error;
                  }
                  errors.push(
                    this.peopleRowError(
                      entityType,
                      item.row,
                      item.rowNumber,
                      this.rowError(error, item.row),
                    ),
                  );
                }
              }
            }
          }
          const processed = Math.min(offset + 10, parsed.rows.length);
          await this.persistProcessingProgress(
            importJob.id,
            attemptToken,
            successful.length,
            new Set(errors.map((error) => error.rowNumber)).size,
          );
          await queueJob.updateProgress(
            Math.round((processed / parsed.rows.length) * 100),
          );
        }
      } else {
        for (let index = 0; index < parsed.rows.length; index += 1) {
          const row = parsed.rows[index];
          const rowNumber = importRowNumber(entityType, row, index + 2);
          if (
            !invalidRows.has(rowNumber) &&
            !persistedRowNumbers.has(rowNumber)
          ) {
            try {
              if (!row) continue;
              recordSuccess(
                await this.handler.create(
                  entityType,
                  importJob.collegeId,
                  row,
                  rowNumber,
                  importJob.id,
                  importJob.requestedById,
                  importMode,
                  { resetExistingPasswords },
                  attemptToken,
                ),
              );
            } catch (error) {
              const reconciled = await this.persistedImportRecords(
                importJob.id,
                [rowNumber],
              );
              if (reconciled.length) {
                reconciled.forEach(recordSuccess);
                continue;
              }
              if (isRetryableImportInfrastructureError(error)) {
                throw error;
              }
              errors.push(
                this.peopleRowError(
                  entityType,
                  row,
                  rowNumber,
                  this.rowError(error, row),
                ),
              );
            }
          }
          if ((index + 1) % 10 === 0 || index === parsed.rows.length - 1) {
            await this.persistProcessingProgress(
              importJob.id,
              attemptToken,
              successful.length,
              new Set(errors.map((error) => error.rowNumber)).size,
            );
            await queueJob.updateProgress(
              Math.round(((index + 1) / parsed.rows.length) * 100),
            );
          }
        }
      }
      const report: ImportResultReport = {
        jobId: importJob.id,
        entityType,
        importMode,
        completedAt: new Date().toISOString(),
        successful,
        errors,
      };
      pendingResultStorageKey = await this.reservePendingResult(
        importJob.id,
        importJob.collegeId,
        attemptToken,
      );
      try {
        await this.prisma.$transaction(
          async (tx) => {
            // This no-op update is a token check and row lock held across the S3
            // write. A recovery token takeover cannot pass until the winning
            // report and database completion commit (or roll back) together.
            const fenced = await tx.importJob.updateMany({
              where: {
                id: importJob.id,
                status: "PROCESSING",
                processingAttemptToken: attemptToken,
                pendingResultStorageKey,
              },
              data: { pendingResultStorageKey },
            });
            if (fenced.count !== 1) {
              throw new ConflictException(
                "Import processing was stopped before report finalization.",
              );
            }
            await this.files.saveReport(
              importJob.collegeId,
              report,
              pendingResultStorageKey!,
            );
            const completed = await tx.importJob.updateMany({
              where: {
                id: importJob.id,
                status: "PROCESSING",
                processingAttemptToken: attemptToken,
                pendingResultStorageKey,
              },
              data: {
                status: "COMPLETED",
                processingAttemptToken: null,
                pendingResultStorageKey: null,
                validRows: successful.length,
                errorRows: new Set(errors.map((error) => error.rowNumber)).size,
                resultStorageKey: pendingResultStorageKey,
              },
            });
            if (completed.count !== 1) {
              throw new ConflictException(
                "Import processing was stopped before completion.",
              );
            }
            await this.audit.record(
              {
                actorId: importJob.requestedById,
                action: "import.completed",
                entityType: "ImportJob",
                entityId: importJob.id,
                afterValue: {
                  importedEntity: entityType,
                  successfulRows: successful.length,
                  errorRows: new Set(errors.map((error) => error.rowNumber))
                    .size,
                },
                requestId: `import-job:${importJob.id}`,
              },
              tx,
            );
          },
          {
            isolationLevel: "Serializable",
            maxWait: 5_000,
            timeout: 30_000,
          },
        );
      } catch (error) {
        const reconciled = await this.prisma.importJob.findFirst({
          where: {
            id: importJob.id,
            collegeId: importJob.collegeId,
            status: "COMPLETED",
            resultStorageKey: pendingResultStorageKey,
            pendingResultStorageKey: null,
          },
          select: { id: true },
        });
        if (!reconciled) throw error;
      }
      ownsTerminalTransition = true;
      pendingResultStorageKey = null;
    } catch (error) {
      if (isRetryableImportInfrastructureError(error)) {
        throw error instanceof RetryableImportInfrastructureError
          ? error
          : new RetryableImportInfrastructureError(
              error instanceof Error
                ? error.message
                : "Transient import infrastructure failure",
            );
      }
      const failure =
        error instanceof Error
          ? error
          : new Error("Unknown data import processing failure");
      ownsTerminalTransition = await this.recordFailure(
        queueJob,
        attemptToken,
        failure,
      );
      throw error;
    } finally {
      if (pendingResultStorageKey) {
        await this.deletePendingResultQuietly(
          importJob.id,
          importJob.collegeId,
          pendingResultStorageKey,
        );
      }
      if (ownsTerminalTransition) {
        await this.deleteSourceQuietly(
          importJob.id,
          importJob.collegeId,
          importJob.sourceStorageKey,
        );
      }
    }
  }

  private async persistProcessingProgress(
    jobId: string,
    attemptToken: string,
    validRows: number,
    errorRows: number,
  ): Promise<void> {
    const updated = await this.prisma.importJob.updateMany({
      where: {
        id: jobId,
        status: "PROCESSING",
        processingAttemptToken: attemptToken,
      },
      data: { validRows, errorRows },
    });
    if (updated.count !== 1) {
      throw new ConflictException(
        "Import processing was stopped before completion.",
      );
    }
  }

  private async deleteSourceAndClear(
    jobId: string,
    collegeId: string,
    key: string | null,
  ): Promise<void> {
    if (!key) return;
    await this.files.deleteSource(collegeId, key);
    await this.prisma.importJob.updateMany({
      where: { id: jobId, collegeId, sourceStorageKey: key },
      data: { sourceStorageKey: null, sourceExpiresAt: null },
    });
  }

  private async deleteSourceQuietly(
    jobId: string,
    collegeId: string,
    key: string | null,
  ): Promise<void> {
    try {
      await this.deleteSourceAndClear(jobId, collegeId, key);
    } catch (error) {
      this.logger.warn(
        {
          jobId,
          error:
            error instanceof Error
              ? error.message
              : "Unknown source cleanup error",
        },
        "Temporary import source cleanup failed",
      );
    }
  }

  private async cleanupExpiredSources(): Promise<void> {
    try {
      const now = new Date();
      const jobs = await this.prisma.importJob.findMany({
        where: {
          sourceStorageKey: { not: null },
          sourceExpiresAt: { lte: now },
          status: {
            in: [
              "VALIDATING",
              "READY",
              "QUEUED",
              "PROCESSING",
              "COMPLETED",
              "FAILED",
              "ROLLED_BACK",
              "CANCELLED",
            ],
          },
        },
        orderBy: { sourceExpiresAt: "asc" },
        take: 100,
        select: {
          id: true,
          collegeId: true,
          requestedById: true,
          entityType: true,
          status: true,
          sourceStorageKey: true,
          sourceExpiresAt: true,
        },
      });
      for (const job of jobs) {
        if (!job.sourceStorageKey) continue;
        if (["QUEUED", "PROCESSING"].includes(job.status)) {
          // BullMQ's remove operation is the final race-safe proof: it fails
          // for a job that acquired an active lock after the state read.
          if (!(await this.removeInactiveQueueJob(job.id))) continue;
        }
        if (
          ["VALIDATING", "READY", "QUEUED", "PROCESSING"].includes(job.status)
        ) {
          const terminalStatus =
            job.status === "READY" ? "CANCELLED" : "FAILED";
          const claimed = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.importJob.updateMany({
              where: {
                id: job.id,
                collegeId: job.collegeId,
                status: job.status,
                sourceStorageKey: job.sourceStorageKey,
                sourceExpiresAt: { lte: now },
              },
              data: {
                status: terminalStatus,
                processingAttemptToken: null,
              },
            });
            if (updated.count !== 1) return false;
            await this.audit.record(
              {
                collegeId: job.collegeId,
                actorId: job.requestedById,
                action: "import.expired",
                entityType: "ImportJob",
                entityId: job.id,
                afterValue: {
                  importedEntity: job.entityType,
                  status: terminalStatus,
                },
                reason: "Temporary import source retention period expired",
                requestId: `import-expiry:${job.id}`,
              },
              tx,
            );
            return true;
          });
          if (!claimed) continue;
        }
        await this.deleteSourceQuietly(
          job.id,
          job.collegeId,
          job.sourceStorageKey,
        );
      }
    } catch (error) {
      this.logger.error(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unknown source cleanup error",
        },
        "Expired import source cleanup pass failed",
      );
    }
  }

  private async removeInactiveQueueJob(importJobId: string): Promise<boolean> {
    try {
      const queueJob = await this.queue.getJob(importJobId);
      if (!queueJob) return true;
      if ((await queueJob.getState()) === "active") return false;
      await queueJob.remove();
      return true;
    } catch (error) {
      this.logger.warn(
        {
          jobId: importJobId,
          error:
            error instanceof Error
              ? error.message
              : "Unknown queue state error",
        },
        "Skipped expired import cleanup because queue inactivity could not be proven",
      );
      return false;
    }
  }

  private async recordFailure(
    job: Job<ImportQueueData, void, string>,
    attemptToken: string,
    error: Error,
  ): Promise<boolean> {
    const importJob = await this.prisma.importJob.findUnique({
      where: { id: job.data.jobId },
      select: { collegeId: true },
    });
    const transitioned = await this.prisma.importJob.updateMany({
      where: {
        id: job.data.jobId,
        status: "PROCESSING",
        processingAttemptToken: attemptToken,
      },
      data: { status: "FAILED", processingAttemptToken: null },
    });
    await this.prisma.backgroundJobFailure.upsert({
      where: {
        queueName_jobId: {
          queueName: "data-imports",
          jobId: String(job.id ?? job.data.jobId),
        },
      },
      create: {
        collegeId: importJob?.collegeId,
        queueName: "data-imports",
        jobId: String(job.id ?? job.data.jobId),
        jobName: job.name,
        payloadRedacted: { importJobId: job.data.jobId },
        errorMessage: error.message.slice(0, 2000),
        stackHash: error.stack
          ? createHash("sha256").update(error.stack).digest("hex")
          : undefined,
        retryCount: job.attemptsMade,
      },
      update: {
        failedAt: new Date(),
        resolvedAt: null,
        errorMessage: error.message.slice(0, 2000),
        stackHash: error.stack
          ? createHash("sha256").update(error.stack).digest("hex")
          : undefined,
        retryCount: job.attemptsMade,
      },
    });
    return transitioned.count === 1;
  }

  private async assertRoleDelegation(
    user: AuthPrincipal,
    entityType: ImportEntityType,
    rows: ImportRow[],
  ): Promise<void> {
    if (!["PEOPLE", "USERS", "STUDENTS", "STAFF"].includes(entityType)) return;
    const roleCodes = [
      ...new Set(
        ["PEOPLE", "STUDENTS"].includes(entityType)
          ? ["STUDENT"]
          : rows.flatMap((row) =>
              (row.role_codes || "")
                .split(/[;,|]/)
                .map((code) => code.trim().toUpperCase())
                .filter(Boolean),
            ),
      ),
    ];
    const roles = await this.prisma.role.findMany({
      where: {
        code: { in: roleCodes },
        isActive: true,
        OR: [{ collegeId: user.collegeId }, { collegeId: null }],
      },
      include: { permissions: { include: { permission: true } } },
    });
    if (!roles.length) return;
    const actorRank = user.roles.reduce(
      (rank, code) => Math.max(rank, ROLE_RANK[code] ?? 0),
      0,
    );
    const actorPermissions = new Set(user.permissions);
    if (
      roles.some((role) => {
        const requestedRank = ROLE_RANK[role.code];
        return requestedRank === undefined
          ? !user.roles.includes("SUPER_ADMIN")
          : requestedRank > actorRank;
      })
    )
      throw new ForbiddenException(
        "The import assigns a role above your administrative level.",
      );
    if (
      roles.some((role) =>
        role.permissions.some(
          (mapping) => !actorPermissions.has(mapping.permission.code),
        ),
      )
    )
      throw new ForbiddenException(
        "The import would delegate permissions that you do not hold.",
      );
  }

  private entityType(value: string): ImportEntityType {
    const normalized = value?.trim().toUpperCase() as ImportEntityType;
    if (!IMPORT_ENTITY_TYPES.includes(normalized))
      throw new BadRequestException(
        `entityType must be one of: ${IMPORT_ENTITY_TYPES.join(", ")}.`,
      );
    return normalized;
  }

  private previewOptions(
    entityType: ImportEntityType,
    raw: PreviewOptionsInput,
  ): PreviewOptions {
    const importMode = this.importMode(raw.importMode);
    if (
      entityType === "PEOPLE" &&
      !["VALIDATE_ONLY", "CREATE_ONLY"].includes(importMode)
    ) {
      throw new BadRequestException(
        "People imports support validate-only or create-only mode.",
      );
    }
    if (
      !["PEOPLE", "USERS", "STUDENTS", "STAFF"].includes(entityType) &&
      importMode !== "CREATE_ONLY"
    ) {
      throw new BadRequestException(
        "Update import modes are available only for user imports.",
      );
    }
    const selectedRoleCode = this.selectedRoleCode(
      entityType,
      raw.selectedRoleCode,
    );
    return {
      importMode,
      sheetName: raw.sheetName?.trim() || undefined,
      columnMapping: this.parseColumnMapping(raw.columnMapping),
      selectedRoleCode,
      resetExistingPasswords: this.booleanOption(raw.resetExistingPasswords),
      departmentMappings: this.parseDepartmentMappings(raw.departmentMappings),
      detectedStudyYear: this.studyYearOption(raw.detectedStudyYear),
      duplicateResolution:
        entityType === "PEOPLE"
          ? "SKIP_ALL"
          : this.duplicateResolution(raw.duplicateResolution),
    };
  }

  private selectedRoleCode(
    entityType: ImportEntityType,
    value?: string,
  ): string | undefined {
    if (entityType === "PEOPLE") {
      const normalized = (value || "STUDENT")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
      if (normalized !== "STUDENT") {
        throw new BadRequestException(
          "People imports assign the Student role.",
        );
      }
      return "STUDENT";
    }
    if (entityType === "STUDENTS") return "STUDENT";
    if (entityType !== "USERS" && entityType !== "STAFF") return undefined;
    const normalized = (value || "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
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
    if (entityType === "STAFF" && roleCode === "STUDENT")
      throw new BadRequestException(
        "Staff imports cannot assign the Student role.",
      );
    if (!ROLE_RANK[roleCode])
      throw new BadRequestException("Import User Type is not recognized.");
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
    const normalizedInput = (value || "VALIDATE_ONLY")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
    const normalized = (aliases[normalizedInput] ??
      normalizedInput) as ImportMode;
    if (!IMPORT_MODES.includes(normalized)) {
      throw new BadRequestException(
        `importMode must be one of: ${IMPORT_MODES.join(", ")}.`,
      );
    }
    return normalized;
  }

  private parseColumnMapping(
    value?: string,
  ): Record<string, string> | undefined {
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
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      )
      .map(([source, target]) => [source.trim(), target.trim()] as const)
      .filter(([source, target]) => source && target);
    if (entries.length > 100)
      throw new BadRequestException(
        "columnMapping can contain at most 100 mapped columns.",
      );
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
    const normalized = (value || "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
    if (!normalized) return undefined;
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
    if (aliases[normalized]) return aliases[normalized];
    throw new BadRequestException(
      "detectedStudyYear must be an integer from 1 to 4.",
    );
  }

  private duplicateResolution(value?: string): "KEEP_FIRST" | "SKIP_ALL" {
    const normalized = (value || "KEEP_FIRST").trim().toUpperCase();
    if (normalized === "KEEP_FIRST" || normalized === "SKIP_ALL")
      return normalized;
    throw new BadRequestException(
      "duplicateResolution must be KEEP_FIRST or SKIP_ALL.",
    );
  }

  private asColumnMapping(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([source]) => !source.startsWith("__"))
        .filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        )
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
    return typeof year === "string" && /^[1-4]$/.test(year)
      ? (year as ImportStudyYear)
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
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const roleCode = (value as Record<string, unknown>)[
      SELECTED_IMPORT_ROLE_KEY
    ];
    return typeof roleCode === "string" ? roleCode : undefined;
  }

  private resetExistingPasswordsFromColumnMapping(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    return (
      (value as Record<string, unknown>)[RESET_EXISTING_PASSWORDS_KEY] ===
      "true"
    );
  }

  private applySelectedRole(
    entityType: ImportEntityType,
    rows: ImportRow[],
    selectedRoleCode?: string,
  ): void {
    if (!["PEOPLE", "USERS", "STUDENTS", "STAFF"].includes(entityType)) return;
    const roleCode =
      selectedRoleCode ||
      (["PEOPLE", "STUDENTS"].includes(entityType) ? "STUDENT" : undefined);
    if (!roleCode) return;
    rows.forEach((row) => {
      row.role_codes = roleCode;
    });
  }
  private booleanOption(value?: string): boolean {
    return ["true", "yes", "1", "on"].includes(
      (value || "").trim().toLowerCase(),
    );
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
      CSE: [
        "CSE",
        "Computer Science and Engineering",
        "Computer Science & Engineering",
      ],
      EEE: ["EEE", "Electrical and Electronics Engineering"],
      ECE: [
        "ECE",
        "Electronics and Communication Engineering",
        "Electronics & Communication",
      ],
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
    for (const [source, rawTarget] of Object.entries(requestedMappings ?? {})) {
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
      const source = (
        row.source_department_code ||
        row.department_code ||
        ""
      ).trim();
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
      const direct = this.exactImportDepartment(
        context.departments,
        sourceCode,
      );
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
        .some(
          (candidate) => candidate.trim().toLocaleLowerCase("en-US") === exact,
        ),
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
    const tokens = new Set(values.map((value) => this.departmentToken(value)));
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
    return value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
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

  private async officialEmailDomains(
    collegeId: string,
  ): Promise<string[] | undefined> {
    const setting = await this.prisma.appSetting.findUnique({
      where: {
        collegeId_key: { collegeId, key: "security.official_email_domains" },
      },
      select: { value: true },
    });
    const value = setting?.value;
    const domains = Array.isArray(value)
      ? value
      : value &&
          typeof value === "object" &&
          "domains" in value &&
          Array.isArray((value as { domains?: unknown }).domains)
        ? (value as { domains: unknown[] }).domains
        : undefined;
    if (!domains) return undefined;
    const normalized = domains
      .filter((domain): domain is string => typeof domain === "string")
      .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
      .filter((domain) =>
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
          domain,
        ),
      );
    return normalized.length ? normalized : undefined;
  }

  private assertPermission(
    user: AuthPrincipal,
    entityType: ImportEntityType,
  ): void {
    if (!user.permissions.includes(IMPORT_TEMPLATES[entityType].permission))
      throw new ForbiddenException(
        "You do not have permission to import this entity type.",
      );
  }
  private permittedEntityTypes(user: AuthPrincipal): ImportEntityType[] {
    return IMPORT_ENTITY_TYPES.filter((entityType) =>
      user.permissions.includes(IMPORT_TEMPLATES[entityType].permission),
    );
  }
  private async findAuthorized(
    user: AuthPrincipal,
    id: string,
    ownerOnly = false,
    expectedEntityType?: ImportEntityType,
  ) {
    const job = await this.prisma.importJob.findFirst({
      where: {
        id,
        collegeId: user.collegeId,
        ...(expectedEntityType ? { entityType: expectedEntityType } : {}),
        ...(!ownerOnly && user.permissions.includes("audit.read")
          ? {}
          : { requestedById: user.id }),
      },
    });
    if (!job) throw new NotFoundException("Import job not found.");
    return job;
  }
  private jobView(job: {
    id: string;
    entityType: string;
    importMode?: string;
    selectedSheetName?: string | null;
    status: string;
    totalRows: number;
    validRows: number;
    errorRows: number;
    sourceSha256: string;
    resultStorageKey: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: job.id,
      entityType: job.entityType,
      importMode: job.importMode ?? "CREATE_ONLY",
      selectedSheetName: job.selectedSheetName ?? null,
      status: job.status,
      totalRows: job.totalRows,
      validRows: job.validRows,
      errorRows: job.errorRows,
      sourceSha256: job.sourceSha256,
      resultAvailable: Boolean(job.resultStorageKey),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
  private safePreviewRow(
    entityType: ImportEntityType,
    row: ImportRow,
  ): ImportRow {
    if (entityType === "PEOPLE") {
      const safeFields = [
        "full_name",
        "college_identity_id",
        "email",
        "department_code",
        "year",
        "class_room_number",
        "mobile",
        "source_sheet",
        "source_row_number",
        "source_department_code",
        "password_status",
      ] as const;
      return Object.fromEntries(
        safeFields.flatMap((field) =>
          row[field] === undefined ? [] : [[field, row[field]]],
        ),
      ) as ImportRow;
    }
    const { temporary_password: _temporaryPassword, ...safeRow } = row;
    return safeRow as ImportRow;
  }
  private async credentialWorkbook(
    rows: CredentialExportRow[],
  ): Promise<Buffer> {
    const content = [
      ["AVS Engineering College"],
      ["Confidential Login Credentials"],
      [
        "This file contains temporary passwords. Store it securely and delete it after distribution.",
      ],
      [],
      [
        "user_id",
        "full_name",
        "role",
        "login_id",
        "temporary_password",
        "first_login_required",
      ],
      ...rows.map((row) => [
        this.safeSpreadsheetText(row.userId),
        this.safeSpreadsheetText(row.fullName),
        this.safeSpreadsheetText(row.role),
        this.safeSpreadsheetText(row.loginId),
        // ExcelJS writes string values as string cells, so this does not create
        // a formula. Preserve the credential byte-for-byte: adding an
        // apostrophe would change the password and make first login fail.
        row.temporaryPassword,
        row.firstLoginRequired ? "true" : "false",
      ]),
    ];
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet("Credentials");
    worksheet.addRows(content);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  private safeSpreadsheetText(value: string): string {
    return /^[=+\-@]/.test(value) ? `'${value}` : value;
  }
  private peopleRowError(
    entityType: ImportEntityType,
    row: ImportRow | undefined,
    rowNumber: number,
    message: string,
  ): ImportRowError {
    return {
      rowNumber,
      message,
      ...(entityType === "PEOPLE" && row?.college_identity_id
        ? { userId: row.college_identity_id.slice(0, 60) }
        : {}),
      ...(entityType === "PEOPLE" && row?.full_name
        ? { userName: row.full_name.slice(0, 180) }
        : {}),
      ...(entityType === "PEOPLE" && row?.email
        ? { email: row.email.slice(0, 254) }
        : {}),
      ...(entityType === "PEOPLE" && row?.department_code
        ? { department: row.department_code.slice(0, 180) }
        : {}),
      ...(entityType === "PEOPLE" && row?.year
        ? { year: row.year.slice(0, 20) }
        : {}),
    };
  }
  private rowError(error: unknown, row?: ImportRow): string {
    let message: string;
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      message =
        typeof response === "string"
          ? response
          : ((
              response as { message?: string | string[] }
            ).message?.toString() ?? "Row validation failed.");
      return this.redactRowPassword(message, row);
    }
    const code = (error as { code?: string }).code;
    if (code === "P2002")
      return "A record with the same unique value already exists.";
    if (code === "P2003")
      return "A referenced record does not exist or cannot be used.";
    if (
      this.config.get<string>("NODE_ENV", "development") !== "production" &&
      error instanceof Error
    ) {
      return this.redactRowPassword(error.message.slice(0, 500), row);
    }
    this.logger.warn(
      {
        error:
          error instanceof Error
            ? this.redactRowPassword(error.message, row)
            : "Unknown row error",
      },
      "Import row rejected",
    );
    return "The row could not be imported. Check its values and references.";
  }
  private redactRowPassword(message: string, row?: ImportRow): string {
    const password = row?.temporary_password;
    return password && message.includes(password)
      ? message.split(password).join("[REDACTED]")
      : message;
  }
}
