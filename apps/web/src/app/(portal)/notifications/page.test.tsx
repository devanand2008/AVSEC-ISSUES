import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsPage from "./page";
import type {
  NotificationResult,
  NotificationSummary,
} from "./notification-center";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  replace: vi.fn(),
  routeParams: new URLSearchParams(),
  permissions: ["issues.acknowledge", "issues.assign"],
  serverRead: false,
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: mocks.get,
    post: mocks.post,
    patch: mocks.patch,
    delete: mocks.delete,
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/lib/firebase", () => ({
  firebaseBrowserConfigured: () => false,
  requestPushToken: vi.fn(),
}));
vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      fullName: "Maintenance User",
      roles: ["MAINTENANCE_STAFF"],
      permissions: mocks.permissions,
    },
    loading: false,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => "/notifications",
  useSearchParams: () => mocks.routeParams,
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const baseItem: NotificationResult["data"][number] = {
  id: "recipient-1",
  readAt: null,
  createdAt: "2026-08-15T10:00:00.000Z",
  actions: [
    {
      id: "acknowledge",
      label: "Acknowledge",
      method: "POST",
      href: "/issues/issue-1/acknowledge",
      requiresConfirmation: false,
    },
    {
      id: "view_ticket",
      label: "View ticket",
      method: "GET",
      href: "/issues/issue-1",
      requiresConfirmation: false,
    },
  ],
  notification: {
    type: "ISSUE_ASSIGNED",
    title: "Electrical issue assigned",
    body: "Please acknowledge this issue.",
    priority: "HIGH",
    relatedEntityType: "Issue",
    relatedEntityId: "issue-1",
    data: { issueNumber: "AVS-ISS-1" },
    context: {
      issueId: "issue-1",
      issueNumber: "AVS-ISS-1",
      title: "Electrical issue",
      category: "Electrical",
      status: "ASSIGNED",
      priority: "HIGH",
      location: "Main Block · Room 101",
      assignedTo: "Maintenance User",
      acknowledgedAt: null,
      resolutionDueAt: null,
      isOverdue: false,
      isEscalation: false,
      escalationLevel: 0,
    },
    createdAt: "2026-08-15T10:00:00.000Z",
  },
};

const summary: NotificationSummary = {
  all: 1,
  unread: 1,
  urgent: 1,
  escalations: 0,
  assigned: 1,
  completed: 0,
  pendingIssues: 1,
  overdueIssues: 0,
  unacknowledgedIssues: 1,
  assignedIssues: 1,
  escalatedIssues: 0,
  resolvedToday: 0,
  averageResolutionMinutes: null,
  alerts: [],
};

function result(): NotificationResult {
  return {
    unread: mocks.serverRead ? 0 : 1,
    data: [
      {
        ...baseItem,
        readAt: mocks.serverRead ? "2026-08-15T10:01:00.000Z" : null,
      },
    ],
    meta: { page: 1, pageSize: 20, total: 1, pageCount: 1 },
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    ...render(
      <QueryClientProvider client={client}>
        <NotificationsPage />
      </QueryClientProvider>,
    ),
    client,
  };
}

beforeEach(() => {
  mocks.routeParams = new URLSearchParams();
  mocks.permissions = ["issues.acknowledge", "issues.assign"];
  mocks.serverRead = false;
  mocks.get.mockImplementation((path: string) => {
    if (path === "/notifications/summary")
      return Promise.resolve({ ...summary, unread: mocks.serverRead ? 0 : 1 });
    if (path === "/notifications/preferences")
      return Promise.resolve({
        preferences: { display_density: "comfortable", dismissed_banners: {} },
        channels: {},
      });
    if (path === "/issues/assignment-options")
      return Promise.resolve([
        {
          id: "team-1",
          code: "ELEC",
          name: "Electrical Team",
          members: [
            {
              id: "staff-1",
              publicId: "staff-public-1",
              fullName: "Staff One",
              isPrimary: true,
              maxOpenIssues: null,
              openIssues: 2,
            },
          ],
        },
      ]);
    if (path.startsWith("/notifications?")) return Promise.resolve(result());
    if (path === "/notifications/devices") return Promise.resolve([]);
    return Promise.reject(new Error(`Unexpected GET ${path}`));
  });
  mocks.post.mockImplementation((path: string) => {
    if (path === "/notifications/recipient-1/read") mocks.serverRead = true;
    return Promise.resolve({ ok: true });
  });
  mocks.patch.mockResolvedValue({
    display_density: "comfortable",
    dismissed_banners: {},
  });
  mocks.delete.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NotificationsPage", () => {
  it("loads notifications and honors a filter from the route", async () => {
    mocks.routeParams = new URLSearchParams("filter=urgent");
    renderPage();

    expect(await screen.findByText("Electrical issue assigned")).toBeVisible();
    expect(screen.getByRole("tab", { name: /Urgent/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(mocks.get).toHaveBeenCalledWith(
      expect.stringContaining("filter=urgent"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("syncs the selected tab after external URL navigation", async () => {
    const view = renderPage();
    await screen.findByText("Electrical issue assigned");
    mocks.routeParams = new URLSearchParams("filter=unread");
    view.rerender(
      <QueryClientProvider client={view.client}>
        <NotificationsPage />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Unread/ })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(mocks.get).toHaveBeenCalledWith(
      expect.stringContaining("filter=unread"),
      expect.any(Object),
    );
  });

  it.each([
    ["All", "all"],
    ["Urgent", "urgent"],
    ["Escalations", "escalations"],
    ["Unread", "unread"],
  ])("requests the %s server-side tab", async (label, expectedFilter) => {
    renderPage();
    await screen.findByText("Electrical issue assigned");

    fireEvent.click(screen.getByRole("tab", { name: new RegExp(label) }));

    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        expect.stringContaining(`filter=${expectedFilter}`),
        expect.any(Object),
      ),
    );
  });

  it("debounces notification search", async () => {
    renderPage();
    await screen.findByText("Electrical issue assigned");

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search notifications" }),
      { target: { value: "  AVS-ISS-1  " } },
    );

    await waitFor(
      () =>
        expect(mocks.get).toHaveBeenCalledWith(
          expect.stringContaining("search=AVS-ISS-1"),
          expect.any(Object),
        ),
      { timeout: 1_500 },
    );
  });

  it("opens an accessible focus-managed mobile filter dialog", async () => {
    renderPage();
    await screen.findByText("Electrical issue assigned");

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));

    expect(
      screen.getByRole("dialog", { name: "Notification filters" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Close notification filters" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Notification filters" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("acknowledges inline, marks read and refreshes the shared counters", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge" }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/issues/issue-1/acknowledge"),
    );
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        "/notifications/recipient-1/read",
      ),
    );
    expect(await screen.findByText("0 unread updates")).toBeVisible();
  });

  it("hides an action when the user lacks its permission even if it was supplied", async () => {
    mocks.permissions = [];
    renderPage();

    await screen.findByText("Electrical issue assigned");
    expect(
      screen.queryByRole("button", { name: "Acknowledge" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View ticket" })).toBeVisible();
  });

  it("assigns an issue through the accessible inline workflow", async () => {
    const assignmentItem = {
      ...baseItem,
      actions: [
        {
          id: "assign",
          label: "Assign",
          method: "POST" as const,
          href: "/issues/issue-1/assign",
          requiresConfirmation: true,
        },
      ],
    };
    mocks.get.mockImplementation((path: string) => {
      if (path === "/notifications/summary") return Promise.resolve(summary);
      if (path === "/notifications/preferences")
        return Promise.resolve({
          preferences: {
            display_density: "comfortable",
            dismissed_banners: {},
          },
          channels: {},
        });
      if (path === "/issues/assignment-options")
        return Promise.resolve([
          { id: "team-1", code: "ELEC", name: "Electrical Team", members: [] },
        ]);
      if (path.startsWith("/notifications?"))
        return Promise.resolve({ ...result(), data: [assignmentItem] });
      return Promise.resolve([]);
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await screen.findByRole("option", { name: "Electrical Team" });
    const team = await screen.findByLabelText("Responsible team");
    const reason = screen.getByLabelText("Assignment reason");
    fireEvent.change(team, { target: { value: "team-1" } });
    fireEvent.change(reason, { target: { value: "Route to electrical team" } });
    const dialog = screen.getByRole("dialog", { name: "Assign issue" });
    expect(team).toHaveValue("team-1");
    expect(reason).toHaveValue("Route to electrical team");
    const submit = within(dialog).getByRole("button", { name: "Assign" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/issues/issue-1/assign", {
        teamId: "team-1",
        userId: undefined,
        reason: "Route to electrical team",
      }),
    );
  });

  it("reassigns an issue when the authorised server action is supplied", async () => {
    const reassignmentItem = {
      ...baseItem,
      actions: [
        {
          id: "reassign",
          label: "Reassign",
          method: "POST" as const,
          href: "/issues/issue-1/assign",
          requiresConfirmation: true,
        },
      ],
    };
    mocks.get.mockImplementation((path: string) => {
      if (path === "/notifications/summary") return Promise.resolve(summary);
      if (path === "/notifications/preferences")
        return Promise.resolve({
          preferences: {
            display_density: "comfortable",
            dismissed_banners: {},
          },
          channels: {},
        });
      if (path === "/issues/assignment-options")
        return Promise.resolve([
          { id: "team-2", code: "CIVIL", name: "Civil Team", members: [] },
        ]);
      if (path.startsWith("/notifications?"))
        return Promise.resolve({ ...result(), data: [reassignmentItem] });
      return Promise.resolve([]);
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Reassign" }));
    await screen.findByRole("option", { name: "Civil Team" });
    fireEvent.change(await screen.findByLabelText("Responsible team"), {
      target: { value: "team-2" },
    });
    fireEvent.change(screen.getByLabelText("Assignment reason"), {
      target: { value: "Balance the active workload" },
    });
    const submit = within(
      screen.getByRole("dialog", { name: "Reassign issue" }),
    ).getByRole("button", { name: "Reassign" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/issues/issue-1/assign", {
        teamId: "team-2",
        userId: undefined,
        reason: "Balance the active workload",
      }),
    );
  });

  it("persists dismissal for a non-critical warning", async () => {
    mocks.get.mockImplementation((path: string) => {
      if (path === "/notifications/summary")
        return Promise.resolve({
          ...summary,
          alerts: [
            {
              id: "push-config",
              level: "WARNING",
              title: "Push not configured",
              message: "Critical alerts may not reach this device.",
              dismissible: true,
              action: null,
              dismissedAt: null,
            },
          ],
        });
      if (path === "/notifications/preferences")
        return Promise.resolve({
          preferences: {
            display_density: "comfortable",
            dismissed_banners: {},
          },
          channels: {},
        });
      if (path.startsWith("/notifications?")) return Promise.resolve(result());
      return Promise.resolve([]);
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        "/profile/me/notification-preferences",
        expect.objectContaining({
          dismissed_banners: expect.objectContaining({
            "push-config": expect.any(String),
          }),
        }),
      ),
    );
  });

  it("never offers permanent dismissal for a critical alert", async () => {
    mocks.get.mockImplementation((path: string) => {
      if (path === "/notifications/summary")
        return Promise.resolve({
          ...summary,
          alerts: [
            {
              id: "critical-overdue-issues",
              level: "CRITICAL",
              title: "Critical issues are overdue",
              message: "Immediate review is required.",
              dismissible: false,
              action: { label: "View issues", href: "/issues" },
              dismissedAt: null,
            },
          ],
        });
      if (path === "/notifications/preferences")
        return Promise.resolve({
          preferences: {
            display_density: "comfortable",
            dismissed_banners: {},
          },
          channels: {},
        });
      if (path.startsWith("/notifications?")) return Promise.resolve(result());
      return Promise.resolve([]);
    });
    renderPage();

    expect(
      await screen.findByText(/Critical issues are overdue/),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Dismiss" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View issues" })).toBeVisible();
  });
});
