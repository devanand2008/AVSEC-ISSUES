export const NOTIFICATION_CATEGORY_KEYS = [
  "issue_assignment",
  "issue_updates",
  "overdue_warnings",
  "maintenance_alerts",
  "escalations",
  "attendance_alerts",
  "announcements",
  "messages",
  "system_alerts",
  "academic_alerts",
  "avs_learn",
  "avs_skill",
  "import_failures",
  "backup_alerts",
] as const;

export type NotificationCategoryKey =
  (typeof NOTIFICATION_CATEGORY_KEYS)[number];
export type DisplayDensity = "comfortable" | "compact";

export const BANNER_DISMISSAL_CLOCK_SKEW_MS = 5 * 60_000;

export interface NotificationChannelPreferences {
  in_app: boolean;
  push: boolean;
  email: boolean;
  whatsapp: boolean;
}

export interface NotificationPreferences
  extends NotificationChannelPreferences {
  categories: Record<NotificationCategoryKey, NotificationChannelPreferences>;
  quiet_hours: {
    enabled: boolean;
    start: string;
    end: string;
    allow_critical: boolean;
  };
  display_density: DisplayDensity;
  dismissed_banners: Record<string, string>;
}

export interface NotificationPreferencesPatch
  extends Partial<NotificationChannelPreferences> {
  categories?: Partial<
    Record<NotificationCategoryKey, Partial<NotificationChannelPreferences>>
  >;
  quiet_hours?: Partial<NotificationPreferences["quiet_hours"]>;
  display_density?: DisplayDensity;
  dismissed_banners?: Record<string, string>;
}

const DEFAULT_CHANNELS: NotificationChannelPreferences = {
  in_app: true,
  push: true,
  email: true,
  whatsapp: false,
};

export function defaultNotificationPreferences(): NotificationPreferences {
  const categories = Object.fromEntries(
    NOTIFICATION_CATEGORY_KEYS.map((category) => [
      category,
      { ...DEFAULT_CHANNELS },
    ]),
  ) as Record<NotificationCategoryKey, NotificationChannelPreferences>;
  return {
    ...DEFAULT_CHANNELS,
    categories,
    quiet_hours: {
      enabled: false,
      start: "22:00",
      end: "06:00",
      allow_critical: true,
    },
    display_density: "comfortable",
    dismissed_banners: {},
  };
}

export function normalizeNotificationPreferences(
  value: unknown,
): NotificationPreferences {
  const defaults = defaultNotificationPreferences();
  const source = asObject(value);
  const channels = normalizeChannels(source, defaults);
  const categorySource = asObject(source.categories);
  const categories = Object.fromEntries(
    NOTIFICATION_CATEGORY_KEYS.map((category) => [
      category,
      normalizeChannels(asObject(categorySource[category]), channels),
    ]),
  ) as Record<NotificationCategoryKey, NotificationChannelPreferences>;
  const quietSource = asObject(source.quiet_hours);
  const dismissedSource = asObject(source.dismissed_banners);
  const dismissed_banners = Object.fromEntries(
    Object.entries(dismissedSource).filter(
      ([key, timestamp]) =>
        isBannerKey(key) &&
        typeof timestamp === "string" &&
        Number.isFinite(Date.parse(timestamp)),
    ),
  ) as Record<string, string>;

  return {
    ...channels,
    categories,
    quiet_hours: {
      enabled: booleanOr(quietSource.enabled, defaults.quiet_hours.enabled),
      start: timeOr(quietSource.start, defaults.quiet_hours.start),
      end: timeOr(quietSource.end, defaults.quiet_hours.end),
      allow_critical: booleanOr(
        quietSource.allow_critical,
        defaults.quiet_hours.allow_critical,
      ),
    },
    display_density:
      source.display_density === "compact" ? "compact" : "comfortable",
    dismissed_banners,
  };
}

export function mergeNotificationPreferences(
  current: unknown,
  patch: NotificationPreferencesPatch,
): NotificationPreferences {
  const existing = normalizeNotificationPreferences(current);
  const categories = { ...existing.categories };
  for (const category of NOTIFICATION_CATEGORY_KEYS) {
    const categoryPatch = patch.categories?.[category];
    if (categoryPatch)
      categories[category] = normalizeChannels(
        categoryPatch,
        existing.categories[category],
      );
  }
  return normalizeNotificationPreferences({
    ...existing,
    in_app: patch.in_app ?? existing.in_app,
    push: patch.push ?? existing.push,
    email: patch.email ?? existing.email,
    whatsapp: patch.whatsapp ?? existing.whatsapp,
    categories,
    quiet_hours: { ...existing.quiet_hours, ...patch.quiet_hours },
    display_density: patch.display_density ?? existing.display_density,
    dismissed_banners: {
      ...existing.dismissed_banners,
      ...patch.dismissed_banners,
    },
  });
}

export function isBannerKey(value: string): boolean {
  return /^[a-z0-9][a-z0-9._:-]{0,119}$/i.test(value);
}

export function activeBannerDismissal(
  value: string | undefined,
  hours: number,
  now = Date.now(),
): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) &&
    timestamp <= now + BANNER_DISMISSAL_CLOCK_SKEW_MS &&
    timestamp > now - hours * 60 * 60_000
    ? value
    : null;
}

function normalizeChannels(
  value: Record<string, unknown> | Partial<NotificationChannelPreferences>,
  fallback: NotificationChannelPreferences,
): NotificationChannelPreferences {
  return {
    in_app: booleanOr(value.in_app, fallback.in_app),
    push: booleanOr(value.push, fallback.push),
    email: booleanOr(value.email, fallback.email),
    whatsapp: booleanOr(value.whatsapp, fallback.whatsapp),
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function timeOr(value: unknown, fallback: string): string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? value
    : fallback;
}
