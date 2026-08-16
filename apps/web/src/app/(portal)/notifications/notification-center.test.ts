import { describe, expect, it } from "vitest";
import {
  actionIsAllowed,
  buildNotificationQuery,
  formatNotificationType,
  formatRelativeTime,
  notificationHref,
  updateNotificationItem,
  visibleActions,
  type NotificationAction,
  type NotificationItem,
  type NotificationResult,
} from "./notification-center";

const acknowledge: NotificationAction = {
  id: "acknowledge",
  label: "Acknowledge",
  method: "POST",
  href: "/issues/issue-1/acknowledge",
  requiresConfirmation: false,
};

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "recipient-1",
    readAt: null,
    createdAt: "2026-08-15T10:00:00.000Z",
    actions: [acknowledge, { id: "view_ticket", label: "View ticket", method: "GET", href: "/issues/issue-1", requiresConfirmation: false }],
    notification: {
      type: "ISSUE_ESCALATED",
      title: "Acknowledgement overdue",
      body: "The assigned issue needs attention.",
      priority: "CRITICAL",
      relatedEntityType: "Issue",
      relatedEntityId: "issue-1",
      data: { issueNumber: "AVS-ISS-1" },
      context: {
        issueId: "issue-1",
        issueNumber: "AVS-ISS-1",
        title: "Electrical issue",
        category: "Electrical",
        status: "ASSIGNED",
        priority: "CRITICAL",
        location: "Block B · Room 204",
        assignedTo: "Maintenance One",
        acknowledgedAt: null,
        resolutionDueAt: "2026-08-15T10:30:00.000Z",
        isOverdue: true,
        isEscalation: true,
        escalationLevel: 1,
      },
      createdAt: "2026-08-15T10:00:00.000Z",
    },
    ...overrides,
  };
}

describe("notification center helpers", () => {
  it("builds a paginated, structured filter query and trims search", () => {
    expect(buildNotificationQuery({ page: 2, pageSize: 20, filter: "urgent", search: "  AVS-ISS-1  ", sort: "priority" }))
      .toBe("/notifications?page=2&pageSize=20&filter=urgent&sort=priority&search=AVS-ISS-1");
  });

  it("uses structured entity context for the safe destination", () => {
    expect(notificationHref(item())).toBe("/issues/issue-1");
    expect(notificationHref(item({ notification: { ...item().notification, context: null, relatedEntityType: "Conversation" } }))).toBe("/messages");
  });

  it("defensively hides a sensitive action without its permission", () => {
    expect(actionIsAllowed(acknowledge, [])).toBe(false);
    expect(actionIsAllowed(acknowledge, ["issues.acknowledge"])).toBe(true);
    expect(visibleActions(item(), []).map((action) => action.id)).toEqual(["view_ticket", "mark_read"]);
  });

  it("does not invent issue workflow actions when the server supplies none", () => {
    expect(visibleActions(item({ actions: [] }), ["issues.acknowledge"]).map((action) => action.id)).toEqual(["mark_read"]);
  });

  it("rejects unknown server actions instead of issuing an unsafe mutation", () => {
    const unknown: NotificationAction = { id: "escalate", label: "Escalate", method: "POST", href: "/unknown", requiresConfirmation: true };
    expect(actionIsAllowed(unknown, ["issues.assign"])).toBe(false);
    expect(visibleActions(item({ actions: [unknown] }), ["issues.assign"]).map((action) => action.id)).toEqual(["mark_read"]);
  });

  it("updates only the intended cached recipient", () => {
    const second = item({ id: "recipient-2", readAt: "2026-08-15T10:01:00.000Z" });
    const result: NotificationResult = { unread: 1, data: [item(), second], meta: { page: 1, pageSize: 20, total: 2, pageCount: 1 } };
    const updated = updateNotificationItem(result, "recipient-1", (entry) => ({ ...entry, readAt: "2026-08-15T10:02:00.000Z" }));
    expect(updated?.data[0]?.readAt).toBe("2026-08-15T10:02:00.000Z");
    expect(updated?.data[1]).toBe(second);
  });

  it("formats labels and relative timestamps without parsing notification text", () => {
    expect(formatNotificationType("ISSUE_STATUS_CHANGED")).toBe("Issue Status Changed");
    expect(formatRelativeTime("2026-08-15T09:42:00.000Z", new Date("2026-08-15T10:00:00.000Z").getTime())).toBe("18 minutes ago");
  });
});
