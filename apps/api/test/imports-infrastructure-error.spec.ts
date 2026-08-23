import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { PrismaService } from "../src/database/prisma.service";
import type { SectionPlacementService } from "../src/modules/academic/section-placement.service";
import {
  isRetryableImportInfrastructureError,
  RetryableImportInfrastructureError,
} from "../src/modules/imports/import-infrastructure-error";
import type {
  ImportEntityType,
  ImportMode,
  ImportRow,
  ImportRowError,
} from "../src/modules/imports/import.types";
import { ImportsHandlerService } from "../src/modules/imports/imports-handler.service";

const COLLEGE_ID = "00000000-0000-4000-8000-000000000201";

interface PrivateImportsHandler {
  validateUserRow(
    entityType: ImportEntityType,
    collegeId: string,
    row: ImportRow,
    importMode: ImportMode,
  ): Promise<void>;
  assertPeopleCoreFields(row: ImportRow): void;
  resolveStudentAcademicData(
    client: unknown,
    collegeId: string,
    row: ImportRow,
  ): Promise<unknown>;
  validateStudentBatchCapacity(
    collegeId: string,
    rows: ImportRow[],
    importMode: ImportMode,
    invalidRows: Set<number>,
    entityType: "PEOPLE" | "STUDENTS",
  ): Promise<ImportRowError[]>;
}

function createHandler(): ImportsHandlerService {
  return new ImportsHandlerService(
    {} as PrismaService,
    new ConfigService({ PASSWORD_PEPPER: "test-only-pepper" }),
    {} as SectionPlacementService,
  );
}

describe("import infrastructure error classification", () => {
  it("recognizes retryable Prisma and network error codes", () => {
    for (const code of [
      "P1001",
      "P1002",
      "P1008",
      "P1017",
      "P2024",
      "P2028",
      "P2034",
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENETDOWN",
      "ENETUNREACH",
    ]) {
      expect(isRetryableImportInfrastructureError({ code })).toBe(true);
    }
  });

  it("recognizes explicit and AWS retry signals", () => {
    expect(
      isRetryableImportInfrastructureError(
        new RetryableImportInfrastructureError("retry later"),
      ),
    ).toBe(true);
    expect(isRetryableImportInfrastructureError({ name: "TimeoutError" })).toBe(
      true,
    );
    expect(
      isRetryableImportInfrastructureError({
        $retryable: { throttling: true },
      }),
    ).toBe(true);
    expect(
      isRetryableImportInfrastructureError({
        $metadata: { httpStatusCode: 429 },
      }),
    ).toBe(true);
    expect(
      isRetryableImportInfrastructureError({
        $metadata: { httpStatusCode: 503 },
      }),
    ).toBe(true);
  });

  it("does not retry domain, constraint, or client-side storage errors", () => {
    expect(
      isRetryableImportInfrastructureError(new BadRequestException("bad row")),
    ).toBe(false);
    expect(isRetryableImportInfrastructureError({ code: "P2002" })).toBe(false);
    expect(
      isRetryableImportInfrastructureError({
        $retryable: null,
        $metadata: { httpStatusCode: 400 },
      }),
    ).toBe(false);
  });
});

describe("ImportsHandlerService validation retry propagation", () => {
  it("rethrows retryable failures from generic row validation", async () => {
    const handler = createHandler();
    const privateHandler = handler as unknown as PrivateImportsHandler;
    const failure = Object.assign(new Error("database unavailable"), {
      code: "P1001",
    });
    jest
      .spyOn(privateHandler, "validateUserRow")
      .mockRejectedValueOnce(failure);

    await expect(
      handler.validate(
        "USERS",
        COLLEGE_ID,
        [{ college_identity_id: "AVS001" } as ImportRow],
        "CREATE_ONLY",
      ),
    ).rejects.toBe(failure);
  });

  it("continues returning deterministic row validation errors", async () => {
    const handler = createHandler();
    const privateHandler = handler as unknown as PrivateImportsHandler;
    jest
      .spyOn(privateHandler, "validateUserRow")
      .mockRejectedValueOnce(new BadRequestException("Invalid department"));

    await expect(
      handler.validate(
        "USERS",
        COLLEGE_ID,
        [{ college_identity_id: "AVS002" } as ImportRow],
        "CREATE_ONLY",
      ),
    ).resolves.toEqual([
      expect.objectContaining({ rowNumber: 2, message: "Invalid department" }),
    ]);
  });

  it("rethrows retryable failures from People core validation catches", async () => {
    const handler = createHandler();
    const privateHandler = handler as unknown as PrivateImportsHandler;
    const failure = Object.assign(new Error("connection pool exhausted"), {
      code: "P2024",
    });
    jest
      .spyOn(privateHandler, "assertPeopleCoreFields")
      .mockImplementationOnce(() => {
        throw failure;
      });

    await expect(
      handler.validate("PEOPLE", COLLEGE_ID, [{} as ImportRow], "CREATE_ONLY"),
    ).rejects.toBe(failure);
  });

  it("rethrows retryable failures from student capacity validation", async () => {
    const handler = createHandler();
    const privateHandler = handler as unknown as PrivateImportsHandler;
    const failure = Object.assign(new Error("transaction expired"), {
      code: "P2028",
    });
    jest
      .spyOn(privateHandler, "resolveStudentAcademicData")
      .mockRejectedValueOnce(failure);

    await expect(
      privateHandler.validateStudentBatchCapacity(
        COLLEGE_ID,
        [{ section_code: "SEC-A" } as ImportRow],
        "CREATE_ONLY",
        new Set<number>(),
        "STUDENTS",
      ),
    ).rejects.toBe(failure);
  });
});
