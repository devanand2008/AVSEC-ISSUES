import { Injectable } from "@nestjs/common";
import { addMinutes } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { PrismaService } from "../../database/prisma.service";

interface WorkingHours { timezone: string; weekdays: number[]; startsAt: string; endsAt: string }

@Injectable()
export class SlaService {
  constructor(private readonly prisma: PrismaService) {}

  async deadlines(collegeId: string, policy: { acknowledgementMinutes: number; resolutionMinutes: number; workingHoursOnly: boolean; timezone: string } | null, start: Date): Promise<{ acknowledgementDueAt?: Date; resolutionDueAt?: Date }> {
    if (!policy) return {};
    if (!policy.workingHoursOnly) return { acknowledgementDueAt: addMinutes(start, policy.acknowledgementMinutes), resolutionDueAt: addMinutes(start, policy.resolutionMinutes) };
    const setting = await this.prisma.appSetting.findUnique({ where: { collegeId_key: { collegeId, key: "working_hours" } } });
    const hours = this.parse(setting?.value, policy.timezone);
    return { acknowledgementDueAt: this.addWorkingMinutes(start, policy.acknowledgementMinutes, hours), resolutionDueAt: this.addWorkingMinutes(start, policy.resolutionMinutes, hours) };
  }

  private addWorkingMinutes(start: Date, minutes: number, hours: WorkingHours): Date {
    const [startHour, startMinute] = this.time(hours.startsAt); const [endHour, endMinute] = this.time(hours.endsAt);
    const startOfDayMinutes = startHour * 60 + startMinute; const endOfDayMinutes = endHour * 60 + endMinute;
    const local = toZonedTime(start, hours.timezone); let remaining = minutes;
    for (let day = 0; day < 3660; day += 1) {
      const weekday = local.getDay(); const current = local.getHours() * 60 + local.getMinutes();
      if (hours.weekdays.includes(weekday) && current < endOfDayMinutes) {
        const effective = Math.max(current, startOfDayMinutes); const available = endOfDayMinutes - effective;
        if (remaining <= available) { local.setHours(Math.floor((effective + remaining) / 60), (effective + remaining) % 60, 0, 0); return fromZonedTime(local, hours.timezone); }
        remaining -= available;
      }
      local.setDate(local.getDate() + 1); local.setHours(startHour, startMinute, 0, 0);
    }
    throw new Error("Working-hours SLA exceeded the supported calculation horizon.");
  }

  private parse(value: unknown, fallbackTimezone: string): WorkingHours {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const row = value as Record<string, unknown>;
      if (typeof row.timezone === "string" && Array.isArray(row.weekdays) && typeof row.startsAt === "string" && typeof row.endsAt === "string") return { timezone: row.timezone, weekdays: row.weekdays.filter((day): day is number => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6), startsAt: row.startsAt, endsAt: row.endsAt };
    }
    return { timezone: fallbackTimezone, weekdays: [1,2,3,4,5,6], startsAt: "09:00", endsAt: "17:00" };
  }

  private time(value: string): [number, number] { const match = /^(\d{2}):(\d{2})$/.exec(value); if (!match) throw new Error("Invalid working-hours time."); return [Number(match[1]), Number(match[2])]; }
}
