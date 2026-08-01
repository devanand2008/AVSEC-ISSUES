import {
  backupScheduleDayRange,
  backupScheduleSlot,
} from "../src/modules/backups/backup-scheduler.service";

describe("backup schedule", () => {
  it("uses the configured Asia/Kolkata hour for the daily backup", () => {
    expect(
      backupScheduleSlot(new Date("2026-07-30T20:30:00.000Z"), 2),
    ).toEqual({
      dayKey: "2026-07-31",
      dueTypes: ["DAILY"],
    });
    expect(
      backupScheduleSlot(new Date("2026-07-30T19:30:00.000Z"), 2),
    ).toBeNull();
  });

  it("adds weekly and monthly recovery points on their due dates", () => {
    expect(
      backupScheduleSlot(new Date("2026-08-01T20:30:00.000Z"), 2),
    ).toEqual({
      dayKey: "2026-08-02",
      dueTypes: ["DAILY", "WEEKLY"],
    });
    expect(
      backupScheduleSlot(new Date("2026-07-31T20:30:00.000Z"), 2),
    ).toEqual({
      dayKey: "2026-08-01",
      dueTypes: ["DAILY", "MONTHLY"],
    });
  });

  it("rejects invalid local schedule hours", () => {
    expect(() => backupScheduleSlot(new Date(), -1)).toThrow(
      "The backup schedule hour is invalid.",
    );
    expect(() => backupScheduleSlot(new Date(), 24)).toThrow(
      "The backup schedule hour is invalid.",
    );
  });

  it("derives an exact Asia/Kolkata day range for database deduplication", () => {
    expect(backupScheduleDayRange("2026-07-31")).toEqual({
      start: new Date("2026-07-30T18:30:00.000Z"),
      end: new Date("2026-07-31T18:30:00.000Z"),
    });
    expect(() => backupScheduleDayRange("2026-02-31")).toThrow(
      "The backup schedule date is invalid.",
    );
  });
});
