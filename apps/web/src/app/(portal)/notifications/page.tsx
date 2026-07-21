"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, CheckCheck, FileWarning, MessageCircle, Smartphone, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { api } from "@/lib/api";
import { firebaseBrowserConfigured, requestPushToken } from "@/lib/firebase";

interface NotificationResult {
  unread: number;
  data: Array<{
    id: string;
    readAt: string | null;
    createdAt: string;
    notification: {
      type: string;
      title: string;
      body: string;
      priority: string | null;
      relatedEntityType: string | null;
      relatedEntityId: string | null;
      createdAt: string;
    };
  }>;
}

interface PushDevice {
  id: string;
  platform: string;
  deviceName: string | null;
  lastSeenAt: string;
  createdAt: string;
}

export default function NotificationsPage() {
  const client = useQueryClient();
  const [pushError, setPushError] = useState("");
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<NotificationResult>("/notifications?pageSize=100") });
  const devices = useQuery({ queryKey: ["push-devices"], queryFn: () => api.get<PushDevice[]>("/notifications/devices") });
  const refresh = () => client.invalidateQueries({ queryKey: ["notifications"] });
  const read = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: refresh });
  const all = useMutation({ mutationFn: () => api.post("/notifications/read-all"), onSuccess: refresh });
  const register = useMutation({
    mutationFn: async () => {
      const token = await requestPushToken();
      return api.post("/notifications/devices", {
        token,
        platform: "WEB",
        deviceName: navigator.platform || "Web browser",
      });
    },
    onMutate: () => setPushError(""),
    onSuccess: () => client.invalidateQueries({ queryKey: ["push-devices"] }),
    onError: (error) => setPushError(error instanceof Error ? error.message : "Push notifications could not be enabled."),
  });
  const removeDevice = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/devices/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["push-devices"] }),
  });

  function href(item: NotificationResult["data"][number]) {
    return item.notification.relatedEntityType === "Issue" ? `/issues/${item.notification.relatedEntityId}`
      : item.notification.relatedEntityType === "Conversation" ? "/messages"
        : item.notification.relatedEntityType === "Announcement" ? "/announcements"
          : "/notifications";
  }

  return <>
    <div className="page-heading">
      <div><span className="eyebrow">Inbox</span><h1 className="page-title" style={{ marginTop: 6 }}>Notifications</h1><p className="page-subtitle">{notifications.data?.unread ?? 0} unread updates</p></div>
      <button className="btn btn-secondary" disabled={!notifications.data?.unread || all.isPending} onClick={() => all.mutate()}><CheckCheck size={18} />Mark all read</button>
    </div>

    <section className="card" style={{ marginBottom: 18, padding: 20 }}>
      <div className="section-head">
        <div><h2><BellRing size={19} style={{ verticalAlign: "text-bottom", marginRight: 8 }} />Push notifications</h2><p>Receive assignments and urgent campus updates when this app is closed.</p></div>
        {firebaseBrowserConfigured() && <button className="btn btn-primary" disabled={register.isPending} onClick={() => register.mutate()}>{register.isPending ? "Enabling…" : "Enable on this device"}</button>}
      </div>
      {!firebaseBrowserConfigured() && <p className="muted">Push delivery is not configured for this deployment. In-app notifications remain active.</p>}
      {pushError && <div className="error-box">{pushError}</div>}
      {!!devices.data?.length && <div className="session-list">{devices.data.map((device) => <article key={device.id}>
        <span><Smartphone /></span>
        <div><strong>{device.deviceName ?? device.platform}</strong><small>Last registered {new Date(device.lastSeenAt).toLocaleString()}</small></div>
        <button className="icon-button" aria-label={`Remove ${device.deviceName ?? "push device"}`} disabled={removeDevice.isPending} onClick={() => removeDevice.mutate(device.id)}><Trash2 size={17} /></button>
      </article>)}</div>}
    </section>

    {notifications.isLoading ? <LoadingState /> : notifications.isError ? <ErrorState /> : !notifications.data?.data.length ? <EmptyState title="You’re all caught up" /> : <div className="card notification-list">{notifications.data.data.map((item) => {
      const Icon = item.notification.type === "NEW_MESSAGE" ? MessageCircle : item.notification.relatedEntityType === "Issue" ? FileWarning : Bell;
      return <Link href={href(item)} className={item.readAt ? "" : "unread"} key={item.id} onClick={() => { if (!item.readAt) read.mutate(item.id); }}>
        <span className="notification-icon"><Icon size={19} /></span>
        <span><strong>{item.notification.title}</strong><p>{item.notification.body}</p><small>{new Date(item.createdAt).toLocaleString()}</small></span>
        {!item.readAt && <i />}
      </Link>;
    })}</div>}
  </>;
}
