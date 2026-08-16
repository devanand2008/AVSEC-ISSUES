import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationItem } from "./notification-item";
import type { NotificationItem as NotificationItemModel } from "./notification-center";

vi.mock("next/link", () => ({
  default: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props} />,
}));

afterEach(cleanup);

const structuredItem: NotificationItemModel = {
  id: "recipient-1",
  readAt: null,
  createdAt: "2026-08-15T10:00:00.000Z",
  actions: [
    { id: "acknowledge", label: "Acknowledge", method: "POST", href: "/issues/issue-1/acknowledge", requiresConfirmation: false },
    { id: "view_ticket", label: "View ticket", method: "GET", href: "/issues/issue-1", requiresConfirmation: false },
  ],
  notification: {
    type: "ISSUE_ESCALATED",
    title: "Acknowledgement overdue",
    body: "The assigned electrical issue needs attention.",
    priority: "CRITICAL",
    relatedEntityType: "Issue",
    relatedEntityId: "issue-1",
    data: { issueNumber: "AVS-ISS-2026-000148" },
    context: {
      issueId: "issue-1",
      issueNumber: "AVS-ISS-2026-000148",
      title: "Electrical issue",
      category: "Electrical",
      status: "ASSIGNED",
      priority: "CRITICAL",
      location: "Block B · Floor 2 · Room 204",
      assignedTo: "Maintenance One",
      acknowledgedAt: null,
      resolutionDueAt: "2026-08-15T10:30:00.000Z",
      isOverdue: true,
      isEscalation: true,
      escalationLevel: 1,
    },
    createdAt: "2026-08-15T10:00:00.000Z",
  },
};

describe("NotificationItem", () => {
  it("renders structured issue, urgency, unread and escalation metadata", () => {
    render(<NotificationItem density="comfortable" item={structuredItem} onAction={vi.fn()} onOpen={vi.fn()} pendingAction={null} permissions={["issues.acknowledge"]} />);

    expect(screen.getByRole("heading", { name: "Acknowledgement overdue" })).toBeVisible();
    expect(screen.getByText("The assigned electrical issue needs attention.")).toBeVisible();
    expect(screen.getByRole("link", { name: "AVS-ISS-2026-000148" })).toHaveAttribute("href", "/issues/issue-1");
    expect(screen.getByText("Electrical")).toBeVisible();
    expect(screen.getByText("Block B · Floor 2 · Room 204")).toBeVisible();
    expect(screen.getByText("CRITICAL")).toBeVisible();
    expect(screen.getByText("ASSIGNED")).toBeVisible();
    expect(screen.getByText("OVERDUE")).toBeVisible();
    expect(screen.getByText("ESCALATED")).toBeVisible();
    expect(screen.getByRole("img", { name: "Unread notification" })).toBeInTheDocument();
  });

  it("runs a server-supplied quick action", () => {
    const onAction = vi.fn();
    render(<NotificationItem density="compact" item={structuredItem} onAction={onAction} onOpen={vi.fn()} pendingAction={null} permissions={["issues.acknowledge"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(onAction).toHaveBeenCalledWith(structuredItem, structuredItem.actions?.[0]);
  });

  it("hides a sensitive action when the current user lacks permission", () => {
    render(<NotificationItem density="comfortable" item={structuredItem} onAction={vi.fn()} onOpen={vi.fn()} pendingAction={null} permissions={[]} />);

    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View ticket" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Mark as read" })).toBeVisible();
  });

  it("does not show an unread marker for a read notification", () => {
    render(<NotificationItem density="comfortable" item={{ ...structuredItem, readAt: "2026-08-15T10:05:00.000Z" }} onAction={vi.fn()} onOpen={vi.fn()} pendingAction={null} permissions={[]} />);

    expect(screen.queryByRole("img", { name: "Unread notification" })).not.toBeInTheDocument();
  });
});
