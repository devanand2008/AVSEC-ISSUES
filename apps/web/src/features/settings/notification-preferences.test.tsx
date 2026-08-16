import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import {
  NotificationPreferencesPage,
  notificationCategoriesForRoles,
} from "./notification-preferences";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), patch: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      fullName: "Main Admin",
      roles: ["MAIN_ADMIN"],
      permissions: ["notifications.read_own", "notifications.preferences"],
    },
  }),
}));

const response = {
  preferences: {
    in_app: true,
    push: true,
    email: true,
    whatsapp: false,
    categories: {
      system_alerts: { in_app: true, push: true, email: true, whatsapp: false },
    },
    quiet_hours: {
      enabled: false,
      start: "22:00",
      end: "06:00",
      allow_critical: true,
    },
    display_density: "comfortable",
  },
  channels: {
    in_app: { supported: true, configured: true, reason: null },
    push: { supported: false, configured: false, reason: "Push is not configured" },
    email: { supported: true, configured: true, reason: null },
    whatsapp: { supported: false, configured: false, reason: "WhatsApp is not configured" },
    sms: { supported: false, configured: false, reason: "SMS is not configured" },
  },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotificationPreferencesPage />
    </QueryClientProvider>,
  );
}

describe("notificationCategoriesForRoles", () => {
  it("shows only role-relevant categories", () => {
    expect(notificationCategoriesForRoles(["STUDENT"])).toContain("avs_learn");
    expect(notificationCategoriesForRoles(["STUDENT"])).not.toContain("backup_alerts");
    expect(notificationCategoriesForRoles(["MAINTENANCE_STAFF"])).toEqual(
      expect.arrayContaining(["issue_assignment", "overdue_warnings", "escalations"]),
    );
    expect(notificationCategoriesForRoles(["MAIN_ADMIN"])).toContain("backup_alerts");
  });

  it("unions categories for users with multiple active roles", () => {
    const categories = notificationCategoriesForRoles([
      "MAINTENANCE_ADMIN",
      "VICE_PRINCIPAL",
      "FACULTY",
    ]);

    expect(categories).toEqual(
      expect.arrayContaining([
        "issue_assignment",
        "overdue_warnings",
        "system_alerts",
        "attendance_alerts",
        "academic_alerts",
      ]),
    );
    expect(categories.indexOf("system_alerts")).toBeLessThan(
      categories.indexOf("issue_assignment"),
    );
  });
});

describe("NotificationPreferencesPage", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue(response);
    vi.mocked(api.patch).mockResolvedValue(response.preferences);
  });

  it("marks unavailable providers without enabling fake channels", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Delivery channels" })).toBeVisible();
    expect(screen.getByRole("switch", { name: "Enable Push" })).toBeDisabled();
    expect(screen.getByText("SMS is not configured")).toBeVisible();
    expect(screen.queryByRole("switch", { name: /SMS/ })).not.toBeInTheDocument();
  });

  it("saves channel choices, quiet hours, and the critical override", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("switch", { name: "Disable Email" }));
    fireEvent.click(screen.getByRole("switch", { name: "Enable quiet hours" }));
    fireEvent.change(screen.getByLabelText("Start time"), {
      target: { value: "21:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/profile/me/notification-preferences",
        expect.objectContaining({
          email: false,
          quiet_hours: expect.objectContaining({
            enabled: true,
            start: "21:30",
            allow_critical: true,
          }),
        }),
      ),
    );
  });
});
