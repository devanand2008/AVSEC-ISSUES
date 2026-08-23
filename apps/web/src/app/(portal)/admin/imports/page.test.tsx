import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImportsPage from "./page";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  postForm: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: mocks,
  ApiError: class ApiError extends Error {
    requestId?: string;
  },
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({
    user: {
      permissions: ["users.import"],
      roles: ["MAIN_ADMIN"],
    },
  }),
}));

const peopleJob = {
  id: "job-1",
  entityType: "PEOPLE",
  importMode: "CREATE_ONLY",
  selectedSheetName: "People",
  status: "VALIDATED",
  totalRows: 3,
  validRows: 2,
  errorRows: 1,
  resultAvailable: false,
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
};

const peoplePreview = {
  job: peopleJob,
  rawHeaders: [
    "User Name",
    "User ID",
    "User Password",
    "Department",
    "Year",
    "Class Room Number",
    "Mobile Number",
  ],
  headers: [
    "full_name",
    "college_identity_id",
    "temporary_password",
    "department_code",
    "year",
    "class_room_number",
    "mobile",
  ],
  columnMapping: {},
  sheetNames: ["People"],
  selectedSheetName: "People",
  sheetInspections: [],
  passwordWarnings: 0,
  duplicateRowCount: 0,
  duplicateGroups: [],
  duplicateResolution: "KEEP_FIRST",
  departmentMappings: {},
  unresolvedDepartmentMappings: [],
  departmentOptions: [],
  previewRows: [
    {
      rowNumber: 2,
      values: {
        full_name: "Valid Student",
        college_identity_id: "AVS001",
        temporary_password: "NeverRender!123",
        department_code: "CSE",
        year: "2",
        class_room_number: "CSE-201",
        mobile: "9876543210",
      },
    },
  ],
  errors: [
    {
      rowNumber: 3,
      userId: "AVS002",
      userName: "Invalid Student",
      field: "Mobile Number",
      message: "Mobile Number must contain 7 to 15 digits.",
    },
  ],
  errorsTruncated: false,
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ImportsPage />
    </QueryClientProvider>,
  );
}

describe("People bulk import page", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockImplementation((path: string) => {
      if (path === "/imports") return Promise.resolve([]);
      if (path === "/imports/job-1") return Promise.resolve(peopleJob);
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });
    mocks.post.mockResolvedValue({ id: "job-1", status: "CANCELLED" });
    mocks.download.mockResolvedValue(undefined);
  });

  it("shows the exact People contract while preserving legacy Student study years", async () => {
    renderPage();

    expect(
      await screen.findByText("Basic People template"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Uses exactly User Name, User ID, User Password/),
    ).toHaveTextContent(
      "User Name, User ID, User Password, Department, Year, Class Room Number, and Mobile Number",
    );
    expect(
      screen.getByText(/must resolve together to one active academic section/),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(
        "Reset existing users to imported temporary password",
      ),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Import type"), {
      target: { value: "STUDENTS" },
    });

    expect(screen.getByLabelText("Import mode")).toHaveValue("VALIDATE_ONLY");
    const studyYear = screen.getByLabelText("Workbook study year");
    expect(
      within(studyYear).getByRole("option", { name: "Fifth Year" }),
    ).toBeInTheDocument();
    expect(
      within(studyYear).getByRole("option", { name: "Eighth Year" }),
    ).toBeInTheDocument();
  });

  it("surfaces template download failures", async () => {
    mocks.download.mockRejectedValueOnce(
      new Error("The People template could not be generated."),
    );
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Download template" }),
    );

    await waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith(
        "/imports/templates/PEOPLE",
        "people-template.xlsx",
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The People template could not be generated.",
    );
  });

  it("keeps passwords out of preview and confirms cancellation in the shared dialog", async () => {
    mocks.postForm.mockResolvedValue(peoplePreview);
    const view = renderPage();
    fireEvent.change(screen.getByLabelText("Import type"), {
      target: { value: "USERS" },
    });
    fireEvent.click(
      screen.getByLabelText(
        "Reset existing users to imported temporary password",
      ),
    );
    fireEvent.change(screen.getByLabelText("Import type"), {
      target: { value: "PEOPLE" },
    });
    const fileInput =
      view.container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput!, {
      target: {
        files: [
          new File(["workbook"], "people.xlsx", {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
        ],
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Validate and preview" }),
    );

    expect(await screen.findByText(/Total rows: 3/)).toHaveTextContent(
      "Valid rows: 2",
    );
    const submitted = mocks.postForm.mock.calls[0]?.[1] as FormData;
    expect(submitted.get("entityType")).toBe("PEOPLE");
    expect(submitted.get("resetExistingPasswords")).toBeNull();
    expect(screen.getByText("Valid Student")).toBeInTheDocument();
    expect(screen.queryByText("NeverRender!123")).not.toBeInTheDocument();
    expect(screen.queryByText("Column mapping")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Cancel this import?")).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Cancel import" }),
    );
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/imports/job-1/cancel"),
    );
    expect(
      await screen.findByText(
        "Import cancelled. The uploaded source file was removed securely.",
      ),
    ).toBeInTheDocument();
  });

  it("requires confirmation before a completed import is rolled back", async () => {
    const completed = {
      ...peopleJob,
      status: "COMPLETED",
      resultAvailable: true,
      result: {
        completedAt: "2026-08-23T00:01:00.000Z",
        successful: [
          { rowNumber: 2, model: "User", id: "user-1", label: "AVS001" },
        ],
        errors: [],
      },
    };
    mocks.get.mockImplementation((path: string) => {
      if (path === "/imports") return Promise.resolve([completed]);
      if (path === "/imports/job-1") return Promise.resolve(completed);
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });
    mocks.post.mockResolvedValue({ recordsRemoved: 1 });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /PEOPLE/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Safe rollback" }),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(mocks.post).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Run safe rollback" }),
    );
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/imports/job-1/rollback"),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("keeps a credential claim retryable until the operator explicitly acknowledges saving it", async () => {
    const exportId = "11111111-1111-4111-8111-111111111111";
    const completed = {
      ...peopleJob,
      id: "job-credentials",
      entityType: "USERS",
      status: "COMPLETED",
      resultAvailable: true,
      credentialsAvailable: true,
      credentialExportClaimId: exportId,
      result: {
        completedAt: "2026-08-23T00:01:00.000Z",
        successful: [
          { rowNumber: 2, model: "User", id: "user-1", label: "AVS001" },
        ],
        errors: [],
      },
    };
    mocks.get.mockImplementation((path: string) => {
      if (path === "/imports") return Promise.resolve([completed]);
      if (path === "/imports/job-credentials")
        return Promise.resolve(completed);
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });
    mocks.post.mockResolvedValue({
      id: "job-credentials",
      status: "ACKNOWLEDGED",
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /USERS/i }));
    const download = await screen.findByRole("button", {
      name: "Download credentials (one-time)",
    });
    fireEvent.click(download);

    await waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith(
        `/imports/job-credentials/credentials?exportId=${exportId}`,
        "import-job-cred-credentials.xlsx",
      ),
    );
    expect(mocks.post).not.toHaveBeenCalled();
    const acknowledge = await screen.findByRole("button", {
      name: "I saved the file — erase server copy",
    });

    fireEvent.click(download);
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(2));
    expect(mocks.download.mock.calls[1]?.[0]).toContain(`exportId=${exportId}`);
    expect(mocks.post).not.toHaveBeenCalled();

    fireEvent.click(acknowledge);
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        "/imports/job-credentials/credentials/acknowledge",
        { exportId },
      ),
    );
    expect(
      await screen.findByText(
        "Credential delivery acknowledged. The encrypted server copy was erased.",
      ),
    ).toBeInTheDocument();
  });
});
