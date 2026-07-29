/* global self, caches, fetch, URL */

const cacheName = "ludico-shell-v1";
const precache = [
  "/",
  "/offline",
  "/manifest.webmanifest",
  "/icons/ludico-192.png",
  "/icons/ludico-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(precache)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isSensitive(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetchAndCache(request).catch(
        async () => (await caches.match(request)) ?? (await caches.match("/offline")),
      ),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetchAndCache(request)));
    return;
  }

  if (/^\/api\/player\/games\/[0-9a-f-]+$/i.test(url.pathname)) {
    event.respondWith(fetchAndCache(request).catch(() => caches.match(request)));
  }
});

async function fetchAndCache(request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

function isSensitive(pathname) {
  return (
    pathname.startsWith("/api/guest-session") ||
    pathname.startsWith("/api/player/") ||
    pathname.includes("/solution") ||
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/api/auth")
  );
}
