import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LocationsAdminPage from "./page";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
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

function renderLocations() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <LocationsAdminPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.get.mockImplementation((path: string) => {
    if (path === "/locations/campuses")
      return Promise.resolve([{ id: "campus-1", code: "MAIN", name: "Main Campus" }]);
    if (path === "/locations/blocks?campusId=campus-1")
      return Promise.resolve([{ id: "block-1", code: "A", name: "Academic Block A" }]);
    if (path === "/locations/floors?blockId=block-1")
      return Promise.resolve([{ id: "floor-1", code: "F1", name: "First Floor" }]);
    if (path === "/locations/rooms?floorId=floor-1") return Promise.resolve([]);
    if (path === "/admin/campuses") return Promise.resolve([]);
    return Promise.reject(new Error(`Unexpected GET ${path}`));
  });
  mocks.post.mockResolvedValue({ id: "created" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LocationsAdminPage", () => {
  it("shows a Campus setup add button and creates a campus through the admin endpoint", async () => {
    renderLocations();

    fireEvent.click(await screen.findByRole("button", { name: "Add Campus" }));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "north" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "North Campus" } });
    fireEvent.click(screen.getByRole("button", { name: "Add campus" }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/admin/campuses", {
        code: "NORTH",
        name: "North Campus",
      }),
    );
  });

  it("exposes a direct Add Lab action after selecting a floor", async () => {
    renderLocations();

    fireEvent.click(await screen.findByRole("button", { name: /Main Campus/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Academic Block A/ }));
    fireEvent.click(await screen.findByRole("button", { name: /First Floor/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Lab" }));

    expect(screen.getByRole("heading", { name: "Add New Lab" })).toBeVisible();
    expect(screen.getByLabelText("Room type")).toHaveValue("LABORATORY");
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "lab-101" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Computer Lab 101" } });
    fireEvent.change(screen.getByLabelText("Room number"), { target: { value: "101" } });
    fireEvent.change(screen.getByLabelText("Capacity"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Add lab" }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/locations/rooms", {
        floorId: "floor-1",
        code: "LAB-101",
        name: "Computer Lab 101",
        roomType: "LABORATORY",
        roomNumber: "101",
        capacity: 40,
      }),
    );
  });
});
