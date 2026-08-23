import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PeopleManagementPage from "./page";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: mocks }));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({
    user: {
      permissions: [
        "users.read",
        "users.create",
        "users.import",
        "users.update",
        "users.suspend",
      ],
      roles: ["MAIN_ADMIN"],
    },
  }),
}));

const filterOptions = {
  departments: [
    { id: "department-cse", code: "CSE", name: "Computer Science" },
  ],
  rooms: [
    {
      id: "room-cse-201",
      code: "CSE-201",
      name: "Second Year Classroom",
      roomNumber: "201",
      departmentId: "department-cse",
      floor: {
        name: "First Floor",
        block: { name: "CSE Block", campus: { name: "Main Campus" } },
      },
    },
  ],
};

const peopleResponse = {
  data: [
    {
      publicId: "person-public-id",
      collegeIdentityId: "AVS001",
      fullName: "Imported Student",
      email: null,
      mobile: "9876543210",
      status: "ACTIVE",
      mustChangePassword: true,
      firstLoginCompletedAt: null,
      lastLoginAt: null,
      archivedAt: null,
      roles: [
        { role: { code: "STUDENT", name: "Student" }, isPrimary: true },
      ],
      studentProfile: {
        studentId: "AVS001",
        department: { code: "CSE", name: "Computer Science" },
        section: {
          code: "A",
          name: "Section A",
          assignedRoom: {
            id: "room-cse-201",
            code: "CSE-201",
            name: "Second Year Classroom",
            roomNumber: "201",
          },
        },
      },
      staffProfile: null,
    },
  ],
  meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PeopleManagementPage />
    </QueryClientProvider>,
  );
}

describe("People management filters", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.patch.mockResolvedValue({ ok: true });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
    mocks.get.mockImplementation((path: string) => {
      if (path.startsWith("/admin/people/filter-options")) {
        return Promise.resolve(filterOptions);
      }
      if (path.startsWith("/admin/people?")) {
        return Promise.resolve(peopleResponse);
      }
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });
  });

  it("keeps Bulk Import available and sends relational Department, Year, and Classroom filters", async () => {
    renderPage();

    expect((await screen.findAllByText("Imported Student")).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Bulk Import" })).toHaveAttribute(
      "href",
      "/admin/imports",
    );
    expect(screen.getAllByText(/Section A .* CSE-201/).length).toBeGreaterThan(0);
    expect(
      mocks.get.mock.calls.some(([path]) =>
        String(path).startsWith("/admin/people/filter-options"),
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const department = await screen.findByLabelText("Department");
    await waitFor(() => {
      expect(department).not.toBeDisabled();
      expect(
        within(department).getByRole("option", {
          name: "CSE - Computer Science",
        }),
      ).toBeInTheDocument();
    });
    expect(
      within(screen.getByLabelText("Study Year")).getByRole("option", {
        name: "Year 8",
      }),
    ).toBeInTheDocument();
    fireEvent.change(department, { target: { value: "department-cse" } });

    await waitFor(() => {
      const roomSelect = screen.getByLabelText("Classroom");
      expect(roomSelect).not.toBeDisabled();
      expect(
        within(roomSelect).getByRole("option", {
          name: /CSE-201 - Second Year Classroom/,
        }),
      ).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText("Study Year"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Classroom"), {
      target: { value: "room-cse-201" },
    });

    await waitFor(() => {
      const peopleUrls = mocks.get.mock.calls
        .map(([path]) => String(path))
        .filter((path) => path.startsWith("/admin/people?"));
      expect(peopleUrls).toContain(
        "/admin/people?page=1&pageSize=25&departmentId=department-cse&studyYear=2&roomId=room-cse-201",
      );
    });
  });

  it("gives mobile icon links stable accessible names", async () => {
    renderPage();

    await screen.findAllByText("Imported Student");
    expect(screen.getByRole("link", { name: "Add Person" })).toHaveAttribute(
      "href",
      "/admin/people/new",
    );
    expect(
      screen.getByRole("link", { name: "View Imported Student" }),
    ).toHaveAttribute("href", "/admin/people/person-public-id");
  });

  it("clears conflicting tab state when role or status filters are applied", async () => {
    renderPage();
    await screen.findAllByText("Imported Student");

    fireEvent.click(screen.getByRole("tab", { name: "Students" }));
    await waitFor(() =>
      expect(
        mocks.get.mock.calls.some(([path]) =>
          String(path).includes("role=STUDENT"),
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(await screen.findByLabelText("Role"), {
      target: { value: "FACULTY" },
    });
    expect(screen.getByRole("tab", { name: "All People" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => {
      const latestPeopleUrl = mocks.get.mock.calls
        .map(([path]) => String(path))
        .filter((path) => path.startsWith("/admin/people?"))
        .at(-1);
      expect(latestPeopleUrl).toContain("role=FACULTY");
      expect(latestPeopleUrl).not.toContain("role=STUDENT");
    });

    fireEvent.click(screen.getByRole("tab", { name: "Suspended" }));
    fireEvent.change(screen.getByLabelText("Account Status"), {
      target: { value: "ACTIVE" },
    });
    expect(screen.getByRole("tab", { name: "All People" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => {
      const latestPeopleUrl = mocks.get.mock.calls
        .map(([path]) => String(path))
        .filter((path) => path.startsWith("/admin/people?"))
        .at(-1);
      expect(latestPeopleUrl).toContain("status=ACTIVE");
      expect(latestPeopleUrl).not.toContain("status=SUSPENDED");
    });
  });

  it("keeps the current page inside the pagination window above page five", async () => {
    mocks.get.mockImplementation((path: string) => {
      if (path.startsWith("/admin/people?")) {
        return Promise.resolve({
          ...peopleResponse,
          meta: { ...peopleResponse.meta, total: 200, totalPages: 8 },
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "5" }));
    await waitFor(() =>
      expect(
        mocks.get.mock.calls.some(([path]) =>
          String(path).startsWith("/admin/people?page=5&pageSize=25"),
        ),
      ).toBe(true),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "6" })).toHaveAttribute(
        "aria-current",
        "page",
      ),
    );
  });

  it("shows account lifecycle mutation failures inside the active dialog", async () => {
    mocks.patch.mockRejectedValueOnce(new Error("Archive service is unavailable."));
    renderPage();

    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "Archive Imported Student",
    });
    fireEvent.change(within(dialog).getByLabelText(/Reason for archiving/), {
      target: { value: "Account lifecycle review" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Archive Student" }),
    );

    expect(
      await within(dialog).findByRole("alert"),
    ).toHaveTextContent("Archive service is unavailable.");
  });
});
