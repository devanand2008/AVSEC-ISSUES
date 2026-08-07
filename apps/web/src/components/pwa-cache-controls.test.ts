import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForPwaUpdate, clearPwaAppCache } from "./pwa-cache-controls";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("installed application maintenance", () => {
  it("checks for a service-worker update and activates a waiting worker", async () => {
    const postMessage = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn().mockResolvedValue({
          update,
          waiting: { postMessage },
        }),
      },
    });

    await expect(checkForPwaUpdate()).resolves.toContain("being activated");
    expect(update).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("deletes only AVS shell caches", async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", {
      keys: vi
        .fn()
        .mockResolvedValue([
          "college-shell-v4",
          "college-shell-v5",
          "unrelated-cache",
        ]),
      delete: deleteCache,
    });

    await expect(clearPwaAppCache()).resolves.toBe(2);
    expect(deleteCache).toHaveBeenCalledTimes(2);
    expect(deleteCache).not.toHaveBeenCalledWith("unrelated-cache");
  });
});
