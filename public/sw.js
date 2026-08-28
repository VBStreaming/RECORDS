const CACHE_NAME = "records-shell-v4";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/records-icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    data = { message: event.data?.text() };
  }
  event.waitUntil(self.registration.showNotification(data.title || "RECORDS 알림", {
    body: data.message || "새로운 과제 알림이 있어요.",
    data,
    tag: data.notificationId || "records-notification",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => "focus" in client);
    return existing ? existing.focus() : clients.openWindow("/");
  }));
});

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch {
        return await caches.match(event.request)
          || event.request.mode === "navigate" && await caches.match("/")
          || new Response("오프라인에서 사용할 수 없는 리소스입니다.", { status: 503 });
      }
    })(),
  );
});
