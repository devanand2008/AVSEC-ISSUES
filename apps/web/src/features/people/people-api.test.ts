import { describe, expect, it } from "vitest";
import { PEOPLE_BACKUPS_ENDPOINT } from "./people-api";

describe("People management API routes", () => {
  it("uses the canonical admin backups controller route", () => {
    expect(PEOPLE_BACKUPS_ENDPOINT).toBe("/admin/backups");
  });
});
