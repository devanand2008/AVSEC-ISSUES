import { ConfigService } from "@nestjs/config";
import { Workbook } from "exceljs";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

import type { AuthPrincipal } from "../src/common/http/request-context";
import type { CredentialExportRow, ImportRow } from "../src/modules/imports/import.types";
import { ImportsFileService } from "../src/modules/imports/imports-file.service";
import { ImportsService } from "../src/modules/imports/imports.service";

function csvFile(content: string): Express.Multer.File {
  const buffer = Buffer.from(content, "utf8");
  return {
    buffer,
    originalname: "rooms.csv",
    size: buffer.length,
  } as Express.Multer.File;
}

async function workbookFile(
  rows: unknown[][],
  originalname = "staff.xlsx",
): Promise<Express.Multer.File> {
  const workbook = new Workbook();
  workbook.addWorksheet("Users").addRows(rows);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, originalname, size: buffer.length } as Express.Multer.File;
}

async function multiSheetWorkbookFile(
  sheets: Record<string, unknown[][]>,
  originalname = "staff.xlsx",
): Promise<Express.Multer.File> {
  const workbook = new Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    workbook.addWorksheet(name).addRows(rows);
  }
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, originalname, size: buffer.length } as Express.Multer.File;
}

describe("ImportsFileService", () => {
  const service: ImportsFileService = new ImportsFileService(
    new ConfigService({
      S3_BUCKET: "private",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY: "test",
      S3_SECRET_KEY: "test-secret",
      S3_FORCE_PATH_STYLE: true,
    }),
  );

  it("parses a valid room template and normalizes headers", async () => {
    const parsed = await service.parse(
      csvFile(
        "Campus Code,Block Code,Floor Code,Code,Name,Room Type\nMAIN,A,F1,A-101,Classroom 101,CLASSROOM\n",
      ),
      "ROOMS",
    );
    expect(parsed.headers).toContain("campus_code");
    expect(parsed.rows[0]?.code).toBe("A-101");
    expect(parsed.errors).toEqual([]);
  });

  it("returns row-level enum and duplicate errors", async () => {
    const parsed = await service.parse(
      csvFile(
        "campus_code,block_code,floor_code,code,name,room_type\nMAIN,A,F1,A-101,Room one,NOT_A_ROOM\nMAIN,A,F1,A-101,Room two,CLASSROOM\n",
      ),
      "ROOMS",
    );
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rowNumber: 2, field: "room_type" }),
        expect.objectContaining({
          rowNumber: 3,
          message: expect.stringContaining("duplicates row 2") as string,
        }),
      ]),
    );
    expect(parsed.duplicateRowCount).toBe(1);
  });

  it("returns header errors while preserving raw columns for mapping", async () => {
    const parsed = await service.parse(
      csvFile(
        "campus_code,block_code,floor_code,code,name,room_type,password\nMAIN,A,F1,A-101,Room,CLASSROOM,secret\n",
      ),
      "ROOMS",
    );

    expect(parsed.rawHeaders).toContain("password");
    expect(parsed.errors).toContainEqual(
      expect.objectContaining({
        rowNumber: 2,
        message: expect.stringContaining("Unexpected headers: password"),
      }),
    );
  });

  it("skips manually ignored columns", async () => {
    const parsed = await service.parse(
      csvFile(
        "campus_code,block_code,floor_code,code,name,room_type,password\nMAIN,A,F1,A-101,Room,CLASSROOM,secret\n",
      ),
      "ROOMS",
      {
        columnMapping: { password: "__IGNORE__" },
      },
    );

    expect(parsed.headers).not.toContain("password");
    expect(parsed.columnMapping.password).toBe("__IGNORE__");
    expect(parsed.errors).toEqual([]);
  });

  it("accepts XLSX staff sheets with common user column aliases", async () => {
    const parsed = await service.parse(
      await workbookFile([
        [
          "Employee ID",
          "Name",
          "Role",
          "Temporary Password",
          "Mobile Number",
          "Account Status",
        ],
        ["EMP-301", "Nila Raman", "CC", "TempPass@123", "9876543210", "ACTIVE"],
      ]),
      "STAFF",
    );

    expect(parsed.selectedSheetName).toBe("Users");
    expect(parsed.headers).toEqual(
      expect.arrayContaining([
        "employee_id",
        "full_name",
        "role_codes",
        "mobile",
      ]),
    );
    expect(parsed.rows[0]).toMatchObject({
      college_identity_id: "EMP-301",
      role_codes: "CLASS_COORDINATOR",
    });
    expect(parsed.errors).toEqual([]);
  });

  it("parses an explicitly selected workbook sheet", async () => {
    const parsed = await service.parse(
      await multiSheetWorkbookFile({
        Empty: [["Employee ID", "Name", "Role"]],
        Staff: [
          ["Employee ID", "Name", "Role", "Temporary Password"],
          ["EMP-701", "Selected Sheet", "FACULTY", "TempPass@123"],
        ],
      }),
      "STAFF",
      { sheetName: "Staff" },
    );

    expect(parsed.sheetNames).toEqual(["Empty", "Staff"]);
    expect(parsed.selectedSheetName).toBe("Staff");
    expect(parsed.rows[0]).toMatchObject({
      employee_id: "EMP-701",
      full_name: "Selected Sheet",
    });
  });

  it("applies manual column mappings before validation", async () => {
    const parsed = await service.parse(
      csvFile(
        "Worker No,Display Name,User Type,Secret\nEMP-801,Mapped User,Faculty,TempPass@123\n",
      ),
      "STAFF",
      {
        columnMapping: {
          "Worker No": "employee_id",
          "Display Name": "full_name",
          "User Type": "role",
          Secret: "temporary_password",
        },
      },
    );

    expect(parsed.columnMapping["Worker No"]).toBe("employee_id");
    expect(parsed.rows[0]).toMatchObject({
      employee_id: "EMP-801",
      role_codes: "FACULTY",
      college_identity_id: "EMP-801",
    });
    expect(parsed.errors).toEqual([]);
  });

  it("keeps legacy student_id sheets readable while reporting missing canonical fields", async () => {
    const parsed = await service.parse(
      csvFile(
        "student_id,full_name,department_code,programme_code,section,academic_year,temporary_password\nAVS26CSE001,Student Name,CSE,CSE-AIML,A,2026-27,TempPass@123\n",
      ),
      "STUDENTS",
    );

    expect(parsed.headers).toEqual(
      expect.arrayContaining([
        "student_id",
        "full_name",
        "section_code",
        "academic_year",
      ]),
    );
    expect(parsed.rows[0]).toMatchObject({
      college_identity_id: "AVS26CSE001",
      admission_year: "2026",
    });
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "email", message: "email is required." }),
        expect.objectContaining({ field: "register_number", message: "register_number is required." }),
        expect.objectContaining({ field: "year", message: "year is required." }),
        expect.objectContaining({ field: "semester_number", message: "semester_number is required." }),
      ]),
    );
  });

  it("rejects legacy email-only student rows instead of creating profile-less accounts", async () => {
    const parsed = await service.parse(
      csvFile(
        "Student Email,Temporary Password\nBASIC.STUDENT@EXAMPLE.EDU,001234\n",
      ),
      "STUDENTS",
    );

    expect(parsed.headers).toEqual(["email", "temporary_password"]);
    expect(parsed.rows[0]).toMatchObject({
      email: "basic.student@example.edu",
      temporary_password: "001234",
    });
    expect(parsed.rows[0]?.college_identity_id).toBeUndefined();
    expect(parsed.rows[0]?.full_name).toBeUndefined();
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "full_name", message: "full_name is required." }),
        expect.objectContaining({ field: "college_identity_id", message: "college_identity_id is required." }),
        expect.objectContaining({ field: "department_code", message: "department_code is required." }),
        expect.objectContaining({ field: "section_code", message: "section_code is required." }),
      ]),
    );
  });

  it("accepts the basic four-column AVS user workbook and preserves numeric password text", async () => {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet("Basic Users");
    worksheet.addRow(["Name", "Email", "Password", "Department"]);
    worksheet.addRow(["Sample Student", "sample.student@example.edu", "", "CSE-AIML"]);
    worksheet.getCell("C2").value = 1234;
    worksheet.getCell("C2").numFmt = "000000";
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await service.parse(
      { buffer, originalname: "avs-user-import-template.xlsx", size: buffer.length } as Express.Multer.File,
      "USERS",
    );

    expect(parsed.headers).toEqual(["full_name", "email", "temporary_password", "department_code"]);
    expect(parsed.rows[0]).toMatchObject({
      college_identity_id: "sample.student@example.edu",
      full_name: "Sample Student",
      email: "sample.student@example.edu",
      temporary_password: "001234",
      department_code: "CSE-AIML",
    });
    expect(parsed.errors).toEqual([]);
  });

  it("aggregates AVS student sheets with dynamic headers, department mappings, and filename year detection", async () => {
    const workbook = new Workbook();
    const cse = workbook.addWorksheet("CSE");
    cse.addRows([
      ["FIRST NAME", "LAST NAME", "EMAIL ID", "PASSWORD", "/PATH"],
      ["Safe", "Student", "safe.student@avsenggcollege.ac.in", "TempPass@123", "/students/1"],
    ]);
    const mechanical = workbook.addWorksheet("MECH");
    mechanical.addRows([
      [],
      ["FIRST NAME", "LAST NAME", "EMAIL ID", "PASSWORD", "/PATH"],
      ["Second", "Student", "second.student@avsenggcollege.ac.in", "", "/students/2"],
    ]);
    mechanical.getCell("D3").value = 1234;
    mechanical.getCell("D3").numFmt = "000000";
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const parsed = await service.parse(
      {
        buffer,
        originalname: "AVSEC USERS FOR 2RD YEAR.xlsx",
        size: buffer.length,
      } as Express.Multer.File,
      "STUDENTS",
      { departmentMappings: { MECH: "ME" } },
    );

    expect(parsed.selectedSheetName).toBeUndefined();
    expect(parsed.detectedStudyYear).toBe("2");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      full_name: "Safe Student",
      department_code: "CSE",
      year: "2",
      source_sheet: "CSE",
      source_row_number: "2",
    });
    expect(parsed.rows[1]).toMatchObject({
      full_name: "Second Student",
      department_code: "ME",
      temporary_password: "001234",
      source_sheet: "MECH",
      source_row_number: "3",
    });
    expect(parsed.passwordWarnings).toBe(1);
    expect(parsed.sheetInspections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheetName: "CSE", headerRowNumber: 1, rowCount: 1 }),
        expect.objectContaining({ sheetName: "MECH", headerRowNumber: 2, rowCount: 1 }),
      ]),
    );
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("Missing required headers"),
        }),
      ]),
    );
  });

  it("detects cross-sheet duplicate emails and supports skipping both rows", async () => {
    const file = await multiSheetWorkbookFile(
      {
        CSE: [
          ["FIRST NAME", "LAST NAME", "EMAIL ID", "PASSWORD", "/PATH"],
          ["First", "Copy", "duplicate@avsenggcollege.ac.in", "TempPass@123", "/one"],
        ],
        ECE: [
          [],
          ["FIRST NAME", "LAST NAME", "EMAIL ID", "PASSWORD", "/PATH"],
          ["Second", "Copy", "DUPLICATE@avsenggcollege.ac.in", "TempPass@456", "/two"],
        ],
      },
      "THIRD YEAR USERS.xlsx",
    );
    const parsed = await service.parse(file, "STUDENTS", {
      duplicateResolution: "SKIP_ALL",
    });

    expect(parsed.detectedStudyYear).toBe("3");
    expect(parsed.duplicateGroups).toHaveLength(1);
    expect(parsed.duplicateGroups[0]?.locations).toEqual([
      expect.objectContaining({ sheetName: "CSE", sourceRowNumber: 2 }),
      expect.objectContaining({ sheetName: "ECE", sourceRowNumber: 3 }),
    ]);
    expect(new Set(parsed.errors.map((error) => error.rowNumber))).toEqual(
      new Set([2, 3]),
    );
    expect(
      parsed.errors.some((error) => error.message.includes("will be skipped")),
    ).toBe(true);
  });

  it("enforces official domains and rejects inexact numeric password cells without exposing their values", async () => {
    const restrictedService = new ImportsFileService(
      new ConfigService({
        S3_BUCKET: "private",
        S3_ENDPOINT: "http://127.0.0.1:9000",
        S3_REGION: "us-east-1",
        S3_ACCESS_KEY: "test",
        S3_SECRET_KEY: "test-secret",
        S3_FORCE_PATH_STYLE: true,
        OFFICIAL_EMAIL_DOMAINS: "avsenggcollege.ac.in",
      }),
    );
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("CSE");
    sheet.addRows([
      ["FIRST NAME", "LAST NAME", "EMAIL ID", "PASSWORD", "/PATH"],
      ["Wrong", "Domain", "wrong@example.edu", "", "/one"],
    ]);
    sheet.getCell("D2").value = Number.MAX_SAFE_INTEGER + 1;
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await restrictedService.parse(
      {
        buffer,
        originalname: "YEAR 3.xlsx",
        size: buffer.length,
      } as Express.Multer.File,
      "STUDENTS",
    );

    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "email",
          message: expect.stringContaining("official college domain") as string,
        }),
        expect.objectContaining({
          field: "temporary_password",
          message: expect.stringContaining("without losing precision") as string,
        }),
      ]),
    );
    expect(parsed.rows[0]?.temporary_password).toBe("");
    expect(parsed.rows[0]?.password_status).toBe(
      "Password value requires review",
    );
  });

  it("preserves leading-zero student temporary passwords and ignores mailbox passwords", async () => {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet("Second year");
    worksheet.addRow([
      "college_id",
      "register_number",
      "full_name",
      "college_email",
      "temporary_password",
      "department_code",
      "programme_code",
      "academic_year",
      "study_year",
      "semester",
      "section",
      "account_status",
      "email_password",
    ]);
    worksheet.addRow([
      "AVS24CSE009",
      "24CSE009",
      "Leading Zero",
      "leading.zero@example.edu",
      "",
      "CSE",
      "BTECH-CSE",
      "2025-26",
      "2",
      "3",
      "A",
      "ACTIVE",
      "DoNotImportMailboxPassword1!",
    ]);
    worksheet.getCell("E2").value = 1234;
    worksheet.getCell("E2").numFmt = "000000";
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await service.parse(
      {
        buffer,
        originalname: "second-year-students.xlsx",
        size: buffer.length,
      } as Express.Multer.File,
      "STUDENTS",
    );

    expect(parsed.headers).not.toContain("email_password");
    expect(parsed.columnMapping.email_password).toBe("__IGNORE__");
    expect(parsed.rows[0]).toMatchObject({
      college_identity_id: "AVS24CSE009",
      register_number: "24CSE009",
      email: "leading.zero@example.edu",
      temporary_password: "001234",
      admission_year: "2024",
      year: "2",
      semester_number: "3",
      section_code: "A",
    });
    expect(parsed.errors).toEqual([]);
  }, 15_000);

  it("derives third-year admission years from the workbook academic year", async () => {
    const parsed = await service.parse(
      csvFile(
        "college_id,register_number,full_name,college_email,temporary_password,department_code,programme_code,academic_year,study_year,semester,section\nAVS23CSE010,23CSE010,Third Year,third.year@example.edu,000567,CSE,BTECH-CSE,2025-26,THIRD_YEAR,5,B\n",
      ),
      "STUDENTS",
    );

    expect(parsed.rows[0]).toMatchObject({
      temporary_password: "000567",
      admission_year: "2023",
      year: "3",
      semester_number: "5",
      section_code: "B",
    });
    expect(parsed.errors).toEqual([]);
  });

  it("supports the canonical student template headers and keeps register number distinct", async () => {
    const parsed = await service.parse(
      csvFile(
        "full_name,official_email,college_id,register_number,department_code,academic_year,study_year,semester,section,temporary_password,mobile\nCanonical Student,student@college.edu,AVS001,620124104001,AIDS,2026-2027,2,3,B,TempPass@123,9876543210\n",
      ),
      "STUDENTS",
      { departmentMappings: { AIDS: "AI & DS" } },
    );

    expect(parsed.rows[0]).toMatchObject({
      full_name: "Canonical Student",
      email: "student@college.edu",
      college_identity_id: "AVS001",
      student_id: "AVS001",
      register_number: "620124104001",
      department_code: "AI & DS",
      source_department_code: "AIDS",
      academic_year: "2026-2027",
      year: "2",
      semester_number: "3",
      section_code: "B",
      mobile: "9876543210",
    });
    expect(parsed.rows[0]?.roll_number).toBeUndefined();
    expect(parsed.errors).toEqual([]);
  });

  it.each(["1", "8"])(
    "accepts study year %s at the supported boundary",
    async (studyYear) => {
      const parsed = await service.parse(
        csvFile(
          `full_name,official_email,college_id,register_number,department_code,academic_year,study_year,semester,section,temporary_password\nBoundary Student,boundary${studyYear}@college.edu,AVS${studyYear},REG${studyYear},CSE,2026-27,${studyYear},1,A,AvsTemp@2026!\n`,
        ),
        "STUDENTS",
      );

      expect(parsed.rows[0]?.year).toBe(studyYear);
      expect(parsed.errors).toEqual([]);
    },
  );

  it("rejects study years outside 1 through 8", async () => {
    const parsed = await service.parse(
      csvFile(
        "full_name,official_email,college_id,register_number,department_code,academic_year,study_year,semester,section,temporary_password\nInvalid Year,invalid.year@college.edu,AVS9,REG9,CSE,2026-27,9,1,A,AvsTemp@2026!\n",
      ),
      "STUDENTS",
    );

    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "year",
          message: "study_year must be an integer from 1 to 8.",
        }),
      ]),
    );
  });

  it("accepts combined user sheets with separate login and profile IDs", async () => {
    const parsed = await service.parse(
      csvFile(
        "user_id,full_name,email,mobile_number,whatsapp_number,role,department_code,programme_code,academic_year,year,semester,section,employee_or_student_id,temporary_password,account_status\nLOGIN-501,Combined Student,student@example.edu,9876543210,9876543210,Student,CSE,CSE-AIML,2026-27,2,3,A,AVS26CSE501,TempPass@123,ACTIVE\nLOGIN-601,Combined Faculty,faculty@example.edu,9876543211,9876543211,Faculty,CSE,,,,,,EMP-601,TempPass@123,ACTIVE\n",
      ),
      "USERS",
    );

    expect(parsed.headers).toEqual(
      expect.arrayContaining([
        "college_identity_id",
        "employee_or_student_id",
        "role_codes",
        "section_code",
      ]),
    );
    expect(parsed.rows[0]).toMatchObject({
      college_identity_id: "LOGIN-501",
      student_id: "AVS26CSE501",
      role_codes: "STUDENT",
      admission_year: "2026",
    });
    expect(parsed.rows[1]).toMatchObject({
      college_identity_id: "LOGIN-601",
      employee_id: "EMP-601",
      role_codes: "FACULTY",
    });
    expect(parsed.errors).toEqual([]);
  });

  it("rejects weak temporary passwords before processing", async () => {
    const parsed = await service.parse(
      csvFile(
        "employee_id,full_name,role,temporary_password\nEMP-401,Weak Password,FACULTY,password\n",
      ),
      "STAFF",
    );

    expect(parsed.errors).toContainEqual(
      expect.objectContaining({ rowNumber: 2, field: "temporary_password" }),
    );
  });

  it("rejects spreadsheet-injection prefixes in CSV text fields", async () => {
    const parsed = await service.parse(
      csvFile(
        "employee_id,full_name,role,temporary_password\nEMP-402,-Malicious,FACULTY,TempPass@123\n",
      ),
      "STAFF",
    );

    expect(parsed.errors).toContainEqual(
      expect.objectContaining({
        rowNumber: 2,
        field: "full_name",
        message: expect.stringContaining("formula character") as string,
      }),
    );
  });

  it("rejects Excel formulas before previewing rows", async () => {
    const file = await workbookFile(
      [
        ["Employee ID", "Name", "Role", "Temporary Password"],
        ["EMP-302", "Formula User", "FACULTY", "TempPass@123"],
      ],
      "staff.xlsx",
    );
    const workbook = new Workbook();
    await workbook.xlsx.load(
      file.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheet = workbook.getWorksheet("Users");
    if (!sheet) throw new Error("Sheet missing");
    sheet.getCell("A2").value = {
      formula: 'CONCAT("EMP","-302")',
      result: "EMP-302",
    };
    file.buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    file.size = file.buffer.length;

    await expect(service.parse(file, "STAFF")).rejects.toThrow(
      "Excel formulas are not allowed",
    );
  });

  it("enforces the configured upload and row import limits", async () => {
    expect(() =>
      service.validateFile({
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
        originalname: "rooms.csv",
        size: 10 * 1024 * 1024 + 1,
      } as Express.Multer.File),
    ).toThrow("between 1 byte and 10 MB");

    const file = await workbookFile([
      ["Employee ID", "Name", "Role"],
      ...Array.from({ length: 5_001 }, (_, index) => [
        `EMP-${index}`,
        `Staff ${index}`,
        "FACULTY",
      ]),
    ]);
    await expect(service.parse(file, "STAFF")).rejects.toThrow(
      "at most 5000 rows",
    );
  }, 30_000);

  it("accepts legacy XLS files and preserves formatted password text", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Mail ID", "Initial Password"],
      ["legacy.student@example.edu", "001234"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Legacy");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xls" }) as Buffer;
    const file = {
      buffer,
      originalname: "students.xls",
      size: buffer.length,
    } as Express.Multer.File;

    expect(() => service.validateFile(file)).not.toThrow();
    const parsed = await service.parse(file, "STUDENTS");
    expect(parsed.selectedSheetName).toBe("Legacy");
    expect(parsed.rows[0]).toMatchObject({
      email: "legacy.student@example.edu",
      temporary_password: "001234",
    });
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("Missing required headers"),
        }),
      ]),
    );
  });
});

describe("ImportsService Excel workbooks", () => {
  const service = Object.create(ImportsService.prototype) as ImportsService;

  it("previews and confirms the canonical student template without a source student_id column", async () => {
    const files = new ImportsFileService(
      new ConfigService({
        S3_BUCKET: "private",
        S3_ENDPOINT: "http://127.0.0.1:9000",
        S3_REGION: "us-east-1",
        S3_ACCESS_KEY: "test",
        S3_SECRET_KEY: "test",
      }),
    );
    jest.spyOn(files, "saveSource").mockResolvedValue({
      key: "colleges/college-1/imports/source/students.csv",
      sha256: "sha256",
    });
    const createdAt = new Date("2026-08-11T00:00:00.000Z");
    let storedJob: Record<string, unknown> | undefined;
    const prisma = {
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: "department-cse", code: "CSE", name: "Computer Science and Engineering", shortName: "CSE" },
        ]),
      },
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      role: { findMany: jest.fn().mockResolvedValue([]) },
      importJob: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          storedJob = {
            id: "job-1",
            ...data,
            resultStorageKey: null,
            createdAt,
            updatedAt: createdAt,
          };
          return storedJob;
        }),
        findFirst: jest.fn(async () => storedJob),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const handler = { validate: jest.fn().mockResolvedValue([]) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const importService = Object.create(ImportsService.prototype) as ImportsService;
    Object.defineProperties(importService, {
      prisma: { value: prisma },
      files: { value: files },
      handler: { value: handler },
      audit: { value: audit },
      queue: { value: queue },
    });
    const user = {
      id: "admin-1",
      collegeId: "college-1",
      roles: ["MAIN_ADMIN"],
      permissions: ["users.import"],
    } as AuthPrincipal;
    const file = csvFile(
      "full_name,official_email,college_id,register_number,department_code,programme_code,academic_year,study_year,semester,section,temporary_password,mobile\nCanonical Student,canonical.student@college.edu,AVS001,620124104001,CSE,,2026-27,2,3,A,AvsTemp@2026!,9876543210\n",
    );

    const preview = await importService.preview(
      user,
      "STUDENTS",
      file,
      "request-1",
      { importMode: "CREATE_ONLY" },
    );
    expect(preview.job).toMatchObject({ id: "job-1", validRows: 1, errorRows: 0 });
    expect(preview.previewRows[0]?.values).toMatchObject({
      college_identity_id: "AVS001",
      student_id: "AVS001",
      register_number: "620124104001",
    });
    expect(preview.previewRows[0]?.values.temporary_password).toBeUndefined();

    await expect(
      importService.confirm(user, "job-1", "request-2"),
    ).resolves.toEqual({ id: "job-1", status: "QUEUED" });
    expect(queue.add).toHaveBeenCalledWith(
      "process",
      { jobId: "job-1" },
      expect.objectContaining({ jobId: "job-1" }),
    );
  });

  it("does not let a parser-invalid row reserve the last seat during queued processing", async () => {
    const source = Buffer.from("stored student import", "utf8");
    const firstRow = {
      full_name: "Parser Invalid",
      college_identity_id: "AVS001",
      student_id: "AVS001",
      section_code: "A",
    } as ImportRow;
    const secondRow = {
      full_name: "Valid Student",
      college_identity_id: "AVS002",
      student_id: "AVS002",
      section_code: "A",
    } as ImportRow;
    const parserError = {
      rowNumber: 2,
      field: "email",
      message: "official_email is required.",
    };
    const importJob = {
      id: "job-capacity",
      collegeId: "college-1",
      requestedById: "admin-1",
      entityType: "STUDENTS",
      importMode: "CREATE_ONLY",
      selectedSheetName: null,
      columnMapping: null,
      sourceStorageKey: "colleges/college-1/imports/source/students.csv",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      status: "QUEUED",
    };
    const transactionImportUpdate = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      importJob: {
        findUnique: jest.fn().mockResolvedValue(importJob),
        update: jest.fn().mockResolvedValue(undefined),
      },
      $transaction: jest.fn(async (work: (tx: unknown) => Promise<void>) =>
        work({ importJob: { update: transactionImportUpdate } }),
      ),
    };
    const files = {
      loadSource: jest.fn().mockResolvedValue(source),
      parse: jest.fn().mockResolvedValue({
        rows: [firstRow, secondRow],
        errors: [parserError],
      }),
      saveReport: jest.fn().mockResolvedValue(
        "colleges/college-1/imports/results/job-capacity.json",
      ),
      deleteSource: jest.fn().mockResolvedValue(undefined),
    };
    const handler = {
      validate: jest.fn(
        async (
          _entityType: string,
          _collegeId: string,
          rows: ImportRow[],
          _importMode: string,
          preInvalidRows: ReadonlySet<number> = new Set<number>(),
        ) => {
          let reservedSeats = 0;
          return rows.flatMap((_row, index) => {
            const rowNumber = index + 2;
            if (preInvalidRows.has(rowNumber)) return [];
            if (reservedSeats === 1) {
              return [{
                rowNumber,
                field: "section_code",
                message: "Section A is full. Current capacity: 1 / 1. Please select another Section.",
              }];
            }
            reservedSeats += 1;
            return [];
          });
        },
      ),
      create: jest.fn().mockResolvedValue({
        rowNumber: 3,
        model: "User",
        id: "user-2",
        label: "AVS002",
      }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const importService = Object.create(ImportsService.prototype) as ImportsService;
    Object.defineProperties(importService, {
      prisma: { value: prisma },
      files: { value: files },
      handler: { value: handler },
      audit: { value: audit },
    });
    const updateProgress = jest.fn().mockResolvedValue(undefined);
    const process = (importService as unknown as {
      process(job: {
        data: { jobId: string };
        updateProgress(progress: number): Promise<void>;
      }): Promise<void>;
    }).process.bind(importService);

    await process({ data: { jobId: importJob.id }, updateProgress });

    expect(handler.validate).toHaveBeenCalledWith(
      "STUDENTS",
      "college-1",
      [firstRow, secondRow],
      "CREATE_ONLY",
      new Set([2]),
    );
    expect(handler.create).toHaveBeenCalledTimes(1);
    expect(handler.create).toHaveBeenCalledWith(
      "STUDENTS",
      "college-1",
      secondRow,
      3,
      importJob.id,
      "admin-1",
      "CREATE_ONLY",
      { resetExistingPasswords: false },
    );
    expect(files.saveReport).toHaveBeenCalledWith(
      "college-1",
      expect.objectContaining({
        successful: [expect.objectContaining({ rowNumber: 3, id: "user-2" })],
        errors: [parserError],
      }),
    );
  });

  it("resolves only exact configured aliases and exposes unknown departments", () => {
    const mappingPreview = (service as unknown as {
      departmentMappingPreview(
        rows: Array<Partial<ImportRow>>,
        context: {
          mappings: Record<string, string>;
          departments: Array<{ id: string; code: string; name: string; shortName: string | null }>;
        },
      ): {
        mappings: Record<string, string>;
        unresolved: Array<{ sourceCode: string; rowCount: number }>;
      };
    }).departmentMappingPreview.bind(service);
    const departments = [
      { id: "department-aiml", code: "AI & ML", name: "Artificial Intelligence and Machine Learning", shortName: "AI & ML" },
    ];

    const result = mappingPreview(
      [
        { source_department_code: "AI-ML", department_code: "AI & ML" },
        { source_department_code: "Computer Science", department_code: "Computer Science" },
      ],
      { mappings: { AIML: "AI & ML" }, departments },
    );

    expect(result.mappings).toEqual({ "AI-ML": "AI & ML" });
    expect(result.unresolved).toEqual([{ sourceCode: "Computer Science", rowCount: 1 }]);
  });

  it("applies the built-in AI department aliases to ordinary CSV rows without fuzzy matching", async () => {
    const mappingService = Object.create(ImportsService.prototype) as ImportsService;
    Object.defineProperty(mappingService, "prisma", {
      value: {
        department: {
          findMany: jest.fn().mockResolvedValue([
            { id: "department-aids", code: "AI & DS", name: "Artificial Intelligence and Data Science", shortName: "AI & DS" },
            { id: "department-aiml", code: "AI & ML", name: "Artificial Intelligence and Machine Learning", shortName: "AI & ML" },
          ]),
        },
        appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      },
    });
    const context = await (mappingService as unknown as {
      departmentImportContext(
        collegeId: string,
      ): Promise<{ mappings: Record<string, string> }>;
    }).departmentImportContext("college-1");
    const parser = new ImportsFileService(
      new ConfigService({
        S3_BUCKET: "private",
        S3_ENDPOINT: "http://127.0.0.1:9000",
        S3_REGION: "us-east-1",
        S3_ACCESS_KEY: "test",
        S3_SECRET_KEY: "test",
      }),
    );
    const aliases = [
      ["AIDS", "AI & DS"],
      ["AI&DS", "AI & DS"],
      ["AI-DS", "AI & DS"],
      ["AIML", "AI & ML"],
      ["AI&ML", "AI & ML"],
      ["AI-ML", "AI & ML"],
    ] as const;

    for (const [source, expected] of aliases) {
      const parsed = await parser.parse(
        csvFile(
          `full_name,official_email,college_id,register_number,department_code,academic_year,study_year,semester,section,temporary_password\nAlias Student,alias.${source.replace(/[^a-z]/gi, "").toLowerCase()}@college.edu,ID${source.replace(/[^a-z]/gi, "")},REG${source.replace(/[^a-z]/gi, "")},${source},2026-27,2,3,A,AvsTemp@2026!\n`,
        ),
        "STUDENTS",
        { departmentMappings: context.mappings },
      );
      expect(parsed.rows[0]).toMatchObject({
        source_department_code: source,
        department_code: expected,
      });
      expect(parsed.errors).toEqual([]);
    }
  });

  it("generates the canonical student data-entry template", async () => {
    const result = await service.template(
      { permissions: ["users.import"] } as AuthPrincipal,
      "STUDENTS",
    );
    const workbook = new Workbook();
    await workbook.xlsx.load(
      result.content as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const worksheet = workbook.getWorksheet("Template");
    const headers = worksheet?.getRow(1).values as string[] | undefined;

    expect(headers?.slice(1)).toEqual([
      "full_name",
      "official_email",
      "college_id",
      "register_number",
      "department_code",
      "academic_year",
      "study_year",
      "semester",
      "section",
      "temporary_password",
      "mobile",
    ]);
    expect(worksheet?.getCell("J2").text).toBe("AvsTemp@2026!");
  });

  it("generates a readable XLSX template with required and example rows", async () => {
    const result = await service.template(
      { permissions: ["users.import"] } as AuthPrincipal,
      "STAFF",
    );
    const workbook = new Workbook();
    await workbook.xlsx.load(
      result.content as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const worksheet = workbook.getWorksheet("Template");

    expect(result.fileName).toBe("staff-import-template.xlsx");
    expect(worksheet?.getCell("A1").text).toBe("full_name");
    expect(worksheet?.getCell("A2").text).toBe("Sample Faculty One");
  });

  it("generates formula-safe confidential credential workbooks", async () => {
    const rows: CredentialExportRow[] = [
      {
        rowNumber: 2,
        userId: "00000000-0000-0000-0000-000000000001",
        fullName: "Formula Safe",
        role: "FACULTY",
        loginId: "=HYPERLINK(\"https://example.invalid\")",
        temporaryPassword: "+Temporary@123",
        firstLoginRequired: true,
      },
    ];
    const content = await (
      service as unknown as {
        credentialWorkbook(values: CredentialExportRow[]): Promise<Buffer>;
      }
    ).credentialWorkbook(rows);
    const workbook = new Workbook();
    await workbook.xlsx.load(
      content as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const worksheet = workbook.getWorksheet("Credentials");

    expect(worksheet?.getCell("D6").text).toBe(
      "'=HYPERLINK(\"https://example.invalid\")",
    );
    expect(worksheet?.getCell("E6").text).toBe("'+Temporary@123");
    expect(worksheet?.getCell("F6").text).toBe("true");
  });
});
