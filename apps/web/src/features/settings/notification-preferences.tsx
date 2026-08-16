"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellRing,
  Mail,
  MessageCircle,
  Save,
  Smartphone,
} from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";
import styles from "./notification-preferences.module.css";

export type PreferenceChannel = "in_app" | "push" | "email" | "whatsapp";
type CapabilityChannel = PreferenceChannel | "sms";
type Density = "comfortable" | "compact";

interface ChannelCapability {
  supported: boolean;
  configured: boolean;
  reason: string | null;
}

export interface NotificationPreferences {
  in_app: boolean;
  push: boolean;
  email: boolean;
  whatsapp: boolean;
  categories: Record<string, Record<PreferenceChannel, boolean>>;
  quiet_hours: {
    enabled: boolean;
    start: string;
    end: string;
    allow_critical: boolean;
  };
  display_density: Density;
  dismissed_banners?: Record<string, string>;
}

interface PreferencesResponse {
  preferences: Partial<NotificationPreferences>;
  channels: Record<CapabilityChannel, ChannelCapability>;
}

const CHANNELS: Array<{
  key: CapabilityChannel;
  label: string;
  description: string;
  Icon: typeof Bell;
}> = [
  { key: "in_app", label: "In-App", description: "Alerts inside the AVS portal", Icon: Bell },
  { key: "push", label: "Push", description: "Browser and installed-app alerts", Icon: BellRing },
  { key: "email", label: "Email", description: "Messages to your official email", Icon: Mail },
  { key: "whatsapp", label: "WhatsApp", description: "Urgent template messages", Icon: MessageCircle },
  { key: "sms", label: "SMS", description: "Mobile text messages", Icon: Smartphone },
];

const CATEGORY_LABELS: Record<string, string> = {
  issue_assignment: "Issue assignments",
  issue_updates: "Issue updates",
  overdue_warnings: "Overdue warnings",
  maintenance_alerts: "Maintenance alerts",
  escalations: "Escalations",
  attendance_alerts: "Attendance alerts",
  announcements: "Announcements",
  messages: "Messages",
  system_alerts: "System alerts",
  academic_alerts: "Academic alerts",
  avs_learn: "AVS Learn",
  avs_skill: "AVS Skill",
  import_failures: "Import failures",
  backup_alerts: "Backup alerts",
};

const MAINTENANCE_ROLES = new Set([
  "MAINTENANCE_ADMIN",
  "MAINTENANCE_SUPERVISOR",
  "MAINTENANCE_STAFF",
  "ELECTRICIAN",
  "PLUMBER",
  "IT_SUPPORT",
  "LAB_TECHNICIAN",
  "HOUSEKEEPING",
  "SECURITY",
  "OTHER_RESPONSIBLE",
]);

const CATEGORY_ORDER = [
  "system_alerts",
  "escalations",
  "maintenance_alerts",
  "issue_assignment",
  "issue_updates",
  "overdue_warnings",
  "attendance_alerts",
  "announcements",
  "messages",
  "academic_alerts",
  "avs_learn",
  "avs_skill",
  "import_failures",
  "backup_alerts",
] as const;

export function notificationCategoriesForRoles(roles: readonly string[]): string[] {
  const values = new Set(roles.map((role) => role.toUpperCase()));
  const selected = new Set<string>();
  const include = (categories: readonly string[]) => {
    categories.forEach((category) => selected.add(category));
  };
  if ([...values].some((role) => MAINTENANCE_ROLES.has(role))) {
    include(["issue_assignment", "issue_updates", "overdue_warnings", "escalations", "messages"]);
  }
  if (values.has("SUPER_ADMIN") || values.has("MAIN_ADMIN")) {
    include(["system_alerts", "escalations", "maintenance_alerts", "attendance_alerts", "import_failures", "backup_alerts"]);
  }
  if (values.has("STUDENT") || values.has("CLASS_REPRESENTATIVE")) {
    include(["announcements", "attendance_alerts", "messages", "avs_learn", "avs_skill", "issue_updates"]);
  }
  if (values.has("FACULTY") || values.has("HOD")) {
    include(["attendance_alerts", "announcements", "messages", "academic_alerts"]);
  }
  if (values.has("PRINCIPAL") || values.has("VICE_PRINCIPAL")) {
    include(["system_alerts", "escalations", "maintenance_alerts", "attendance_alerts", "announcements"]);
  }
  if (!selected.size) include(["announcements", "messages", "issue_updates"]);
  return CATEGORY_ORDER.filter((category) => selected.has(category));
}

const DEFAULT_CAPABILITY: ChannelCapability = {
  supported: false,
  configured: false,
  reason: "Not configured",
};

export function NotificationPreferencesPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState(false);
  const categories = useMemo(
    () => notificationCategoriesForRoles(user?.roles ?? []),
    [user?.roles],
  );
  const query = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: ({ signal }) =>
      api.get<PreferencesResponse>("/notifications/preferences", { signal }),
    enabled: Boolean(user),
  });
  const base = normalizePreferences(query.data?.preferences, categories);
  const preferences = draft ?? base;
  const update = (change: (current: NotificationPreferences) => NotificationPreferences) => {
    setMessage("");
    setSaveError(false);
    setDraft((current) => change(current ?? base));
  };
  const save = useMutation({
    mutationFn: () =>
      api.patch<NotificationPreferences>(
        "/profile/me/notification-preferences",
        preferences,
      ),
    onSuccess: () => {
      setMessage("Notification preferences saved.");
      setSaveError(false);
      setDraft(null);
      void client.invalidateQueries({ queryKey: ["notification-preferences"] });
      void client.invalidateQueries({ queryKey: ["profile-me"] });
    },
    onError: (caught) => {
      setSaveError(true);
      setMessage(
        caught instanceof ApiError
          ? caught.message
          : "Notification preferences could not be saved.",
      );
    },
  });

  if (!user) return null;
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) {
    return <ErrorState message="Notification preferences are unavailable. Please try again." />;
  }

  const categoryChannels = CHANNELS.filter(({ key }) => {
    if (key === "sms") return false;
    const capability = query.data.channels[key] ?? DEFAULT_CAPABILITY;
    return capability.supported && capability.configured;
  }) as Array<(typeof CHANNELS)[number] & { key: PreferenceChannel }>;

  return (
    <div className={styles.page} data-notification-ui="true">
      <PageHeader
        title="Notification settings"
        description="Choose how and when AVS sends updates relevant to your role."
        breadcrumbs={[
          { label: "Settings", href: "/profile" },
          { label: "Notifications" },
        ]}
      />

      <section className={styles.section} aria-labelledby="channels-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="channels-heading">Delivery channels</h2>
            <p>Unavailable providers are clearly marked and cannot be enabled.</p>
          </div>
        </div>
        <div className={styles.channelGrid}>
          {CHANNELS.map(({ key, label, description, Icon }) => {
            const capability = query.data.channels[key] ?? DEFAULT_CAPABILITY;
            const configurable =
              key !== "sms" && capability.supported && capability.configured;
            const enabled =
              key === "sms" ? false : configurable && preferences[key];
            return (
              <article className={styles.channelCard} key={key}>
                <span className={styles.channelIcon} aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className={styles.channelCopy}>
                  <strong>{label}</strong>
                  <small>{capability.reason || description}</small>
                  {!configurable && <span className={styles.unavailable}>Not configured</span>}
                </span>
                {key !== "sms" && (
                  <PreferenceSwitch
                    checked={enabled}
                    disabled={!configurable}
                    label={`${enabled ? "Disable" : "Enable"} ${label}`}
                    onChange={() =>
                      update((current) => ({ ...current, [key]: !current[key] }))
                    }
                  />
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="categories-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="categories-heading">Notification categories</h2>
            <p>Only categories relevant to your active role are shown.</p>
          </div>
        </div>
        {categoryChannels.length ? (
          <div className={styles.matrixScroller}>
            <div
              className={styles.matrix}
              role="table"
              aria-label="Notification category preferences"
            >
              <div
                className={`${styles.matrixRow} ${styles.matrixHeader}`}
                role="row"
                style={{ "--channel-count": categoryChannels.length } as CSSProperties}
              >
                <span className={styles.matrixLabel} role="columnheader">Category</span>
                {categoryChannels.map(({ key, label }) => (
                  <span className={styles.matrixCell} role="columnheader" key={key}>{label}</span>
                ))}
              </div>
              {categories.map((category) => (
                <div
                  className={styles.matrixRow}
                  role="row"
                  key={category}
                  style={{ "--channel-count": categoryChannels.length } as CSSProperties}
                >
                  <span className={styles.matrixLabel} role="rowheader">
                    {CATEGORY_LABELS[category] ?? category}
                  </span>
                  {categoryChannels.map(({ key, label }) => {
                    const enabled = preferences.categories[category]?.[key] ?? false;
                    return (
                      <span className={styles.matrixCell} role="cell" key={key}>
                        <PreferenceSwitch
                          checked={enabled}
                          disabled={!preferences[key]}
                          label={`${enabled ? "Disable" : "Enable"} ${CATEGORY_LABELS[category] ?? category} via ${label}`}
                          onChange={() =>
                            update((current) => {
                              const existing = current.categories[category] ?? {
                                in_app: current.in_app,
                                push: current.push,
                                email: false,
                                whatsapp: false,
                              };
                              return {
                                ...current,
                                categories: {
                                  ...current.categories,
                                  [category]: {
                                    ...existing,
                                    [key]: !existing[key],
                                  },
                                },
                              };
                            })
                          }
                        />
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="muted">No configured delivery channel is currently available.</p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="quiet-hours-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="quiet-hours-heading">Quiet hours</h2>
            <p>Save your preferred recurring daily quiet window.</p>
          </div>
        </div>
        <div className={styles.quietGrid}>
          <div className={styles.settingRow}>
            <div>
              <strong>Enable quiet hours</strong>
              <p>This preference never hides notifications already available in the portal.</p>
            </div>
            <PreferenceSwitch
              checked={preferences.quiet_hours.enabled}
              label="Enable quiet hours"
              onChange={() =>
                update((current) => ({
                  ...current,
                  quiet_hours: {
                    ...current.quiet_hours,
                    enabled: !current.quiet_hours.enabled,
                  },
                }))
              }
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="quiet-hours-start">Start time</label>
            <input
              id="quiet-hours-start"
              type="time"
              value={preferences.quiet_hours.start}
              disabled={!preferences.quiet_hours.enabled}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  quiet_hours: { ...current.quiet_hours, start: event.target.value },
                }))
              }
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="quiet-hours-end">End time</label>
            <input
              id="quiet-hours-end"
              type="time"
              value={preferences.quiet_hours.end}
              disabled={!preferences.quiet_hours.enabled}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  quiet_hours: { ...current.quiet_hours, end: event.target.value },
                }))
              }
            />
          </div>
        </div>
        <div className={`${styles.settingRow} ${styles.criticalOverride}`}>
          <div>
            <strong>Allow critical alerts during quiet hours</strong>
            <p>Keep this safety preference enabled for emergency maintenance escalations.</p>
          </div>
          <PreferenceSwitch
            checked={preferences.quiet_hours.allow_critical}
            label="Allow critical alerts during quiet hours"
            onChange={() =>
              update((current) => ({
                ...current,
                quiet_hours: {
                  ...current.quiet_hours,
                  allow_critical: !current.quiet_hours.allow_critical,
                },
              }))
            }
          />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="density-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="density-heading">Display density</h2>
            <p>Compact mode shows more notifications without shrinking touch targets.</p>
          </div>
        </div>
        <div className={styles.densityOptions} role="radiogroup" aria-label="Display density">
          {(["comfortable", "compact"] as const).map((density) => (
            <button
              className={styles.densityOption}
              role="radio"
              aria-checked={preferences.display_density === density}
              type="button"
              key={density}
              onClick={() => update((current) => ({ ...current, display_density: density }))}
            >
              {density === "comfortable" ? "Comfortable" : "Compact"}
            </button>
          ))}
        </div>
      </section>

      <div className={styles.footer}>
        <span
          className={`${styles.status} ${saveError ? styles.error : ""}`}
          role={saveError ? "alert" : "status"}
          aria-live="polite"
        >
          {message || (draft ? "You have unsaved changes." : "Preferences are up to date.")}
        </span>
        <button
          className="btn btn-primary"
          disabled={!draft || save.isPending}
          type="button"
          onClick={() => save.mutate()}
        >
          <Save size={17} aria-hidden="true" />
          {save.isPending ? "Saving…" : "Save preferences"}
        </button>
      </div>
    </div>
  );
}

function PreferenceSwitch({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      className={styles.switch}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
    />
  );
}

function normalizePreferences(
  input: Partial<NotificationPreferences> | undefined,
  categories: readonly string[],
): NotificationPreferences {
  const channels: Record<PreferenceChannel, boolean> = {
    in_app: input?.in_app ?? true,
    push: input?.push ?? true,
    email: input?.email ?? true,
    whatsapp: input?.whatsapp ?? false,
  };
  return {
    ...channels,
    categories: Object.fromEntries(
      categories.map((category) => [
        category,
        {
          in_app: input?.categories?.[category]?.in_app ?? channels.in_app,
          push: input?.categories?.[category]?.push ?? channels.push,
          email: input?.categories?.[category]?.email ?? false,
          whatsapp: input?.categories?.[category]?.whatsapp ?? false,
        },
      ]),
    ),
    quiet_hours: {
      enabled: input?.quiet_hours?.enabled ?? false,
      start: input?.quiet_hours?.start ?? "22:00",
      end: input?.quiet_hours?.end ?? "06:00",
      allow_critical: input?.quiet_hours?.allow_critical ?? true,
    },
    display_density: input?.display_density ?? "comfortable",
    dismissed_banners: input?.dismissed_banners,
  };
}
