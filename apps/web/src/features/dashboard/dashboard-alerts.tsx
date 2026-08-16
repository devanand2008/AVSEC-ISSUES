import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import type {
  NotificationSummary,
  NotificationSummaryAlert,
} from "@/features/shell/notification-summary";
import styles from "./dashboard-alerts.module.css";

const alertPresentation = {
  CRITICAL: { className: styles.critical, Icon: AlertCircle },
  WARNING: { className: styles.warning, Icon: AlertTriangle },
  INFO: { className: styles.info, Icon: Info },
  SUCCESS: { className: styles.success, Icon: CheckCircle2 },
} as const;

export function DashboardAlerts() {
  const client = useQueryClient();
  const summary = useQuery({
    queryKey: ["notification-summary"],
    queryFn: ({ signal }) =>
      api.get<NotificationSummary>("/notifications/summary", { signal }),
    staleTime: 30_000,
    retry: false,
  });
  const dismiss = useMutation({
    mutationFn: ({ id, dismissedAt }: { id: string; dismissedAt: string }) =>
      api.patch("/profile/me/notification-preferences", {
        dismissed_banners: { [id]: dismissedAt },
      }),
    onMutate: async ({ id, dismissedAt }) => {
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
                alerts: current.alerts.map((alert) =>
                  alert.id === id ? { ...alert, dismissedAt } : alert,
                ),
              }
            : current,
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        client.setQueryData(["notification-summary"], context.previous);
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["notification-summary"] });
      void client.invalidateQueries({ queryKey: ["notification-preferences"] });
    },
  });

  const alerts = summary.data?.alerts.filter((alert) => !alert.dismissedAt) ?? [];
  if (!alerts.length) return null;

  return (
    <section className={styles.stack} aria-label="Operational alerts" aria-live="polite">
      {alerts.map((alert) => (
        <DashboardAlert
          alert={alert}
          dismissing={dismiss.isPending && dismiss.variables?.id === alert.id}
          key={alert.id}
          onDismiss={() => {
            if (alert.level === "CRITICAL" || !alert.dismissible) return;
            dismiss.mutate({ id: alert.id, dismissedAt: new Date().toISOString() });
          }}
        />
      ))}
    </section>
  );
}

function DashboardAlert({
  alert,
  dismissing,
  onDismiss,
}: {
  alert: NotificationSummaryAlert;
  dismissing: boolean;
  onDismiss: () => void;
}) {
  const presentation = alertPresentation[alert.level];
  const Icon = presentation.Icon;
  const canDismiss = alert.level !== "CRITICAL" && alert.dismissible;

  return (
    <article
      className={`${styles.alert} ${presentation.className}`}
      data-priority={alert.level}
      role={alert.level === "CRITICAL" ? "alert" : undefined}
    >
      <span className={styles.icon} aria-hidden="true">
        <Icon size={20} />
      </span>
      <div className={styles.copy}>
        <strong>{alert.level === "INFO" ? "Information" : titleCase(alert.level)}: {alert.title}</strong>
        <span>{alert.message}</span>
      </div>
      {(alert.action || canDismiss) && (
        <div className={styles.actions}>
          {alert.action && (
            <Link className={styles.action} href={alert.action.href}>
              {alert.action.label}
            </Link>
          )}
          {canDismiss && (
            <button
              className={styles.dismiss}
              disabled={dismissing}
              type="button"
              aria-label={`Dismiss ${alert.title}`}
              onClick={onDismiss}
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function titleCase(value: string): string {
  return `${value.slice(0, 1)}${value.slice(1).toLowerCase()}`;
}
