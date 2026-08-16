"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertCircle,
  BellRing,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Info,
  Search,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { firebaseBrowserConfigured, requestPushToken } from "@/lib/firebase";
import { useAuth } from "@/providers/auth-provider";
import {
  AssignmentDialog,
  type AssignmentTeam,
  type AssignmentValue,
} from "./assignment-dialog";
import { NotificationFilterSheet } from "./notification-filter-sheet";
import {
  EXTRA_FILTERS,
  REQUIRED_FILTERS,
  buildNotificationQuery,
  isAssignmentAction,
  isDirectAction,
  isMarkReadAction,
  normalizeActionId,
  updateNotificationItem,
  type NotificationAction,
  type NotificationAlert,
  type NotificationFilter,
  type NotificationItem as NotificationItemModel,
  type NotificationResult,
  type NotificationSort,
  type NotificationSummary,
} from "./notification-center";
import { NotificationItem } from "./notification-item";
import styles from "./notifications.module.css";

const PAGE_SIZE = 20;

interface PushDevice {
  id: string;
  platform: string;
  deviceName: string | null;
  lastSeenAt: string;
  createdAt: string;
}

interface AssignmentTarget {
  item: NotificationItemModel;
  action: NotificationAction;
}

interface NotificationPreferences {
  display_density: "comfortable" | "compact";
  dismissed_banners?: Record<string, string>;
}

interface NotificationPreferencesResponse {
  preferences: NotificationPreferences;
}

interface CacheSnapshot {
  notifications: Array<[readonly unknown[], NotificationResult | undefined]>;
  summary: NotificationSummary | undefined;
}

function alertIcon(level: NotificationAlert["level"]) {
  if (level === "CRITICAL") return CircleAlert;
  if (level === "WARNING") return TriangleAlert;
  if (level === "SUCCESS") return CheckCheck;
  return Info;
}

function optimisticStatus(action: NotificationAction): string | null {
  const id = normalizeActionId(action.id);
  if (id === "acknowledge") return "ACKNOWLEDGED";
  if (id === "start_work") return "IN_PROGRESS";
  if (id === "assign" || id === "reassign") return "ASSIGNED";
  return null;
}

function notificationFilter(value: string | null): NotificationFilter {
  return [...REQUIRED_FILTERS, ...EXTRA_FILTERS].some(
    (item) => item.id === value,
  )
    ? (value as NotificationFilter)
    : "all";
}

export default function NotificationsPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.state} aria-label="Loading notifications" />
      }
    >
      <NotificationsPageContent />
    </Suspense>
  );
}

function NotificationsPageContent() {
  const client = useQueryClient();
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const routeSearchParams = useSearchParams();
  const routeFilter = notificationFilter(routeSearchParams.get("filter"));
  const [filter, setFilter] = useState<NotificationFilter>(routeFilter);
  const [sort, setSort] = useState<NotificationSort>("newest");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [assignmentTarget, setAssignmentTarget] =
    useState<AssignmentTarget | null>(null);
  const [assignmentError, setAssignmentError] = useState("");
  const [densityOverride, setDensityOverride] = useState<
    "comfortable" | "compact" | null
  >(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setFilter((current) => (current === routeFilter ? current : routeFilter));
      setPage(1);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [routeFilter]);

  const notifications = useQuery({
    queryKey: [
      "notifications",
      { page, pageSize: PAGE_SIZE, filter, search, sort },
    ],
    queryFn: ({ signal }) =>
      api.get<NotificationResult>(
        buildNotificationQuery({
          page,
          pageSize: PAGE_SIZE,
          filter,
          search,
          sort,
        }),
        { signal },
      ),
    placeholderData: keepPreviousData,
    staleTime: 20_000,
  });
  const summary = useQuery({
    queryKey: ["notification-summary"],
    queryFn: ({ signal }) =>
      api.get<NotificationSummary>("/notifications/summary", { signal }),
    staleTime: 20_000,
  });
  const preferences = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: ({ signal }) =>
      api.get<NotificationPreferencesResponse>("/notifications/preferences", {
        signal,
      }),
    staleTime: 60_000,
  });
  const devices = useQuery({
    queryKey: ["push-devices"],
    queryFn: ({ signal }) =>
      api.get<PushDevice[]>("/notifications/devices", { signal }),
    enabled: deliveryOpen,
    staleTime: 60_000,
  });
  const assignmentOptions = useQuery({
    queryKey: ["issue-assignment-options"],
    queryFn: ({ signal }) =>
      api.get<AssignmentTeam[]>("/issues/assignment-options", { signal }),
    enabled: Boolean(
      assignmentTarget && user?.permissions.includes("issues.assign"),
    ),
    staleTime: 60_000,
  });

  function snapshotCache(): CacheSnapshot {
    return {
      notifications: client.getQueriesData<NotificationResult>({
        queryKey: ["notifications"],
      }),
      summary: client.getQueryData<NotificationSummary>([
        "notification-summary",
      ]),
    };
  }

  function restoreCache(snapshot: CacheSnapshot | undefined) {
    snapshot?.notifications.forEach(([key, value]) =>
      client.setQueryData(key, value),
    );
    if (snapshot?.summary)
      client.setQueryData(["notification-summary"], snapshot.summary);
  }

  function optimisticallyRead(
    item: NotificationItemModel,
    status?: string | null,
  ) {
    const wasUnread = !item.readAt;
    const readAt = item.readAt ?? new Date().toISOString();
    client.setQueriesData<NotificationResult>(
      { queryKey: ["notifications"] },
      (current) => {
        const updated = updateNotificationItem(current, item.id, (cached) => ({
          ...cached,
          readAt,
          notification:
            status && cached.notification.context
              ? {
                  ...cached.notification,
                  context: { ...cached.notification.context, status },
                }
              : cached.notification,
        }));
        if (!updated || !wasUnread) return updated;
        return { ...updated, unread: Math.max(0, updated.unread - 1) };
      },
    );
    if (wasUnread || status === "ACKNOWLEDGED") {
      client.setQueryData<NotificationSummary>(
        ["notification-summary"],
        (current) =>
          current
            ? {
                ...current,
                unread: wasUnread
                  ? Math.max(0, current.unread - 1)
                  : current.unread,
                unacknowledgedIssues:
                  status === "ACKNOWLEDGED"
                    ? Math.max(0, current.unacknowledgedIssues - 1)
                    : current.unacknowledgedIssues,
              }
            : current,
      );
    }
  }

  async function invalidateNotificationData() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["notifications"] }),
      client.invalidateQueries({ queryKey: ["notification-summary"] }),
    ]);
  }

  const markRead = useMutation({
    mutationFn: (item: NotificationItemModel) =>
      api.post(`/notifications/${item.id}/read`),
    onMutate: async (item) => {
      await Promise.all([
        client.cancelQueries({ queryKey: ["notifications"] }),
        client.cancelQueries({ queryKey: ["notification-summary"] }),
      ]);
      const snapshot = snapshotCache();
      optimisticallyRead(item);
      return snapshot;
    },
    onError: (caught, _item, snapshot) => {
      restoreCache(snapshot);
      setFeedback({
        type: "error",
        message:
          caught instanceof ApiError
            ? caught.message
            : "Notification could not be marked as read.",
      });
    },
    onSettled: invalidateNotificationData,
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post("/notifications/read-all"),
    onMutate: async () => {
      await Promise.all([
        client.cancelQueries({ queryKey: ["notifications"] }),
        client.cancelQueries({ queryKey: ["notification-summary"] }),
      ]);
      const snapshot = snapshotCache();
      const readAt = new Date().toISOString();
      client.setQueriesData<NotificationResult>(
        { queryKey: ["notifications"] },
        (current) =>
          current
            ? {
                ...current,
                unread: 0,
                data: current.data.map((item) => ({
                  ...item,
                  readAt: item.readAt ?? readAt,
                })),
              }
            : current,
      );
      client.setQueryData<NotificationSummary>(
        ["notification-summary"],
        (current) => (current ? { ...current, unread: 0 } : current),
      );
      return snapshot;
    },
    onSuccess: () =>
      setFeedback({
        type: "success",
        message: "All notifications are marked as read.",
      }),
    onError: (caught, _variables, snapshot) => {
      restoreCache(snapshot);
      setFeedback({
        type: "error",
        message:
          caught instanceof ApiError
            ? caught.message
            : "Notifications could not be updated.",
      });
    },
    onSettled: invalidateNotificationData,
  });

  const runIssueAction = useMutation({
    mutationFn: async ({
      item,
      action,
    }: {
      item: NotificationItemModel;
      action: NotificationAction;
    }) => {
      const result = await api.post(action.href);
      if (!item.readAt)
        await api.post(`/notifications/${item.id}/read`).catch(() => undefined);
      return result;
    },
    onMutate: async ({ item, action }) => {
      await Promise.all([
        client.cancelQueries({ queryKey: ["notifications"] }),
        client.cancelQueries({ queryKey: ["notification-summary"] }),
      ]);
      const snapshot = snapshotCache();
      optimisticallyRead(item, optimisticStatus(action));
      setFeedback(null);
      return snapshot;
    },
    onSuccess: (_result, { action }) =>
      setFeedback({ type: "success", message: `${action.label} completed.` }),
    onError: (caught, _variables, snapshot) => {
      restoreCache(snapshot);
      setFeedback({
        type: "error",
        message:
          caught instanceof ApiError
            ? caught.message
            : "The notification action could not be completed.",
      });
    },
    onSettled: invalidateNotificationData,
  });

  const assignIssue = useMutation({
    mutationFn: async (value: AssignmentValue) => {
      if (!assignmentTarget) throw new Error("No issue was selected.");
      const result = await api.post(assignmentTarget.action.href, value);
      if (!assignmentTarget.item.readAt) {
        await api
          .post(`/notifications/${assignmentTarget.item.id}/read`)
          .catch(() => undefined);
      }
      return result;
    },
    onMutate: () => {
      setAssignmentError("");
      return assignmentTarget ? { target: assignmentTarget } : undefined;
    },
    onSuccess: (_result, _value, context) => {
      if (context?.target) {
        const wasAssigned =
          context.target.item.notification.context?.status === "ASSIGNED";
        optimisticallyRead(context.target.item, "ASSIGNED");
        if (!wasAssigned) {
          client.setQueryData<NotificationSummary>(
            ["notification-summary"],
            (current) =>
              current
                ? {
                    ...current,
                    assignedIssues: current.assignedIssues + 1,
                  }
                : current,
          );
        }
      }
      setFeedback({
        type: "success",
        message: `${context?.target.action.label ?? "Assignment"} completed.`,
      });
      setAssignmentTarget(null);
    },
    onError: (caught) => {
      setAssignmentError(
        caught instanceof ApiError
          ? caught.message
          : "The issue could not be assigned.",
      );
    },
    onSettled: invalidateNotificationData,
  });

  const registerDevice = useMutation({
    mutationFn: async () => {
      const token = await requestPushToken();
      return api.post("/notifications/devices", {
        token,
        platform: "WEB",
        deviceName: navigator.platform || "Web browser",
      });
    },
    onMutate: () => setFeedback(null),
    onSuccess: () => {
      setFeedback({
        type: "success",
        message: "Push notifications are enabled on this device.",
      });
      void client.invalidateQueries({ queryKey: ["push-devices"] });
    },
    onError: (caught) =>
      setFeedback({
        type: "error",
        message:
          caught instanceof Error
            ? caught.message
            : "Push notifications could not be enabled.",
      }),
  });

  const removeDevice = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/devices/${id}`),
    onSuccess: () => {
      setFeedback({ type: "success", message: "Push device removed." });
      void client.invalidateQueries({ queryKey: ["push-devices"] });
    },
    onError: (caught) =>
      setFeedback({
        type: "error",
        message:
          caught instanceof ApiError
            ? caught.message
            : "Push device could not be removed.",
      }),
  });

  const saveDensity = useMutation({
    mutationFn: (nextDensity: "comfortable" | "compact") =>
      api.patch<NotificationPreferences>(
        "/profile/me/notification-preferences",
        { display_density: nextDensity },
      ),
    onMutate: (nextDensity) => {
      const previous = densityOverride;
      setDensityOverride(nextDensity);
      return { previous };
    },
    onSuccess: (saved) => {
      client.setQueryData<NotificationPreferencesResponse>(
        ["notification-preferences"],
        (current) => (current ? { ...current, preferences: saved } : current),
      );
    },
    onError: (caught, _nextDensity, context) => {
      setDensityOverride(context?.previous ?? null);
      setFeedback({
        type: "error",
        message:
          caught instanceof ApiError
            ? caught.message
            : "Display density could not be saved.",
      });
    },
  });

  const dismissAlert = useMutation({
    mutationFn: ({
      alert,
      dismissedAt,
    }: {
      alert: NotificationAlert;
      dismissedAt: string;
    }) =>
      api.patch<NotificationPreferences>(
        "/profile/me/notification-preferences",
        {
          dismissed_banners: {
            ...(preferences.data?.preferences.dismissed_banners ?? {}),
            [alert.id]: dismissedAt,
          },
        },
      ),
    onMutate: async ({ alert, dismissedAt }) => {
      await client.cancelQueries({ queryKey: ["notification-summary"] });
      const previous = client.getQueryData<NotificationSummary>([
        "notification-summary",
      ]);
      client.setQueryData<NotificationSummary>(
        ["notification-summary"],
        (current) =>
          current
            ? {
                ...current,
                alerts: current.alerts.map((item) =>
                  item.id === alert.id ? { ...item, dismissedAt } : item,
                ),
              }
            : current,
      );
      return { previous };
    },
    onSuccess: (saved) => {
      client.setQueryData<NotificationPreferencesResponse>(
        ["notification-preferences"],
        (current) => (current ? { ...current, preferences: saved } : current),
      );
    },
    onError: (caught, _variables, context) => {
      if (context?.previous)
        client.setQueryData(["notification-summary"], context.previous);
      setFeedback({
        type: "error",
        message:
          caught instanceof ApiError
            ? caught.message
            : "The warning could not be dismissed.",
      });
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: ["notification-summary"] }),
  });

  function selectFilter(nextFilter: NotificationFilter) {
    setFilter(nextFilter);
    setPage(1);
    const params = new URLSearchParams(routeSearchParams.toString());
    if (nextFilter === "all") params.delete("filter");
    else params.set("filter", nextFilter);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  function selectSort(nextSort: NotificationSort) {
    setSort(nextSort);
    setPage(1);
  }

  function changeDensity(nextDensity: "comfortable" | "compact") {
    saveDensity.mutate(nextDensity);
  }

  function openNotification(item: NotificationItemModel) {
    if (!item.readAt && !markRead.isPending) markRead.mutate(item);
  }

  function handleAction(
    item: NotificationItemModel,
    action: NotificationAction,
  ) {
    setFeedback(null);
    if (isMarkReadAction(action)) {
      markRead.mutate(item);
      return;
    }
    if (isAssignmentAction(action)) {
      setAssignmentError("");
      setAssignmentTarget({ item, action });
      return;
    }
    if (isDirectAction(action)) {
      runIssueAction.mutate({ item, action });
      return;
    }
    setFeedback({
      type: "error",
      message: "Open the related record to complete this action safely.",
    });
  }

  const unread = summary.data?.unread ?? notifications.data?.unread ?? 0;
  const pageCount = notifications.data?.meta.pageCount ?? 0;
  const pendingAction =
    runIssueAction.isPending && runIssueAction.variables
      ? `${runIssueAction.variables.item.id}:${normalizeActionId(runIssueAction.variables.action.id)}`
      : markRead.isPending && markRead.variables
        ? `${markRead.variables.id}:mark_read`
        : null;
  const configured = firebaseBrowserConfigured();
  const density =
    densityOverride ??
    preferences.data?.preferences.display_density ??
    "comfortable";
  const activeExtraFilter = EXTRA_FILTERS.some((item) => item.id === filter)
    ? filter
    : "";

  return (
    <main className={styles.page} data-notification-ui="true">
      <div className={styles.heading}>
        <div className={styles.headingCopy}>
          <span className={styles.eyebrow}>Inbox</span>
          <h1>Notifications</h1>
          <p aria-live="polite">
            {unread} unread {unread === 1 ? "update" : "updates"}
          </p>
        </div>
        <div className={styles.headingActions}>
          <Link
            className={styles.secondaryButton}
            href="/settings/notifications"
          >
            <SlidersHorizontal size={17} aria-hidden="true" />
            Preferences
          </Link>
          <button
            className={styles.secondaryButton}
            disabled={!unread || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
            type="button"
          >
            <CheckCheck size={17} aria-hidden="true" />
            {markAllRead.isPending ? "Updating…" : "Mark all read"}
          </button>
        </div>
      </div>

      {!!summary.data?.alerts?.length && (
        <section className={styles.alertStack} aria-label="Priority alerts">
          {summary.data.alerts
            .filter((alert) => !alert.dismissedAt)
            .slice(0, 3)
            .map((alert) => {
              const AlertIcon = alertIcon(alert.level);
              return (
                <div
                  className={styles.alert}
                  data-level={alert.level}
                  role={alert.level === "CRITICAL" ? "alert" : "status"}
                  key={alert.id}
                >
                  <AlertIcon size={19} aria-hidden="true" />
                  <div className={styles.alertCopy}>
                    <strong>
                      {alert.level}: {alert.title}
                    </strong>
                    <span>{alert.message}</span>
                  </div>
                  <div className={styles.alertActions}>
                    {alert.action && (
                      <Link href={alert.action.href}>{alert.action.label}</Link>
                    )}
                    {alert.dismissible && alert.level !== "CRITICAL" && (
                      <button
                        disabled={dismissAlert.isPending}
                        onClick={() =>
                          dismissAlert.mutate({
                            alert,
                            dismissedAt: new Date().toISOString(),
                          })
                        }
                        type="button"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
        </section>
      )}

      {feedback && (
        <div
          className={`${styles.feedback} ${feedback.type === "error" ? styles.inlineError : styles.alert}`}
          data-level={feedback.type === "success" ? "SUCCESS" : undefined}
          role={feedback.type === "error" ? "alert" : "status"}
        >
          {feedback.type === "error" ? (
            <AlertCircle size={18} aria-hidden="true" />
          ) : (
            <CheckCheck size={18} aria-hidden="true" />
          )}
          <div className={styles.alertCopy}>
            <strong>
              {feedback.type === "error" ? "Action failed" : "Updated"}
            </strong>
            <span>{feedback.message}</span>
          </div>
          <button
            className={styles.iconButton}
            onClick={() => setFeedback(null)}
            type="button"
            aria-label="Dismiss message"
          >
            <X size={17} />
          </button>
        </div>
      )}

      <details
        className={styles.deliveryPanel}
        onToggle={(event) => setDeliveryOpen(event.currentTarget.open)}
      >
        <summary>
          <span className={styles.deliveryIcon}>
            <BellRing size={18} aria-hidden="true" />
          </span>
          <span className={styles.deliveryCopy}>
            <strong>Browser delivery</strong>
            <span>
              {configured
                ? "Manage push delivery for this browser."
                : "Push delivery is not configured; in-app notifications remain active."}
            </span>
          </span>
          <ChevronDown size={17} aria-hidden="true" />
        </summary>
        <div className={styles.deliveryBody}>
          <p>
            {configured
              ? "Enable urgent assignments and campus alerts on this device."
              : "An administrator must configure the push provider before browser delivery can be enabled."}
          </p>
          {configured && (
            <button
              className={styles.primaryButton}
              disabled={registerDevice.isPending}
              onClick={() => registerDevice.mutate()}
              type="button"
            >
              {registerDevice.isPending ? "Enabling…" : "Enable on this device"}
            </button>
          )}
          {devices.isLoading && configured && (
            <p>Loading registered devices…</p>
          )}
          {!!devices.data?.length && (
            <div className={styles.deviceList}>
              {devices.data.map((device) => (
                <article className={styles.device} key={device.id}>
                  <Smartphone size={18} aria-hidden="true" />
                  <div>
                    <strong>{device.deviceName ?? device.platform}</strong>
                    <small>
                      Last registered{" "}
                      {new Date(device.lastSeenAt).toLocaleString()}
                    </small>
                  </div>
                  <button
                    className={styles.iconButton}
                    aria-label={`Remove ${device.deviceName ?? "push device"}`}
                    disabled={removeDevice.isPending}
                    onClick={() => removeDevice.mutate(device.id)}
                    type="button"
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>
      </details>

      <section
        className={styles.toolbar}
        aria-label="Notification filters and search"
      >
        <div className={styles.filterRow}>
          <div
            className={styles.filterTabs}
            role="tablist"
            aria-label="Notification category"
          >
            {REQUIRED_FILTERS.map((tab) => {
              const count = summary.data?.[tab.countKey];
              return (
                <button
                  aria-controls="notification-results"
                  aria-selected={filter === tab.id}
                  className={styles.filterTab}
                  key={tab.id}
                  onClick={() => selectFilter(tab.id)}
                  role="tab"
                  type="button"
                >
                  {tab.label}
                  {count !== undefined && (
                    <span className={styles.filterCount}>
                      {count > 999 ? "999+" : count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <label className={`${styles.control} ${styles.moreFilterControl}`}>
            <span className={styles.eyebrow}>More</span>
            <select
              aria-label="Additional notification filters"
              value={activeExtraFilter}
              onChange={(event) => {
                if (event.target.value)
                  selectFilter(event.target.value as NotificationFilter);
              }}
            >
              <option value="">More filters</option>
              {EXTRA_FILTERS.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.toolRow}>
          <label className={styles.searchField}>
            <Search size={17} aria-hidden="true" />
            <input
              aria-label="Search notifications"
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search title, issue number, location or category"
              type="search"
              value={searchInput}
            />
            {searchInput && (
              <button
                aria-label="Clear notification search"
                onClick={() => setSearchInput("")}
                type="button"
              >
                <X size={16} />
              </button>
            )}
          </label>
          <div className={`${styles.toolbarActions} ${styles.desktopControls}`}>
            <label className={styles.control}>
              <select
                aria-label="Sort notifications"
                value={sort}
                onChange={(event) =>
                  selectSort(event.target.value as NotificationSort)
                }
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="priority">Highest priority</option>
                <option value="unread">Unread first</option>
              </select>
            </label>
            <label className={styles.control}>
              <select
                aria-label="Notification display density"
                disabled={saveDensity.isPending}
                value={density}
                onChange={(event) =>
                  changeDensity(event.target.value as "comfortable" | "compact")
                }
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
          </div>
          <button
            className={styles.mobileFilterButton}
            onClick={() => setShowMobileFilters(true)}
            type="button"
          >
            <SlidersHorizontal size={17} aria-hidden="true" />
            Filters
          </button>
        </div>
      </section>

      <NotificationFilterSheet
        activeCount={
          (filter !== "all" ? 1 : 0) +
          (sort !== "newest" ? 1 : 0) +
          (density !== "comfortable" ? 1 : 0)
        }
        onClose={() => setShowMobileFilters(false)}
        onReset={() => {
          selectFilter("all");
          selectSort("newest");
          changeDensity("comfortable");
        }}
        open={showMobileFilters}
      >
        <div>
          <label className="avs-label" htmlFor="mobile-notification-filter">
            Show
          </label>
          <select
            className="avs-input avs-select"
            id="mobile-notification-filter"
            value={filter}
            onChange={(event) =>
              selectFilter(event.target.value as NotificationFilter)
            }
          >
            {[...REQUIRED_FILTERS, ...EXTRA_FILTERS].map((item) => (
              <option value={item.id} key={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="avs-label" htmlFor="mobile-notification-sort">
            Sort
          </label>
          <select
            className="avs-input avs-select"
            id="mobile-notification-sort"
            value={sort}
            onChange={(event) =>
              selectSort(event.target.value as NotificationSort)
            }
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="priority">Highest priority</option>
            <option value="unread">Unread first</option>
          </select>
        </div>
        <div>
          <label className="avs-label" htmlFor="mobile-notification-density">
            Display density
          </label>
          <select
            className="avs-input avs-select"
            disabled={saveDensity.isPending}
            id="mobile-notification-density"
            value={density}
            onChange={(event) =>
              changeDensity(event.target.value as "comfortable" | "compact")
            }
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </div>
      </NotificationFilterSheet>

      <section
        className={styles.list}
        id="notification-results"
        aria-busy={notifications.isFetching}
        aria-label={`${filter} notifications`}
        aria-live="polite"
        role="tabpanel"
      >
        {notifications.isLoading ? (
          <div
            className={styles.skeletonList}
            aria-label="Loading notifications"
          >
            {Array.from({ length: 4 }, (_, index) => (
              <div className={styles.skeletonRow} key={index}>
                <span className={styles.skeletonIcon} />
                <span className={styles.skeletonLines}>
                  <span className={styles.skeletonLine} />
                  <span className={styles.skeletonLine} />
                  <span className={styles.skeletonLine} />
                </span>
              </div>
            ))}
          </div>
        ) : notifications.isError ? (
          <div className={styles.state} role="alert">
            <div className={styles.emptyContent}>
              <AlertCircle size={30} />
              <strong>Notifications could not be loaded</strong>
              <p>Check your connection, then try again.</p>
              <button
                className={styles.secondaryButton}
                onClick={() => notifications.refetch()}
                type="button"
              >
                Try again
              </button>
            </div>
          </div>
        ) : !notifications.data?.data.length ? (
          <div className={styles.state}>
            <div className={styles.emptyContent}>
              <BellRing size={30} />
              <strong>You&apos;re all caught up</strong>
              <p>There are no notifications matching this filter.</p>
              {filter !== "all" && (
                <button
                  className={styles.secondaryButton}
                  onClick={() => selectFilter("all")}
                  type="button"
                >
                  View all
                </button>
              )}
            </div>
          </div>
        ) : (
          notifications.data.data.map((item) => (
            <NotificationItem
              density={density}
              item={item}
              key={item.id}
              onAction={handleAction}
              onOpen={openNotification}
              pendingAction={pendingAction}
              permissions={user?.permissions ?? []}
            />
          ))
        )}
      </section>

      {pageCount > 1 && (
        <nav className={styles.pagination} aria-label="Notification pages">
          <button
            className={styles.paginationButton}
            disabled={page <= 1 || notifications.isFetching}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            type="button"
          >
            <ChevronLeft size={16} />
            Previous
          </button>
          <span>
            Page {notifications.data?.meta.page ?? page} of {pageCount} ·{" "}
            {notifications.data?.meta.total ?? 0} notifications
          </span>
          <button
            className={styles.paginationButton}
            disabled={page >= pageCount || notifications.isFetching}
            onClick={() =>
              setPage((current) => Math.min(pageCount, current + 1))
            }
            type="button"
          >
            Next
            <ChevronRight size={16} />
          </button>
        </nav>
      )}

      <AssignmentDialog
        key={
          assignmentTarget
            ? `${assignmentTarget.item.id}:${assignmentTarget.action.id}`
            : "closed"
        }
        actionLabel={assignmentTarget?.action.label ?? "Assign"}
        error={
          assignmentError ||
          (assignmentOptions.isError
            ? "Assignment options could not be loaded."
            : "")
        }
        item={assignmentTarget?.item ?? null}
        loadingOptions={assignmentOptions.isLoading}
        onClose={() => {
          setAssignmentTarget(null);
          setAssignmentError("");
        }}
        onSubmit={(value) => assignIssue.mutate(value)}
        saving={assignIssue.isPending}
        teams={assignmentOptions.data ?? []}
      />
    </main>
  );
}
