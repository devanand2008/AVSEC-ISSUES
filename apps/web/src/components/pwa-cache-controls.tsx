"use client";

import { RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

const APP_CACHE_PREFIX = "college-shell-";

export async function checkForPwaUpdate(): Promise<string> {
  if (!("serviceWorker" in navigator)) {
    return "App updates are not supported by this browser.";
  }
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) {
    return "The installed-app worker is not registered yet. Refresh once and try again.";
  }
  await registration.update();
  registration.waiting?.postMessage({ type: "SKIP_WAITING" });
  return registration.waiting
    ? "An update was found and is being activated. Refresh once to use it."
    : "The app is up to date.";
}

export async function clearPwaAppCache(): Promise<number> {
  if (!("caches" in globalThis)) return 0;
  const keys = await caches.keys();
  const appKeys = keys.filter((key) => key.startsWith(APP_CACHE_PREFIX));
  await Promise.all(appKeys.map((key) => caches.delete(key)));
  return appKeys.length;
}

export function PwaCacheControls() {
  const [busy, setBusy] = useState<"update" | "clear" | null>(null);
  const [message, setMessage] = useState("");

  async function check() {
    setBusy("update");
    setMessage("");
    try {
      setMessage(await checkForPwaUpdate());
    } catch {
      setMessage(
        "The update check could not be completed. Check your connection and try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    setMessage("");
    try {
      const removed = await clearPwaAppCache();
      setMessage(
        removed > 0
          ? "The local app cache was cleared. Server records and sign-in data were not changed."
          : "No stale app cache was found. Server records and sign-in data were not changed.",
      );
    } catch {
      setMessage(
        "The local app cache could not be cleared. Refresh and try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card" style={{ marginTop: 18, padding: 20 }}>
      <div className="section-head" style={{ margin: "-20px -20px 18px" }}>
        <div>
          <h2>Installed application</h2>
          <p>
            Update this browser or installed PWA without changing college data.
          </p>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <button
          className="btn"
          type="button"
          disabled={busy !== null}
          onClick={() => void check()}
        >
          <RefreshCw size={16} />
          {busy === "update" ? "Checking..." : "Check for update"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy !== null}
          onClick={() => void clear()}
        >
          <Trash2 size={16} />
          {busy === "clear" ? "Clearing..." : "Clear app cache"}
        </button>
      </div>
      {message && (
        <p aria-live="polite" className="muted" style={{ marginBottom: 0 }}>
          {message}
        </p>
      )}
    </section>
  );
}
