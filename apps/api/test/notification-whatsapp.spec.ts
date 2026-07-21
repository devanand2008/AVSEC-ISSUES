/**
 * Notification channel & WhatsApp provider mock tests.
 * Tests the channel strategy pattern, template rendering, and delivery attempt logic.
 */

/* ─── Channel enum ─── */
const CHANNELS = ["IN_APP", "PUSH", "WHATSAPP", "EMAIL", "SMS"] as const;
type Channel = typeof CHANNELS[number];

/* ─── Template rendering ─── */
interface NotificationTemplate {
  id: string;
  channel: Channel;
  event: string;
  subject: string | null;
  body: string;
  isActive: boolean;
}

function renderTemplate(template: NotificationTemplate, variables: Record<string, string>): { subject: string | null; body: string } {
  let body = template.body;
  let subject = template.subject;
  for (const [key, value] of Object.entries(variables)) {
    const token = `{{${key}}}`;
    body = body.replaceAll(token, value);
    if (subject) subject = subject.replaceAll(token, value);
  }
  return { subject, body };
}

/* ─── Mock WhatsApp provider ─── */
interface WhatsAppMessage {
  to: string;
  body: string;
  templateName?: string;
  templateVars?: Record<string, string>;
}

function makeWhatsAppProvider(shouldSucceed = true) {
  const sent: WhatsAppMessage[] = [];
  return {
    send: jest.fn(async (msg: WhatsAppMessage) => {
      if (!shouldSucceed) throw new Error("WhatsApp API error: rate limited");
      sent.push(msg);
      return { messageId: `wamid-${Math.random()}`, status: "sent" };
    }),
    getSent: () => sent,
  };
}

/* ─── Delivery attempt tracker ─── */
type DeliveryStatus = "PENDING" | "SENT" | "FAILED" | "RETRYING";

interface DeliveryAttempt {
  id: string;
  notificationId: string;
  channel: Channel;
  recipient: string;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
}

function makeAttempt(overrides: Partial<DeliveryAttempt> = {}): DeliveryAttempt {
  return {
    id: "attempt-001",
    notificationId: "notif-001",
    channel: "WHATSAPP",
    recipient: "+919876543210",
    status: "PENDING",
    attempts: 0,
    lastError: null,
    ...overrides,
  };
}

const MAX_RETRIES = 3;

function shouldRetry(attempt: DeliveryAttempt): boolean {
  return attempt.status === "FAILED" && attempt.attempts < MAX_RETRIES;
}

describe("Notification channel validation", () => {
  it.each(CHANNELS)("recognises valid channel: %s", (channel) => {
    expect(CHANNELS.includes(channel)).toBe(true);
  });

  it("rejects an unknown channel", () => {
    expect(CHANNELS.includes("TELEGRAM" as Channel)).toBe(false);
  });
});

describe("Template rendering", () => {
  const template: NotificationTemplate = {
    id: "tpl-001",
    channel: "EMAIL",
    event: "ISSUE_CREATED",
    subject: "New issue: {{title}}",
    body: "Hello {{name}}, your issue '{{title}}' has been raised as {{issueNumber}}.",
    isActive: true,
  };

  it("replaces all placeholders with provided variables", () => {
    const vars = { name: "Alice", title: "Fan broken", issueNumber: "ISS-2026-001" };
    const result = renderTemplate(template, vars);
    expect(result.body).toBe("Hello Alice, your issue 'Fan broken' has been raised as ISS-2026-001.");
    expect(result.subject).toBe("New issue: Fan broken");
  });

  it("leaves unmatched placeholders unchanged", () => {
    const vars = { name: "Alice" };
    const result = renderTemplate(template, vars);
    expect(result.body).toContain("{{title}}");
  });

  it("handles subject-less templates (SMS / push)", () => {
    const smsTemplate: NotificationTemplate = { ...template, channel: "SMS", subject: null };
    const result = renderTemplate(smsTemplate, { name: "Bob", title: "Leak", issueNumber: "ISS-001" });
    expect(result.subject).toBeNull();
    expect(result.body).toContain("Bob");
  });

  it("renders an empty body for empty template", () => {
    const empty: NotificationTemplate = { ...template, body: "", subject: null };
    const result = renderTemplate(empty, {});
    expect(result.body).toBe("");
  });
});

describe("WhatsApp provider mock — success path", () => {
  it("sends a message and returns a messageId", async () => {
    const provider = makeWhatsAppProvider(true);
    const result = await provider.send({ to: "+919876543210", body: "Your issue ISS-001 has been assigned." });
    expect(result.status).toBe("sent");
    expect(result.messageId).toMatch(/^wamid-/);
    expect(provider.getSent()).toHaveLength(1);
  });

  it("accumulates multiple sent messages", async () => {
    const provider = makeWhatsAppProvider(true);
    await provider.send({ to: "+911111111111", body: "Message 1" });
    await provider.send({ to: "+912222222222", body: "Message 2" });
    expect(provider.getSent()).toHaveLength(2);
  });
});

describe("WhatsApp provider mock — failure path", () => {
  it("throws on API error", async () => {
    const provider = makeWhatsAppProvider(false);
    await expect(provider.send({ to: "+919876543210", body: "Test" })).rejects.toThrow("WhatsApp API error");
  });
});

describe("Delivery attempt retry logic", () => {
  it("should retry a FAILED attempt below max retries", () => {
    const attempt = makeAttempt({ status: "FAILED", attempts: 2 });
    expect(shouldRetry(attempt)).toBe(true);
  });

  it("should NOT retry when max retries reached", () => {
    const attempt = makeAttempt({ status: "FAILED", attempts: 3 });
    expect(shouldRetry(attempt)).toBe(false);
  });

  it("should NOT retry a SENT attempt", () => {
    const attempt = makeAttempt({ status: "SENT", attempts: 1 });
    expect(shouldRetry(attempt)).toBe(false);
  });

  it("should NOT retry a PENDING attempt", () => {
    const attempt = makeAttempt({ status: "PENDING", attempts: 0 });
    expect(shouldRetry(attempt)).toBe(false);
  });

  it("tracks last error message", () => {
    const attempt = makeAttempt({ status: "FAILED", lastError: "Connection refused", attempts: 1 });
    expect(attempt.lastError).toBe("Connection refused");
    expect(shouldRetry(attempt)).toBe(true);
  });
});
