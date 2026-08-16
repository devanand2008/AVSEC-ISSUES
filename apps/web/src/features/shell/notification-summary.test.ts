import { describe, expect, it } from "vitest";
import {
  compactBadgeCount,
  navigationBadgeCount,
  type NotificationSummary,
} from "./notification-summary";

const summary: NotificationSummary = {
  all: 30,
  unread: 12,
  urgent: 5,
  assigned: 8,
  completed: 3,
  escalations: 3,
  escalatedIssues: 3,
  pendingIssues: 18,
  overdueIssues: 4,
  unacknowledgedIssues: 6,
  assignedIssues: 7,
  resolvedToday: 2,
  averageResolutionMinutes: 138,
  alerts: [],
};

describe("navigationBadgeCount", () => {
  it.each([
    ["/notifications", 12],
    ["/issues", 18],
    ["/assigned", 7],
    ["/admin/escalation", 3],
    ["/messages", null],
  ])("maps %s to its useful scoped count", (href, count) => {
    expect(navigationBadgeCount(href, summary)).toBe(count);
  });

  it("hides zero and unavailable counts", () => {
    expect(navigationBadgeCount("/notifications", { ...summary, unread: 0 })).toBeNull();
    expect(navigationBadgeCount("/notifications", undefined)).toBeNull();
  });
});

describe("compactBadgeCount", () => {
  it("caps large visual counts without changing accessible labels", () => {
    expect(compactBadgeCount(12)).toBe("12");
    expect(compactBadgeCount(120)).toBe("99+");
  });
});
