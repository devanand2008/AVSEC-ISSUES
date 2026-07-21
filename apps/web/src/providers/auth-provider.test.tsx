import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { User } from "@/lib/types";
import { performLogout } from "./auth-provider";

const user: User = {
  id: "user-1",
  fullName: "Alice Admin",
  email: "alice@example.com",
  status: "ACTIVE",
  mustChangePassword: false,
  roles: ["ADMIN"],
  permissions: ["settings.read"],
};

describe("AuthProvider logout", () => {
  it("clears local auth state even when the server logout request fails", async () => {
    const client = new QueryClient();
    const revokeSession = vi.fn().mockRejectedValue(new Error("Network unavailable"));

    client.setQueryData(["me"], user);
    client.setQueryData(["issues"], [{ id: "issue-1" }]);

    await performLogout(client, revokeSession);

    expect(client.getQueryData(["me"])).toBeNull();
    expect(client.getQueryData(["issues"])).toBeUndefined();
    expect(revokeSession).toHaveBeenCalledOnce();
  });
});
