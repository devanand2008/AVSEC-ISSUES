const CACHE_PREFIX = "college-shell-";
const CACHE = `${CACHE_PREFIX}v4`;
const SHELL = ["/offline", "/manifest.webmanifest", "/icons/avs-icon-192.png", "/icons/avs-icon-512.png"];

function isCacheablePublicAsset(url) {
  return url.pathname.startsWith("/_next/static/")
    || url.pathname.startsWith("/icons/")
    || url.pathname === "/manifest.webmanifest"
    || url.pathname === "/offline"
    || url.pathname === "/favicon.ico";
}

function canStore(response) {
  return response && response.ok && (response.type === "basic" || response.type === "default");
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await event.preloadResponse || await fetch(request);
      } catch {
        return await caches.match("/offline") || Response.error();
      }
    })());
    return;
  }

  // Route payloads and private page data are deliberately left to the network.
  if (!isCacheablePublicAsset(url)) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const refresh = fetch(request).then(async (response) => {
      if (canStore(response)) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    });
    if (cached) {
      event.waitUntil(refresh.catch(() => undefined));
      return cached;
    }
    return refresh;
  })());
});
