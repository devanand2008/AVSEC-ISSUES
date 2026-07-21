import { getApp, getApps, initializeApp } from "firebase/app";
import { deleteToken, getMessaging, getToken, isSupported, onMessage, type MessagePayload, type Messaging } from "firebase/messaging";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function firebaseBrowserConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId && config.messagingSenderId && config.appId && process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY);
}

async function messaging(): Promise<Messaging> {
  if (!firebaseBrowserConfigured()) throw new Error("Push notifications are not configured for this deployment.");
  if (!(await isSupported())) throw new Error("This browser does not support push notifications.");
  const app = getApps().length ? getApp() : initializeApp(config);
  return getMessaging(app);
}

export async function requestPushToken(): Promise<string> {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    throw new Error("This browser does not support push notifications.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");
  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
    scope: "/firebase-cloud-messaging-push-scope",
  });
  const token = await getToken(await messaging(), {
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error("Firebase did not issue a device token.");
  return token;
}

export async function removeBrowserPushToken(): Promise<void> {
  if (!firebaseBrowserConfigured() || !(await isSupported())) return;
  await deleteToken(await messaging());
}

export async function listenForForegroundMessages(handler: (payload: MessagePayload) => void): Promise<() => void> {
  if (!firebaseBrowserConfigured() || !(await isSupported())) return () => undefined;
  return onMessage(await messaging(), handler);
}
