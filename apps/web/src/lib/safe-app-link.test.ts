import { describe, expect, it } from "vitest";
import { safeAppLink } from "./safe-app-link";

describe("safeAppLink", () => {
  const origin = "https://campus.example";

  it("keeps a relative in-app route including its query and fragment", () => {
    expect(safeAppLink("/issues/123?from=push#updates", origin)).toBe("/issues/123?from=push#updates");
  });

  it.each(["https://evil.example/phish", "//evil.example/phish", "/\\evil.example/phish", "javascript:alert(1)"])("rejects unsafe link %s", (link) => {
    expect(safeAppLink(link, origin)).toBe("/notifications");
  });
});
