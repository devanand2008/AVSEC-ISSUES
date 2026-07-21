import { describe, expect, it } from "vitest";
import { resolveRuntimeUrl } from "./runtime-url";

describe("resolveRuntimeUrl", () => {
  it("keeps local browser requests on localhost when the image was built with a LAN API URL", () => {
    expect(resolveRuntimeUrl("http://10.181.158.176:4000/api/v1", "localhost")).toBe("http://localhost:4000/api/v1");
  });

  it("uses the current LAN host when the image was built with a localhost API URL", () => {
    expect(resolveRuntimeUrl("http://localhost:4000/api/v1", "10.181.158.176")).toBe("http://10.181.158.176:4000/api/v1");
  });

  it("does not rewrite public production API hosts during local development", () => {
    expect(resolveRuntimeUrl("https://api.college.example/api/v1", "localhost")).toBe("https://api.college.example/api/v1");
  });
});
