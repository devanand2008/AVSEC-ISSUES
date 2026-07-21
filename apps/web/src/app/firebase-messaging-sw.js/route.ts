const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

export const dynamic = "force-static";

export function GET() {
  const script = `
importScripts("https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js");
firebase.initializeApp(${JSON.stringify(firebaseConfig)});
const messaging = firebase.messaging();
function safeAppLink(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/notifications";
  try {
    const target = new URL(value, self.location.origin);
    if (target.origin !== self.location.origin || (target.protocol !== "http:" && target.protocol !== "https:")) return "/notifications";
    return target.pathname + target.search + target.hash;
  } catch {
    return "/notifications";
  }
}
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification && payload.notification.title;
  if (!title) return;
  self.registration.showNotification(title, {
    body: payload.notification.body || "",
    icon: "/icons/icon-192.svg",
    data: { link: safeAppLink(payload.data && payload.data.link) }
  });
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(safeAppLink(event.notification.data && event.notification.data.link)));
});
`;
  return new Response(script, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
      "service-worker-allowed": "/firebase-cloud-messaging-push-scope",
    },
  });
}
