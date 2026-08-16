"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BellRing,
  Clock3,
  ListTodo,
  ShieldAlert,
  TimerReset,
} from "lucide-react";
import Link from "next/link";
import type { DashboardMetrics } from "./dashboard-types";
import { api } from "@/lib/api";
import type { NotificationSummary } from "@/features/shell/notification-summary";
import styles from "./operations-summary.module.css";

export function formatResolutionTime(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "—";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded}m`;
  const days = Math.floor(rounded / 1_440);
  const hours = Math.floor((rounded % 1_440) / 60);
  const remainingMinutes = rounded % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function OperationsSummary({ metrics }: { metrics: DashboardMetrics }) {
  const summary = useQuery({
    queryKey: ["notification-summary"],
    queryFn: ({ signal }) =>
      api.get<NotificationSummary>("/notifications/summary", { signal }),
    staleTime: 30_000,
    retry: false,
  });
  const live = summary.data;
  const items = [
    {
      label: "Pending tickets",
      value: live?.pendingIssues ?? metrics.openIssues,
      icon: ListTodo,
      href: "/issues",
      tone: "",
    },
    {
      label: "Overdue issues",
      value: live?.overdueIssues ?? metrics.overdueIssues,
      icon: Clock3,
      href: "/notifications?filter=overdue",
      tone: (live?.overdueIssues ?? metrics.overdueIssues) > 0 ? styles.critical : "",
    },
    {
      label: "Unacknowledged",
      value: live?.unacknowledgedIssues ?? metrics.newIssues,
      icon: BellRing,
      href: "/issues",
      tone: (live?.unacknowledgedIssues ?? metrics.newIssues) > 0 ? styles.warning : "",
    },
    {
      label: "Escalations",
      value: live?.escalatedIssues ?? metrics.escalatedIssues,
      icon: ShieldAlert,
      href: "/notifications?filter=escalations",
      tone: (live?.escalatedIssues ?? metrics.escalatedIssues) > 0 ? styles.critical : "",
    },
    {
      label: "Avg. resolution",
      value: formatResolutionTime(
        live?.averageResolutionMinutes ?? metrics.averageResolutionMinutes,
      ),
      icon: TimerReset,
      href: "/analytics",
      tone: styles.success,
    },
  ];

  return (
    <section className={styles.summary} aria-label="Issue operations summary">
      {items.map(({ label, value, icon: Icon, href, tone }) => (
        <Link className={`${styles.metric} ${tone}`.trim()} href={href} key={label}>
          <span className={styles.icon} aria-hidden="true">
            <Icon size={19} />
          </span>
          <span className={styles.copy}>
            <strong className={styles.value}>{value}</strong>
            <span className={styles.label}>{label}</span>
          </span>
        </Link>
      ))}
    </section>
  );
}
