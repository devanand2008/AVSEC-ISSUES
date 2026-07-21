import { existsSync } from "node:fs";
import { resolve } from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

export interface QrPosterTarget {
  targetName: string;
  targetType: string;
  department?: { name: string } | null;
  block?: { name: string } | null;
  floor?: { name: string } | null;
  room?: { name: string; roomNumber?: string | null } | null;
}

export async function createQrPosterPdf(qrUrl: string, target: QrPosterTarget): Promise<Buffer> {
  const qr = await QRCode.toBuffer(qrUrl, { type: "png", margin: 2, width: 960, errorCorrectionLevel: "H" });
  const location = [
    target.department?.name,
    target.block?.name,
    target.floor?.name,
    target.room?.roomNumber ?? target.room?.name,
  ].filter((value): value is string => Boolean(value)).join(" / ");

  return new Promise<Buffer>((resolveBuffer, reject) => {
    const document = new PDFDocument({
      size: "A4",
      margin: 0,
      info: {
        Title: `AVS feedback QR - ${target.targetName}`,
        Author: "AVS Engineering College",
        Subject: "Official Smart Campus feedback QR poster",
      },
    });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolveBuffer(Buffer.concat(chunks)));
    document.on("error", reject);

    const pageWidth = document.page.width;
    document.rect(0, 0, pageWidth, 126).fill("#1d4ed8");
    const logo = logoPath();
    if (logo) {
      document.image(logo, 42, 27, { fit: [72, 72], align: "center", valign: "center" });
    } else {
      document.circle(78, 63, 35).fillAndStroke("#ffffff", "#bfdbfe");
      document.fillColor("#1d4ed8").font("Helvetica-Bold").fontSize(19).text("AVS", 50, 55, { width: 56, align: "center" });
    }
    document.fillColor("#ffffff").font("Helvetica-Bold").fontSize(24).text("AVS Engineering College", 124, 35, { width: pageWidth - 166, align: "center" });
    document.fillColor("#dbeafe").font("Helvetica").fontSize(16).text("We Value Your Feedback", 124, 75, { width: pageWidth - 166, align: "center" });

    document.roundedRect(70, 166, pageWidth - 140, 455, 14).fillAndStroke("#eff6ff", "#bfdbfe");
    document.image(qr, 112, 198, { fit: [pageWidth - 224, 360], align: "center", valign: "center" });
    document.fillColor("#0f172a").font("Helvetica-Bold").fontSize(22).text(target.targetName, 72, 647, { width: pageWidth - 144, align: "center" });
    document.fillColor("#475569").font("Helvetica").fontSize(12).text(target.targetType.replaceAll("_", " "), 72, 680, { width: pageWidth - 144, align: "center" });
    if (location) document.text(location, 72, 700, { width: pageWidth - 144, align: "center" });

    document.fillColor("#1d4ed8").font("Helvetica-Bold").fontSize(20).text("Scan the QR Code", 72, 746, { width: pageWidth - 144, align: "center" });
    document.fillColor("#334155").font("Helvetica").fontSize(13).text("Share Your Rating and Feedback", 72, 776, { width: pageWidth - 144, align: "center" });
    document.fillColor("#64748b").fontSize(10).text("Your Feedback Helps Us Improve • Sign in with your active AVS student account", 54, 812, { width: pageWidth - 108, align: "center" });
    document.end();
  });
}

function logoPath(): string | undefined {
  const candidates = [
    resolve(process.cwd(), "..", "web", "public", "images", "avs-logo-360.png"),
    resolve(process.cwd(), "apps", "web", "public", "images", "avs-logo-360.png"),
    resolve(process.cwd(), "logo", "logo.png"),
    resolve(process.cwd(), "..", "..", "logo", "logo.png"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}
