"use client";

import { Download, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaRegistration() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [secureContext, setSecureContext] = useState(true);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean(
        (navigator as Navigator & { standalone?: boolean }).standalone,
      );
    const initialStateFrame = window.requestAnimationFrame(() => {
      setInstalled(standalone);
      setSecureContext(window.isSecureContext);
      setIos(
        (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" &&
            navigator.maxTouchPoints > 1)) &&
          !("MSStream" in window),
      );
    });
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const markInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setInstructionsOpen(false);
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", markInstalled);

    if (!("serviceWorker" in navigator)) {
      return () => {
        window.cancelAnimationFrame(initialStateFrame);
        window.removeEventListener(
          "beforeinstallprompt",
          captureInstallPrompt,
        );
        window.removeEventListener("appinstalled", markInstalled);
      };
    }
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
      window.cancelAnimationFrame(initialStateFrame);
      window.removeEventListener("load", register);
      window.removeEventListener("online", update);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener(
        "beforeinstallprompt",
        captureInstallPrompt,
      );
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  async function install() {
    if (!installPrompt) {
      setInstructionsOpen(true);
      return;
    }
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setInstallPrompt(null);
    } catch {
      setInstallPrompt(null);
      setInstructionsOpen(true);
    }
  }

  if (installed) return null;
  return (
    <>
      <button
        type="button"
        className={`pwa-install-button ${installPrompt ? "pwa-install-ready" : ""}`}
        aria-label="Install AVS app"
        title="Install AVS app"
        onClick={() => void install()}
      >
        <Download size={21} />
        <span>Install app</span>
      </button>
      {instructionsOpen && (
        <div
          className="pwa-install-scrim"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target)
              setInstructionsOpen(false);
          }}
        >
          <section
            className="pwa-install-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwa-install-title"
          >
            <header>
              <div>
                <span className="eyebrow">AVS Campus</span>
                <h2 id="pwa-install-title">Install app</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close install instructions"
                onClick={() => setInstructionsOpen(false)}
              >
                <X size={19} />
              </button>
            </header>
            {!secureContext ? (
              <p>
                Android requires a secure HTTPS address before it can install
                this app. The current HTTP network address can be used in the
                browser but cannot trigger PWA installation.
              </p>
            ) : ios ? (
              <p>
                Tap <Share2 size={17} aria-hidden /> in Safari, then choose
                <strong>Add to Home Screen</strong>.
              </p>
            ) : (
              <>
                <p>
                  Open the browser menu and choose
                  <strong>Install app</strong> or
                  <strong>Add to Home screen</strong>.
                </p>
                <p className="pwa-install-note">
                  If that option is missing, open this page in Chrome, Edge, or
                  Safari using its HTTPS address and refresh once.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
