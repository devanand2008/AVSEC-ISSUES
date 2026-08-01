import { createHash } from "node:crypto";

type FeedbackRule = "ONCE_PER_DAY" | "ONCE_PER_WEEK" | "ONCE_PER_CYCLE" | "UNLIMITED";

function extractFeedbackToken(raw: string): string {
  const input = decodeURIComponent(raw).trim();
  const token = input.startsWith("http://") || input.startsWith("https://")
    ? new URL(input).pathname.split("/").filter(Boolean).pop() ?? ""
    : input;
  if (!/^FB_[A-Za-z0-9_-]{16,160}$/.test(token)) throw new Error("Invalid feedback QR token format.");
  return token;
}

function hashFeedbackToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function duplicateWindow(rule: FeedbackRule, now: Date, cycleId?: string) {
  if (rule === "UNLIMITED") return {};
  if (rule === "ONCE_PER_CYCLE" && cycleId) return { feedbackCycleId: cycleId };
  const since = rule === "ONCE_PER_WEEK"
    ? new Date(now.getTime() - 7 * 86400_000)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { submittedAt: { gte: since } };
}

function average(values: number[]): number {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function sentiment(rating: number): "POSITIVE" | "NEUTRAL" | "NEGATIVE" {
  if (rating >= 4) return "POSITIVE";
  if (rating <= 2) return "NEGATIVE";
  return "NEUTRAL";
}

function priority(rating: number, complaint?: string): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (rating <= 1 || (complaint && /unsafe|harass|threat|urgent|danger|fire|abuse/i.test(complaint))) return "CRITICAL";
  if (rating <= 2 || complaint) return "HIGH";
  if (rating === 3) return "MEDIUM";
  return "LOW";
}

function attendanceStatus(percentage: number, thresholds = { required: 75, warning: 65, critical: 50 }): "SAFE" | "WARNING" | "CRITICAL" {
  if (percentage >= thresholds.required) return "SAFE";
  if (percentage >= thresholds.warning) return "WARNING";
  return "CRITICAL";
}

function classesNeeded(attended: number, total: number, requiredPercentage: number): number {
  const required = requiredPercentage / 100;
  if (required >= 1) return 0;
  if (total > 0 && attended / total >= required) return 0;
  return Math.max(0, Math.ceil(((required * total) - attended) / (1 - required)));
}

function managementStudent(identityVisible: boolean, isAnonymous: boolean) {
  return identityVisible && !isAnonymous ? { publicId: "student-public-id" } : null;
}

describe("Smart Campus QR security", () => {
  it("accepts opaque feedback tokens from raw scanner output", () => {
    expect(extractFeedbackToken("FB_abcdefghijklmnopqrstuvwxyz123456")).toBe("FB_abcdefghijklmnopqrstuvwxyz123456");
  });

  it("accepts opaque feedback tokens embedded in student feedback URLs", () => {
    const url = "https://avs.example.edu/feedback/scan/FB_abcdefghijklmnopqrstuvwxyz123456";
    expect(extractFeedbackToken(url)).toBe("FB_abcdefghijklmnopqrstuvwxyz123456");
  });

  it("rejects raw database-style UUIDs and short predictable codes", () => {
    expect(() => extractFeedbackToken("1b4d87d2-b2b8-4549-b7de-aa71d29c8308")).toThrow("Invalid feedback QR token format.");
    expect(() => extractFeedbackToken("FB_123")).toThrow("Invalid feedback QR token format.");
  });

  it("stores lookup material as a SHA-256 hash instead of the visible QR token", () => {
    const token = "FB_abcdefghijklmnopqrstuvwxyz123456";
    const hash = hashFeedbackToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
  });
});

describe("Smart Campus feedback workflow rules", () => {
  const now = new Date("2026-07-18T10:15:00.000Z");

  it("uses same-day duplicate protection by default", () => {
    expect(duplicateWindow("ONCE_PER_DAY", now)).toEqual({
      submittedAt: { gte: new Date("2026-07-18T00:00:00.000Z") },
    });
  });

  it("supports week, cycle and unlimited submission rules", () => {
    expect(duplicateWindow("ONCE_PER_WEEK", now)).toEqual({
      submittedAt: { gte: new Date("2026-07-11T10:15:00.000Z") },
    });
    expect(duplicateWindow("ONCE_PER_CYCLE", now, "cycle-001")).toEqual({ feedbackCycleId: "cycle-001" });
    expect(duplicateWindow("UNLIMITED", now)).toEqual({});
  });

  it("derives rating sentiment and escalation priority consistently", () => {
    expect(average([5, 4, 4])).toBe(4);
    expect(sentiment(4)).toBe("POSITIVE");
    expect(sentiment(3)).toBe("NEUTRAL");
    expect(sentiment(2)).toBe("NEGATIVE");
    expect(priority(5)).toBe("LOW");
    expect(priority(3)).toBe("MEDIUM");
    expect(priority(2)).toBe("HIGH");
    expect(priority(5, "There is an unsafe lab condition")).toBe("CRITICAL");
  });

  it("keeps student identity hidden unless visibility is enabled and feedback is not anonymous", () => {
    expect(managementStudent(false, false)).toBeNull();
    expect(managementStudent(true, true)).toBeNull();
    expect(managementStudent(true, false)).toEqual({ publicId: "student-public-id" });
  });
});

describe("Smart Campus attendance analytics", () => {
  it("labels attendance buckets by configured thresholds", () => {
    expect(attendanceStatus(82)).toBe("SAFE");
    expect(attendanceStatus(70)).toBe("WARNING");
    expect(attendanceStatus(49)).toBe("CRITICAL");
  });

  it("calculates shortage classes needed to reach the required percentage", () => {
    expect(classesNeeded(56, 80, 75)).toBe(16);
    expect(classesNeeded(75, 100, 75)).toBe(0);
    expect(classesNeeded(0, 0, 75)).toBe(0);
  });
});
