import { Workbook } from "exceljs";
import PDFDocument from "pdfkit";

const brandBlue = "1D4ED8";
const brandNavy = "0F172A";
const brandLightBlue = "DBEAFE";
const brandSlate = "475569";

export interface FeedbackReportRow {
  referenceNumber: string;
  submittedAt: Date;
  targetType: string;
  targetName: string;
  department: string;
  overallRating: number;
  sentiment: string;
  status: string;
  priority: string;
  positiveComment: string;
  improvementComment: string;
  generalComment: string;
  complaintText: string;
  categoryRatings: string;
}

export interface FeedbackReportMetadata {
  collegeName: string;
  generatedAt: Date;
  filterSummary: string;
  maximumRows: number;
}

interface FeedbackReportSummary {
  total: number;
  averageRating: number;
  positive: number;
  neutral: number;
  negative: number;
  openActions: number;
}

export function neutralizeSpreadsheetCell(value: string): string {
  const cleaned = value.replace(/\0/g, "");
  return /^[\t\r=+\-@]/.test(cleaned) ? `'${cleaned}` : cleaned;
}

export async function createFeedbackReportXlsx(rows: FeedbackReportRow[], metadata: FeedbackReportMetadata): Promise<Buffer> {
  const workbook = new Workbook();
  workbook.creator = metadata.collegeName;
  workbook.company = metadata.collegeName;
  workbook.subject = "Authorized feedback report";
  workbook.title = "Feedback Report";
  workbook.created = metadata.generatedAt;
  workbook.modified = metadata.generatedAt;

  const summary = reportSummary(rows);
  const summarySheet = workbook.addWorksheet("Summary", {
    properties: { defaultRowHeight: 20 },
    views: [{ showGridLines: false }],
  });
  summarySheet.columns = [
    { key: "label", width: 32 },
    { key: "value", width: 24 },
    { key: "spacer", width: 4 },
    { key: "label2", width: 32 },
    { key: "value2", width: 24 },
  ];
  summarySheet.mergeCells("A1:E2");
  const title = summarySheet.getCell("A1");
  title.value = `${neutralizeSpreadsheetCell(metadata.collegeName)} — Feedback Report`;
  title.font = { name: "Arial", size: 20, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${brandBlue}` } };
  title.alignment = { vertical: "middle", horizontal: "center" };
  summarySheet.getRow(1).height = 32;
  summarySheet.getRow(2).height = 14;

  summarySheet.addRow([]);
  summarySheet.addRow(["Generated at", metadata.generatedAt.toISOString(), "", "Authorized filter", neutralizeSpreadsheetCell(metadata.filterSummary)]);
  summarySheet.addRow(["Rows exported", summary.total, "", "Maximum rows", metadata.maximumRows]);
  summarySheet.addRow(["Average rating", summary.averageRating, "", "Open actions", summary.openActions]);
  summarySheet.addRow(["Positive", summary.positive, "", "Neutral", summary.neutral]);
  summarySheet.addRow(["Negative", summary.negative]);
  for (let rowNumber = 4; rowNumber <= 8; rowNumber += 1) {
    const row = summarySheet.getRow(rowNumber);
    row.getCell(1).font = { bold: true, color: { argb: `FF${brandNavy}` } };
    row.getCell(4).font = { bold: true, color: { argb: `FF${brandNavy}` } };
    row.alignment = { vertical: "middle", wrapText: true };
  }

  const dataSheet = workbook.addWorksheet("Feedback", {
    properties: { defaultRowHeight: 18 },
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
  });
  dataSheet.columns = [
    { header: "Reference Number", key: "referenceNumber", width: 27 },
    { header: "Submitted At", key: "submittedAt", width: 24 },
    { header: "Target Type", key: "targetType", width: 21 },
    { header: "Target Name", key: "targetName", width: 34 },
    { header: "Department", key: "department", width: 30 },
    { header: "Rating", key: "overallRating", width: 11 },
    { header: "Sentiment", key: "sentiment", width: 15 },
    { header: "Status", key: "status", width: 20 },
    { header: "Priority", key: "priority", width: 14 },
    { header: "Positive Comment", key: "positiveComment", width: 42 },
    { header: "Improvement Comment", key: "improvementComment", width: 42 },
    { header: "General Comment", key: "generalComment", width: 42 },
    { header: "Complaint", key: "complaintText", width: 42 },
    { header: "Category Ratings", key: "categoryRatings", width: 48 },
  ];
  dataSheet.addRows(rows.map((row) => ({
    referenceNumber: neutralizeSpreadsheetCell(row.referenceNumber),
    submittedAt: row.submittedAt,
    targetType: neutralizeSpreadsheetCell(row.targetType),
    targetName: neutralizeSpreadsheetCell(row.targetName),
    department: neutralizeSpreadsheetCell(row.department),
    overallRating: row.overallRating,
    sentiment: neutralizeSpreadsheetCell(row.sentiment),
    status: neutralizeSpreadsheetCell(row.status),
    priority: neutralizeSpreadsheetCell(row.priority),
    positiveComment: neutralizeSpreadsheetCell(row.positiveComment),
    improvementComment: neutralizeSpreadsheetCell(row.improvementComment),
    generalComment: neutralizeSpreadsheetCell(row.generalComment),
    complaintText: neutralizeSpreadsheetCell(row.complaintText),
    categoryRatings: neutralizeSpreadsheetCell(row.categoryRatings),
  })));
  const header = dataSheet.getRow(1);
  header.height = 28;
  header.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${brandBlue}` } };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  dataSheet.autoFilter = { from: "A1", to: "N1" };
  dataSheet.getColumn("submittedAt").numFmt = "yyyy-mm-dd hh:mm";
  dataSheet.getColumn("overallRating").numFmt = "0";
  dataSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
    if (rowNumber % 2 === 0) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    }
    row.eachCell((cell) => {
      cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } };
    });
  });

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

export function createFeedbackReportPdf(rows: FeedbackReportRow[], metadata: FeedbackReportMetadata): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 36,
      bufferPages: true,
      info: {
        Title: `${metadata.collegeName} Feedback Report`,
        Author: metadata.collegeName,
        Subject: "Authorized feedback report",
        CreationDate: metadata.generatedAt,
      },
    });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    const summary = reportSummary(rows);
    let y = drawPdfHeader(document, metadata, summary, true);
    y = drawPdfTableHeader(document, y);

    rows.forEach((row, index) => {
      const rowHeight = 44;
      if (y + rowHeight > document.page.height - 42) {
        document.addPage();
        y = drawPdfHeader(document, metadata, summary, false);
        y = drawPdfTableHeader(document, y);
      }
      drawPdfRow(document, row, y, rowHeight, index % 2 === 1);
      y += rowHeight;
    });

    if (!rows.length) {
      document.fillColor(`#${brandSlate}`).font("Helvetica-Oblique").fontSize(11)
        .text("No feedback records matched the authorized filters.", 36, y + 18, { width: document.page.width - 72, align: "center" });
    }

    const pageRange = document.bufferedPageRange();
    for (let pageIndex = pageRange.start; pageIndex < pageRange.start + pageRange.count; pageIndex += 1) {
      document.switchToPage(pageIndex);
      document.fillColor("#64748B").font("Helvetica").fontSize(8)
        .text(`Authorized feedback export • Page ${pageIndex - pageRange.start + 1} of ${pageRange.count}`, 36, document.page.height - 25, {
          width: document.page.width - 72,
          align: "center",
          lineBreak: false,
        });
    }
    document.end();
  });
}

function reportSummary(rows: FeedbackReportRow[]): FeedbackReportSummary {
  const total = rows.length;
  const averageRating = total ? Math.round((rows.reduce((sum, row) => sum + row.overallRating, 0) / total) * 100) / 100 : 0;
  return {
    total,
    averageRating,
    positive: rows.filter((row) => row.sentiment === "POSITIVE").length,
    neutral: rows.filter((row) => row.sentiment === "NEUTRAL").length,
    negative: rows.filter((row) => row.sentiment === "NEGATIVE").length,
    openActions: rows.filter((row) => ["NEW", "VIEWED", "UNDER_REVIEW", "ASSIGNED", "ACTION_REQUIRED"].includes(row.status)).length,
  };
}

function drawPdfHeader(document: PDFKit.PDFDocument, metadata: FeedbackReportMetadata, summary: FeedbackReportSummary, firstPage: boolean): number {
  const pageWidth = document.page.width;
  document.rect(0, 0, pageWidth, 58).fill(`#${brandBlue}`);
  document.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(18)
    .text(metadata.collegeName, 36, 15, { width: pageWidth - 72, align: "left", lineBreak: false });
  document.fillColor(`#${brandLightBlue}`).font("Helvetica").fontSize(11)
    .text("Feedback Report", 36, 37, { width: 250, lineBreak: false });
  document.fillColor("#FFFFFF").fontSize(8)
    .text(`Generated ${metadata.generatedAt.toISOString()}`, pageWidth - 300, 20, { width: 264, align: "right", lineBreak: false });

  if (!firstPage) return 78;
  document.fillColor(`#${brandSlate}`).font("Helvetica").fontSize(8)
    .text(`Authorized filters: ${pdfText(metadata.filterSummary, 180)}`, 36, 68, { width: pageWidth - 72, lineBreak: false });
  const cards = [
    ["Total", summary.total],
    ["Average", `${summary.averageRating}/5`],
    ["Positive", summary.positive],
    ["Neutral", summary.neutral],
    ["Negative", summary.negative],
    ["Open actions", summary.openActions],
  ] as const;
  const gap = 8;
  const cardWidth = (pageWidth - 72 - (cards.length - 1) * gap) / cards.length;
  cards.forEach(([label, value], index) => {
    const x = 36 + index * (cardWidth + gap);
    document.roundedRect(x, 91, cardWidth, 45, 4).fillAndStroke("#EFF6FF", "#BFDBFE");
    document.fillColor(`#${brandSlate}`).font("Helvetica").fontSize(7).text(label, x + 7, 99, { width: cardWidth - 14, align: "center", lineBreak: false });
    document.fillColor(`#${brandNavy}`).font("Helvetica-Bold").fontSize(13).text(String(value), x + 7, 114, { width: cardWidth - 14, align: "center", lineBreak: false });
  });
  return 151;
}

const pdfColumns = [
  { label: "Reference", key: "referenceNumber", width: 118 },
  { label: "Submitted", key: "submittedAt", width: 78 },
  { label: "Target", key: "targetName", width: 155 },
  { label: "Department", key: "department", width: 125 },
  { label: "Rating", key: "overallRating", width: 42 },
  { label: "Sentiment", key: "sentiment", width: 70 },
  { label: "Status", key: "status", width: 78 },
  { label: "Priority", key: "priority", width: 55 },
] as const;

function drawPdfTableHeader(document: PDFKit.PDFDocument, y: number): number {
  document.rect(36, y, pdfColumns.reduce((sum, column) => sum + column.width, 0), 22).fill(`#${brandNavy}`);
  let x = 36;
  for (const column of pdfColumns) {
    document.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7.5)
      .text(column.label, x + 4, y + 7, { width: column.width - 8, lineBreak: false, align: column.key === "overallRating" ? "center" : "left" });
    x += column.width;
  }
  return y + 22;
}

function drawPdfRow(document: PDFKit.PDFDocument, row: FeedbackReportRow, y: number, height: number, alternate: boolean): void {
  const width = pdfColumns.reduce((sum, column) => sum + column.width, 0);
  document.rect(36, y, width, height).fill(alternate ? "#F8FAFC" : "#FFFFFF");
  document.moveTo(36, y + height).lineTo(36 + width, y + height).strokeColor("#E2E8F0").lineWidth(0.5).stroke();
  const values: Record<(typeof pdfColumns)[number]["key"], string> = {
    referenceNumber: row.referenceNumber,
    submittedAt: row.submittedAt.toISOString().replace("T", " ").slice(0, 16),
    targetName: `${row.targetName} (${row.targetType.replaceAll("_", " ")})`,
    department: row.department || "Unassigned",
    overallRating: `${row.overallRating}/5`,
    sentiment: row.sentiment,
    status: row.status.replaceAll("_", " "),
    priority: row.priority,
  };
  let x = 36;
  for (const column of pdfColumns) {
    document.fillColor(`#${brandNavy}`).font("Helvetica").fontSize(7.2)
      .text(pdfText(values[column.key], column.key === "targetName" ? 52 : 34), x + 4, y + 6, {
        width: column.width - 8,
        height: 15,
        ellipsis: true,
        lineBreak: false,
        align: column.key === "overallRating" ? "center" : "left",
      });
    x += column.width;
  }
  const comments = [row.positiveComment, row.improvementComment, row.generalComment, row.complaintText]
    .filter(Boolean)
    .join(" • ");
  const detail = [comments, row.categoryRatings].filter(Boolean).join(" | ");
  if (detail) {
    document.fillColor("#64748B").font("Helvetica-Oblique").fontSize(6.7)
      .text(pdfText(detail, 180), 40, y + 25, { width: width - 8, height: 12, ellipsis: true, lineBreak: false });
  }
}

function pdfText(value: string, maximumLength: number): string {
  const cleaned = Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? " " : char;
  }).join("").replace(/\s+/g, " ").trim();
  return cleaned.length > maximumLength ? `${cleaned.slice(0, Math.max(0, maximumLength - 1))}…` : cleaned;
}
