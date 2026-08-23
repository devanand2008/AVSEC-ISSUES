export type LocationKind = "campus" | "block" | "floor" | "room";

export interface LocationRecord {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  address?: string | null;
  contactNumber?: string | null;
  campusId?: string;
  blockId?: string;
  floorId?: string;
  level?: number;
  roomNumber?: string | null;
  roomType?: string;
  customRoomTypeLabel?: string | null;
  capacity?: number | null;
  departmentId?: string | null;
  isActive?: boolean;
  archivedAt?: string | null;
  isTestData?: boolean;
  imageStorageKey?: string | null;
  campus?: { id: string; code?: string; name: string };
  block?: {
    id: string;
    code?: string;
    name: string;
    campus?: { id: string; code?: string; name: string };
  };
  floor?: {
    id: string;
    code?: string;
    name: string;
    block?: {
      id: string;
      code?: string;
      name: string;
      campus?: { id: string; code?: string; name: string };
    };
  };
  department?: { id: string; code: string; name: string } | null;
  _count?: Record<string, number>;
}

export interface LocationPageMeta {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export type LocationListResponse =
  | LocationRecord[]
  | { data: LocationRecord[]; meta: LocationPageMeta };

export interface NormalizedLocationList {
  records: LocationRecord[];
  meta: LocationPageMeta;
}

export interface LocationListFilters {
  search?: string;
  status?: string;
  campusId?: string;
  blockId?: string;
  floorId?: string;
  roomType?: string;
  departmentId?: string;
  page?: number;
  pageSize?: number;
}

export interface LocationDependencyReport {
  canDelete: boolean;
  totalDependencies: number;
  dependencies: Record<string, number>;
  message: string;
}

export interface LocationImageResponse {
  imageUrl: string | null;
  thumbnailUrl?: string | null;
  expiresIn?: number;
  width?: number;
  height?: number;
  sizeBytes?: number;
  sha256?: string;
}

export const ROOM_TYPES = [
  "CLASSROOM",
  "LABORATORY",
  "SEMINAR_HALL",
  "STAFF_ROOM",
  "FACULTY_ROOM",
  "OFFICE",
  "AUDITORIUM",
  "STORE_ROOM",
  "HOD_ROOM",
  "PRINCIPAL_OFFICE",
  "ADMINISTRATIVE_OFFICE",
  "LIBRARY",
  "WORKSHOP",
  "RESTROOM",
  "CANTEEN",
  "HOSTEL_ROOM",
  "CORRIDOR",
  "STAIRCASE",
  "PARKING_AREA",
  "PLAYGROUND",
  "OTHER",
] as const;

export function roomTypeDisplayLabel(
  room: Pick<LocationRecord, "roomType" | "customRoomTypeLabel">,
): string {
  if (room.roomType === "OTHER" && room.customRoomTypeLabel?.trim()) {
    return room.customRoomTypeLabel.trim();
  }
  return room.roomType?.replaceAll("_", " ") ?? "";
}

export function pluralLocationKind(kind: LocationKind): string {
  return kind === "campus" ? "campuses" : `${kind}s`;
}

export function adminLocationListPath(
  kind: LocationKind,
  filters: LocationListFilters,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "" || value === "ALL") continue;
    query.set(key, String(value));
  }
  const suffix = query.toString();
  return `/admin/${pluralLocationKind(kind)}${suffix ? `?${suffix}` : ""}`;
}

function safePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

export function normalizeLocationList(
  response: LocationListResponse | undefined,
  requestedPage = 1,
  requestedPageSize = 20,
): NormalizedLocationList {
  const fallbackMeta: LocationPageMeta = {
    page: requestedPage,
    pageSize: requestedPageSize,
    total: 0,
    pageCount: 1,
  };
  if (!response) return { records: [], meta: fallbackMeta };
  if (Array.isArray(response)) {
    return {
      records: response,
      meta: {
        page: 1,
        pageSize: response.length || requestedPageSize,
        total: response.length,
        pageCount: 1,
      },
    };
  }
  const records = Array.isArray(response.data) ? response.data : [];
  const total = Math.max(0, Number(response.meta?.total) || 0);
  return {
    records,
    meta: {
      page: safePositiveInteger(response.meta?.page, requestedPage),
      pageSize: safePositiveInteger(response.meta?.pageSize, requestedPageSize),
      total,
      pageCount: safePositiveInteger(
        response.meta?.pageCount,
        Math.max(1, Math.ceil(total / requestedPageSize)),
      ),
    },
  };
}

function countMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, count]) =>
      typeof count === "number" && Number.isFinite(count) && count >= 0
        ? [[key, count]]
        : [],
    ),
  );
}

export function normalizeDependencyReport(
  response: unknown,
): LocationDependencyReport {
  const raw =
    response && typeof response === "object"
      ? (response as Record<string, unknown>)
      : {};
  const dependencies = {
    ...countMap(raw.counts),
    ...countMap(raw.dependencies),
  };
  const calculatedTotal = Object.values(dependencies).reduce(
    (total, count) => total + count,
    0,
  );
  const reportedTotal =
    typeof raw.totalDependencies === "number"
      ? raw.totalDependencies
      : typeof raw.totalRecords === "number"
        ? raw.totalRecords
        : calculatedTotal;
  return {
    canDelete: raw.canDelete === true,
    totalDependencies: Math.max(0, reportedTotal),
    dependencies,
    message:
      typeof raw.message === "string" && raw.message.trim()
        ? raw.message
        : raw.canDelete === true
          ? "No blocking dependencies were found."
          : "This location is still referenced and cannot be permanently deleted.",
  };
}

export function locationContext(record: LocationRecord): {
  campusId: string;
  blockId: string;
  floorId: string;
} {
  return {
    campusId:
      record.campusId ??
      record.campus?.id ??
      record.block?.campus?.id ??
      record.floor?.block?.campus?.id ??
      "",
    blockId: record.blockId ?? record.block?.id ?? record.floor?.block?.id ?? "",
    floorId: record.floorId ?? record.floor?.id ?? "",
  };
}
