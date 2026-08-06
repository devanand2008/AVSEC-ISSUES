import { api, idempotencyKey } from "./api";
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

    const assertion = expect(api.get("/slow")).rejects.toThrow("Aborted");
    await vi.advanceTimersByTimeAsync(90_000);

    await assertion;
  });
});
