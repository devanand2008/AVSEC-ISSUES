import { describe, expect, it } from "vitest";
import { statusBadgeClass } from "./status-badge";

describe("StatusBadge", () => {
  it("renders readable workflow labels", () => {
    expect(statusBadgeClass("NEEDS_MANUAL_ASSIGNMENT")).toContain("badge-red");
  });

  it("uses consistent operational priority and escalation tones", () => {
    expect(statusBadgeClass("HIGH")).toContain("badge-orange");
    expect(statusBadgeClass("ACKNOWLEDGEMENT_OVERDUE")).toContain("badge-red");
    expect(statusBadgeClass("ESCALATED")).toContain("badge-red");
  });
});
