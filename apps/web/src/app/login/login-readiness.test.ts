import { describe, expect, it, vi } from "vitest";
import { probeLoginReadiness } from "./login-readiness";

describe("probeLoginReadiness", () => {
  it("stops after three failed readiness checks", async () => {
    const ping = vi.fn().mockRejectedValue(new Error("starting"));
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      probeLoginReadiness(ping, { attempts: 20, wait }),
    ).resolves.toBe("unavailable");
    expect(ping).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("returns ready as soon as a retry succeeds", async () => {
    const ping = vi
      .fn()
      .mockRejectedValueOnce(new Error("starting"))
      .mockResolvedValue(undefined);

    await expect(
      probeLoginReadiness(ping, { wait: async () => undefined }),
    ).resolves.toBe("ready");
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("does not send a readiness request while offline", async () => {
    const ping = vi.fn().mockResolvedValue(undefined);

    await expect(
      probeLoginReadiness(ping, { isOnline: () => false }),
    ).resolves.toBe("offline");
    expect(ping).not.toHaveBeenCalled();
  });
});
