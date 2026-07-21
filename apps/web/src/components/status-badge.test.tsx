import { describe, expect, it } from "vitest";
import { statusBadgeClass } from "./status-badge";

describe("StatusBadge", () => {
  it("renders readable workflow labels", () => {
    expect(statusBadgeClass("NEEDS_MANUAL_ASSIGNMENT")).toContain("badge-red");
  });
});
