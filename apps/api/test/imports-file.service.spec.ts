import { ConfigService } from "@nestjs/config";
import { Workbook } from "exceljs";

import type { AuthPrincipal } from "../src/common/http/request-context";
import type { CredentialExportRow } from "../src/modules/imports/import.types";
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

  it("accepts student sheets that use student_id as the login ID", async () => {
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
    expect(parsed.errors).toEqual([]);
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
      roll_number: "24CSE009",
      email: "leading.zero@example.edu",
      temporary_password: "001234",
      admission_year: "2024",
      year: "2",
      semester_number: "3",
      section_code: "A",
    });
    expect(parsed.errors).toEqual([]);
  });

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
      year: "THIRD_YEAR",
      semester_number: "5",
      section_code: "B",
    });
    expect(parsed.errors).toEqual([]);
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
  });

  it("rejects legacy XLS files with conversion guidance", () => {
    expect(() =>
      service.validateFile({
        buffer: Buffer.from("legacy"),
        originalname: "staff.xls",
        size: 6,
      } as Express.Multer.File),
    ).toThrow("Save legacy .xls files as .xlsx");
  });
});

describe("ImportsService Excel workbooks", () => {
  const service = Object.create(ImportsService.prototype) as ImportsService;

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
    expect(worksheet?.getCell("A1").text).toBe("employee_id");
    expect(worksheet?.getCell("A2").text).toBe("E101");
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
