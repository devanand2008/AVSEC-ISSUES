import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { NotificationSummary } from "@/features/shell/notification-summary";
import type { DashboardMetrics } from "./dashboard-types";
import { formatResolutionTime, OperationsSummary } from "./operations-summary";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));

const metrics: DashboardMetrics = {
  openIssues: 18,
  newIssues: 5,
  unassignedIssues: 2,
  criticalIssues: 1,
  overdueIssues: 4,
  resolvedToday: 7,
  unreadNotifications: 12,
  averageAcknowledgementMinutes: 15,
  averageResolutionMinutes: 138,
  slaCompliancePercentage: 94,
  escalatedIssues: 3,
  notificationFailures: 0,
};

describe("OperationsSummary", () => {
  it("renders the compact summary endpoint metrics as links to working filters", async () => {
    const liveSummary: NotificationSummary = {
      all: 20,
      unread: 9,
      urgent: 6,
      assigned: 4,
      completed: 2,
      escalations: 3,
      escalatedIssues: 8,
      pendingIssues: 21,
      overdueIssues: 6,
      unacknowledgedIssues: 9,
      assignedIssues: 4,
      resolvedToday: 2,
      averageResolutionMinutes: 61,
      alerts: [],
    };
    vi.mocked(api.get).mockResolvedValue(liveSummary);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <OperationsSummary metrics={metrics} />
      </QueryClientProvider>,
    );

    const summary = screen.getByRole("region", { name: "Issue operations summary" });
    expect(await screen.findByText("21")).toBeVisible();
    expect(summary).toHaveTextContent("6");
    expect(summary).toHaveTextContent("9");
    expect(summary).toHaveTextContent("8");
    expect(summary).toHaveTextContent("1h 1m");
    expect(screen.getByRole("link", { name: /Overdue issues/i })).toHaveAttribute(
      "href",
      "/notifications?filter=overdue",
    );
    expect(screen.getByRole("link", { name: /Unacknowledged/i })).toHaveAttribute(
      "href",
      "/issues",
    );
  });
});

describe("formatResolutionTime", () => {
  it.each([
    [null, "—"],
    [42, "42m"],
    [120, "2h"],
    [138, "2h 18m"],
    [1_620, "1d 3h"],
  ])("formats %s minutes as %s", (minutes, expected) => {
    expect(formatResolutionTime(minutes)).toBe(expected);
  });
});
