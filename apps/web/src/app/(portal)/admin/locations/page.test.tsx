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
import LocationsAdminPage from "./page";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: mocks.get,
    post: mocks.post,
    patch: mocks.patch,
    delete: mocks.delete,
    upload: mocks.upload,
  },
  ApiError: class ApiError extends Error {
    constructor(message: string, readonly status = 500) {
      super(message);
    }
  },
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

const campus = {
  id: "campus-1",
  code: "MAIN",
  name: "Main Campus",
  description: null,
  address: null,
  contactNumber: null,
  isActive: true,
  archivedAt: null,
  imageStorageKey: null,
};

function pageResponse(data: unknown[], page = 1, total = data.length) {
  return {
    data,
    meta: {
      page,
      pageSize: 20,
      total,
      pageCount: Math.max(1, Math.ceil(total / 20)),
    },
  };
}

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
    if (path === "/locations/campuses") return Promise.resolve([campus]);
    if (path === "/academic/departments") return Promise.resolve([]);
    if (path === "/locations/blocks?campusId=campus-1")
      return Promise.resolve([
        {
          id: "block-1",
          campusId: "campus-1",
          code: "A",
          name: "Academic Block A",
          description: null,
          isActive: true,
        },
      ]);
    if (path === "/locations/floors?blockId=block-1")
      return Promise.resolve([
        {
          id: "floor-1",
          blockId: "block-1",
          code: "F1",
          name: "First Floor",
          level: 1,
          isActive: true,
        },
      ]);
    if (path === "/locations/rooms?floorId=floor-1") return Promise.resolve([]);
    if (path.startsWith("/admin/campuses?"))
      return Promise.resolve(pageResponse([]));
    if (path.endsWith("/image")) return Promise.resolve({ imageUrl: null });
    return Promise.reject(new Error(`Unexpected GET ${path}`));
  });
  mocks.post.mockImplementation((path: string) => {
    if (path === "/admin/campuses")
      return Promise.resolve({ ...campus, id: "created-campus" });
    if (path === "/admin/rooms")
      return Promise.resolve({
        id: "created-room",
        floorId: "floor-1",
        code: "LAB-101",
        name: "Computer Lab 101",
        roomType: "LABORATORY",
      });
    return Promise.resolve({ id: "updated" });
  });
  mocks.patch.mockResolvedValue({ ...campus, id: "updated" });
  mocks.delete.mockResolvedValue({ removed: true });
  mocks.upload.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LocationsAdminPage", () => {
  it("creates a campus through the permission-protected admin endpoint", async () => {
    renderLocations();
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Add Campus" }))[0]!,
    );
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "north" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "North Campus" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add campus" }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/admin/campuses", {
        code: "NORTH",
        name: "North Campus",
      }),
    );
  });

  it("loads hierarchy branches lazily and creates a laboratory", async () => {
    renderLocations();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Main Campus" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Academic Block A" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Add Lab to First Floor" }),
    );

    expect(screen.getByRole("dialog", { name: "Add Room" })).toBeVisible();
    expect(screen.getByLabelText("Room type")).toHaveValue("LABORATORY");
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "lab-101" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Computer Lab 101" },
    });
    fireEvent.change(screen.getByLabelText("Room number"), {
      target: { value: "101" },
    });
    fireEvent.change(screen.getByLabelText("Capacity"), {
      target: { value: "40" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add room" }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/admin/rooms", {
        floorId: "floor-1",
        code: "LAB-101",
        name: "Computer Lab 101",
        roomType: "LABORATORY",
        roomNumber: "101",
        capacity: 40,
      }),
    );
    expect(mocks.get).toHaveBeenCalledWith(
      "/locations/blocks?campusId=campus-1",
    );
    expect(mocks.get).toHaveBeenCalledWith(
      "/locations/floors?blockId=block-1",
    );
  });

  it("requires and submits a trimmed custom label for an OTHER room", async () => {
    renderLocations();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Main Campus" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Academic Block A" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Add Lab to First Floor" }),
    );

    fireEvent.change(screen.getByLabelText("Room type"), {
      target: { value: "OTHER" },
    });
    const customLabel = screen.getByLabelText("Custom room type label");
    expect(customLabel).toBeRequired();
    expect(customLabel).toHaveAttribute("minlength", "2");
    expect(customLabel).toHaveAttribute("maxlength", "80");
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "innov-1" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Flexible Space" },
    });
    fireEvent.change(customLabel, {
      target: { value: "  Innovation Studio  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add room" }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/admin/rooms", {
        floorId: "floor-1",
        code: "INNOV-1",
        name: "Flexible Space",
        roomType: "OTHER",
        customRoomTypeLabel: "Innovation Studio",
      }),
    );
  });

  it("displays the configured OTHER label in the hierarchy and room list", async () => {
    const otherRoom = {
      id: "room-other",
      floorId: "floor-1",
      code: "INNOV-1",
      name: "Flexible Space",
      roomNumber: "115",
      roomType: "OTHER",
      customRoomTypeLabel: "Innovation Studio",
      isActive: true,
      archivedAt: null,
      floor: {
        id: "floor-1",
        name: "First Floor",
        block: {
          id: "block-1",
          name: "Academic Block A",
          campus: { id: "campus-1", name: "Main Campus" },
        },
      },
    };
    mocks.get.mockImplementation((path: string) => {
      if (path === "/locations/campuses") return Promise.resolve([campus]);
      if (path === "/academic/departments") return Promise.resolve([]);
      if (path === "/locations/blocks?campusId=campus-1")
        return Promise.resolve([
          {
            id: "block-1",
            campusId: "campus-1",
            code: "A",
            name: "Academic Block A",
            isActive: true,
          },
        ]);
      if (path === "/locations/floors?blockId=block-1")
        return Promise.resolve([
          {
            id: "floor-1",
            blockId: "block-1",
            code: "F1",
            name: "First Floor",
            level: 1,
            isActive: true,
          },
        ]);
      if (path === "/locations/rooms?floorId=floor-1")
        return Promise.resolve([otherRoom]);
      if (path.startsWith("/admin/campuses?"))
        return Promise.resolve(pageResponse([]));
      if (path.startsWith("/admin/rooms?"))
        return Promise.resolve(pageResponse([otherRoom]));
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });

    renderLocations();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Main Campus" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Academic Block A" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand First Floor" }),
    );
    const hierarchy = await screen.findByRole("list", {
      name: "Campus hierarchy",
    });
    expect(
      await within(hierarchy).findByText(/Innovation Studio/),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Rooms" }));
    const table = await screen.findByRole("table");
    expect(within(table).getByText(/Innovation Studio/)).toBeVisible();
  });

  it("edits campus identity, metadata, and status", async () => {
    renderLocations();
    const tree = await screen.findByRole("list", { name: "Campus hierarchy" });
    fireEvent.click(
      within(tree).getByRole("button", { name: "Edit Main Campus" }),
    );
    expect(screen.getByRole("dialog", { name: "Edit Campus" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "central" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Central Campus" },
    });
    fireEvent.change(screen.getByLabelText("Location / address"), {
      target: { value: "Salem" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Primary campus" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith("/admin/campuses/campus-1", {
        code: "CENTRAL",
        name: "Central Campus",
        description: "Primary campus",
        isActive: true,
        address: "Salem",
        contactNumber: null,
      }),
    );
  });

  it("submits search and status as server-side list filters", async () => {
    renderLocations();
    await screen.findByRole("list", { name: "Campus hierarchy" });
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "North" },
    });
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "ACTIVE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        "/admin/campuses?search=North&status=ACTIVE&page=1&pageSize=20",
      ),
    );
  });

  it("archives through the shared dialog without window.confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    mocks.get.mockImplementation((path: string) => {
      if (path === "/locations/campuses") return Promise.resolve([campus]);
      if (path === "/academic/departments") return Promise.resolve([]);
      if (path.startsWith("/admin/campuses?"))
        return Promise.resolve(pageResponse([campus]));
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });
    renderLocations();

    const table = await screen.findByRole("table");
    expect(screen.getByLabelText("Campuses mobile list")).toBeInTheDocument();
    fireEvent.click(
      within(table).getByRole("button", { name: "Archive Main Campus" }),
    );
    expect(
      screen.getByRole("alertdialog", { name: "Archive Main Campus" }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Reason for archiving"), {
      target: { value: "Campus temporarily unavailable" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Archive location" }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        "/admin/campus/campus-1/archive",
        { reason: "Campus temporarily unavailable" },
      ),
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("uploads an optional image through presign, direct upload, and completion", async () => {
    mocks.post.mockImplementation((path: string) => {
      if (path === "/admin/campuses")
        return Promise.resolve({ ...campus, id: "created-campus" });
      if (path === "/admin/campus/created-campus/image/presign")
        return Promise.resolve({
          storageKey:
            "colleges/college/campus-images/campuses/created-campus/image.png",
          uploadUrl: "https://storage.example/upload",
          requiredHeaders: { "content-type": "image/png" },
        });
      if (path === "/admin/campus/created-campus/image/complete")
        return Promise.resolve({
          record: { ...campus, id: "created-campus" },
          image: { imageUrl: "https://storage.example/image" },
        });
      return Promise.resolve({});
    });
    renderLocations();

    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Add Campus" }))[0]!,
    );
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "north" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "North Campus" },
    });
    const file = new File(
      [new Uint8Array([137, 80, 78, 71])],
      "campus.png",
      { type: "image/png" },
    );
    fireEvent.change(screen.getByLabelText("Choose image"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add campus" }));

    await waitFor(() =>
      expect(mocks.upload).toHaveBeenCalledWith(
        "https://storage.example/upload",
        file,
        { "content-type": "image/png" },
      ),
    );
    expect(mocks.post).toHaveBeenCalledWith(
      "/admin/campus/created-campus/image/complete",
      expect.objectContaining({
        fileName: "campus.png",
        mimeType: "image/png",
        sizeBytes: file.size,
      }),
    );
  });
});
