import { istFileTimestamp } from "../src/modules/backups/backups.service";

describe("backup artifact naming", () => {
  it("uses the Asia/Kolkata calendar date and time", () => {
    const timestamp = istFileTimestamp(new Date("2026-08-04T20:30:00.000Z"));
    expect(timestamp).toBe("2026-08-05_02-00-00");
    expect(`avs_portal_full_${timestamp}_IST.sql`).toMatch(
      /^avs_portal_full_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_IST\.sql$/,
    );
  });
});
