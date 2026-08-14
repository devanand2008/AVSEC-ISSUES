import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isStaffFeedbackQrEligible,
  StaffFeedbackQrPanel,
} from "./staff-feedback-qr";

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  blob: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMocks }));

const publicId = "2e494965-d430-4d3c-a305-07184ea39312";
const endpoint = `/admin/feedback/staff/${publicId}/qr`;
const activeRecord = {
  staff: {
    publicId,
    staffId: "FAC-001",
    name: "Test Faculty",
    designation: "Assistant Professor",
    department: { id: "department-1", code: "CSE", name: "Computer Science" },
    targetType: "STAFF",
  },
  target: {
    id: "201e108f-0b2f-4acd-a2e1-cc79f9923482",
    targetType: "STAFF",
    targetName: "Test Faculty",
    description: "Assistant Professor",
    isActive: true,
  },
  qr: {
    id: "9da6948b-f830-46e8-bbf2-668049d5dfe5",
    secureUrl:
      "https://college.example/feedback/scan/FB_abcdefghijklmnopqrstuvwxyz123456",
    status: "ACTIVE",
    expiryDate: null,
    createdAt: "2026-08-14T08:00:00.000Z",
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("staff feedback QR eligibility", () => {
  it("uses StaffProfile eligibility for leadership, faculty and maintenance staff", () => {
    expect(isStaffFeedbackQrEligible(true)).toBe(true);
    expect(isStaffFeedbackQrEligible(false)).toBe(false);
  });

  it("keeps the QR details and actions usable on phone widths", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/styles/components.css"),
      "utf8",
    );

    expect(css).toMatch(
      /@media\s*\(max-width:\s*480px\)[\s\S]*?\.staff-feedback-qr-details\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/u,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*480px\)[\s\S]*?\.staff-feedback-qr-actions\s*\{[^}]*flex-direction:\s*column;/u,
    );
    expect(css).toMatch(
      /\.staff-feedback-qr-actions \.avs-btn,[\s\S]*?width:\s*100%;/u,
    );
  });
});

describe("StaffFeedbackQrPanel", () => {
  it("does not render or request QR data without management permission", () => {
    renderPanel({ canManage: false });

    expect(screen.queryByText("Staff feedback QR")).not.toBeInTheDocument();
    expect(apiMocks.get).not.toHaveBeenCalled();
  });

  it("does not request a student account without a StaffProfile", () => {
    renderPanel({ hasStaffProfile: false });

    expect(screen.queryByText("Staff feedback QR")).not.toBeInTheDocument();
    expect(apiMocks.get).not.toHaveBeenCalled();
  });

  it.each(["Maintenance Admin", "Maintenance Staff"])(
    "loads feedback QR controls for a %s StaffProfile",
    async (staffName) => {
      apiMocks.get.mockResolvedValue({
        ...activeRecord,
        staff: { ...activeRecord.staff, name: staffName },
        target: { ...activeRecord.target, targetName: staffName },
      });
      renderPanel({ staffName });

      expect(await screen.findByText(staffName)).toBeVisible();
      expect(apiMocks.get).toHaveBeenCalledWith(endpoint);
    },
  );

  it("loads the exact profile QR and never prints its secure token URL", async () => {
    apiMocks.get.mockResolvedValue(activeRecord);
    renderPanel();

    expect(await screen.findByText("Test Faculty")).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Copy secure link" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Preview QR" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "PNG" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Poster PDF" })).toBeEnabled();
    expect(
      screen.queryByText(activeRecord.qr.secureUrl),
    ).not.toBeInTheDocument();
    expect(apiMocks.get).toHaveBeenCalledWith(endpoint);
  });

  it("uses the idempotent profile ensure endpoint when a QR is missing", async () => {
    apiMocks.get.mockResolvedValue({
      ...activeRecord,
      target: null,
      qr: null,
    });
    apiMocks.post.mockResolvedValue({
      ...activeRecord,
      created: { target: true, qr: true },
    });
    renderPanel();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Generate staff feedback QR",
      }),
    );

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(`${endpoint}/ensure`),
    );
    expect(
      await screen.findByText("Feedback QR generated for Test Faculty."),
    ).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
  });

  it("hides file actions without download permission", async () => {
    apiMocks.get.mockResolvedValue(activeRecord);
    renderPanel({ canDownload: false });

    expect(await screen.findByText("Test Faculty")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Copy secure link" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Preview QR" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "PNG" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Poster PDF" }),
    ).not.toBeInTheDocument();
  });

  it("offers the safe ensure action for an expired code instead of sharing it", async () => {
    apiMocks.get.mockResolvedValue({
      ...activeRecord,
      qr: {
        ...activeRecord.qr,
        expiryDate: "2020-01-01T00:00:00.000Z",
      },
    });
    renderPanel();

    expect(await screen.findByText("Expired")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Activate feedback QR" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Copy secure link" }),
    ).not.toBeInTheDocument();
  });

  it("offers synchronization instead of sharing a QR after the staff feedback role changes", async () => {
    apiMocks.get.mockResolvedValue({
      ...activeRecord,
      staff: { ...activeRecord.staff, targetType: "HOD" },
    });
    renderPanel();

    expect(
      await screen.findByText(/Role changed - activation required/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Activate feedback QR" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Copy secure link" }),
    ).not.toBeInTheDocument();
  });

  it("blocks generation for an archived staff account without calling the API", () => {
    renderPanel({ accountStatus: "ARCHIVED" });

    expect(
      screen.getByText(
        /generation is unavailable while this staff account is archived/i,
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /generate staff feedback QR/i }),
    ).not.toBeInTheDocument();
    expect(apiMocks.get).not.toHaveBeenCalled();
  });
});

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof StaffFeedbackQrPanel>> = {},
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <StaffFeedbackQrPanel
        staffPublicId={publicId}
        staffName="Test Faculty"
        accountStatus="ACTIVE"
        hasStaffProfile
        canManage
        canDownload
        {...overrides}
      />
    </QueryClientProvider>,
  );
}
