import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from "class-validator";

export const NOTIFICATION_FILTERS = [
  "all",
  "urgent",
  "escalations",
  "unread",
  "assigned",
  "overdue",
  "completed",
] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

export const NOTIFICATION_SORTS = [
  "newest",
  "oldest",
  "priority",
  "unread",
] as const;
export type NotificationSort = (typeof NOTIFICATION_SORTS)[number];

export class NotificationQueryDto {
  // Keep accepting the legacy integer range; the service clamps it to safe bounds.
  @IsOptional() @Type(() => Number) @IsInt() page = 1;
  @IsOptional() @Type(() => Number) @IsInt() pageSize = 20;
  @IsOptional() @IsIn(NOTIFICATION_FILTERS) filter: NotificationFilter = "all";
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsIn(NOTIFICATION_SORTS) sort: NotificationSort = "newest";

  // Kept for existing clients. `filter=unread` is the preferred form.
  @IsOptional() @IsIn(["true", "false"]) unreadOnly?: string;
}
