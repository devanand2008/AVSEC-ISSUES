import { ConfigService } from "@nestjs/config";

import type { PrismaService } from "../src/database/prisma.service";
import type { SectionPlacementService } from "../src/modules/academic/section-placement.service";
import type { ImportMode, ImportRow, ImportRowError, ImportedRecord } from "../src/modules/imports/import.types";
import { ImportsFileService } from "../src/modules/imports/imports-file.service";
import { ImportsHandlerService } from "../src/modules/imports/imports-handler.service";

const academicRow = (overrides: Partial<ImportRow> = {}): ImportRow => ({
  full_name: "Test Student",
  email: "test.student@college.edu",
  college_identity_id: "AVS001",
  student_id: "AVS001",
  register_number: "620124104001",
  temporary_password: "TempPass@123",
  department_code: "CSE",
  programme_code: "",
  academic_year: "2026-2027",
  year: "2",
  semester_number: "3",
  section_code: "A",
  admission_year: "2025",
  account_status: "ACTIVE",
  ...overrides,
} as ImportRow);

function academicLookupMocks(capacity = 70) {
  return {
    department: {
      findFirst: jest.fn().mockResolvedValue({ id: "department-1", code: "CSE", name: "Computer Science and Engineering" }),
    },
    programme: {
      findMany: jest.fn().mockResolvedValue([{ id: "programme-1", code: "BTECH-CSE" }]),
    },
    academicYear: {
      findMany: jest.fn().mockResolvedValue([{ id: "year-1", name: "2026-27" }]),
    },
    semester: {
      findUnique: jest.fn().mockResolvedValue({ id: "semester-1", isActive: true }),
    },
    section: {
      findUnique: jest.fn().mockResolvedValue({ id: "section-1", code: "A", capacity, isActive: true, archivedAt: null }),
      findFirst: jest.fn().mockResolvedValue({ code: "A", capacity }),
    },
  };
}

describe("ImportsHandlerService student academic import", () => {
  it("infers a single active programme and persists register number plus membership academic year", async () => {
    const fileService = new ImportsFileService(
      new ConfigService({
        S3_BUCKET: "private",
        S3_ENDPOINT: "http://127.0.0.1:9000",
        S3_REGION: "us-east-1",
        S3_ACCESS_KEY: "test",
        S3_SECRET_KEY: "test",
      }),
    );
    const parsed = await fileService.parse(
      {
        buffer: Buffer.from(
          "full_name,official_email,college_id,register_number,department_code,programme_code,academic_year,study_year,semester,section,temporary_password,mobile\nTest Student,test.student@college.edu,AVS001,620124104001,CSE,,2026-2027,2,3,A,TempPass@123,9876543210\n",
        ),
        originalname: "students.csv",
        mimetype: "text/csv",
        size: 1,
      } as Express.Multer.File,
      "STUDENTS",
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]?.student_id).toBe("AVS001");

    const academic = academicLookupMocks();
    const tx = {
      ...academic,
      role: { findMany: jest.fn().mockResolvedValue([{ id: "role-student", code: "STUDENT" }]) },
      studentProfile: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      sectionMembership: { count: jest.fn().mockResolvedValue(0) },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "user-1", publicId: "public-user-1", collegeIdentityId: "AVS001", fullName: "Test Student" }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const sectionPlacement = {
      placeStudent: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ImportsHandlerService(
      {} as PrismaService,
      new ConfigService({ PASSWORD_PEPPER: "test-pepper" }),
      sectionPlacement as unknown as SectionPlacementService,
    );
    const createUser = (service as unknown as {
      createUser(
        client: typeof tx,
        collegeId: string,
        row: ImportRow,
        rowNumber: number,
        kind: "STUDENT",
        importMode: ImportMode,
        importJobId: string,
        options: Record<string, never>,
      ): Promise<ImportedRecord>;
    }).createUser.bind(service);

    await createUser(tx, "college-1", parsed.rows[0]!, 2, "STUDENT", "CREATE_ONLY", "job-1", {});

    expect(sectionPlacement.placeStudent).toHaveBeenCalledWith(tx, expect.objectContaining({
      sectionId: "section-1",
      profile: expect.objectContaining({
        registerNumber: "620124104001",
        departmentId: "department-1",
        programmeId: "programme-1",
        academicYearId: "year-1",
        semesterId: "semester-1",
      }),
    }));
    expect(academic.programme.findMany.mock.calls[0]?.[0]?.where.code).toBeUndefined();
  });

  it("accepts every Engineering study year from 1 through 4", () => {
    const service = new ImportsHandlerService(
      {} as PrismaService,
      new ConfigService({ PASSWORD_PEPPER: "test-pepper" }),
      {} as SectionPlacementService,
    );
    const importStudyYear = (service as unknown as {
      importStudyYear(value: string): number;
    }).importStudyYear.bind(service);

    expect(Array.from({ length: 4 }, (_, index) => importStudyYear(String(index + 1)))).toEqual([1, 2, 3, 4]);
    for (const invalid of ["5", "8", "9"]) {
      expect(() => importStudyYear(invalid)).toThrow("study_year must be an integer from 1 to 4.");
    }
  });

  it("marks rows beyond the remaining seats invalid during preview", async () => {
    const academic = academicLookupMocks(1);
    const prisma = {
      ...academic,
      studentProfile: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      sectionMembership: { count: jest.fn().mockResolvedValue(0) },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
      },
    };
    const service = new ImportsHandlerService(
      prisma as unknown as PrismaService,
      new ConfigService({ PASSWORD_PEPPER: "test-pepper" }),
      {} as SectionPlacementService,
    );
    const validateCapacity = (service as unknown as {
      validateStudentBatchCapacity(
        collegeId: string,
        rows: ImportRow[],
        mode: ImportMode,
        invalidRows: Set<number>,
      ): Promise<ImportRowError[]>;
    }).validateStudentBatchCapacity.bind(service);

    const errors = await validateCapacity(
      "college-1",
      [academicRow(), academicRow({ college_identity_id: "AVS002", student_id: "AVS002", register_number: "620124104002", email: "student2@college.edu" })],
      "CREATE_ONLY",
      new Set(),
    );

    expect(errors).toEqual([
      expect.objectContaining({
        rowNumber: 3,
        field: "section_code",
        message: "Section A is full. Current capacity: 1 / 1. Please select another Section.",
      }),
    ]);
  });

  it("does not let an already-invalid row reserve a section seat", async () => {
    const academic = academicLookupMocks(1);
    const prisma = {
      ...academic,
      studentProfile: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      sectionMembership: { count: jest.fn().mockResolvedValue(0) },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
      },
    };
    const service = new ImportsHandlerService(
      prisma as unknown as PrismaService,
      new ConfigService({ PASSWORD_PEPPER: "test-pepper" }),
      {} as SectionPlacementService,
    );
    const validateCapacity = (service as unknown as {
      validateStudentBatchCapacity(
        collegeId: string,
        rows: ImportRow[],
        mode: ImportMode,
        invalidRows: Set<number>,
      ): Promise<ImportRowError[]>;
    }).validateStudentBatchCapacity.bind(service);

    const errors = await validateCapacity(
      "college-1",
      [academicRow(), academicRow({ college_identity_id: "AVS002", student_id: "AVS002", register_number: "620124104002", email: "student2@college.edu" })],
      "CREATE_ONLY",
      new Set([2]),
    );

    expect(errors).toEqual([]);
    expect(prisma.sectionMembership.count).toHaveBeenCalledTimes(1);
  });

  it("removes placement membership and scope before rolling back an imported student", async () => {
    const tx = {
      classCoordinatorAssignment: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      classRepresentativeAssignment: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      facultySubjectAssignment: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      sectionMembership: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userScope: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      studentProfile: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      staffProfile: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      user: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<void>) => work(tx)),
    };
    const service = new ImportsHandlerService(
      prisma as unknown as PrismaService,
      new ConfigService({ PASSWORD_PEPPER: "test-pepper" }),
      {} as SectionPlacementService,
    );

    await service.rollback("college-1", [
      { rowNumber: 2, model: "User", id: "user-1", label: "AVS001" },
    ]);

    expect(tx.sectionMembership.deleteMany).toHaveBeenCalledWith({
      where: { studentUserId: "user-1" },
    });
    expect(tx.userScope.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(tx.sectionMembership.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.user.deleteMany.mock.invocationCallOrder[0]!,
    );
  });
});
