"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let disposed = false;
    let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;
    const activateWaitingWorker = (registration: ServiceWorkerRegistration) => {
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    };
    const register = () => {
      if (registrationPromise) return;
      registrationPromise = navigator.serviceWorker.register("/sw.js").then((registration) => {
        if (disposed) return registration;
        activateWaitingWorker(registration);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) activateWaitingWorker(registration);
          });
        });
        return registration;
      }).catch(() => {
        // Offline support must not prevent the authenticated app from loading.
        registrationPromise = null;
        throw new Error("Service worker registration failed.");
      });
      void registrationPromise.catch(() => undefined);
    };
    const update = () => {
      if (document.visibilityState === "visible") void registrationPromise?.then((registration) => registration.update()).catch(() => undefined);
    };
    window.addEventListener("load", register, { once: true });
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", update);
    if (document.readyState === "complete") register();
    return () => {
      disposed = true;
      window.removeEventListener("load", register);
      window.removeEventListener("online", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return null;
}
