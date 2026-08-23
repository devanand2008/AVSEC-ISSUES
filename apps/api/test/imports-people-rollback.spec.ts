import { ConfigService } from "@nestjs/config";

import type { AuthPrincipal } from "../src/common/http/request-context";
import type { PrismaService } from "../src/database/prisma.service";
import type { SectionPlacementService } from "../src/modules/academic/section-placement.service";
import type { ImportedRecord } from "../src/modules/imports/import.types";
import { ImportsHandlerService } from "../src/modules/imports/imports-handler.service";
import { ImportsService } from "../src/modules/imports/imports.service";

const COLLEGE_ID = "00000000-0000-4000-8000-000000000001";
const IMPORT_JOB_ID = "00000000-0000-4000-8000-000000000002";
const ADMIN_ID = "00000000-0000-4000-8000-000000000003";
const SECTION_ID = "00000000-0000-4000-8000-000000000004";
const IMPORTED_AT = new Date("2026-08-23T08:00:00.000Z");
const UNCHANGED_BEFORE = new Date("2026-08-23T08:01:00.000Z");
const CHANGED_AFTER = new Date("2026-08-23T08:02:00.000Z");

type ImportedUserState = ReturnType<typeof unchangedImportedUser>;

function unchangedImportedUser(id: string) {
  return {
    id,
    createdAt: IMPORTED_AT,
    updatedAt: IMPORTED_AT,
    version: 1,
    status: "ACTIVE",
    archivedAt: null,
    mustChangePassword: true,
    firstLoginCompletedAt: null as Date | null,
    lastLoginAt: null as Date | null,
    profileCompletionStatus: "IN_PROGRESS",
    profileCompletionPercentage: 90,
    credential: {
      passwordChangedAt: null,
      failedAttemptCount: 0,
      lockedUntil: null,
    },
    roles: [
      {
        createdAt: IMPORTED_AT,
        role: { code: "STUDENT" },
      },
    ],
    scopes: [
      {
        createdAt: IMPORTED_AT,
        scopeType: "SECTION",
        scopeId: SECTION_ID,
        issueCategoryId: null,
      },
    ],
    studentProfile: {
      sectionId: SECTION_ID,
      createdAt: IMPORTED_AT,
      updatedAt: IMPORTED_AT,
    },
    staffProfile: null,
    sectionMemberships: [
      {
        sectionId: SECTION_ID,
        createdAt: IMPORTED_AT,
        updatedAt: IMPORTED_AT,
        changedById: null as string | null,
        status: "ACTIVE",
        isActive: true,
        endsOn: null,
      },
    ],
  };
}

function recordsFor(ids: string[]): ImportedRecord[] {
  return ids.map((id, index) => ({
    rowNumber: index + 2,
    model: "User",
    id,
    label: `AVS${String(index + 1).padStart(4, "0")}`,
  }));
}

function sqlText(query: unknown): string {
  const strings = (query as { strings?: readonly string[] }).strings;
  return strings?.join(" ").replace(/\s+/g, " ").trim() ?? "";
}

interface DependencyReference {
  schemaName: string;
  tableName: string;
  columnName: string;
}

function rollbackTransaction(options: {
  users: ImportedUserState[];
  lockedIds?: string[];
  references?: DependencyReference[];
  dynamicDependencyCount?: number;
  unmanagedDependencyCount?: number;
}) {
  const userIds = options.users.map((user) => user.id);
  const queryRaw = jest.fn(async (query: unknown) => {
    const text = sqlText(query);
    if (text.includes("FROM users")) {
      return (options.lockedIds ?? userIds).map((id) => ({ id }));
    }
    if (text.includes("FROM pg_constraint")) {
      return options.references ?? [];
    }
    if (text.includes("FROM user_presence")) {
      return [{ count: String(options.unmanagedDependencyCount ?? 0) }];
    }
    if (text.includes("SELECT COUNT(*)")) {
      return [{ count: String(options.dynamicDependencyCount ?? 0) }];
    }
    throw new Error(`Unexpected rollback query: ${text}`);
  });
  return {
    $queryRaw: queryRaw,
    user: {
      findMany: jest.fn().mockResolvedValue(options.users),
      deleteMany: jest.fn().mockResolvedValue({ count: userIds.length }),
    },
    sectionMembership: {
      deleteMany: jest.fn().mockResolvedValue({ count: userIds.length }),
    },
    studentProfile: {
      deleteMany: jest.fn().mockResolvedValue({ count: userIds.length }),
    },
  };
}

function handlerService(): ImportsHandlerService {
  return new ImportsHandlerService(
    {} as PrismaService,
    new ConfigService({ PASSWORD_PEPPER: "rollback-test-pepper" }),
    {} as SectionPlacementService,
  );
}

async function rollbackPeople(
  service: ImportsHandlerService,
  tx: ReturnType<typeof rollbackTransaction>,
  ids: string[],
) {
  await service.rollback(
    COLLEGE_ID,
    recordsFor(ids),
    {
      entityType: "PEOPLE",
      importJobId: IMPORT_JOB_ID,
      unchangedBefore: UNCHANGED_BEFORE,
    },
    tx as never,
  );
}

describe("People import rollback safety", () => {
  it("requires every ledger user to match the exact tenant and import batch before reading or deleting its graph", async () => {
    const id = "00000000-0000-4000-8000-000000000010";
    const tx = rollbackTransaction({
      users: [unchangedImportedUser(id)],
      lockedIds: [],
    });

    await expect(rollbackPeople(handlerService(), tx, [id])).rejects.toThrow(
      "outside this college, or were not created by this import",
    );

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const lockQuery = tx.$queryRaw.mock.calls[0]?.[0] as {
      strings: readonly string[];
      values: unknown[];
    };
    expect(sqlText(lockQuery)).toContain("college_id =");
    expect(sqlText(lockQuery)).toContain("import_batch_id =");
    expect(lockQuery.values).toEqual(
      expect.arrayContaining([COLLEGE_ID, IMPORT_JOB_ID, id]),
    );
    expect(tx.user.findMany).not.toHaveBeenCalled();
    expect(tx.user.deleteMany).not.toHaveBeenCalled();
  });

  it("accepts only the unchanged initial People account graph and deletes it with tenant and batch guards", async () => {
    const id = "00000000-0000-4000-8000-000000000011";
    const tx = rollbackTransaction({ users: [unchangedImportedUser(id)] });

    await rollbackPeople(handlerService(), tx, [id]);

    expect(tx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: [id] },
          collegeId: COLLEGE_ID,
          importBatchId: IMPORT_JOB_ID,
        },
      }),
    );
    expect(tx.sectionMembership.deleteMany).toHaveBeenCalledWith({
      where: { studentUserId: { in: [id] } },
    });
    expect(tx.studentProfile.deleteMany).toHaveBeenCalledWith({
      where: { userId: { in: [id] }, collegeId: COLLEGE_ID },
    });
    expect(tx.user.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: [id] },
        collegeId: COLLEGE_ID,
        importBatchId: IMPORT_JOB_ID,
      },
    });
  });

  it.each([
    [
      "login",
      (user: ImportedUserState) => {
        user.lastLoginAt = CHANGED_AFTER;
        user.firstLoginCompletedAt = CHANGED_AFTER;
      },
    ],
    [
      "profile",
      (user: ImportedUserState) => {
        user.studentProfile.updatedAt = CHANGED_AFTER;
      },
    ],
    [
      "role",
      (user: ImportedUserState) => {
        user.roles.push({
          createdAt: CHANGED_AFTER,
          role: { code: "CLASS_REPRESENTATIVE" },
        });
      },
    ],
    [
      "scope",
      (user: ImportedUserState) => {
        user.scopes[0] = {
          ...user.scopes[0]!,
          scopeType: "DEPARTMENT",
        };
      },
    ],
    [
      "membership",
      (user: ImportedUserState) => {
        user.sectionMemberships[0] = {
          ...user.sectionMemberships[0]!,
          updatedAt: CHANGED_AFTER,
          changedById: ADMIN_ID,
          isActive: false,
        };
      },
    ],
  ])("rejects a post-import %s change before any delete", async (_label, mutate) => {
    const id = "00000000-0000-4000-8000-000000000012";
    const user = unchangedImportedUser(id);
    mutate(user);
    const tx = rollbackTransaction({ users: [user] });

    await expect(rollbackPeople(handlerService(), tx, [id])).rejects.toThrow(
      "has been used or changed",
    );

    expect(tx.sectionMembership.deleteMany).not.toHaveBeenCalled();
    expect(tx.studentProfile.deleteMany).not.toHaveBeenCalled();
    expect(tx.user.deleteMany).not.toHaveBeenCalled();
  });

  it("blocks a dynamically discovered cascading dependency before deleting baseline records", async () => {
    const id = "00000000-0000-4000-8000-000000000013";
    const tx = rollbackTransaction({
      users: [unchangedImportedUser(id)],
      references: [
        {
          schemaName: "public",
          tableName: "sessions",
          columnName: "user_id",
        },
      ],
      dynamicDependencyCount: 1,
    });

    await expect(rollbackPeople(handlerService(), tx, [id])).rejects.toThrow(
      "sessions dependency prevents safe People rollback",
    );

    expect(tx.sectionMembership.deleteMany).not.toHaveBeenCalled();
    expect(tx.studentProfile.deleteMany).not.toHaveBeenCalled();
    expect(tx.user.deleteMany).not.toHaveBeenCalled();
  });

  it("uses a bounded number of set-based reads and writes for 1,000 imported users", async () => {
    const ids = Array.from(
      { length: 1_000 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    );
    const tx = rollbackTransaction({ users: ids.map(unchangedImportedUser) });

    await rollbackPeople(handlerService(), tx, ids);

    expect(tx.user.findMany).toHaveBeenCalledTimes(1);
    expect(tx.sectionMembership.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.studentProfile.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.user.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.user.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ids },
        collegeId: COLLEGE_ID,
        importBatchId: IMPORT_JOB_ID,
      },
    });
  });
});

interface ServiceHarnessOptions {
  handlerFailure?: Error;
  jobClaimCount?: number;
}

function serviceRollbackHarness(options: ServiceHarnessOptions = {}) {
  const job = {
    id: IMPORT_JOB_ID,
    collegeId: COLLEGE_ID,
    requestedById: ADMIN_ID,
    entityType: "PEOPLE",
    status: "COMPLETED",
    resultStorageKey: null,
    updatedAt: UNCHANGED_BEFORE,
  };
  const importedId = "00000000-0000-4000-8000-000000000020";
  const ledger = [
    {
      rowNumber: 2,
      model: "User",
      recordId: importedId,
      label: "AVS0001",
    },
  ];
  const pendingMutations: string[] = [];
  const committedMutations: string[] = [];
  const tx = {
    importJob: {
      updateMany: jest.fn(async () => {
        pendingMutations.push("job");
        return { count: options.jobClaimCount ?? 1 };
      }),
    },
    importJobRecord: {
      updateMany: jest.fn(async () => {
        pendingMutations.push("ledger");
        return { count: 1 };
      }),
    },
  };
  const transaction = jest.fn(
    async (work: (client: typeof tx) => Promise<unknown>) => {
      try {
        const result = await work(tx);
        committedMutations.push(...pendingMutations);
        pendingMutations.length = 0;
        return result;
      } catch (error) {
        pendingMutations.length = 0;
        throw error;
      }
    },
  );
  const prisma = {
    importJob: { findFirst: jest.fn().mockResolvedValue(job) },
    importJobRecord: { findMany: jest.fn().mockResolvedValue(ledger) },
    $transaction: transaction,
  };
  const handler = {
    rollback: jest.fn(async (...args: unknown[]) => {
      expect(args[3]).toBe(tx);
      pendingMutations.push("delete");
      if (options.handlerFailure) throw options.handlerFailure;
    }),
  };
  const audit = {
    record: jest.fn(async (_input: unknown, client: unknown) => {
      expect(client).toBe(tx);
      pendingMutations.push("audit");
    }),
  };
  const service = Object.create(ImportsService.prototype) as ImportsService;
  Object.defineProperties(service, {
    prisma: { value: prisma },
    handler: { value: handler },
    audit: { value: audit },
  });
  const actor = {
    id: ADMIN_ID,
    collegeId: COLLEGE_ID,
    roles: ["MAIN_ADMIN"],
    permissions: ["users.import"],
  } as AuthPrincipal;
  return {
    service,
    actor,
    tx,
    prisma,
    handler,
    audit,
    pendingMutations,
    committedMutations,
  };
}

describe("ImportsService People rollback atomicity", () => {
  it("runs account deletion, job claim, ledger update, and audit in the same serializable transaction", async () => {
    const harness = serviceRollbackHarness();

    await expect(
      harness.service.rollback(harness.actor, IMPORT_JOB_ID, "request-1"),
    ).resolves.toEqual({
      id: IMPORT_JOB_ID,
      status: "ROLLED_BACK",
      recordsRemoved: 1,
    });

    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(harness.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: "Serializable",
        timeout: 60_000,
      }),
    );
    expect(harness.handler.rollback).toHaveBeenCalledWith(
      COLLEGE_ID,
      [
        {
          rowNumber: 2,
          model: "User",
          id: "00000000-0000-4000-8000-000000000020",
          label: "AVS0001",
        },
      ],
      {
        entityType: "PEOPLE",
        importJobId: IMPORT_JOB_ID,
        unchangedBefore: UNCHANGED_BEFORE,
      },
      harness.tx,
    );
    expect(harness.tx.importJobRecord.updateMany).toHaveBeenCalledWith({
      where: { importJobId: IMPORT_JOB_ID, rolledBackAt: null },
      data: {
        rolledBackAt: expect.any(Date) as Date,
        credentialCiphertext: null,
      },
    });
    expect(harness.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "import.rolled_back",
        entityId: IMPORT_JOB_ID,
      }),
      harness.tx,
    );
    expect(harness.committedMutations).toEqual([
      "delete",
      "job",
      "ledger",
      "audit",
    ]);
    expect(harness.pendingMutations).toEqual([]);
  });

  it("rolls account deletes back when the job status claim is ambiguous", async () => {
    const harness = serviceRollbackHarness({ jobClaimCount: 0 });

    await expect(
      harness.service.rollback(harness.actor, IMPORT_JOB_ID, "request-2"),
    ).rejects.toThrow(
      "Rollback is no longer safe because one or more imported records are now referenced by other data.",
    );

    expect(harness.handler.rollback).toHaveBeenCalledTimes(1);
    expect(harness.tx.importJob.updateMany).toHaveBeenCalledTimes(1);
    expect(harness.tx.importJobRecord.updateMany).not.toHaveBeenCalled();
    expect(harness.audit.record).not.toHaveBeenCalled();
    expect(harness.committedMutations).toEqual([]);
    expect(harness.pendingMutations).toEqual([]);
  });

  it("rolls the transaction back without mutating job, ledger, or audit when dependency deletion fails", async () => {
    const harness = serviceRollbackHarness({
      handlerFailure: new Error("dynamic dependency appeared"),
    });

    await expect(
      harness.service.rollback(harness.actor, IMPORT_JOB_ID, "request-3"),
    ).rejects.toThrow(
      "Rollback is no longer safe because one or more imported records are now referenced by other data.",
    );

    expect(harness.tx.importJob.updateMany).not.toHaveBeenCalled();
    expect(harness.tx.importJobRecord.updateMany).not.toHaveBeenCalled();
    expect(harness.audit.record).not.toHaveBeenCalled();
    expect(harness.committedMutations).toEqual([]);
    expect(harness.pendingMutations).toEqual([]);
  });
});
