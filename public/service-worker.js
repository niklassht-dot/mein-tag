/* Mein Tag – Service Worker
   - App-Hülle offline verfügbar (Netzwerk zuerst, Cache als Rückfall)
   - Push-Benachrichtigungen anzeigen, Klick öffnet den passenden Bereich */

const CACHE = "meintag-shell-v8";
const SHELL = [
  "/", "/index.html", "/assets/css/app.css", "/manifest.webmanifest",
  "/assets/js/lead-schedule.js", "/assets/js/model.js", "/assets/js/core.js",
  "/assets/js/views/today.js", "/assets/js/views/journal.js", "/assets/js/views/calendar.js",
  "/assets/js/views/todos.js", "/assets/js/views/training.js", "/assets/js/views/goals.js",
  "/assets/js/views/health.js", "/assets/js/views/body.js", "/assets/js/views/brainstorm.js", "/assets/js/views/weekly.js",
  "/assets/img/icon-192.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(event.request);
      if (res.ok) { const c = await caches.open(CACHE); c.put(event.request, res.clone()); }
      return res;
    } catch (e) {
      return (await caches.match(event.request)) || (await caches.match("/index.html"));
    }
  })());
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: "Mein Tag", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Mein Tag", {
    body: data.body || "",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    icon: "/assets/img/icon-192.png",
    badge: "/assets/img/badge-96.png",
    data: { url: data.url || "/" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        client.postMessage({ type: "open-url", url: target });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
