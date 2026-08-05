import type { AttendanceCode, AttendancePartStatus } from "../../generated/prisma/client";

export interface AttendanceParts {
  morningStatus: AttendancePartStatus | null;
  afternoonStatus: AttendancePartStatus | null;
  effectiveAttendanceValue: number;
}

const CREDITED = new Set<AttendanceCode>(["PRESENT", "LATE", "ON_DUTY", "AUTHORIZED_LEAVE"]);

export function attendanceParts(
  status: AttendanceCode,
  morningStatus?: AttendancePartStatus,
  afternoonStatus?: AttendancePartStatus,
): AttendanceParts {
  if ((morningStatus && !afternoonStatus) || (!morningStatus && afternoonStatus)) {
    throw new Error("Morning and afternoon attendance must be supplied together.");
  }
  const halfDay = status === "HALF_DAY_PRESENT" || status === "HALF_DAY_ABSENT";
  if (!halfDay && (morningStatus || afternoonStatus)) {
    throw new Error("Morning and afternoon values are only valid for half-day attendance.");
  }
  if (halfDay) {
    const expectedMorning = status === "HALF_DAY_PRESENT" ? "PRESENT" : "ABSENT";
    const expectedAfternoon = status === "HALF_DAY_PRESENT" ? "ABSENT" : "PRESENT";
    const morning = morningStatus ?? expectedMorning;
    const afternoon = afternoonStatus ?? expectedAfternoon;
    if (morning === afternoon) {
      throw new Error("Half-day attendance must contain one present part and one absent part.");
    }
    return { morningStatus: morning, afternoonStatus: afternoon, effectiveAttendanceValue: 0.5 };
  }
  return { morningStatus: null, afternoonStatus: null, effectiveAttendanceValue: CREDITED.has(status) ? 1 : 0 };
}

export function attendanceCredit(record: { status: string; effectiveAttendanceValue?: number | { toNumber(): number } | null }): number {
  if (typeof record.effectiveAttendanceValue === "number") return record.effectiveAttendanceValue;
  if (record.effectiveAttendanceValue && typeof record.effectiveAttendanceValue === "object") return record.effectiveAttendanceValue.toNumber();
  if (["HALF_DAY_PRESENT", "HALF_DAY_ABSENT"].includes(record.status)) return 0.5;
  return CREDITED.has(record.status as AttendanceCode) ? 1 : 0;
}
