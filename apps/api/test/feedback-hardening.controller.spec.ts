import { StreamableFile } from "@nestjs/common";
import { HEADERS_METADATA } from "@nestjs/common/constants";
import type { AuthPrincipal, RequestWithId } from "../src/common/http/request-context";
import { AdminFeedbackController } from "../src/modules/feedback/admin-feedback.controller";
import { FeedbackController } from "../src/modules/feedback/feedback.controller";

const user: AuthPrincipal = {
  id: "00000000-0000-0000-0000-000000000001",
  publicId: "00000000-0000-0000-0000-000000000002",
  collegeId: "00000000-0000-0000-0000-000000000003",
  fullName: "Student",
  email: null,
  status: "ACTIVE",
  mustChangePassword: false,
  sessionId: "00000000-0000-0000-0000-000000000004",
  roles: ["STUDENT"],
  permissions: ["feedback.scan", "feedback.submit"],
  scopes: [],
};

describe("FeedbackController hardening metadata", () => {
  const feedback = { scan: jest.fn(), submit: jest.fn() };
  const controller = new FeedbackController(feedback as never);

  beforeEach(() => jest.clearAllMocks());

  it("uses endpoint-specific throttles stricter than the global API limit", () => {
    expect(Reflect.getMetadata("THROTTLER:LIMITdefault", FeedbackController.prototype.scan)).toBe(30);
    expect(Reflect.getMetadata("THROTTLER:TTLdefault", FeedbackController.prototype.scan)).toBe(60_000);
    expect(Reflect.getMetadata("THROTTLER:LIMITdefault", FeedbackController.prototype.submit)).toBe(8);
    expect(Reflect.getMetadata("THROTTLER:TTLdefault", FeedbackController.prototype.submit)).toBe(60_000);
  });

  it("forwards request fingerprint data to scan and submit", async () => {
    const request = {
      ip: "192.0.2.10",
      headers: { "user-agent": "Feedback Test Browser" },
    } as RequestWithId;
    feedback.scan.mockResolvedValue({ submissionTicket: "ticket" });
    feedback.submit.mockResolvedValue({ referenceNumber: "AVS-FB-1" });

    await controller.scan(user, "FB_abcdefghijklmnopqrstuvwxyz123456", request);
    await controller.submit(user, {
      submissionTicket: "signed-ticket-value-that-is-long-enough-for-validation",
      targetId: "00000000-0000-0000-0000-000000000005",
      ratings: [{ questionId: "00000000-0000-0000-0000-000000000006", rating: 5 }],
    }, "request-1", request);

    expect(feedback.scan).toHaveBeenCalledWith(user, "FB_abcdefghijklmnopqrstuvwxyz123456", {
      ip: "192.0.2.10",
      userAgent: "Feedback Test Browser",
    });
    expect(feedback.submit).toHaveBeenCalledWith(user, expect.objectContaining({ targetId: "00000000-0000-0000-0000-000000000005" }), "request-1", {
      ip: "192.0.2.10",
      userAgent: "Feedback Test Browser",
    });
  });
});

describe("AdminFeedbackController report downloads", () => {
  const feedback = {
    exportXlsx: jest.fn().mockResolvedValue(Buffer.from([0x50, 0x4B, 0x03, 0x04])),
    exportPdf: jest.fn().mockResolvedValue(Buffer.from("%PDF-1.7")),
  };
  const controller = new AdminFeedbackController(feedback as never);
  const query = { page: 1, pageSize: 20, sortBy: "submittedAt" as const, sortOrder: "desc" as const };

  it("returns StreamableFile responses for XLSX and PDF exports", async () => {
    await expect(controller.exportXlsx(user, "request-xlsx", query)).resolves.toBeInstanceOf(StreamableFile);
    await expect(controller.exportPdf(user, "request-pdf", query)).resolves.toBeInstanceOf(StreamableFile);
    expect(feedback.exportXlsx).toHaveBeenCalledWith(user, "request-xlsx", query);
    expect(feedback.exportPdf).toHaveBeenCalledWith(user, "request-pdf", query);
  });

  it("declares correct report filenames and content types", () => {
    const xlsxHeaders = headersFor(AdminFeedbackController.prototype.exportXlsx);
    const pdfHeaders = headersFor(AdminFeedbackController.prototype.exportPdf);
    expect(xlsxHeaders["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(xlsxHeaders["content-disposition"]).toBe("attachment; filename=feedback-report.xlsx");
    expect(pdfHeaders["content-type"]).toBe("application/pdf");
    expect(pdfHeaders["content-disposition"]).toBe("attachment; filename=feedback-report.pdf");
  });
});

function headersFor(handler: (...args: never[]) => unknown): Record<string, string> {
  const headers = Reflect.getMetadata(HEADERS_METADATA, handler) as Array<{ name: string; value: string }> | undefined;
  return Object.fromEntries((headers ?? []).map((header) => [header.name.toLowerCase(), header.value]));
}
