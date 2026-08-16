"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listenForForegroundMessages } from "@/lib/firebase";
import { safeAppLink } from "@/lib/safe-app-link";

export function PushMessageListener() {
  const client = useQueryClient();
  useEffect(() => {
    let unsubscribe: () => void = () => undefined;
    void listenForForegroundMessages((payload) => {
      void client.invalidateQueries({ queryKey: ["notifications"] });
      void client.invalidateQueries({ queryKey: ["notification-summary"] });
      if (Notification.permission === "granted" && payload.notification?.title) {
        const notification = new Notification(payload.notification.title, {
          body: payload.notification.body,
          icon: "/icons/icon-192.svg",
          data: { link: safeAppLink(payload.data?.link, window.location.origin) },
        });
        notification.onclick = () => window.location.assign(safeAppLink(notification.data?.link, window.location.origin));
      }
    }).then((stop) => { unsubscribe = stop; }).catch(() => undefined);
    return () => unsubscribe();
  }, [client]);
  return null;
}
