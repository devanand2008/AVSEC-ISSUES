import { ApiNetworkError, api, idempotencyKey } from "./api";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.cookie = "";
});

Object.defineProperty(document, "cookie", {
  writable: true,
  value: "",
});

describe("idempotencyKey", () => {
  it("generates distinct non-empty request keys", () => {
    const first = idempotencyKey();
    const second = idempotencyKey();
    expect(first.length).toBeGreaterThan(10);
    expect(second).not.toBe(first);
  });
});

describe("automatic session refresh", () => {
  it("shares one refresh request across simultaneous unauthorized responses", async () => {
    document.cookie = "college_csrf=test-token";
    let protectedCalls = 0;
    let refreshCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/auth/refresh")) {
          refreshCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return Response.json({ refreshed: true });
        }
        protectedCalls += 1;
        return protectedCalls <= 2
          ? Response.json({ error: { message: "Expired" } }, { status: 401 })
          : Response.json({ ok: true });
      }),
    );

    await Promise.all([api.get("/first"), api.get("/second")]);

    expect(refreshCalls).toBe(1);
    expect(protectedCalls).toBe(4);
  });

  it("aborts stalled requests", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }),
    );

    const assertion = expect(api.get("/slow")).rejects.toMatchObject({
      kind: "timeout",
    });
    await vi.advanceTimersByTimeAsync(90_000);

    await assertion;
  });

  it("preserves a caller abort so query cancellation is not reported as a network failure", async () => {
    const parent = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }),
    );

    const request = api.get("/cancelled", { signal: parent.signal });
    parent.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    await expect(request).rejects.not.toBeInstanceOf(ApiNetworkError);
  });

  it("shares one cold-start readiness request across simultaneous callers", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const first = api.warmup();
    const second = api.warmup();
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/health/live",
      "/health/ready",
    ]);
  });

  it("retains the server request ID on API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message: "This account is suspended." } },
          { status: 403, headers: { "x-request-id": "request-403" } },
        ),
      ),
    );

    await expect(api.post("/auth/login", {})).rejects.toMatchObject({
      requestId: "request-403",
      status: 403,
    });
  });
});
