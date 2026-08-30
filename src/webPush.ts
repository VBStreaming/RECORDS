type PushSubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function decodeBase64Url(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = window.atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function usesApplicationServerKey(subscription: PushSubscription, expected: Uint8Array) {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((value, index) => value === expected[index]);
}

export function isWebPushConfigured() {
  return Boolean(vapidPublicKey);
}

export function requestWebPushPermission() {
  if (!isWebPushConfigured()) throw new Error("Web Push 설정이 없습니다.");
  if (!window.isSecureContext) throw new Error("브라우저 알림은 HTTPS에서 사용할 수 있습니다.");
  if (!("Notification" in window)) throw new Error("이 브라우저는 알림을 지원하지 않습니다.");
  return window.Notification.permission === "default"
    ? window.Notification.requestPermission()
    : Promise.resolve(window.Notification.permission);
}

export async function enableWebPush(registerSubscription: (subscription: PushSubscriptionPayload) => Promise<void>, permission?: NotificationPermission): Promise<NotificationPermission> {
  const nextPermission = permission ?? await requestWebPushPermission();
  if (nextPermission !== "granted") return nextPermission;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("이 브라우저는 Web Push를 지원하지 않습니다.");
  }

  const registration = await navigator.serviceWorker.ready;
  const applicationServerKey = decodeBase64Url(vapidPublicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !usesApplicationServerKey(subscription, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  const serialized = subscription.toJSON();
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth) throw new Error("Web Push 구독 정보를 읽지 못했습니다.");
  await registerSubscription({ endpoint: serialized.endpoint, keys: { p256dh: serialized.keys.p256dh, auth: serialized.keys.auth } });
  return nextPermission;
}
