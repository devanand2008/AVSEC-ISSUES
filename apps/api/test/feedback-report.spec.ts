import { Workbook } from "exceljs";
import {
  createFeedbackReportPdf,
  createFeedbackReportXlsx,
  type FeedbackReportMetadata,
  type FeedbackReportRow,
  neutralizeSpreadsheetCell,
} from "../src/modules/feedback/feedback-report";

const metadata: FeedbackReportMetadata = {
  collegeName: "AVS Engineering College",
  generatedAt: new Date("2026-07-19T12:00:00.000Z"),
  filterSummary: "department=CSE; status=NEW",
  maximumRows: 50_000,
};

function row(index = 1): FeedbackReportRow {
  return {
    referenceNumber: `AVS-FB-20260719-${String(index).padStart(8, "0")}`,
    submittedAt: new Date(`2026-07-19T${String(index % 24).padStart(2, "0")}:00:00.000Z`),
    targetType: "STAFF",
    targetName: index === 1 ? "=HYPERLINK(\"https://evil.example\")" : `Faculty ${index}`,
    department: "Computer Science and Engineering",
    overallRating: (index % 5) + 1,
    sentiment: index % 3 === 0 ? "NEGATIVE" : index % 2 === 0 ? "NEUTRAL" : "POSITIVE",
    status: index % 4 === 0 ? "RESOLVED" : "ACTION_REQUIRED",
    priority: index % 3 === 0 ? "CRITICAL" : "HIGH",
    positiveComment: index === 1 ? "+SUM(1,1)" : `Positive comment ${index}`,
    improvementComment: `Improvement comment ${index}`,
    generalComment: `General comment ${index}`,
    complaintText: index % 3 === 0 ? `Complaint ${index}` : "",
    categoryRatings: "Teaching:5; Support:4",
  };
}

describe("feedback report renderers", () => {
  it("creates a genuine styled XLSX and neutralizes formula-like cells", async () => {
    const output = await createFeedbackReportXlsx([row()], metadata);
    expect(output.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4B, 0x03, 0x04]));

    const workbook = new Workbook();
    await workbook.xlsx.load(output as never);
    expect(workbook.getWorksheet("Summary")?.getCell("A1").value).toContain("Feedback Report");
    const sheet = workbook.getWorksheet("Feedback");
    expect(sheet?.getCell("D2").value).toBe("'=HYPERLINK(\"https://evil.example\")");
    expect(sheet?.getCell("J2").value).toBe("'+SUM(1,1)");
    expect(sheet?.autoFilter).toBeDefined();
  });

  it("creates a genuine paginated printable PDF", async () => {
    const output = await createFeedbackReportPdf(Array.from({ length: 70 }, (_, index) => row(index + 1)), metadata);
    expect(output.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(output.length).toBeGreaterThan(15_000);
    const pageObjects = output.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [];
    expect(pageObjects.length).toBeGreaterThan(1);
  }, 20_000);

  it("neutralizes all spreadsheet formula trigger prefixes", () => {
    expect(neutralizeSpreadsheetCell("=1+1")).toBe("'=1+1");
    expect(neutralizeSpreadsheetCell("+SUM(A1:A2)")).toBe("'+SUM(A1:A2)");
    expect(neutralizeSpreadsheetCell("-2+3")).toBe("'-2+3");
    expect(neutralizeSpreadsheetCell("@command")).toBe("'@command");
    expect(neutralizeSpreadsheetCell("safe text")).toBe("safe text");
  });
});
