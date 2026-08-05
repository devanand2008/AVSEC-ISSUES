import { resolveRuntimeUrl } from "./runtime-url";

const CONFIGURED_API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.VITE_API_BASE_URL ??
  process.env.API_URL ??
  "http://localhost:4000/api/v1";
const REQUEST_TIMEOUT_MS = 30_000;
const BLOB_REQUEST_TIMEOUT_MS = 60_000;
let refreshPromise: Promise<void> | null = null;

function apiUrl(): string {
  return resolveRuntimeUrl(CONFIGURED_API_URL);
}

export function apiEventUrl(path: string): string {
  return `${apiUrl()}${path}`;
}

export function authenticatedStream(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const headers = new Headers({
    accept: "text/event-stream",
    "content-type": "application/json",
  });
  const csrf = cookie("college_csrf");
  if (csrf) headers.set("x-csrf-token", decodeURIComponent(csrf));
  return fetch(`${apiUrl()}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "include",
    signal,
  });
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function cookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), ms);
  const abort = () => controller.abort();
  const parent = init.signal;
  if (parent) {
    if (parent.aborted) abort();
    else parent.addEventListener("abort", abort, { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeout);
    parent?.removeEventListener("abort", abort);
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const method = init.method?.toUpperCase() ?? "GET";
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = cookie("college_csrf");
    if (csrf) headers.set("x-csrf-token", decodeURIComponent(csrf));
  }
  const response = await fetchWithTimeout(
    `${apiUrl()}${path}`,
    {
      ...init,
      headers,
      credentials: "include",
    },
    REQUEST_TIMEOUT_MS,
  );
  const canRefresh = Boolean(cookie("college_csrf"));
  if (
    response.status === 401 &&
    canRefresh &&
    retry &&
    path !== "/auth/refresh" &&
    path !== "/auth/login"
  ) {
    try {
      refreshPromise ??= request<unknown>(
        "/auth/refresh",
        { method: "POST" },
        false,
      )
        .then(() => undefined)
        .finally(() => {
          refreshPromise = null;
        });
      await refreshPromise;
      return request<T>(path, init, false);
    } catch {
      // Continue with the original response so callers receive the correct unauthorized state.
    }
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | {
          error?: { message?: string; code?: string; details?: unknown };
          message?: string;
          duplicate?: unknown;
        }
      | undefined;
    throw new ApiError(
      body?.error?.message ??
        body?.message ??
        `Request failed with status ${response.status}.`,
      response.status,
      body?.error?.code,
      body?.error?.details ?? body?.duplicate,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function requestBlob(path: string, retry = true): Promise<Blob> {
  const response = await fetchWithTimeout(
    `${apiUrl()}${path}`,
    {
      credentials: "include",
    },
    BLOB_REQUEST_TIMEOUT_MS,
  );
  if (response.status === 401 && retry && cookie("college_csrf")) {
    try {
      refreshPromise ??= request<unknown>(
        "/auth/refresh",
        { method: "POST" },
        false,
      )
        .then(() => undefined)
        .finally(() => {
          refreshPromise = null;
        });
      await refreshPromise;
      return requestBlob(path, false);
    } catch {
      // Surface the original authorization failure below.
    }
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { message?: string } }
      | undefined;
    throw new ApiError(
      body?.error?.message ?? "The file could not be generated.",
      response.status,
    );
  }
  return response.blob();
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, init),
  post: <T>(
    path: string,
    body?: unknown,
    headers?: HeadersInit,
    init?: Omit<RequestInit, "body" | "headers" | "method">,
  ) =>
    request<T>(path, {
      ...init,
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
    }),
  postForm: <T>(path: string, body: FormData) =>
    request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "DELETE",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  blob: (path: string) => requestBlob(path),
  download: async (path: string, fileName: string) => {
    const url = URL.createObjectURL(await requestBlob(path));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  },
  preview: async (path: string) => {
    const previewWindow = window.open("", "_blank", "noopener,noreferrer");
    const url = URL.createObjectURL(await requestBlob(path));
    if (previewWindow) previewWindow.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  },
  upload: async (url: string, file: File, headers: HeadersInit = {}) => {
    const response = await fetch(url, { method: "PUT", body: file, headers });
    if (!response.ok)
      throw new ApiError("Attachment upload failed.", response.status);
  },
};

export function idempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}
