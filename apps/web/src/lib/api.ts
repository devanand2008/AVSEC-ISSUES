import { resolveRuntimeUrl } from "./runtime-url";

const CONFIGURED_API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.VITE_API_BASE_URL ??
  process.env.API_URL ??
  "/api/v1";
// A cached installed PWA can reach the API while Render is still waking the
// service. Give that cold start enough time to complete before surfacing a
// connection failure to the user.
const REQUEST_TIMEOUT_MS = 90_000;
const BLOB_REQUEST_TIMEOUT_MS = 60_000;
const READINESS_TIMEOUT_MS = 20_000;
let refreshPromise: Promise<void> | null = null;
let readinessPromise: Promise<void> | null = null;

function apiUrl(): string {
  return resolveRuntimeUrl(CONFIGURED_API_URL);
}

export function resolveApiRequestUrl(base: string, path: string): string {
  if (path === "/health" || path.startsWith("/health/")) {
    if (base.startsWith("/")) return path;
    try {
      const url = new URL(base);
      url.pathname = path;
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return path;
    }
  }
  return `${base}${path}`;
}

function requestUrl(path: string): string {
  return resolveApiRequestUrl(apiUrl(), path);
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
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export type ApiNetworkErrorKind = "offline" | "timeout" | "unreachable";

export class ApiNetworkError extends Error {
  constructor(readonly kind: ApiNetworkErrorKind) {
    super(
      kind === "offline"
        ? "The device is offline."
        : kind === "timeout"
          ? "The AVS server did not respond before the request timed out."
          : "The AVS server could not be reached.",
    );
    this.name = "ApiNetworkError";
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
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const abort = () => controller.abort();
  const parent = init.signal;
  if (parent) {
    if (parent.aborted) abort();
    else parent.addEventListener("abort", abort, { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (parent?.aborted) throw error;
    if (timedOut) throw new ApiNetworkError("timeout");
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new ApiNetworkError("offline");
    }
    throw new ApiNetworkError("unreachable");
  } finally {
    globalThis.clearTimeout(timeout);
    parent?.removeEventListener("abort", abort);
  }
}

function healthUrl(check: "live" | "ready"): string {
  return requestUrl(`/health/${check}`);
}

async function warmApi(): Promise<void> {
  readinessPromise ??= (async () => {
    for (const check of ["live", "ready"] as const) {
      const response = await fetchWithTimeout(
        healthUrl(check),
        {
          cache: "no-store",
          credentials: "include",
          headers: { accept: "application/json" },
        },
        READINESS_TIMEOUT_MS,
      );
      if (!response.ok) {
        throw new ApiError(
          "The AVS server is not ready yet.",
          response.status,
          undefined,
          undefined,
          response.headers.get("x-request-id") ?? undefined,
        );
      }
    }
  })().finally(() => {
    readinessPromise = null;
  });
  return readinessPromise;
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
    requestUrl(path),
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
      response.headers.get("x-request-id") ?? undefined,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function requestBlob(path: string, retry = true): Promise<Blob> {
  const response = await fetchWithTimeout(
    requestUrl(path),
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
      undefined,
      undefined,
      response.headers.get("x-request-id") ?? undefined,
    );
  }
  return response.blob();
}

export const api = {
  warmup: warmApi,
  health: <T>(check: "live" | "ready", init?: RequestInit) =>
    request<T>(`/health/${check}`, init),
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
      throw new ApiError(
        "Attachment upload failed.",
        response.status,
        undefined,
        undefined,
        response.headers.get("x-request-id") ?? undefined,
      );
  },
};

export function idempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}
