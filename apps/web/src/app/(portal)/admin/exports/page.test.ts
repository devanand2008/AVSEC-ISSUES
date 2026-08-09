import { describe, expect, it } from "vitest";
import { EXPORTS } from "./page";

describe("data export routes", () => {
  it("uses the reports controller CSV endpoints", () => {
    expect(EXPORTS.map(({ key, path }) => ({ key, path }))).toEqual([
      { key: "attendance", path: "/reports/attendance/export.csv" },
      { key: "issues", path: "/reports/issues/export.csv" },
    ]);
  });
});
