"use client";

import {
  Bell,
  BellRing,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  FileWarning,
  MessageCircle,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import {
  formatNotificationType,
  formatRelativeTime,
  isDirectAction,
  isMarkReadAction,
  notificationCategory,
  notificationHref,
  notificationPriority,
  notificationStatus,
  normalizeActionId,
  visibleActions,
  type NotificationAction,
  type NotificationItem as NotificationItemModel,
} from "./notification-center";
import styles from "./notifications.module.css";

interface NotificationItemProps {
  item: NotificationItemModel;
  permissions: readonly string[];
  pendingAction: string | null;
  density: "comfortable" | "compact";
  onAction: (item: NotificationItemModel, action: NotificationAction) => void;
  onOpen: (item: NotificationItemModel) => void;
}

function notificationIcon(item: NotificationItemModel) {
  if (item.notification.context?.isEscalation || item.notification.type === "ISSUE_ESCALATED") return <ShieldAlert size={19} />;
  if (item.notification.type === "NEW_MESSAGE") return <MessageCircle size={19} />;
  if (item.notification.relatedEntityType === "Issue") return <FileWarning size={19} />;
  if (item.notification.type.includes("COMPLETE") || item.notification.type.includes("RESOLVED")) return <CheckCircle2 size={19} />;
  if (notificationPriority(item) === "CRITICAL" || notificationPriority(item) === "EMERGENCY") return <CircleAlert size={19} />;
  if (!item.readAt) return <BellRing size={19} />;
  return <Bell size={19} />;
}

function actionRank(action: NotificationAction): number {
  const id = normalizeActionId(action.id);
  if (isDirectAction(action)) return 0;
  if (id === "assign" || id === "reassign") return 1;
  if (action.method === "GET") return 2;
  if (isMarkReadAction(action)) return 4;
  return 3;
}

export function NotificationItem({
  item,
  permissions,
  pendingAction,
  density,
  onAction,
  onOpen,
}: NotificationItemProps) {
  const context = item.notification.context;
  const priority = notificationPriority(item);
  const status = notificationStatus(item);
  const actions = visibleActions(item, permissions).toSorted((left, right) => actionRank(left) - actionRank(right));
  const primaryActions = actions.slice(0, 2);
  const overflowActions = actions.slice(2);
  const destination = notificationHref(item);
  const timestamp = item.createdAt || item.notification.createdAt;

  function renderAction(action: NotificationAction, compact = false) {
    const key = `${item.id}:${normalizeActionId(action.id)}`;
    const waiting = pendingAction === key;
    const className = compact ? styles.menuAction : styles.actionButton;
    if (action.method === "GET") {
      return (
        <Link className={className} href={action.href || destination} key={action.id} onClick={() => onOpen(item)}>
          {action.label}
        </Link>
      );
    }
    return (
      <button
        className={className}
        disabled={Boolean(pendingAction)}
        key={action.id}
        onClick={() => onAction(item, action)}
        type="button"
      >
        {waiting ? "Working…" : action.label}
      </button>
    );
  }

  return (
    <article
      className={`${styles.notificationItem} ${!item.readAt ? styles.unread : ""} ${density === "compact" ? styles.compact : ""}`}
      aria-labelledby={`notification-${item.id}-title`}
    >
      <div className={styles.icon} aria-hidden="true">{notificationIcon(item)}</div>
      <div className={styles.itemContent}>
        <header className={styles.itemHeader}>
          <div className={styles.titleLine}>
            {!item.readAt && <span className={styles.unreadDot} aria-label="Unread notification" role="img" />}
            <h2 id={`notification-${item.id}-title`}>{item.notification.title}</h2>
          </div>
          <time dateTime={timestamp} title={new Date(timestamp).toLocaleString()}>{formatRelativeTime(timestamp)}</time>
        </header>

        <p className={styles.description}>{item.notification.body}</p>

        <div className={styles.metadata} aria-label="Notification details">
          {context?.issueNumber && <Link href={destination} onClick={() => onOpen(item)}>{context.issueNumber}</Link>}
          <span>{notificationCategory(item)}</span>
          {context?.location && <span>{context.location}</span>}
          {context?.assignedTo && <span>Assigned to {context.assignedTo}</span>}
        </div>

        <div className={styles.itemFooter}>
          <div className={styles.badges}>
            {priority && <StatusBadge value={priority} />}
            {status && <StatusBadge value={status} />}
            {context?.isOverdue && status !== "OVERDUE" && <StatusBadge value="OVERDUE" />}
            {context?.isEscalation && <StatusBadge value="ESCALATED" />}
            {!context && <span className={styles.categoryBadge}>{formatNotificationType(item.notification.type)}</span>}
          </div>
          <div className={styles.actions} aria-label={`Actions for ${item.notification.title}`}>
            {primaryActions.map((action) => renderAction(action))}
            {!!overflowActions.length && (
              <details className={styles.moreMenu}>
                <summary aria-label={`More actions for ${item.notification.title}`}>
                  More <ChevronDown size={15} aria-hidden="true" />
                </summary>
                <div>{overflowActions.map((action) => renderAction(action, true))}</div>
              </details>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
