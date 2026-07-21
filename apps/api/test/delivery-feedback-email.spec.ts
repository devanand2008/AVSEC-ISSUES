import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../src/database/prisma.service";
import { DeliveryService } from "../src/modules/delivery/delivery.service";
import { DeviceRegistrationService } from "../src/modules/notifications/device-registration.service";

const mockQueueAdd = jest.fn();
const mockSendMail = jest.fn();

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: mockQueueAdd, close: jest.fn(), on: jest.fn() })),
  Worker: jest.fn().mockImplementation(() => ({ close: jest.fn(), on: jest.fn() })),
}));

jest.mock("nodemailer", () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(() => ({ sendMail: mockSendMail, close: jest.fn() })),
  },
}));

interface DeliveryInternals {
  channelsForEvent(eventType: string, aggregateId: string): Promise<Array<"PUSH" | "WHATSAPP" | "EMAIL">>;
  sendEmail(notification: { title: string; body: string; relatedEntityType?: string; relatedEntityId?: string }, address: string | null): Promise<string | undefined>;
  trackFeedbackDelivery(
    notification: { type: string; relatedEntityType?: string; relatedEntityId?: string },
    channel: "PUSH" | "WHATSAPP" | "EMAIL",
    recipient: string,
    status: "SENT" | "DISABLED" | "FAILED",
    providerReference?: string,
    errorMessage?: string,
  ): Promise<void>;
}

function serviceWith(options: { settings?: Record<string, unknown>; config?: Record<string, unknown>; existingTrackingId?: string } = {}) {
  const feedbackNotification = {
    findFirst: jest.fn().mockResolvedValue(options.existingTrackingId ? { id: options.existingTrackingId } : null),
    create: jest.fn().mockResolvedValue({ id: "tracking-new" }),
    update: jest.fn().mockResolvedValue({ id: options.existingTrackingId ?? "tracking-new" }),
  };
  const prisma = {
    feedbackSubmission: { findUnique: jest.fn().mockResolvedValue({ collegeId: "college-1" }) },
    appSetting: { findUnique: jest.fn().mockResolvedValue({ value: options.settings ?? {} }) },
    feedbackNotification,
  };
  const values: Record<string, unknown> = {
    REDIS_URL: "redis://localhost:6379",
    EMAIL_ENABLED: false,
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    EMAIL_FROM_NAME: "AVS Engineering College",
    WEB_URL: "https://college.example.edu",
    ...options.config,
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
    getOrThrow: jest.fn((key: string) => {
      if (values[key] === undefined) throw new Error(`Missing ${key}`);
      return values[key];
    }),
  };
  const delivery = new DeliveryService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    {} as DeviceRegistrationService,
  );
  return { delivery, internals: delivery as unknown as DeliveryInternals, prisma, feedbackNotification };
}

describe("feedback delivery channel policy", () => {
  beforeEach(() => {
    mockQueueAdd.mockReset();
    mockSendMail.mockReset();
  });

  it("uses the per-college feedback settings to select external channels", async () => {
    const { internals } = serviceWith({ settings: { emailAlertsEnabled: true, whatsAppAlertsEnabled: false } });
    await expect(internals.channelsForEvent("feedback.submitted", "submission-1")).resolves.toEqual(["PUSH", "EMAIL"]);
  });

  it("keeps existing issue delivery channels unchanged", async () => {
    const { internals } = serviceWith();
    await expect(internals.channelsForEvent("issue.created", "issue-1")).resolves.toEqual(["PUSH", "WHATSAPP"]);
  });

  it("sends a text and escaped HTML email with a secure dashboard link", async () => {
    mockSendMail.mockResolvedValue({ messageId: "smtp-message-1" });
    const { internals } = serviceWith({
      config: {
        EMAIL_ENABLED: true,
        SMTP_HOST: "smtp.example.edu",
        EMAIL_FROM_ADDRESS: "alerts@example.edu",
      },
    });
    await expect(internals.sendEmail({
      title: "Feedback alert",
      body: "CSE <Lab> needs review",
      relatedEntityType: "FeedbackSubmission",
      relatedEntityId: "submission-1",
    }, "principal@example.edu")).resolves.toBe("smtp-message-1");
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "principal@example.edu",
      text: expect.stringContaining("https://college.example.edu/admin/feedback/submissions"),
      html: expect.stringContaining("CSE &lt;Lab&gt; needs review"),
    }));
  });

  it("records and updates channel-specific feedback delivery status", async () => {
    const created = serviceWith();
    await created.internals.trackFeedbackDelivery(
      { type: "FEEDBACK_ALERT", relatedEntityType: "FeedbackSubmission", relatedEntityId: "submission-1" },
      "EMAIL",
      "principal@example.edu",
      "SENT",
      "smtp-message-1",
    );
    expect(created.feedbackNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ submissionId: "submission-1", channel: "EMAIL", status: "SENT", providerReference: "smtp-message-1" }),
    });

    const updated = serviceWith({ existingTrackingId: "tracking-1" });
    await updated.internals.trackFeedbackDelivery(
      { type: "FEEDBACK_ALERT", relatedEntityType: "FeedbackSubmission", relatedEntityId: "submission-1" },
      "EMAIL",
      "principal@example.edu",
      "FAILED",
      undefined,
      "SMTP unavailable",
    );
    expect(updated.feedbackNotification.update).toHaveBeenCalledWith({
      where: { id: "tracking-1" },
      data: expect.objectContaining({ status: "FAILED", errorMessage: "SMTP unavailable" }),
    });
  });
});
