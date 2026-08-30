import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Workbook } from "exceljs";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

import type { AuthPrincipal } from "../src/common/http/request-context";
import { RoomType } from "../src/generated/prisma/enums";
import {
  importRowNumber,
  type CredentialExportRow,
  type ImportRow,
} from "../src/modules/imports/import.types";
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

  it("rejects cross-tenant and nested import source cleanup keys", async () => {
    await expect(
      service.deleteSource(
        "college-1",
        "colleges/college-2/imports/source/people.xlsx",
      ),
    ).rejects.toThrow(
      "The import source is outside the authorized college storage path.",
    );
    await expect(
      service.deleteSource(
        "college-1",
        "colleges/college-1/imports/source/nested/people.xlsx",
      ),
    ).rejects.toThrow(BadRequestException);
  });

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

  it("accepts every current Prisma room type", async () => {
    const rows = Object.values(RoomType).map(
      (roomType, index) =>
        `MAIN,A,F1,A-${index + 1},Room ${index + 1},${roomType}`,
    );
    const parsed = await service.parse(
      csvFile(
        ["campus_code,block_code,floor_code,code,name,room_type", ...rows].join(
          "\n",
        ),
      ),
      "ROOMS",
    );

    expect(parsed.rows.map((row) => row.room_type)).toEqual(
      Object.values(RoomType),
    );
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
        expect.objectContaining({
          field: "email",
          message: "email is required.",
        }),
        expect.objectContaining({
          field: "register_number",
          message: "register_number is required.",
        }),
        expect.objectContaining({
          field: "year",
          message: "year is required.",
        }),
        expect.objectContaining({
          field: "semester_number",
          message: "semester_number is required.",
        }),
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
        expect.objectContaining({
          field: "full_name",
          message: "full_name is required.",
        }),
        expect.objectContaining({
          field: "college_identity_id",
          message: "college_identity_id is required.",
        }),
        expect.objectContaining({
          field: "department_code",
          message: "department_code is required.",
        }),
        expect.objectContaining({
          field: "section_code",
          message: "section_code is required.",
        }),
      ]),
    );
  });

  it("accepts the basic four-column AVS user workbook and preserves numeric password text", async () => {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet("Basic Users");
    worksheet.addRow(["Name", "Email", "Password", "Department"]);
    worksheet.addRow([
      "Sample Student",
      "sample.student@example.edu",
      "",
      "CSE-AIML",
    ]);
    worksheet.getCell("C2").value = 1234;
    worksheet.getCell("C2").numFmt = "000000";
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await service.parse(
      {
        buffer,
        originalname: "avs-user-import-template.xlsx",
        size: buffer.length,
      } as Express.Multer.File,
      "USERS",
    );

    expect(parsed.headers).toEqual([
      "full_name",
      "email",
      "temporary_password",
      "department_code",
    ]);
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
      [
        "Safe",
        "Student",
        "safe.student@avsenggcollege.ac.in",
        "TempPass@123",
        "/students/1",
      ],
    ]);
    const mechanical = workbook.addWorksheet("MECH");
    mechanical.addRows([
      [],
      ["FIRST NAME", "LAST NAME", "EMAIL ID", "PASSWORD", "/PATH"],
      [
        "Second",
        "Student",
        "second.student@avsenggcollege.ac.in",
        "",
        "/students/2",
      ],
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
      temporary_password: "1234",
      source_sheet: "MECH",
      source_row_number: "3",
    });
    expect(parsed.passwordWarnings).toBe(1);
    expect(parsed.sheetInspections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetName: "CSE",
          headerRowNumber: 1,
          rowCount: 1,
        }),
        expect.objectContaining({
          sheetName: "MECH",
          headerRowNumber: 2,
          rowCount: 1,
        }),
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
          [
            "First",
            "Copy",
            "duplicate@avsenggcollege.ac.in",
            "TempPass@123",
            "/one",
          ],
        ],
        ECE: [
          [],
          ["FIRST NAME", "LAST NAME", "EMAIL ID", "PASSWORD", "/PATH"],
          [
            "Second",
            "Copy",
            "DUPLICATE@avsenggcollege.ac.in",
            "TempPass@456",
            "/two",
          ],
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
    sheet.getCell("D2").value = 1234.5;
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
          message: expect.stringContaining(
            "without losing precision",
          ) as string,
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
        "full_name,official_email,college_id,register_number,department_code,academic_year,study_year,semester,section,temporary_password,mobile\nCanonical Student,student@college.edu,AVS001,999999990001,AIDS,2026-2027,2,3,B,TempPass@123,9876543210\n",
      ),
      "STUDENTS",
      { departmentMappings: { AIDS: "AI & DS" } },
    );

    expect(parsed.rows[0]).toMatchObject({
      full_name: "Canonical Student",
      email: "student@college.edu",
      college_identity_id: "AVS001",
      student_id: "AVS001",
      register_number: "999999990001",
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

  it.each(["1", "4"])(
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

  it.each(["5", "8", "9"])(
    "rejects study year %s outside 1 through 4",
    async (studyYear) => {
      const parsed = await service.parse(
        csvFile(
          `full_name,official_email,college_id,register_number,department_code,academic_year,study_year,semester,section,temporary_password\nInvalid Year,invalid.year${studyYear}@college.edu,AVS${studyYear},REG${studyYear},CSE,2026-27,${studyYear},1,A,AvsTemp@2026!\n`,
        ),
        "STUDENTS",
      );

      expect(parsed.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "year",
            message: "study_year must be an integer from 1 to 4.",
          }),
        ]),
      );
    },
  );

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
    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xls",
    }) as Buffer;
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

  it("SKIP_ALL rejects every cross-sheet PEOPLE duplicate email while preserving physical locations", async () => {
    const headers = [
      "FIRST NAME",
      "LAST NAME",
      "EMAIL ID",
      "PASSWORD",
      "/PATH",
      "USER ID",
      "DEPARTMENT",
      "YEAR",
    ];
    const parsed = await service.parse(
      await multiSheetWorkbookFile(
        {
          CSE: [
            [],
            headers,
            [
              "First",
              "Person",
              "duplicate@avsenggcollege.ac.in",
              "Strong!Pass123",
              "/one",
              "AVS-CSE-001",
              "CSE",
              "2",
            ],
          ],
          ECE: [
            [],
            headers,
            [
              "Second",
              "Person",
              "DUPLICATE@AVSENGGCOLLEGE.AC.IN",
              "Strong!Pass456",
              "/two",
              "AVS-ECE-001",
              "ECE",
              "2",
            ],
          ],
        },
        "people.xlsx",
      ),
      "PEOPLE",
      { duplicateResolution: "SKIP_ALL" },
    );

    expect(
      parsed.rows.map((row) => ({
        importRowNumber: row.import_row_number,
        sourceSheet: row.source_sheet,
        sourceRowNumber: row.source_row_number,
      })),
    ).toEqual([
      {
        importRowNumber: "2",
        sourceSheet: "CSE",
        sourceRowNumber: "3",
      },
      {
        importRowNumber: "3",
        sourceSheet: "ECE",
        sourceRowNumber: "3",
      },
    ]);
    expect(
      parsed.rows.map((row, index) =>
        importRowNumber("PEOPLE", row, index + 2),
      ),
    ).toEqual([2, 3]);
    expect(parsed.duplicateGroups).toEqual([
      {
        normalizedEmail: "duplicate@avsenggcollege.ac.in",
        locations: [
          { rowNumber: 2, sheetName: "CSE", sourceRowNumber: 3 },
          { rowNumber: 3, sheetName: "ECE", sourceRowNumber: 3 },
        ],
      },
    ]);
    const emailErrors = parsed.errors.filter(
      (error) => error.field === "email" && /duplicate/i.test(error.message),
    );
    expect(emailErrors).toHaveLength(2);
    expect(new Set(emailErrors.map((error) => error.rowNumber))).toEqual(
      new Set([2, 3]),
    );
    expect(emailErrors.map((error) => error.userId).sort()).toEqual([
      "AVS-CSE-001",
      "AVS-ECE-001",
    ]);
    expect(emailErrors.map((error) => error.message).join(" ")).toEqual(
      expect.stringContaining("CSE, row 3"),
    );
    expect(emailErrors.map((error) => error.message).join(" ")).toEqual(
      expect.stringContaining("ECE, row 3"),
    );
    expect(parsed.duplicateRowCount).toBe(2);
    expect(parsed.errors).toHaveLength(2);
  });

  it("derives AVS People login IDs from the full normalized official email", async () => {
    const parsed = await service.parse(
      await multiSheetWorkbookFile(
        {
          CSE: [
            ["FIRST NAME", "LAST NAME", "EMAIL ID", "PASSWORD", "/PATH"],
            [
              "Sample",
              "Surname",
              "  SAMPLE.STUDENT@AVSENGGCOLLEGE.AC.IN  ",
              "Strong!Pass123",
              "/ignored",
            ],
          ],
        },
        "AVSEC USERS FOR 2ND YEAR.xlsx",
      ),
      "PEOPLE",
    );

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      full_name: "Sample Surname",
      college_identity_id: "sample.student@avsenggcollege.ac.in",
      student_id: "sample.student@avsenggcollege.ac.in",
      email: "sample.student@avsenggcollege.ac.in",
      role_codes: "STUDENT",
      department_code: "CSE",
      year: "2",
    });
    expect(parsed.errors).toEqual([]);
  });

  it("reports AVS email-derived identity duplicates once per affected row without exposing passwords", async () => {
    const parsed = await service.parse(
      await multiSheetWorkbookFile(
        {
          CSE: [
            ["FIRST NAME", "LAST NAME", "EMAIL ID", "PASSWORD", "/PATH"],
            [
              "First",
              "Student",
              "duplicate@avsenggcollege.ac.in",
              "FirstSecret!123",
              "/ignored-one",
            ],
          ],
          ECE: [
            ["FIRST NAME", "LAST NAME", "EMAIL ID", "PASSWORD", "/PATH"],
            [
              "Second",
              "Student",
              "DUPLICATE@AVSENGGCOLLEGE.AC.IN",
              "SecondSecret!456",
              "/ignored-two",
            ],
          ],
        },
        "AVSEC USERS FOR 3RD YEAR.xlsx",
      ),
      "PEOPLE",
      { duplicateResolution: "SKIP_ALL" },
    );

    expect(parsed.rows.map((row) => row.college_identity_id)).toEqual([
      "duplicate@avsenggcollege.ac.in",
      "duplicate@avsenggcollege.ac.in",
    ]);
    expect(parsed.duplicateRowCount).toBe(2);
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rowNumber: 2, field: "email" }),
        expect.objectContaining({ rowNumber: 3, field: "email" }),
      ]),
    );
    expect(JSON.stringify(parsed.errors)).not.toMatch(
      /FirstSecret|SecondSecret/,
    );
  });

  it("keeps an explicit User ID mandatory for generic People templates", async () => {
    const parsed = await service.parse(
      csvFile(
        [
          "User Name,Official College Email,User Password,Department,Year,Class Room Number,Mobile Number",
          "Generic Student,generic.student@avsenggcollege.ac.in,Strong!Pass123,CSE,2,,",
        ].join("\n"),
      ),
      "PEOPLE",
    );

    expect(parsed.rows[0]?.college_identity_id).toBeUndefined();
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowNumber: 2,
          message: expect.stringContaining("Missing required headers: User ID"),
        }),
        expect.objectContaining({
          rowNumber: 2,
          field: "college_identity_id",
          message: "User ID is required.",
        }),
      ]),
    );
  });

  it("SKIP_ALL rejects every cross-sheet PEOPLE duplicate User ID case-insensitively", async () => {
    const headers = [
      "FIRST NAME",
      "LAST NAME",
      "EMAIL ID",
      "PASSWORD",
      "/PATH",
      "USER ID",
      "DEPARTMENT",
      "YEAR",
    ];
    const parsed = await service.parse(
      await multiSheetWorkbookFile(
        {
          CSE: [
            headers,
            [
              "First",
              "Person",
              "first.person@avsenggcollege.ac.in",
              "Strong!Pass123",
              "/one",
              "avs-duplicate-id",
              "CSE",
              "2",
            ],
          ],
          ECE: [
            headers,
            [
              "Second",
              "Person",
              "second.person@avsenggcollege.ac.in",
              "Strong!Pass456",
              "/two",
              "AVS-DUPLICATE-ID",
              "ECE",
              "2",
            ],
          ],
        },
        "people.xlsx",
      ),
      "PEOPLE",
      { duplicateResolution: "SKIP_ALL" },
    );

    const identityErrors = parsed.errors.filter(
      (error) =>
        error.field === "college_identity_id" &&
        /duplicate/i.test(error.message),
    );
    expect(identityErrors).toHaveLength(2);
    expect(new Set(identityErrors.map((error) => error.rowNumber))).toEqual(
      new Set([2, 3]),
    );
    expect(parsed.duplicateRowCount).toBe(2);
    expect(parsed.duplicateGroups).toEqual([]);
    expect(parsed.errors).toHaveLength(2);
  });

  it("accepts the eight People CSV headers and keeps physical source row numbers", async () => {
    const parsed = await service.parse(
      csvFile(
        [
          "User Name,User ID,Official College Email,User Password,Department,Year,Class Room Number,Mobile Number",
          "",
          "Arun Kumar,AVS001,arun.kumar@avsenggcollege.ac.in,Strong!Pass123,CSE,2,CSE-201,9876543210",
        ].join("\n"),
      ),
      "PEOPLE",
    );

    expect(parsed.headers).toEqual([
      "full_name",
      "college_identity_id",
      "email",
      "temporary_password",
      "department_code",
      "year",
      "class_room_number",
      "mobile",
    ]);
    expect(parsed.rows[0]).toMatchObject({
      import_row_number: "2",
      source_row_number: "3",
      full_name: "Arun Kumar",
      college_identity_id: "AVS001",
      email: "arun.kumar@avsenggcollege.ac.in",
      temporary_password: "Strong!Pass123",
    });
    expect(parsed.errors).toEqual([]);
  });

  it("uses exact OOXML password lexemes for canonical People workbooks", async () => {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet("People");
    worksheet.addRows([
      [
        "User Name",
        "User ID",
        "Official College Email",
        "User Password",
        "Department",
        "Year",
        "Class Room Number",
        "Mobile Number",
      ],
      [
        "Leading Zero",
        "AVS001",
        "leading.zero@avsenggcollege.ac.in",
        "001234567890",
        "CSE",
        "2",
        "",
        "",
      ],
      [
        "Unsafe Decimal",
        "AVS002",
        "unsafe.decimal@avsenggcollege.ac.in",
        "",
        "CSE",
        "2",
        "",
        "",
      ],
      [
        "Exact Integer",
        "AVS003",
        "exact.integer@avsenggcollege.ac.in",
        "",
        "CSE",
        "2",
        "",
        "",
      ],
    ]);
    worksheet.getCell("D3").value = 1234.5;
    worksheet.getCell("D4").value = 999999990002;
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const parsed = await service.parse(
      {
        buffer,
        originalname: "people-template.xlsx",
        size: buffer.length,
      } as Express.Multer.File,
      "PEOPLE",
      { duplicateResolution: "SKIP_ALL" },
    );

    expect(parsed.rows[0]?.temporary_password).toBe("001234567890");
    expect(parsed.rows[1]?.temporary_password).toBe("");
    expect(parsed.rows[2]?.temporary_password).toBe("999999990002");
    expect(parsed.passwordWarnings).toBe(2);
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowNumber: 3,
          field: "temporary_password",
          message: expect.stringContaining(
            "without losing precision",
          ) as string,
        }),
      ]),
    );
    expect(
      parsed.errors.some(
        (error) =>
          error.rowNumber === 2 && error.field === "temporary_password",
      ),
    ).toBe(false);
  });

  it("rejects legacy XLS People credentials because exact password bytes cannot be proven", async () => {
    await expect(
      service.parse(
        {
          buffer: Buffer.from("legacy-xls"),
          originalname: "people.xls",
          size: 10,
        } as Express.Multer.File,
        "PEOPLE",
      ),
    ).rejects.toThrow("cannot prove exact password characters");
  });

  it("reports renamed People columns as friendly missing and unexpected headers", async () => {
    const password = "Strong!Pass123";
    const parsed = await service.parse(
      csvFile(
        [
          "User Name,User ID,User Password,Department,Year,Classroom Number,Mobile Number",
          `Arun Kumar,AVS001,${password},CSE,2,CSE-201,9876543210`,
        ].join("\n"),
      ),
      "PEOPLE",
    );

    expect(parsed.errors).toContainEqual(
      expect.objectContaining({
        rowNumber: 2,
        userId: "AVS001",
        userName: "Arun Kumar",
        message: expect.stringMatching(
          /Missing required headers: Official College Email.*Unexpected headers: Classroom Number/,
        ) as string,
      }),
    );
    expect(JSON.stringify(parsed.errors)).not.toContain(password);
  });

  it("rejects duplicate canonical People headers", async () => {
    const password = "Strong!Pass123";
    const parsed = await service.parse(
      csvFile(
        [
          "User Name,User ID,Official College Email,User Password,Department,Year,Class Room Number,Mobile Number,User ID",
          `Arun Kumar,AVS001,arun.kumar@avsenggcollege.ac.in,${password},CSE,2,CSE-201,9876543210,AVS002`,
        ].join("\n"),
      ),
      "PEOPLE",
    );

    expect(parsed.errors).toContainEqual(
      expect.objectContaining({
        rowNumber: 2,
        message: expect.stringContaining(
          "Unexpected duplicate headers: User ID",
        ) as string,
      }),
    );
    expect(JSON.stringify(parsed.errors)).not.toContain(password);
  });

  it("does not silently trim People identity or password cells in XLSX", async () => {
    const parsed = await service.parse(
      await workbookFile(
        [
          [
            "User Name",
            "User ID",
            "Official College Email",
            "User Password",
            "Department",
            "Year",
            "Class Room Number",
            "Mobile Number",
          ],
          [
            "Arun Kumar",
            " AVS001",
            "arun.kumar@avsenggcollege.ac.in",
            "Strong!Pass123 ",
            "CSE",
            "2",
            "CSE-201",
            "9876543210",
          ],
        ],
        "people.xlsx",
      ),
      "PEOPLE",
    );

    expect(parsed.rows[0]?.college_identity_id).toBe(" AVS001");
    expect(parsed.rows[0]?.temporary_password).toBe("Strong!Pass123 ");
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "college_identity_id",
          message: "User ID must not begin or end with whitespace.",
        }),
        expect.objectContaining({
          field: "temporary_password",
          message: "User Password must not begin or end with whitespace.",
        }),
      ]),
    );
  });
});

describe("ImportsService Excel workbooks", () => {
  const service = Object.create(ImportsService.prototype) as ImportsService;

  it("allowlists People preview fields so unexpected credential columns cannot leak", () => {
    const safePreviewRow = (
      service as unknown as {
        safePreviewRow: (entityType: "PEOPLE", row: ImportRow) => ImportRow;
      }
    ).safePreviewRow.bind(service);
    const preview = safePreviewRow("PEOPLE", {
      full_name: "Safe Student",
      college_identity_id: "safe.student@avsenggcollege.ac.in",
      email: "safe.student@avsenggcollege.ac.in",
      department_code: "CSE",
      year: "2",
      temporary_password: "must-not-render",
      password: "must-not-render",
      mailbox_password: "must-not-render",
      unexpected_secret: "must-not-render",
      password_status: "Password text preserved",
      import_row_number: "2",
    } as unknown as ImportRow);

    expect(preview).toEqual({
      full_name: "Safe Student",
      college_identity_id: "safe.student@avsenggcollege.ac.in",
      email: "safe.student@avsenggcollege.ac.in",
      department_code: "CSE",
      year: "2",
      password_status: "Password text preserved",
    });
    expect(JSON.stringify(preview)).not.toContain("must-not-render");
  });

  it("previews and confirms the canonical student template without a source student_id column", async () => {
    const persistenceEvents: string[] = [];
    const files = new ImportsFileService(
      new ConfigService({
        S3_BUCKET: "private",
        S3_ENDPOINT: "http://127.0.0.1:9000",
        S3_REGION: "us-east-1",
        S3_ACCESS_KEY: "test",
        S3_SECRET_KEY: "test",
      }),
    );
    jest
      .spyOn(files, "saveSource")
      .mockImplementation(async (_collegeId, _entityType, sourceFile, key) => {
        persistenceEvents.push("source-uploaded");
        return {
          key,
          sha256: createHash("sha256").update(sourceFile.buffer).digest("hex"),
        };
      });
    const createdAt = new Date("2026-08-11T00:00:00.000Z");
    let storedJob: Record<string, unknown> | undefined;
    const prisma: Record<string, unknown> = {
      department: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "department-cse",
            code: "CSE",
            name: "Computer Science and Engineering",
            shortName: "CSE",
          },
        ]),
      },
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      role: { findMany: jest.fn().mockResolvedValue([]) },
      importJob: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          persistenceEvents.push("job-persisted");
          storedJob = {
            ...data,
            resultStorageKey: null,
            createdAt,
            updatedAt: createdAt,
          };
          return storedJob;
        }),
        findFirst: jest.fn(async () => storedJob),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          storedJob = { ...storedJob, ...data };
          return storedJob;
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) =>
        work(prisma),
      ),
    };
    const handler = { validate: jest.fn().mockResolvedValue([]) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    let queuedJob:
      | { getState: jest.Mock<Promise<string>, []>; remove: jest.Mock }
      | undefined;
    const queue = {
      getJob: jest.fn(async () => queuedJob),
      add: jest.fn(async () => {
        queuedJob = {
          getState: jest.fn().mockResolvedValue("waiting"),
          remove: jest.fn(),
        };
      }),
    };
    const importService = Object.create(
      ImportsService.prototype,
    ) as ImportsService;
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
      "full_name,official_email,college_id,register_number,department_code,programme_code,academic_year,study_year,semester,section,temporary_password,mobile\nCanonical Student,canonical.student@college.edu,AVS001,999999990001,CSE,,2026-27,2,3,A,AvsTemp@2026!,9876543210\n",
    );

    const preview = await importService.preview(
      user,
      "STUDENTS",
      file,
      "request-1",
      { importMode: "CREATE_ONLY" },
    );
    expect(preview.job).toMatchObject({
      id: expect.any(String),
      validRows: 1,
      errorRows: 0,
    });
    expect(preview.previewRows[0]?.values).toMatchObject({
      college_identity_id: "AVS001",
      student_id: "AVS001",
      register_number: "999999990001",
    });
    expect(preview.previewRows[0]?.values.temporary_password).toBeUndefined();
    expect(persistenceEvents).toEqual(["job-persisted", "source-uploaded"]);

    await expect(
      importService.confirm(user, preview.job.id, "request-2"),
    ).resolves.toEqual({ id: preview.job.id, status: "QUEUED" });
    expect(queue.add).toHaveBeenCalledWith(
      "process",
      { jobId: preview.job.id },
      expect.objectContaining({ jobId: preview.job.id }),
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
    const transactionImportUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      importJobRecord: { findMany: jest.fn().mockResolvedValue([]) },
      importJob: {
        findUnique: jest.fn().mockResolvedValue(importJob),
        findFirst: jest
          .fn()
          .mockResolvedValue({ pendingResultStorageKey: null }),
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (work: (tx: unknown) => Promise<void>) =>
        work({ importJob: { updateMany: transactionImportUpdate } }),
      ),
    };
    const files = {
      loadSource: jest.fn().mockResolvedValue(source),
      parse: jest.fn().mockResolvedValue({
        rows: [firstRow, secondRow],
        errors: [parserError],
      }),
      saveReport: jest
        .fn()
        .mockResolvedValue(
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
              return [
                {
                  rowNumber,
                  field: "section_code",
                  message:
                    "Section A is full. Current capacity: 1 / 1. Please select another Section.",
                },
              ];
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
    const importService = Object.create(
      ImportsService.prototype,
    ) as ImportsService;
    Object.defineProperties(importService, {
      prisma: { value: prisma },
      files: { value: files },
      handler: { value: handler },
      audit: { value: audit },
    });
    const updateProgress = jest.fn().mockResolvedValue(undefined);
    const process = (
      importService as unknown as {
        process(job: {
          data: { jobId: string };
          updateProgress(progress: number): Promise<void>;
        }): Promise<void>;
      }
    ).process.bind(importService);

    await process({ data: { jobId: importJob.id }, updateProgress });

    expect(handler.validate).toHaveBeenCalledWith(
      "STUDENTS",
      "college-1",
      [firstRow, secondRow],
      "CREATE_ONLY",
      new Set([2]),
      undefined,
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
      expect.any(String),
    );
    expect(files.saveReport).toHaveBeenCalledWith(
      "college-1",
      expect.objectContaining({
        successful: [expect.objectContaining({ rowNumber: 3, id: "user-2" })],
        errors: [parserError],
      }),
      expect.any(String),
    );
  });

  it("processes 1000 People rows through one queued source and never persists supplied passwords", async () => {
    const source = Buffer.from("stored 1000-row people import", "utf8");
    const suppliedPassword = "Scale!Pass123";
    const rows = Array.from(
      { length: 1_000 },
      (_, index) =>
        ({
          full_name: `Scale Person ${index + 1}`,
          college_identity_id: `SCALE${String(index + 1).padStart(4, "0")}`,
          temporary_password: suppliedPassword,
          department_code: "CSE",
          year: "2",
          class_room_number: "CSE-201",
          mobile: `9${String(index).padStart(9, "0")}`,
          source_row_number: String(index + 2),
        }) as ImportRow,
    );
    const importJob = {
      id: "00000000-0000-4000-8000-000000000030",
      collegeId: "college-1",
      requestedById: "admin-1",
      entityType: "PEOPLE",
      importMode: "CREATE_ONLY",
      selectedSheetName: "People",
      columnMapping: { __selected_import_role: "STUDENT" },
      sourceStorageKey: "colleges/college-1/imports/source/scale-people.xlsx",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      status: "QUEUED",
    };
    const finalImportUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      importJobRecord: { findMany: jest.fn().mockResolvedValue([]) },
      importJob: {
        findUnique: jest.fn().mockResolvedValue(importJob),
        findFirst: jest
          .fn()
          .mockResolvedValue({ pendingResultStorageKey: null }),
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (work: (tx: unknown) => Promise<void>) =>
        work({ importJob: { updateMany: finalImportUpdate } }),
      ),
    };
    const files = {
      loadSource: jest.fn().mockResolvedValue(source),
      parse: jest.fn().mockResolvedValue({ rows, errors: [] }),
      saveReport: jest
        .fn()
        .mockResolvedValue(
          "colleges/college-1/imports/results/scale-people.json",
        ),
      deleteSource: jest.fn().mockResolvedValue(undefined),
    };
    const importedRecord = (row: ImportRow, rowNumber: number) => ({
      rowNumber,
      model: "User",
      id: "00000000-0000-4000-8000-000000000031",
      label: `${row.college_identity_id} - ${row.full_name}`,
      credential: {
        rowNumber,
        userId: "00000000-0000-4000-8000-000000000032",
        fullName: row.full_name,
        role: "STUDENT",
        loginId: row.college_identity_id,
        temporaryPassword: row.temporary_password,
        firstLoginRequired: true,
      },
    });
    const handler = {
      validate: jest.fn().mockResolvedValue([]),
      createPeopleBatch: jest.fn(
        async (
          _collegeId: string,
          batch: Array<{ row: ImportRow; rowNumber: number }>,
        ) => batch.map((item) => importedRecord(item.row, item.rowNumber)),
      ),
      create: jest.fn(
        async (
          _entityType: string,
          _collegeId: string,
          row: ImportRow,
          rowNumber: number,
        ) => importedRecord(row, rowNumber),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const importService = Object.create(
      ImportsService.prototype,
    ) as ImportsService;
    Object.defineProperties(importService, {
      prisma: { value: prisma },
      files: { value: files },
      handler: { value: handler },
      audit: { value: audit },
    });
    const updateProgress = jest.fn().mockResolvedValue(undefined);
    const process = (
      importService as unknown as {
        process(job: {
          data: { jobId: string };
          updateProgress(progress: number): Promise<void>;
        }): Promise<void>;
      }
    ).process.bind(importService);

    await process({ data: { jobId: importJob.id }, updateProgress });

    expect(files.loadSource).toHaveBeenCalledTimes(1);
    expect(files.parse).toHaveBeenCalledTimes(1);
    expect(handler.validate).toHaveBeenCalledTimes(1);
    expect(handler.createPeopleBatch).toHaveBeenCalledTimes(100);
    expect(handler.create).not.toHaveBeenCalled();
    expect(files.saveReport).toHaveBeenCalledTimes(1);
    expect(updateProgress).toHaveBeenCalledTimes(100);
    expect(updateProgress).toHaveBeenLastCalledWith(100);
    const report = files.saveReport.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(report.successful).toHaveLength(1_000);
    expect(report.credentials).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain(suppliedPassword);
    expect(files.deleteSource).toHaveBeenCalledWith(
      importJob.collegeId,
      importJob.sourceStorageKey,
    );
  }, 30_000);

  it("falls back from a failed People batch to exact row-level outcomes", async () => {
    const source = Buffer.from("stored mixed people import", "utf8");
    const suppliedPassword = "Fallback!Pass123";
    const officialEmailDomains = ["tenant.example.edu"];
    const rows = [
      {
        full_name: "Valid Person",
        college_identity_id: "FALLBACK001",
        temporary_password: suppliedPassword,
        source_row_number: "2",
      },
      {
        full_name: "Late Invalid Person",
        college_identity_id: "FALLBACK002",
        temporary_password: suppliedPassword,
        source_row_number: "3",
      },
    ] as ImportRow[];
    const importJob = {
      id: "00000000-0000-4000-8000-000000000080",
      collegeId: "college-1",
      requestedById: "admin-1",
      entityType: "PEOPLE",
      importMode: "CREATE_ONLY",
      selectedSheetName: "People",
      columnMapping: null,
      sourceStorageKey: "colleges/college-1/imports/source/mixed-people.xlsx",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      status: "QUEUED",
    };
    const prisma = {
      appSetting: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ value: officialEmailDomains }),
      },
      importJobRecord: { findMany: jest.fn().mockResolvedValue([]) },
      importJob: {
        findUnique: jest.fn().mockResolvedValue(importJob),
        findFirst: jest
          .fn()
          .mockResolvedValue({ pendingResultStorageKey: null }),
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (work: (tx: unknown) => Promise<void>) =>
        work({
          importJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        }),
      ),
    };
    const files = {
      loadSource: jest.fn().mockResolvedValue(source),
      parse: jest.fn().mockResolvedValue({ rows, errors: [] }),
      saveReport: jest
        .fn()
        .mockResolvedValue(
          "colleges/college-1/imports/results/mixed-people.json",
        ),
      deleteSource: jest.fn().mockResolvedValue(undefined),
    };
    const handler = {
      validate: jest.fn().mockResolvedValue([]),
      createPeopleBatch: jest
        .fn()
        .mockRejectedValue(new Error("bounded transaction rolled back")),
      create: jest.fn(
        async (
          _entityType: string,
          _collegeId: string,
          row: ImportRow,
          rowNumber: number,
        ) => {
          if (row.college_identity_id === "FALLBACK002") {
            throw new BadRequestException(
              `Late conflict for ${row.temporary_password}`,
            );
          }
          return {
            rowNumber,
            model: "User",
            id: "00000000-0000-4000-8000-000000000081",
            label: `${row.college_identity_id} - ${row.full_name}`,
          };
        },
      ),
    };
    const importService = Object.create(
      ImportsService.prototype,
    ) as ImportsService;
    Object.defineProperties(importService, {
      prisma: { value: prisma },
      files: { value: files },
      handler: { value: handler },
      audit: { value: { record: jest.fn().mockResolvedValue(undefined) } },
    });
    const process = (
      importService as unknown as {
        process(job: {
          data: { jobId: string };
          updateProgress(progress: number): Promise<void>;
        }): Promise<void>;
      }
    ).process.bind(importService);

    await process({
      data: { jobId: importJob.id },
      updateProgress: jest.fn().mockResolvedValue(undefined),
    });

    expect(handler.createPeopleBatch).toHaveBeenCalledTimes(1);
    expect(handler.create).toHaveBeenCalledTimes(2);
    expect(handler.createPeopleBatch).toHaveBeenCalledWith(
      importJob.collegeId,
      expect.any(Array),
      importJob.id,
      importJob.requestedById,
      "CREATE_ONLY",
      { resetExistingPasswords: false, officialEmailDomains },
      expect.any(String),
    );
    const createCalls = handler.create.mock.calls as unknown as unknown[][];
    for (const call of createCalls) {
      expect(call[7]).toEqual({
        resetExistingPasswords: false,
        officialEmailDomains,
      });
    }
    const report = files.saveReport.mock.calls[0]?.[1] as {
      successful: unknown[];
      errors: Array<{ rowNumber: number; message: string }>;
    };
    expect(report.successful).toHaveLength(1);
    expect(report.errors).toEqual([
      expect.objectContaining({
        rowNumber: 3,
        message: "Late conflict for [REDACTED]",
      }),
    ]);
    expect(JSON.stringify(report)).not.toContain(suppliedPassword);
  });

  it("resolves only exact configured aliases and exposes unknown departments", () => {
    const mappingPreview = (
      service as unknown as {
        departmentMappingPreview(
          rows: Array<Partial<ImportRow>>,
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
        };
      }
    ).departmentMappingPreview.bind(service);
    const departments = [
      {
        id: "department-aiml",
        code: "AI & ML",
        name: "Artificial Intelligence and Machine Learning",
        shortName: "AI & ML",
      },
    ];

    const result = mappingPreview(
      [
        { source_department_code: "AI-ML", department_code: "AI & ML" },
        {
          source_department_code: "Computer Science",
          department_code: "Computer Science",
        },
      ],
      { mappings: { AIML: "AI & ML" }, departments },
    );

    expect(result.mappings).toEqual({ "AI-ML": "AI & ML" });
    expect(result.unresolved).toEqual([
      { sourceCode: "Computer Science", rowCount: 1 },
    ]);
  });

  it("applies the built-in AI department aliases to ordinary CSV rows without fuzzy matching", async () => {
    const mappingService = Object.create(
      ImportsService.prototype,
    ) as ImportsService;
    Object.defineProperty(mappingService, "prisma", {
      value: {
        department: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: "department-aids",
              code: "AI & DS",
              name: "Artificial Intelligence and Data Science",
              shortName: "AI & DS",
            },
            {
              id: "department-aiml",
              code: "AI & ML",
              name: "Artificial Intelligence and Machine Learning",
              shortName: "AI & ML",
            },
          ]),
        },
        appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      },
    });
    const context = await (
      mappingService as unknown as {
        departmentImportContext(
          collegeId: string,
        ): Promise<{ mappings: Record<string, string> }>;
      }
    ).departmentImportContext("college-1");
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

  it("generates the exact header-only People template", async () => {
    const result = await service.template(
      { permissions: ["users.import"] } as AuthPrincipal,
      "PEOPLE",
    );
    const workbook = new Workbook();
    await workbook.xlsx.load(
      result.content as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const worksheet = workbook.getWorksheet("Template");
    const headers = worksheet?.getRow(1).values as string[] | undefined;

    expect(result.fileName).toBe("people-import-template.xlsx");
    expect(headers?.slice(1)).toEqual([
      "User Name",
      "User ID",
      "Official College Email",
      "User Password",
      "Department",
      "Year",
      "Class Room Number",
      "Mobile Number",
    ]);
    expect(worksheet?.rowCount).toBe(1);
  });

  it("atomically cancels a READY People import and removes its password-bearing source", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const files = { deleteSource: jest.fn().mockResolvedValue(undefined) };
    const importService = Object.create(
      ImportsService.prototype,
    ) as ImportsService;
    const job = {
      id: "00000000-0000-4000-8000-000000000010",
      collegeId: "college-1",
      requestedById: "admin-1",
      entityType: "PEOPLE",
      status: "READY",
      sourceStorageKey:
        "colleges/college-1/imports/source/people-passwords.xlsx",
    };
    const prisma = {
      importJob: {
        findFirst: jest.fn().mockResolvedValue(job),
        updateMany,
      },
      $transaction: jest.fn(
        async (
          work: (tx: {
            importJob: { updateMany: typeof updateMany };
          }) => Promise<void>,
        ) => work({ importJob: { updateMany } }),
      ),
    };
    Object.defineProperties(importService, {
      prisma: { value: prisma },
      files: { value: files },
      audit: { value: audit },
      logger: { value: { error: jest.fn() } },
    });
    const actor = {
      id: "admin-1",
      collegeId: "college-1",
      permissions: ["users.import"],
    } as AuthPrincipal;

    await expect(
      importService.cancel(actor, job.id, "request-cancel"),
    ).resolves.toEqual({ id: job.id, status: "CANCELLED" });
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: job.id,
        collegeId: "college-1",
        requestedById: "admin-1",
        status: "READY",
      },
      data: { status: "CANCELLED" },
    });
    expect(files.deleteSource).toHaveBeenCalledWith(
      job.collegeId,
      job.sourceStorageKey,
    );
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: job.id,
        collegeId: job.collegeId,
        sourceStorageKey: job.sourceStorageKey,
      },
      data: { sourceStorageKey: null, sourceExpiresAt: null },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "import.cancelled",
        afterValue: { importedEntity: "PEOPLE", status: "CANCELLED" },
      }),
      expect.anything(),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(
      /password|temporary_password/i,
    );
  });

  it("expires an abandoned READY source with an atomic status claim and durable deletion marker", async () => {
    const sourceStorageKey =
      "colleges/college-1/imports/source/expired-people.xlsx";
    const job = {
      id: "00000000-0000-4000-8000-000000000011",
      collegeId: "college-1",
      requestedById: "admin-1",
      entityType: "PEOPLE",
      status: "READY",
      sourceStorageKey,
      sourceExpiresAt: new Date("2026-08-23T00:00:00.000Z"),
    };
    const claim = jest.fn().mockResolvedValue({ count: 1 });
    const clear = jest.fn().mockResolvedValue({ count: 1 });
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const files = { deleteSource: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      importJob: {
        findMany: jest.fn().mockResolvedValue([job]),
        updateMany: clear,
      },
      $transaction: jest.fn(
        async (
          work: (tx: {
            importJob: { updateMany: typeof claim };
          }) => Promise<unknown>,
        ) => work({ importJob: { updateMany: claim } }),
      ),
    };
    const importService = Object.create(
      ImportsService.prototype,
    ) as ImportsService;
    Object.defineProperties(importService, {
      prisma: { value: prisma },
      files: { value: files },
      audit: { value: audit },
      logger: { value: { error: jest.fn(), warn: jest.fn() } },
    });
    const cleanup = (
      importService as unknown as { cleanupExpiredSources(): Promise<void> }
    ).cleanupExpiredSources.bind(importService);

    await cleanup();

    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: job.id,
          collegeId: job.collegeId,
          status: "READY",
          sourceStorageKey,
        }),
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "import.expired",
        afterValue: { importedEntity: "PEOPLE", status: "CANCELLED" },
      }),
      expect.anything(),
    );
    expect(files.deleteSource).toHaveBeenCalledWith(
      job.collegeId,
      sourceStorageKey,
    );
    expect(clear).toHaveBeenCalledWith({
      where: {
        id: job.id,
        collegeId: job.collegeId,
        sourceStorageKey,
      },
      data: { sourceStorageKey: null, sourceExpiresAt: null },
    });
  });

  it("retains the source marker after a storage error and retries terminal cleanup", async () => {
    const sourceStorageKey =
      "colleges/college-1/imports/source/retry-people.xlsx";
    const job = {
      id: "00000000-0000-4000-8000-000000000012",
      collegeId: "college-1",
      requestedById: "admin-1",
      entityType: "PEOPLE",
      status: "COMPLETED",
      sourceStorageKey,
      sourceExpiresAt: new Date("2026-08-23T00:00:00.000Z"),
    };
    const clear = jest.fn().mockResolvedValue({ count: 1 });
    const files = {
      deleteSource: jest
        .fn()
        .mockRejectedValueOnce(new Error("temporary storage outage"))
        .mockResolvedValueOnce(undefined),
    };
    const logger = { error: jest.fn(), warn: jest.fn() };
    const importService = Object.create(
      ImportsService.prototype,
    ) as ImportsService;
    Object.defineProperties(importService, {
      prisma: {
        value: {
          importJob: {
            findMany: jest.fn().mockResolvedValue([job]),
            updateMany: clear,
          },
        },
      },
      files: { value: files },
      audit: { value: { record: jest.fn() } },
      logger: { value: logger },
    });
    const cleanup = (
      importService as unknown as { cleanupExpiredSources(): Promise<void> }
    ).cleanupExpiredSources.bind(importService);

    await cleanup();
    expect(clear).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: job.id }),
      "Temporary import source cleanup failed",
    );

    await cleanup();
    expect(files.deleteSource).toHaveBeenCalledTimes(2);
    expect(clear).toHaveBeenCalledWith({
      where: {
        id: job.id,
        collegeId: job.collegeId,
        sourceStorageKey,
      },
      data: { sourceStorageKey: null, sourceExpiresAt: null },
    });
  });

  it("never replays a PROCESSING job or deletes the source owned by its active attempt", async () => {
    const importJob = {
      id: "00000000-0000-4000-8000-000000000090",
      collegeId: "college-1",
      requestedById: "admin-1",
      entityType: "PEOPLE",
      importMode: "CREATE_ONLY",
      selectedSheetName: "People",
      columnMapping: null,
      sourceStorageKey: "colleges/college-1/imports/source/replay-people.xlsx",
      sourceSha256: "0".repeat(64),
      status: "PROCESSING",
    };
    const files = {
      loadSource: jest.fn(),
      deleteSource: jest.fn(),
    };
    const importService = Object.create(
      ImportsService.prototype,
    ) as ImportsService;
    Object.defineProperties(importService, {
      prisma: {
        value: {
          importJob: {
            findUnique: jest.fn().mockResolvedValue(importJob),
            findFirst: jest
              .fn()
              .mockResolvedValue({ pendingResultStorageKey: null }),
            updateMany: jest.fn(),
          },
        },
      },
      files: { value: files },
    });
    const process = (
      importService as unknown as {
        process(job: { data: { jobId: string } }): Promise<void>;
      }
    ).process.bind(importService);

    await process({ data: { jobId: importJob.id } });

    expect(files.loadSource).not.toHaveBeenCalled();
    expect(files.deleteSource).not.toHaveBeenCalled();
  });

  it("does not delete a queued source when another worker wins the atomic claim", async () => {
    const importJob = {
      id: "00000000-0000-4000-8000-000000000091",
      collegeId: "college-1",
      requestedById: "admin-1",
      entityType: "PEOPLE",
      importMode: "CREATE_ONLY",
      selectedSheetName: "People",
      columnMapping: null,
      sourceStorageKey: "colleges/college-1/imports/source/claimed-people.xlsx",
      sourceSha256: "0".repeat(64),
      status: "QUEUED",
    };
    const files = {
      loadSource: jest.fn(),
      deleteSource: jest.fn(),
    };
    const claim = jest.fn().mockResolvedValue({ count: 0 });
    const importService = Object.create(
      ImportsService.prototype,
    ) as ImportsService;
    Object.defineProperties(importService, {
      prisma: {
        value: {
          importJob: {
            findUnique: jest.fn().mockResolvedValue(importJob),
            findFirst: jest
              .fn()
              .mockResolvedValue({ pendingResultStorageKey: null }),
            updateMany: claim,
          },
        },
      },
      files: { value: files },
    });
    const process = (
      importService as unknown as {
        process(job: { data: { jobId: string } }): Promise<void>;
      }
    ).process.bind(importService);

    await process({ data: { jobId: importJob.id } });

    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "QUEUED" }),
      }),
    );
    expect(files.loadSource).not.toHaveBeenCalled();
    expect(files.deleteSource).not.toHaveBeenCalled();
  });

  it("fails and cleans a stale PROCESSING job only after BullMQ proves it is inactive", async () => {
    const sourceStorageKey =
      "colleges/college-1/imports/source/stale-processing.xlsx";
    const job = {
      id: "00000000-0000-4000-8000-000000000092",
      collegeId: "college-1",
      requestedById: "admin-1",
      entityType: "PEOPLE",
      status: "PROCESSING",
      sourceStorageKey,
      sourceExpiresAt: new Date("2026-08-23T00:00:00.000Z"),
    };
    const queueJob = {
      getState: jest.fn().mockResolvedValue("completed"),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const claim = jest.fn().mockResolvedValue({ count: 1 });
    const clear = jest.fn().mockResolvedValue({ count: 1 });
    const files = { deleteSource: jest.fn().mockResolvedValue(undefined) };
    const importService = Object.create(
      ImportsService.prototype,
    ) as ImportsService;
    Object.defineProperties(importService, {
      prisma: {
        value: {
          importJob: {
            findMany: jest.fn().mockResolvedValue([job]),
            updateMany: clear,
          },
          $transaction: jest.fn(
            async (
              work: (tx: {
                importJob: { updateMany: typeof claim };
              }) => Promise<unknown>,
            ) => work({ importJob: { updateMany: claim } }),
          ),
        },
      },
      files: { value: files },
      audit: { value: { record: jest.fn().mockResolvedValue(undefined) } },
      queue: { value: { getJob: jest.fn().mockResolvedValue(queueJob) } },
      logger: { value: { error: jest.fn(), warn: jest.fn() } },
    });
    const cleanup = (
      importService as unknown as { cleanupExpiredSources(): Promise<void> }
    ).cleanupExpiredSources.bind(importService);

    await cleanup();

    expect(queueJob.remove).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: job.id,
          status: "PROCESSING",
        }),
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    expect(files.deleteSource).toHaveBeenCalledWith(
      job.collegeId,
      sourceStorageKey,
    );
    expect(clear).toHaveBeenCalledWith({
      where: {
        id: job.id,
        collegeId: job.collegeId,
        sourceStorageKey,
      },
      data: { sourceStorageKey: null, sourceExpiresAt: null },
    });
  });

  it("keeps an expired PROCESSING source while its BullMQ job is active", async () => {
    const sourceStorageKey =
      "colleges/college-1/imports/source/active-processing.xlsx";
    const job = {
      id: "00000000-0000-4000-8000-000000000093",
      collegeId: "college-1",
      requestedById: "admin-1",
      entityType: "PEOPLE",
      status: "PROCESSING",
      sourceStorageKey,
      sourceExpiresAt: new Date("2026-08-23T00:00:00.000Z"),
    };
    const queueJob = {
      getState: jest.fn().mockResolvedValue("active"),
      remove: jest.fn(),
    };
    const files = { deleteSource: jest.fn() };
    const transaction = jest.fn();
    const importService = Object.create(
      ImportsService.prototype,
    ) as ImportsService;
    Object.defineProperties(importService, {
      prisma: {
        value: {
          importJob: { findMany: jest.fn().mockResolvedValue([job]) },
          $transaction: transaction,
        },
      },
      files: { value: files },
      queue: { value: { getJob: jest.fn().mockResolvedValue(queueJob) } },
      logger: { value: { error: jest.fn(), warn: jest.fn() } },
    });
    const cleanup = (
      importService as unknown as { cleanupExpiredSources(): Promise<void> }
    ).cleanupExpiredSources.bind(importService);

    await cleanup();

    expect(queueJob.remove).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(files.deleteSource).not.toHaveBeenCalled();
  });

  it("refuses People rollback when preserved audit or other dependencies block user deletion", async () => {
    const importService = Object.create(
      ImportsService.prototype,
    ) as ImportsService;
    const job = {
      id: "00000000-0000-4000-8000-000000000060",
      collegeId: "college-1",
      requestedById: "admin-1",
      entityType: "PEOPLE",
      status: "COMPLETED",
      resultStorageKey: null,
    };
    const prisma = {
      importJob: { findFirst: jest.fn().mockResolvedValue(job) },
      importJobRecord: {
        findMany: jest.fn().mockResolvedValue([
          {
            rowNumber: 2,
            model: "User",
            recordId: "00000000-0000-4000-8000-000000000061",
            label: "AVS001 - Arun Kumar",
          },
        ]),
      },
      $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) =>
        work({}),
      ),
    };
    const handler = {
      rollback: jest.fn().mockRejectedValue(
        Object.assign(new Error("Foreign key dependency"), {
          code: "P2003",
        }),
      ),
    };
    Object.defineProperties(importService, {
      prisma: { value: prisma },
      handler: { value: handler },
    });
    const actor = {
      id: "admin-1",
      collegeId: "college-1",
      permissions: ["users.import"],
    } as AuthPrincipal;

    await expect(
      importService.rollback(actor, job.id, "request-rollback"),
    ).rejects.toThrow(
      "Rollback is no longer safe because one or more imported records are now referenced by other data.",
    );
    expect(handler.rollback).toHaveBeenCalledWith(
      "college-1",
      [
        expect.objectContaining({
          model: "User",
          id: "00000000-0000-4000-8000-000000000061",
        }),
      ],
      expect.objectContaining({
        entityType: "PEOPLE",
        importJobId: job.id,
      }),
      expect.any(Object),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("generates formula-safe confidential credential workbooks", async () => {
    const rows: CredentialExportRow[] = [
      {
        rowNumber: 2,
        userId: "00000000-0000-0000-0000-000000000001",
        fullName: "Formula Safe",
        role: "FACULTY",
        loginId: '=HYPERLINK("https://example.invalid")',
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
      '\'=HYPERLINK("https://example.invalid")',
    );
    expect(worksheet?.getCell("E6").text).toBe("+Temporary@123");
    expect(worksheet?.getCell("F6").text).toBe("true");
  });
});
