const CACHE_NAME = "records-shell-v4";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/records-icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const firebaseQuery = new URL(self.location.href).searchParams;
const firebaseConfig = Object.fromEntries(["apiKey", "projectId", "messagingSenderId", "appId"]
  .map((key) => [key, firebaseQuery.get(key) || ""]));

try {
  if (Object.values(firebaseConfig).every(Boolean)) {
    importScripts(
      "https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js",
      "https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js",
    );
    firebase.initializeApp(firebaseConfig);
    firebase.messaging().onBackgroundMessage((payload) => {
      const data = payload.data || {};
      self.registration.showNotification(data.title || "RECORDS 알림", {
        body: data.message || "새로운 과제 알림이 있어요.",
        data,
        tag: data.notificationId || "records-notification",
      });
    });
  }
} catch {
  // FCM is optional; the app shell remains available when the messaging CDN is unreachable.
}

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
