import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { PrismaService } from "../src/database/prisma.service";
import type { SectionPlacementService } from "../src/modules/academic/section-placement.service";
import type {
  ImportMode,
  ImportedRecord,
  ImportRow,
} from "../src/modules/imports/import.types";
import { ImportsHandlerService } from "../src/modules/imports/imports-handler.service";

const peopleRow = (overrides: Partial<ImportRow> = {}): ImportRow =>
  ({
    full_name: "Arun Kumar",
    college_identity_id: "AVS001",
    student_id: "AVS001",
    email: "arun.kumar@avsenggcollege.ac.in",
    temporary_password: "Strong!Pass123",
    department_code: "CSE",
    year: "2",
    class_room_number: "CSE-201",
    mobile: "9876543210",
    account_status: "ACTIVE",
    role_codes: "STUDENT",
    ...overrides,
  }) as ImportRow;

describe("ImportsHandlerService People import", () => {
  it("uses the same tenant official-domain policy during transactional validation", () => {
    const service = new ImportsHandlerService(
      {} as PrismaService,
      new ConfigService({
        PASSWORD_PEPPER: "test-only-pepper",
        OFFICIAL_EMAIL_DOMAINS: "global.example.edu",
      }),
      {} as SectionPlacementService,
    );
    const assertPeopleCoreFields = (
      service as unknown as {
        assertPeopleCoreFields(
          row: ImportRow,
          domains?: readonly string[],
        ): void;
      }
    ).assertPeopleCoreFields.bind(service);
    const tenantRow = peopleRow({ email: "student@tenant.example.edu" });

    expect(() =>
      assertPeopleCoreFields(tenantRow, ["tenant.example.edu"]),
    ).not.toThrow();
    expect(() =>
      assertPeopleCoreFields(tenantRow, ["different.example.edu"]),
    ).toThrow("approved college domain");
  });

  it("validates 1000 same-class rows with seven set-based database queries", async () => {
    const rows = Array.from({ length: 1_000 }, (_, index) =>
      peopleRow({
        college_identity_id: `SCALE${String(index + 1).padStart(4, "0")}`,
        student_id: `SCALE${String(index + 1).padStart(4, "0")}`,
        source_row_number: String(index + 2),
      }),
    );
    const roleFindMany = jest.fn().mockResolvedValue([{ id: "role-student" }]);
    const userFindMany = jest.fn().mockResolvedValue([]);
    const profileFindMany = jest.fn().mockResolvedValue([]);
    const departmentFindMany = jest.fn().mockResolvedValue([
      {
        id: "department-1",
        code: "CSE",
        name: "Computer Science and Engineering",
        shortName: "CSE",
      },
    ]);
    const roomFindMany = jest.fn().mockResolvedValue([
      {
        id: "room-1",
        code: "CSE-201",
        roomNumber: "201",
        departmentId: "department-1",
      },
    ]);
    const sectionFindMany = jest.fn().mockResolvedValue([
      {
        id: "section-1",
        code: "A",
        capacity: 1_000,
        studyYear: 2,
        assignedRoomId: "room-1",
        semester: {
          number: 3,
          academicYearId: "academic-year-1",
          programmeId: "programme-1",
          programme: { departmentId: "department-1" },
        },
      },
    ]);
    const membershipGroupBy = jest.fn().mockResolvedValue([]);
    const prisma = {
      role: { findMany: roleFindMany },
      user: { findMany: userFindMany },
      studentProfile: { findMany: profileFindMany },
      department: { findMany: departmentFindMany },
      room: { findMany: roomFindMany },
      section: { findMany: sectionFindMany },
      sectionMembership: { groupBy: membershipGroupBy },
    };
    const service = new ImportsHandlerService(
      prisma as unknown as PrismaService,
      new ConfigService({ PASSWORD_PEPPER: "test-only-pepper" }),
      {} as SectionPlacementService,
    );

    await expect(
      service.validate("PEOPLE", "college-1", rows, "CREATE_ONLY"),
    ).resolves.toEqual([]);

    const queryMocks = [
      roleFindMany,
      userFindMany,
      profileFindMany,
      departmentFindMany,
      roomFindMany,
      sectionFindMany,
      membershipGroupBy,
    ];
    expect(queryMocks.map((mock) => mock.mock.calls.length)).toEqual([
      1, 1, 1, 1, 1, 1, 1,
    ]);
    expect(
      queryMocks.reduce((total, mock) => total + mock.mock.calls.length, 0),
    ).toBe(7);
  });

  it("creates ten People rows in one bounded Serializable transaction", async () => {
    const tx = {};
    const sectionPlacement = {
      transaction: jest.fn(
        async (work: (client: typeof tx) => Promise<ImportedRecord[]>) =>
          work(tx),
      ),
    };
    const service = new ImportsHandlerService(
      {} as PrismaService,
      new ConfigService({ PASSWORD_PEPPER: "test-only-pepper" }),
      sectionPlacement as unknown as SectionPlacementService,
    );
    const hashTemporaryPassword = jest
      .spyOn(
        service as unknown as {
          hashTemporaryPassword(password: string): Promise<string>;
        },
        "hashTemporaryPassword",
      )
      .mockResolvedValue("$argon2id$prepared-batch-hash");
    const createInTransaction = jest
      .spyOn(
        service as unknown as {
          createInTransaction(...args: unknown[]): Promise<ImportedRecord>;
        },
        "createInTransaction",
      )
      .mockImplementation(async (...args: unknown[]) => ({
        rowNumber: args[4] as number,
        model: "User",
        id: "00000000-0000-4000-8000-000000000070",
        label: "Imported person",
      }));
    const batch = Array.from({ length: 10 }, (_, index) => ({
      row: peopleRow({
        college_identity_id: `BATCH${index + 1}`,
        student_id: `BATCH${index + 1}`,
      }),
      rowNumber: index + 2,
    }));

    await expect(
      service.createPeopleBatch(
        "college-1",
        batch,
        "00000000-0000-4000-8000-000000000071",
        "admin-1",
      ),
    ).resolves.toHaveLength(10);
    expect(hashTemporaryPassword).toHaveBeenCalledTimes(10);
    expect(sectionPlacement.transaction).toHaveBeenCalledTimes(1);
    expect(createInTransaction).toHaveBeenCalledTimes(10);
    for (const call of createInTransaction.mock.calls) {
      expect(call[0]).toBe(tx);
      expect(call[9]).toBe("$argon2id$prepared-batch-hash");
    }
  });

  it("prepares bounded People hashes before opening the transaction or writing", async () => {
    const events: string[] = [];
    const tx = {};
    const sectionPlacement = {
      transaction: jest.fn(
        async (work: (client: typeof tx) => Promise<ImportedRecord[]>) => {
          events.push("transaction");
          return work(tx);
        },
      ),
    };
    const service = new ImportsHandlerService(
      {} as PrismaService,
      new ConfigService({ PASSWORD_PEPPER: "test-only-pepper" }),
      sectionPlacement as unknown as SectionPlacementService,
    );
    jest
      .spyOn(
        service as unknown as {
          hashTemporaryPassword(password: string): Promise<string>;
        },
        "hashTemporaryPassword",
      )
      .mockImplementation(async (password) => {
        events.push(`hash:${password}`);
        return `$argon2id$prepared-${events.length}`;
      });
    const createInTransaction = jest
      .spyOn(
        service as unknown as {
          createInTransaction(...args: unknown[]): Promise<ImportedRecord>;
        },
        "createInTransaction",
      )
      .mockImplementation(async (...args) => {
        events.push(`write:${String(args[4])}`);
        return {
          rowNumber: args[4] as number,
          model: "User",
          id: "00000000-0000-4000-8000-000000000072",
          label: "Imported person",
        };
      });
    const batch = [
      {
        row: peopleRow({ temporary_password: "001234567890" }),
        rowNumber: 2,
      },
      {
        row: peopleRow({
          college_identity_id: "AVS002",
          student_id: "AVS002",
          temporary_password: "Second!Pass123",
        }),
        rowNumber: 3,
      },
    ];

    const records = await service.createPeopleBatch(
      "college-1",
      batch,
      "00000000-0000-4000-8000-000000000073",
      "admin-1",
    );

    expect(events).toEqual([
      "hash:001234567890",
      "hash:Second!Pass123",
      "transaction",
      "write:2",
      "write:3",
    ]);
    expect(createInTransaction.mock.calls.map((call) => call[9])).toEqual([
      "$argon2id$prepared-1",
      "$argon2id$prepared-2",
    ]);
    expect(JSON.stringify(records)).not.toContain("$argon2id$");
  });

  it("revalidates the People password policy before using a prepared hash", async () => {
    const service = new ImportsHandlerService(
      {} as PrismaService,
      new ConfigService({ PASSWORD_PEPPER: "test-only-pepper" }),
      {} as SectionPlacementService,
    );
    const createInTransaction = (
      service as unknown as {
        createInTransaction(...args: unknown[]): Promise<ImportedRecord>;
      }
    ).createInTransaction.bind(service);

    await expect(
      createInTransaction(
        {},
        "PEOPLE",
        "college-1",
        peopleRow({ temporary_password: "weak" }),
        2,
        "00000000-0000-4000-8000-000000000074",
        "admin-1",
        "CREATE_ONLY",
        {},
        "$argon2id$must-not-be-used",
      ),
    ).rejects.toThrow("Numeric-only college temporary passwords are allowed");
  });

  it("creates an Argon2 credential and leaves the imported profile in the completion workflow", async () => {
    const row = peopleRow();
    const userCreate = jest
      .fn()
      .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: "00000000-0000-4000-8000-000000000011",
          publicId: "00000000-0000-4000-8000-000000000012",
          collegeIdentityId: row.college_identity_id,
          fullName: row.full_name,
          data,
        }),
      );
    const tx = {
      role: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "role-student", code: "STUDENT" }]),
      },
      studentProfile: { findFirst: jest.fn().mockResolvedValue(null) },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: userCreate,
      },
      department: {
        findFirst: jest.fn().mockResolvedValue({
          id: "department-1",
          code: "CSE",
          name: "Computer Science and Engineering",
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "department-1",
            code: "CSE",
            name: "Computer Science and Engineering",
          },
        ]),
      },
      room: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "room-1",
            code: "CSE-201",
            roomNumber: "201",
            departmentId: "department-1",
          },
        ]),
      },
      section: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "section-1",
            code: "A",
            capacity: 70,
            semesterId: "semester-3",
            semester: {
              academicYearId: "academic-year-1",
              academicYear: {
                startsOn: new Date("2026-06-01T00:00:00.000Z"),
              },
              programmeId: "programme-1",
            },
          },
        ]),
      },
    };
    const sectionPlacement = {
      placeStudent: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ImportsHandlerService(
      {} as PrismaService,
      new ConfigService({ PASSWORD_PEPPER: "test-only-pepper" }),
      sectionPlacement as unknown as SectionPlacementService,
    );
    const createUser = (
      service as unknown as {
        createUser(
          client: typeof tx,
          collegeId: string,
          value: ImportRow,
          rowNumber: number,
          kind: "PEOPLE",
          importMode: ImportMode,
          importJobId: string,
          options: Record<string, never>,
        ): Promise<ImportedRecord>;
      }
    ).createUser.bind(service);

    const record = await createUser(
      tx,
      "college-1",
      row,
      2,
      "PEOPLE",
      "CREATE_ONLY",
      "00000000-0000-4000-8000-000000000013",
      {},
    );

    const createData = userCreate.mock.calls[0]?.[0]?.data as {
      mustChangePassword: boolean;
      firstLoginCompletedAt?: Date;
      profileCompletionStatus: string;
      profileCompletionPercentage: number;
      profileSubmittedAt?: Date;
      credential: {
        create: { passwordHash: string; passwordChangedAt: Date | null };
      };
    };
    expect(createData).toMatchObject({
      mustChangePassword: true,
      profileCompletionStatus: "NOT_STARTED",
      profileCompletionPercentage: 0,
      credential: { create: { passwordChangedAt: null } },
    });
    expect(createData.firstLoginCompletedAt).toBeUndefined();
    expect(createData.profileSubmittedAt).toBeUndefined();
    expect(createData.credential.create.passwordHash).toMatch(/^\$argon2id\$/);
    expect(createData.credential.create.passwordHash).not.toContain(
      row.temporary_password,
    );
    expect(sectionPlacement.placeStudent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        sectionId: "section-1",
        profile: expect.objectContaining({
          departmentId: "department-1",
          programmeId: "programme-1",
          academicYearId: "academic-year-1",
          semesterId: "semester-3",
          studentId: "AVS001",
          studyYear: 2,
          admissionYear: 2025,
        }),
      }),
    );
    const placement = sectionPlacement.placeStudent.mock.calls[0]?.[1];
    expect(placement.profile).toMatchObject({
      dateOfBirth: undefined,
      gender: undefined,
      bloodGroup: undefined,
      address: undefined,
      parentName: undefined,
      parentMobileNumber: undefined,
    });
    expect(record.credential).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain(row.temporary_password);
  });

  it.each([
    ["1", 2026],
    ["2", 2025],
    ["3", 2024],
    ["4", 2023],
  ])(
    "derives Year %s admission year from the active academic-year start",
    async (year, expectedAdmissionYear) => {
      const placeStudent = jest.fn().mockResolvedValue(undefined);
      const service = new ImportsHandlerService(
        {} as PrismaService,
        new ConfigService({ PASSWORD_PEPPER: "test-only-pepper" }),
        { placeStudent } as unknown as SectionPlacementService,
      );
      const placeImportedStudent = (
        service as unknown as {
          placeImportedStudent(
            tx: object,
            collegeId: string,
            userId: string,
            accountStatus: string,
            selection: Record<string, unknown>,
            row: ImportRow,
            deriveAdmissionYear?: boolean,
          ): Promise<void>;
        }
      ).placeImportedStudent.bind(service);

      await placeImportedStudent(
        {},
        "college-1",
        "00000000-0000-4000-8000-000000000011",
        "ACTIVE",
        {
          departmentId: "department-1",
          programmeId: "programme-1",
          sectionId: "section-1",
          academicYearId: "academic-year-1",
          academicYearStartsOn: new Date("2026-06-01T00:00:00.000Z"),
          semesterId: `semester-${year}`,
          sectionCode: "A",
          capacity: 70,
        },
        peopleRow({ year }),
        true,
      );

      expect(placeStudent).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          profile: expect.objectContaining({
            studyYear: Number(year),
            admissionYear: expectedAdmissionYear,
          }),
        }),
      );
    },
  );

  it("records a password-free audit event for every imported person", async () => {
    const row = peopleRow();
    const tx = {
      importJobRecord: { create: jest.fn().mockResolvedValue(undefined) },
    };
    const sectionPlacement = {
      transaction: jest.fn(
        async (work: (client: typeof tx) => Promise<ImportedRecord>) =>
          work(tx),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ImportsHandlerService(
      {} as PrismaService,
      new ConfigService({ PASSWORD_PEPPER: "test-only-pepper" }),
      sectionPlacement as unknown as SectionPlacementService,
      audit as never,
    );
    jest
      .spyOn(
        service as unknown as {
          createUser(...args: unknown[]): Promise<ImportedRecord>;
        },
        "createUser",
      )
      .mockResolvedValue({
        rowNumber: 7,
        model: "User",
        id: "00000000-0000-4000-8000-000000000020",
        label: "AVS001 - Arun Kumar",
      });

    await service.create(
      "PEOPLE",
      "college-1",
      row,
      7,
      "00000000-0000-4000-8000-000000000021",
      "admin-1",
      "CREATE_ONLY",
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "admin-1",
        action: "person.imported",
        entityType: "User",
        afterValue: {
          importJobId: "00000000-0000-4000-8000-000000000021",
          rowNumber: 7,
          collegeIdentityId: "AVS001",
          department: "CSE",
          studyYear: "2",
          classroom: "CSE-201",
        },
      }),
      tx,
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
      row.temporary_password,
    );
  });

  it("redacts a supplied password from row-validation exception text", () => {
    const row = peopleRow();
    const service = new ImportsHandlerService(
      {} as PrismaService,
      new ConfigService({ PASSWORD_PEPPER: "test-only-pepper" }),
      {} as SectionPlacementService,
    );
    const errorMessage = (
      service as unknown as {
        errorMessage(error: unknown, value: ImportRow): string;
      }
    ).errorMessage.bind(service);

    expect(
      errorMessage(
        new BadRequestException(`Rejected value ${row.temporary_password}`),
        row,
      ),
    ).toBe("Rejected value [REDACTED]");
  });
});
