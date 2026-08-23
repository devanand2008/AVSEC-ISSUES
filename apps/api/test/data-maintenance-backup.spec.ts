import { BadRequestException } from "@nestjs/common";
import type { AuthPrincipal } from "../src/common/http/request-context";
import { PrismaService } from "../src/database/prisma.service";
import { DataMaintenanceService } from "../src/modules/admin/data-maintenance.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { SectionPlacementService } from "../src/modules/academic/section-placement.service";
import { StorageService } from "../src/modules/storage/storage.service";

const actor: AuthPrincipal = {
  id: "admin-id",
  publicId: "admin-public-id",
  collegeId: "college-id",
  fullName: "Main Admin",
  email: "admin@college.edu",
  status: "ACTIVE",
  mustChangePassword: false,
  sessionId: "session-id",
  roles: ["MAIN_ADMIN"],
  permissions: ["data.maintenance"],
  scopes: [],
};

const createdAt = new Date("2026-08-12T00:00:00.000Z");
const job = {
  id: "job-id",
  collegeId: actor.collegeId,
  category: "PROMOTE_STUDENTS",
  mode: "ARCHIVE_OR_CLEAN",
  status: "ANALYSED",
  recordCounts: {},
  backupReference: null,
  confirmationPhraseHash: null,
  reason: null,
  report: {},
  createdAt,
  executedAt: null,
};

function serviceWith(
  backup: { id: string; restoreTests: Array<{ status: string }> } | null,
) {
  const tx = {
    dataMaintenanceJob: {
      update: jest.fn().mockResolvedValue({
        ...job,
        status: "BACKUP_CONFIRMED",
        backupReference: "backup-id",
      }),
    },
  };
  const prisma = {
    dataMaintenanceJob: { findFirst: jest.fn().mockResolvedValue(job) },
    databaseBackup: { findFirst: jest.fn().mockResolvedValue(backup) },
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new DataMaintenanceService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    {} as StorageService,
    {} as SectionPlacementService,
  );
  return { service, prisma, tx };
}

describe("DataMaintenanceService backup safety", () => {
  it("rejects a nonexistent or untested backup reference", async () => {
    const { service, tx } = serviceWith(null);

    await expect(
      service.registerBackup(actor, job.id, "backup-id", "request-id"),
    ).rejects.toThrow(BadRequestException);
    expect(tx.dataMaintenanceJob.update).not.toHaveBeenCalled();
  });

  it("requires a same-college restore-tested backup created after analysis", async () => {
    const { service, prisma } = serviceWith({
      id: "backup-id",
      restoreTests: [{ status: "PASSED" }],
    });

    await expect(
      service.registerBackup(actor, job.id, "backup-id", "request-id"),
    ).resolves.toEqual({
      id: job.id,
      status: "BACKUP_CONFIRMED",
      backupReference: "backup-id",
    });
    expect(prisma.databaseBackup.findFirst).toHaveBeenCalledWith({
      where: {
        id: "backup-id",
        collegeId: actor.collegeId,
        status: "RESTORE_TESTED",
        completedAt: { gte: createdAt },
        deletedAt: null,
      },
      select: {
        id: true,
        restoreTests: {
          orderBy: [
            { completedAt: "desc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
          take: 1,
          select: { status: true },
        },
      },
    });
  });

  it("rejects a backup whose latest restore test is not passed", async () => {
    const { service, tx } = serviceWith({
      id: "backup-id",
      restoreTests: [{ status: "FAILED" }],
    });

    await expect(
      service.registerBackup(actor, job.id, "backup-id", "request-id"),
    ).rejects.toThrow(BadRequestException);
    expect(tx.dataMaintenanceJob.update).not.toHaveBeenCalled();
  });
});

describe("DataMaintenanceService temporary import cleanup", () => {
  it("deduplicates every import object key and removes storage before database jobs", async () => {
    const deleteMaintenanceObjects = jest.fn().mockResolvedValue({
      requested: 3,
      deleted: 3,
      failed: 0,
    });
    const deleteRecords = jest.fn().mockResolvedValue({ count: 2 });
    const deleteJobs = jest.fn().mockResolvedValue({ count: 2 });
    const deleteAttendance = jest.fn().mockResolvedValue({ count: 0 });
    const tx = {
      importJobRecord: { deleteMany: deleteRecords },
      importJob: { deleteMany: deleteJobs },
      attendanceImportBatch: { deleteMany: deleteAttendance },
    };
    const importJobFindMany = jest
      .fn()
      .mockResolvedValueOnce([{ id: "job-1" }, { id: "job-2" }])
      .mockResolvedValueOnce([
        {
          id: "job-1",
          sourceStorageKey: "imports/shared.xlsx",
          resultStorageKey: "imports/job-1-result.json",
          pendingResultStorageKey: "imports/shared.xlsx",
        },
        {
          id: "job-2",
          sourceStorageKey: "imports/shared.xlsx",
          resultStorageKey: "imports/job-1-result.json",
          pendingResultStorageKey: "imports/job-2-pending.json",
        },
      ]);
    const prisma = {
      importJob: { findMany: importJobFindMany },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = new DataMaintenanceService(
      prisma as unknown as PrismaService,
      {} as AuditService,
      { deleteMaintenanceObjects } as unknown as StorageService,
      {} as SectionPlacementService,
    );

    const result = await (
      service as unknown as {
        executeCategory: (
          user: AuthPrincipal,
          category: "DELETE_TEMPORARY_IMPORTS",
          parameters: { beforeDate: string },
        ) => Promise<Record<string, unknown>>;
      }
    ).executeCategory(actor, "DELETE_TEMPORARY_IMPORTS", {
      beforeDate: "2026-08-01T00:00:00.000Z",
    });

    expect(deleteMaintenanceObjects).toHaveBeenCalledTimes(1);
    expect(deleteMaintenanceObjects).toHaveBeenCalledWith([
      "imports/shared.xlsx",
      "imports/job-1-result.json",
      "imports/job-2-pending.json",
    ]);
    expect(deleteMaintenanceObjects.mock.invocationCallOrder[0]!).toBeLessThan(
      deleteJobs.mock.invocationCallOrder[0]!,
    );
    expect(deleteRecords).toHaveBeenCalledWith({
      where: { importJobId: { in: ["job-1", "job-2"] } },
    });
    expect(deleteJobs).toHaveBeenCalledWith({
      where: { id: { in: ["job-1", "job-2"] } },
    });
    expect(result).toEqual({
      importJobs: 2,
      importRows: 2,
      failedAttendanceImports: 0,
      storage: { requested: 3, deleted: 3, failed: 0 },
    });
  });
});
