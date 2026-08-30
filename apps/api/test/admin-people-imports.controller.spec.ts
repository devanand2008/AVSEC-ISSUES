import { StreamableFile } from "@nestjs/common";
import { parse } from "csv-parse/sync";
import type { AuthPrincipal } from "../src/common/http/request-context";
import { AdminPeopleImportsController } from "../src/modules/imports/admin-people-imports.controller";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  collegeId: "00000000-0000-4000-8000-000000000002",
  permissions: ["users.import"],
} as AuthPrincipal;

describe("AdminPeopleImportsController error report", () => {
  const batchId = "00000000-0000-4000-8000-000000000003";
  const get = jest.fn();
  const list = jest.fn();
  const confirm = jest.fn();
  const cancel = jest.fn();
  const controller = new AdminPeopleImportsController({
    get,
    list,
    confirm,
    cancel,
  } as never);

  beforeEach(() => jest.clearAllMocks());

  it("downloads only safe, password-free People error columns", async () => {
    get.mockResolvedValue({
      result: {
        errors: [
          {
            rowNumber: 7,
            userId: '=HYPERLINK("https://example.invalid")',
            userName: "+Formula User",
            email: "student@avsenggcollege.ac.in",
            department: "CSE",
            year: "2",
            message: "@Invalid department",
            field: "temporary_password",
            temporaryPassword: "TopSecret@123",
          },
        ],
        credentials: [{ temporaryPassword: "AnotherSecret@123" }],
      },
    });

    const file = await controller.errorReport(user, batchId);
    const content = await streamText(file);
    const rows = parse(content, { bom: true, columns: true }) as Array<
      Record<string, string>
    >;

    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders()).toEqual(
      expect.objectContaining({
        type: "text/csv; charset=utf-8",
        disposition: `attachment; filename="people-import-${batchId}-errors.csv"`,
      }),
    );
    expect(Object.keys(rows[0] ?? {})).toEqual([
      "Row Number",
      "User Name",
      "User ID",
      "Official College Email",
      "Department",
      "Year",
      "Error",
    ]);
    expect(rows).toEqual([
      {
        "Row Number": "7",
        "User Name": "'+Formula User",
        "User ID": '\'=HYPERLINK("https://example.invalid")',
        "Official College Email": "student@avsenggcollege.ac.in",
        Department: "CSE",
        Year: "2",
        Error: "'@Invalid department",
      },
    ]);
    expect(content).not.toMatch(/TopSecret|AnotherSecret|temporary_password/i);
    expect(get).toHaveBeenCalledWith(user, batchId, "PEOPLE");
  });

  it("returns a header-only CSV when the import has no result errors", async () => {
    get.mockResolvedValue({ status: "READY" });

    const file = await controller.errorReport(user, batchId);
    const content = await streamText(file);

    expect(content.replace(/^\uFEFF/, "").trim()).toBe(
      "Row Number,User Name,User ID,Official College Email,Department,Year,Error",
    );
  });

  it("binds every People history, detail and mutation route to PEOPLE jobs", async () => {
    list.mockResolvedValue([]);
    get.mockResolvedValue({ status: "READY" });
    confirm.mockResolvedValue({ status: "QUEUED" });
    cancel.mockResolvedValue({ status: "CANCELLED" });

    await controller.history(user);
    await controller.get(user, batchId);
    await controller.errors(user, batchId);
    await controller.confirm(user, { batchId }, "request-confirm-body");
    await controller.confirmByPath(user, batchId, "request-confirm-path");
    await controller.cancel(user, batchId, "request-cancel");

    expect(list).toHaveBeenCalledWith(user, "PEOPLE");
    expect(get).toHaveBeenNthCalledWith(1, user, batchId, "PEOPLE");
    expect(get).toHaveBeenNthCalledWith(2, user, batchId, "PEOPLE");
    expect(confirm).toHaveBeenNthCalledWith(
      1,
      user,
      batchId,
      "request-confirm-body",
      "PEOPLE",
    );
    expect(confirm).toHaveBeenNthCalledWith(
      2,
      user,
      batchId,
      "request-confirm-path",
      "PEOPLE",
    );
    expect(cancel).toHaveBeenCalledWith(
      user,
      batchId,
      "request-cancel",
      "PEOPLE",
    );
  });
});

async function streamText(file: StreamableFile): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of file.getStream()) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf8");
}
