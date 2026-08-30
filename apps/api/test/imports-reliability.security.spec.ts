import { ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";

import type { AuthPrincipal } from "../src/common/http/request-context";
import type { PrismaService } from "../src/database/prisma.service";
import type { SectionPlacementService } from "../src/modules/academic/section-placement.service";
import type {
  CredentialExportRow,
  ImportedRecord,
  ImportRow,
} from "../src/modules/imports/import.types";
import {
  decryptImportCredential,
  encryptImportCredential,
} from "../src/modules/imports/import-credential.crypto";
import { ImportsHandlerService } from "../src/modules/imports/imports-handler.service";
import { ImportsService } from "../src/modules/imports/imports.service";

interface QueueJobInput {
  data: { jobId: string; recovery?: boolean };
  id?: string;
  name?: string;
  attemptsMade?: number;
  stalledCounter?: number;
  attemptsStarted?: number;
  updateProgress(progress: number): Promise<void>;
}

interface PrivateImportsService {
  ensureQueueJobScheduled(
    importJobId: string,
    recovery?: boolean,
  ): Promise<void>;
  deletePendingResultAndClear(
    importJobId: string,
    collegeId: string,
    storageKey: string,
  ): Promise<void>;
  process(job: QueueJobInput, workerToken?: string): Promise<void>;
  credentialWorkbook(rows: CredentialExportRow[]): Promise<Buffer>;
}

function importsServiceWith(
  dependencies: Record<string, unknown>,
): ImportsService {
  const service = Object.create(ImportsService.prototype) as ImportsService;
  Object.defineProperties(
    service,
    Object.fromEntries(
      Object.entries(dependencies).map(([property, value]) => [
        property,
        { value },
      ]),
    ),
  );
  return service;
}

function queueJob(jobId: string, recovery = false): QueueJobInput {
  return {
    data: { jobId, ...(recovery ? { recovery: true } : {}) },
    id: jobId,
    name: "process",
    attemptsMade: 0,
    stalledCounter: 0,
    attemptsStarted: recovery ? 2 : 1,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  };
}

const config = new ConfigService({
  PASSWORD_PEPPER: "test-only-import-escrow-pepper",
});

describe("ImportsService queue and worker reliability", () => {
  it("reconciles an ambiguous queue.add response using the stable job ID", async () => {
    const scheduled = {
      getState: jest.fn().mockResolvedValue("waiting"),
      remove: jest.fn(),
    };
    let queueState: typeof scheduled | undefined;
    const queue = {
      getJob: jest.fn(async () => queueState),
      add: jest.fn(async () => {
        queueState = scheduled;
        throw Object.assign(new Error("connection reset after write"), {
          code: "ECONNRESET",
        });
      }),
    };
    const service = importsServiceWith({ queue });

    await expect(
      (service as unknown as PrivateImportsService).ensureQueueJobScheduled(
        "00000000-0000-4000-8000-000000000101",
      ),
    ).resolves.toBeUndefined();

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.getJob).toHaveBeenCalledTimes(2);
    expect(scheduled.getState).toHaveBeenCalledTimes(1);
  });

  it("removes a retained terminal BullMQ job before scheduling its replacement", async () => {
    const terminal = {
      getState: jest.fn().mockResolvedValue("completed"),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const replacement = {
      getState: jest.fn().mockResolvedValue("waiting"),
      remove: jest.fn(),
    };
    let queueState: typeof terminal | typeof replacement | undefined = terminal;
    const queue = {
      getJob: jest.fn(async () => queueState),
      add: jest.fn(async () => {
        queueState = replacement;
      }),
    };
    const service = importsServiceWith({ queue });
    const jobId = "00000000-0000-4000-8000-000000000102";

    await (service as unknown as PrivateImportsService).ensureQueueJobScheduled(
      jobId,
      true,
    );

    expect(terminal.remove).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      "process",
      { jobId, recovery: true },
      expect.objectContaining({ jobId, attempts: 3 }),
    );
    expect(replacement.getState).toHaveBeenCalledTimes(1);
  });

  it("recovers PROCESSING work under a new token and trusts its durable ledger", async () => {
    const source = Buffer.from("recovered People workbook", "utf8");
    const importJob = {
      id: "00000000-0000-4000-8000-000000000103",
      collegeId: "00000000-0000-4000-8000-000000000201",
      requestedById: "00000000-0000-4000-8000-000000000301",
      entityType: "PEOPLE",
      importMode: "CREATE_ONLY",
      selectedSheetName: "People",
      columnMapping: null,
      sourceStorageKey:
        "colleges/00000000-0000-4000-8000-000000000201/imports/source/recovery.xlsx",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      sourceExpiresAt: new Date("2026-08-23T12:00:00.000Z"),
      status: "PROCESSING",
      processingAttemptToken: "stalled-attempt-token",
    };
    const durableRecord = {
      rowNumber: 2,
      model: "User",
      recordId: "00000000-0000-4000-8000-000000000401",
      label: "AVS001 - Durable Student",
      credentialCiphertext: null,
    };
    const importUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const transactionUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const tx = { importJob: { updateMany: transactionUpdate } };
    const prisma = {
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      importJobRecord: {
        findMany: jest.fn().mockResolvedValue([durableRecord]),
      },
      importJob: {
        findUnique: jest.fn().mockResolvedValue(importJob),
        findFirst: jest
          .fn()
          .mockResolvedValue({ pendingResultStorageKey: null }),
        updateMany: importUpdate,
      },
      $transaction: jest.fn(
        async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
      ),
    };
    const files = {
      loadSource: jest.fn().mockResolvedValue(source),
      parse: jest.fn().mockResolvedValue({
        rows: [
          {
            full_name: "Durable Student",
            college_identity_id: "AVS001",
            temporary_password: "NeverPersistThis!1",
            source_row_number: "2",
          } as ImportRow,
        ],
        errors: [],
      }),
      saveReport: jest.fn().mockResolvedValue(undefined),
      deleteSource: jest.fn().mockResolvedValue(undefined),
      deleteReport: jest.fn().mockResolvedValue(undefined),
    };
    const handler = {
      validate: jest.fn().mockResolvedValue([]),
      createPeopleBatch: jest.fn(),
      create: jest.fn(),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = importsServiceWith({
      prisma,
      config,
      files,
      handler,
      audit,
      logger: { warn: jest.fn(), error: jest.fn() },
    });
    const recoveredToken = "recovered-attempt-token";

    await (service as unknown as PrivateImportsService).process(
      queueJob(importJob.id, true),
      recoveredToken,
    );

    expect(importUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PROCESSING",
          processingAttemptToken: "stalled-attempt-token",
        }),
        data: expect.objectContaining({
          status: "PROCESSING",
          processingAttemptToken: recoveredToken,
        }),
      }),
    );
    expect(handler.createPeopleBatch).not.toHaveBeenCalled();
    expect(handler.create).not.toHaveBeenCalled();
    const report = files.saveReport.mock.calls[0]?.[1] as {
      successful: ImportedRecord[];
    };
    expect(report.successful).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        id: durableRecord.recordId,
      }),
    ]);
    expect(JSON.stringify(report)).not.toContain("NeverPersistThis!1");
    expect(files.deleteSource).toHaveBeenCalledWith(
      importJob.collegeId,
      importJob.sourceStorageKey,
    );
  });

  it("reconciles an ambiguously committed People batch from the ledger without replay", async () => {
    const source = Buffer.from("ambiguous People workbook", "utf8");
    const row = {
      full_name: "Committed Student",
      college_identity_id: "AVS002",
      temporary_password: "NeverInReport!2",
      source_row_number: "2",
    } as ImportRow;
    const importJob = {
      id: "00000000-0000-4000-8000-000000000104",
      collegeId: "00000000-0000-4000-8000-000000000202",
      requestedById: "00000000-0000-4000-8000-000000000302",
      entityType: "PEOPLE",
      importMode: "CREATE_ONLY",
      selectedSheetName: "People",
      columnMapping: null,
      sourceStorageKey:
        "colleges/00000000-0000-4000-8000-000000000202/imports/source/ambiguous.xlsx",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      sourceExpiresAt: new Date("2026-08-23T12:00:00.000Z"),
      status: "QUEUED",
      processingAttemptToken: null,
    };
    const durableRecord = {
      rowNumber: 2,
      model: "User",
      recordId: "00000000-0000-4000-8000-000000000402",
      label: "AVS002 - Committed Student",
      credentialCiphertext: null,
    };
    const tx = {
      importJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      importJobRecord: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([durableRecord]),
      },
      importJob: {
        findUnique: jest.fn().mockResolvedValue(importJob),
        findFirst: jest
          .fn()
          .mockResolvedValue({ pendingResultStorageKey: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(
        async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
      ),
    };
    const files = {
      loadSource: jest.fn().mockResolvedValue(source),
      parse: jest.fn().mockResolvedValue({ rows: [row], errors: [] }),
      saveReport: jest.fn().mockResolvedValue(undefined),
      deleteSource: jest.fn().mockResolvedValue(undefined),
      deleteReport: jest.fn().mockResolvedValue(undefined),
    };
    const handler = {
      validate: jest.fn().mockResolvedValue([]),
      createPeopleBatch: jest.fn().mockRejectedValue(
        Object.assign(new Error("response lost after COMMIT"), {
          code: "ECONNRESET",
        }),
      ),
      create: jest.fn(),
    };
    const service = importsServiceWith({
      prisma,
      config,
      files,
      handler,
      audit: { record: jest.fn().mockResolvedValue(undefined) },
      logger: { warn: jest.fn(), error: jest.fn() },
    });

    await (service as unknown as PrivateImportsService).process(
      queueJob(importJob.id),
      "first-attempt-token",
    );

    expect(handler.createPeopleBatch).toHaveBeenCalledTimes(1);
    expect(handler.create).not.toHaveBeenCalled();
    expect(prisma.importJobRecord.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          importJobId: importJob.id,
          rowNumber: { in: [2] },
        }),
      }),
    );
    const report = files.saveReport.mock.calls[0]?.[1] as {
      successful: ImportedRecord[];
    };
    expect(report.successful).toEqual([
      expect.objectContaining({ id: durableRecord.recordId, rowNumber: 2 }),
    ]);
    expect(JSON.stringify(report)).not.toContain("NeverInReport!2");
  });

  it("retains PROCESSING ownership and its source after transient infrastructure failure", async () => {
    const importJob = {
      id: "00000000-0000-4000-8000-000000000105",
      collegeId: "00000000-0000-4000-8000-000000000203",
      requestedById: "00000000-0000-4000-8000-000000000303",
      entityType: "PEOPLE",
      importMode: "CREATE_ONLY",
      selectedSheetName: "People",
      columnMapping: null,
      sourceStorageKey:
        "colleges/00000000-0000-4000-8000-000000000203/imports/source/retry.xlsx",
      sourceSha256: "0".repeat(64),
      sourceExpiresAt: new Date("2026-08-23T12:00:00.000Z"),
      status: "QUEUED",
      processingAttemptToken: null,
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      importJob: {
        findUnique: jest.fn().mockResolvedValue(importJob),
        findFirst: jest
          .fn()
          .mockResolvedValue({ pendingResultStorageKey: null }),
        updateMany,
      },
      backgroundJobFailure: { upsert: jest.fn() },
    };
    const files = {
      loadSource: jest.fn().mockRejectedValue(
        Object.assign(new Error("temporary object-store disconnect"), {
          code: "ECONNRESET",
        }),
      ),
      deleteSource: jest.fn(),
      deleteReport: jest.fn(),
    };
    const service = importsServiceWith({
      prisma,
      files,
      logger: { warn: jest.fn(), error: jest.fn() },
    });

    await expect(
      (service as unknown as PrivateImportsService).process(
        queueJob(importJob.id),
        "retryable-attempt-token",
      ),
    ).rejects.toThrow("temporary object-store disconnect");

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PROCESSING",
          processingAttemptToken: "retryable-attempt-token",
        }),
      }),
    );
    expect(prisma.backgroundJobFailure.upsert).not.toHaveBeenCalled();
    expect(files.deleteSource).not.toHaveBeenCalled();
  });

  it("never deletes a pending attempt report that became the winning result", async () => {
    const jobId = "00000000-0000-4000-8000-000000000106";
    const collegeId = "00000000-0000-4000-8000-000000000204";
    const storageKey =
      `colleges/${collegeId}/imports/results/${jobId}-` +
      "a".repeat(64) +
      ".json";
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const tx = { importJob: { updateMany } };
    const prisma = {
      $transaction: jest.fn(
        async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
      ),
    };
    const files = { deleteReport: jest.fn() };
    const service = importsServiceWith({ prisma, files });

    await (
      service as unknown as PrivateImportsService
    ).deletePendingResultAndClear(jobId, collegeId, storageKey);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: jobId,
        collegeId,
        pendingResultStorageKey: storageKey,
        OR: [
          { resultStorageKey: null },
          { resultStorageKey: { not: storageKey } },
        ],
      },
      data: { pendingResultStorageKey: storageKey },
    });
    expect(files.deleteReport).not.toHaveBeenCalled();
  });

  it("deletes and clears the normal orphan when no result has committed", async () => {
    const jobId = "00000000-0000-4000-8000-000000000109";
    const collegeId = "00000000-0000-4000-8000-000000000209";
    const storageKey =
      `colleges/${collegeId}/imports/results/${jobId}-` +
      "b".repeat(64) +
      ".json";
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const tx = { importJob: { updateMany } };
    const prisma = {
      $transaction: jest.fn(
        async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
      ),
    };
    const files = { deleteReport: jest.fn().mockResolvedValue(undefined) };
    const service = importsServiceWith({ prisma, files });

    await (
      service as unknown as PrivateImportsService
    ).deletePendingResultAndClear(jobId, collegeId, storageKey);

    expect(files.deleteReport).toHaveBeenCalledWith(
      collegeId,
      jobId,
      storageKey,
    );
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1]?.[0]).toEqual({
      where: {
        id: jobId,
        collegeId,
        pendingResultStorageKey: storageKey,
        OR: [
          { resultStorageKey: null },
          { resultStorageKey: { not: storageKey } },
        ],
      },
      data: { pendingResultStorageKey: null },
    });
  });
});

describe("ImportsHandlerService worker fencing", () => {
  it("rejects a stale attempt token before any People row write", async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const sectionPlacement = {
      transaction: jest.fn(
        async (work: (client: typeof tx) => Promise<ImportedRecord[]>) =>
          work(tx),
      ),
    };
    const service = new ImportsHandlerService(
      {} as PrismaService,
      config,
      sectionPlacement as unknown as SectionPlacementService,
    );
    const privateService = service as unknown as {
      hashTemporaryPassword(password: string): Promise<string>;
      createInTransaction(...args: unknown[]): Promise<ImportedRecord>;
    };
    jest
      .spyOn(privateService, "hashTemporaryPassword")
      .mockResolvedValue("$argon2id$prepared-outside-transaction");
    const createInTransaction = jest
      .spyOn(privateService, "createInTransaction")
      .mockResolvedValue({
        rowNumber: 2,
        model: "User",
        id: "00000000-0000-4000-8000-000000000405",
        label: "must not be written",
      });

    await expect(
      service.createPeopleBatch(
        "00000000-0000-4000-8000-000000000205",
        [
          {
            rowNumber: 2,
            row: {
              full_name: "Stale Worker",
              college_identity_id: "AVS003",
              email: "stale.worker@avsenggcollege.ac.in",
              temporary_password: "Strong!Password3",
              mobile: "9876543210",
            } as ImportRow,
          },
        ],
        "00000000-0000-4000-8000-000000000107",
        "00000000-0000-4000-8000-000000000305",
        "CREATE_ONLY",
        {},
        "stale-attempt-token",
      ),
    ).rejects.toThrow(ConflictException);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(createInTransaction).not.toHaveBeenCalled();
  });
});

describe("encrypted import credential escrow", () => {
  const importJobId = "00000000-0000-4000-8000-000000000108";
  const credential: CredentialExportRow = {
    rowNumber: 2,
    userId: "00000000-0000-4000-8000-000000000408",
    fullName: "Credential Student",
    role: "STUDENT",
    loginId: "AVS004",
    temporaryPassword: "EscrowOnly!Password4",
    firstLoginRequired: true,
  };

  it("round-trips an authenticated envelope without exposing plaintext", () => {
    const encrypted = encryptImportCredential(
      "test-only-import-escrow-pepper",
      importJobId,
      credential,
    );

    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain(credential.temporaryPassword);
    expect(
      decryptImportCredential(
        "test-only-import-escrow-pepper",
        importJobId,
        credential.rowNumber,
        encrypted,
      ),
    ).toEqual(credential);
    expect(() =>
      decryptImportCredential(
        "test-only-import-escrow-pepper",
        "00000000-0000-4000-8000-000000000999",
        credential.rowNumber,
        encrypted,
      ),
    ).toThrow();
  });

  it("provides one retry-safe claim, then atomically acknowledges and erases escrow", async () => {
    const collegeId = "00000000-0000-4000-8000-000000000208";
    const actorId = "00000000-0000-4000-8000-000000000308";
    const resultStorageKey = `colleges/${collegeId}/imports/results/${importJobId}.json`;
    const encrypted = encryptImportCredential(
      "test-only-import-escrow-pepper",
      importJobId,
      credential,
    );
    const state = {
      id: importJobId,
      collegeId,
      requestedById: actorId,
      entityType: "USERS",
      status: "COMPLETED",
      resultStorageKey,
      credentialExportedAt: null as Date | null,
      credentialExportClaimId: null as string | null,
      credentialExportClaimedById: null as string | null,
      credentialExportClaimedAt: null as Date | null,
    };
    let credentialCiphertext: string | null = encrypted;
    const importJobFindFirst = jest.fn(
      async ({ where }: { where: Record<string, unknown> }) => {
        if (where.credentialExportedAt) {
          return state.credentialExportedAt &&
            where.credentialExportClaimId === state.credentialExportClaimId &&
            where.credentialExportClaimedById ===
              state.credentialExportClaimedById
            ? { id: state.id }
            : null;
        }
        return { ...state };
      },
    );
    const importJobUpdateMany = jest.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        if ("credentialExportClaimId" in data) {
          const requestedClaimId = data.credentialExportClaimId as string;
          const requestedActorId = data.credentialExportClaimedById as string;
          const available =
            state.credentialExportedAt === null &&
            (state.credentialExportClaimId === null ||
              (state.credentialExportClaimId === requestedClaimId &&
                state.credentialExportClaimedById === requestedActorId));
          if (!available) return { count: 0 };
          state.credentialExportClaimId = requestedClaimId;
          state.credentialExportClaimedById = requestedActorId;
          state.credentialExportClaimedAt =
            data.credentialExportClaimedAt as Date;
          return { count: 1 };
        }
        if ("credentialExportedAt" in data) {
          const matches =
            state.credentialExportedAt === null &&
            where.credentialExportClaimId === state.credentialExportClaimId &&
            where.credentialExportClaimedById ===
              state.credentialExportClaimedById;
          if (!matches) return { count: 0 };
          state.credentialExportedAt = data.credentialExportedAt as Date;
          return { count: 1 };
        }
        const ownsClaim =
          state.credentialExportedAt === null &&
          where.credentialExportClaimId === state.credentialExportClaimId &&
          where.credentialExportClaimedById ===
            state.credentialExportClaimedById;
        return { count: ownsClaim ? 1 : 0 };
      },
    );
    const recordUpdateMany = jest.fn(async () => {
      const count = credentialCiphertext ? 1 : 0;
      credentialCiphertext = null;
      return { count };
    });
    const tx = {
      importJob: {
        updateMany: importJobUpdateMany,
        findFirst: importJobFindFirst,
      },
      importJobRecord: { updateMany: recordUpdateMany },
    };
    let transactionTail: Promise<void> = Promise.resolve();
    const transaction = jest.fn(
      (work: (client: typeof tx) => Promise<unknown>): Promise<unknown> => {
        const result = transactionTail.then(() => work(tx));
        transactionTail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    );
    const prisma = {
      importJob: {
        findFirst: importJobFindFirst,
        updateMany: importJobUpdateMany,
      },
      importJobRecord: {
        findMany: jest.fn(async () =>
          credentialCiphertext
            ? [
                {
                  rowNumber: credential.rowNumber,
                  credentialCiphertext,
                },
              ]
            : [],
        ),
      },
      $transaction: transaction,
    };
    const files = {
      loadReport: jest.fn().mockResolvedValue({
        jobId: importJobId,
        entityType: "USERS",
        importMode: "CREATE_ONLY",
        completedAt: "2026-08-23T00:00:00.000Z",
        successful: [],
        errors: [],
      }),
      saveReport: jest.fn().mockResolvedValue(undefined),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = importsServiceWith({ prisma, config, files, audit });
    const privateService = service as unknown as PrivateImportsService;
    const credentialWorkbook = jest
      .spyOn(privateService, "credentialWorkbook")
      .mockResolvedValue(Buffer.from("credential-workbook"));
    const actor = {
      id: actorId,
      collegeId,
      roles: ["MAIN_ADMIN"],
      permissions: ["users.import"],
    } as AuthPrincipal;
    const firstExportId = "11111111-1111-4111-8111-111111111111";
    const competingExportId = "22222222-2222-4222-8222-222222222222";

    const competingClaims = await Promise.allSettled([
      service.credentials(actor, importJobId, "request-claim-1", firstExportId),
      service.credentials(
        actor,
        importJobId,
        "request-claim-2",
        competingExportId,
      ),
    ]);
    expect(competingClaims.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const winningClaim = competingClaims.find(
      (
        result,
      ): result is PromiseFulfilledResult<{
        fileName: string;
        content: Buffer;
        exportId: string;
      }> => result.status === "fulfilled",
    );
    expect(winningClaim).toBeDefined();
    const winningExportId = winningClaim?.value.exportId ?? firstExportId;

    await expect(
      service.credentials(
        actor,
        importJobId,
        "request-claim-retry",
        winningExportId,
      ),
    ).resolves.toMatchObject({ exportId: winningExportId });
    expect(credentialWorkbook).toHaveBeenCalledWith([credential]);
    expect(
      audit.record.mock.calls.filter(
        ([entry]) => entry.action === "import.credentials_export_claimed",
      ),
    ).toHaveLength(1);

    await expect(
      Promise.all([
        service.acknowledgeCredentials(
          actor,
          importJobId,
          "request-ack-1",
          winningExportId,
        ),
        service.acknowledgeCredentials(
          actor,
          importJobId,
          "request-ack-2",
          winningExportId,
        ),
      ]),
    ).resolves.toEqual([
      { id: importJobId, status: "ACKNOWLEDGED" },
      { id: importJobId, status: "ACKNOWLEDGED" },
    ]);
    expect(recordUpdateMany).toHaveBeenCalledTimes(1);
    expect(credentialCiphertext).toBeNull();
    expect(state.credentialExportedAt).toBeInstanceOf(Date);
    expect(
      audit.record.mock.calls.filter(
        ([entry]) => entry.action === "import.credentials_exported",
      ),
    ).toHaveLength(1);

    await expect(
      service.acknowledgeCredentials(
        actor,
        importJobId,
        "request-ack-retry",
        winningExportId,
      ),
    ).resolves.toEqual({ id: importJobId, status: "ACKNOWLEDGED" });
    await expect(
      service.credentials(
        actor,
        importJobId,
        "request-after-ack",
        winningExportId,
      ),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.acknowledgeCredentials(
        actor,
        importJobId,
        "request-wrong-ack",
        competingExportId,
      ),
    ).rejects.toThrow(
      "Credential export acknowledgement does not match the active claim.",
    );
  });
});
