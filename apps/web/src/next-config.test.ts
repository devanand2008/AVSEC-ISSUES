import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("frontend security headers", () => {
  it("applies the API-equivalent HSTS policy to all frontend and PWA paths", async () => {
    const rules = await nextConfig.headers?.();
    const catchAll = rules?.find((rule) => rule.source === "/(.*)");

    expect(catchAll?.headers).toContainEqual({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
    expect(rules?.some((rule) => rule.source === "/sw.js")).toBe(true);
  });
});
