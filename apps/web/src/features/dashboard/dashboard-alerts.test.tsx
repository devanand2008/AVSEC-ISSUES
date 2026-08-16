import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { NotificationSummary } from "@/features/shell/notification-summary";
import { DashboardAlerts } from "./dashboard-alerts";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), patch: vi.fn() },
}));

const summary: NotificationSummary = {
  all: 3,
  unread: 3,
  urgent: 2,
  assigned: 0,
  completed: 0,
  escalations: 1,
  escalatedIssues: 1,
  pendingIssues: 3,
  overdueIssues: 1,
  unacknowledgedIssues: 2,
  assignedIssues: 0,
  resolvedToday: 0,
  averageResolutionMinutes: null,
  alerts: [
    {
      id: "critical-issues",
      level: "CRITICAL",
      title: "Critical issues require attention",
      message: "One unresolved emergency issue is in scope.",
      dismissible: false,
      action: { label: "View", href: "/issues?priority=CRITICAL" },
      dismissedAt: null,
    },
    {
      id: "delivery-warning",
      level: "WARNING",
      title: "Push notifications not configured",
      message: "Critical alerts may not reach your device.",
      dismissible: true,
      action: { label: "Configure", href: "/settings/notifications" },
      dismissedAt: null,
    },
  ],
};

function renderAlerts() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DashboardAlerts />
    </QueryClientProvider>,
  );
}

describe("DashboardAlerts", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue(summary);
    vi.mocked(api.patch).mockResolvedValue({});
  });

  it("renders priority text and never offers permanent dismissal for critical alerts", async () => {
    renderAlerts();

    expect(await screen.findByText(/Critical: Critical issues require attention/)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveAttribute("data-priority", "CRITICAL");
    expect(screen.queryByRole("button", { name: /Dismiss Critical issues/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "/issues?priority=CRITICAL",
    );
  });

  it("persists dismissible warnings through notification preferences", async () => {
    renderAlerts();
    fireEvent.click(
      await screen.findByRole("button", { name: "Dismiss Push notifications not configured" }),
    );

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/profile/me/notification-preferences",
        expect.objectContaining({
          dismissed_banners: expect.objectContaining({
            "delivery-warning": expect.any(String),
          }),
        }),
      ),
    );
  });
});
