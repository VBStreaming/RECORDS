import { getApps, initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage, type MessagePayload } from "firebase/messaging";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

export type PushMessage = MessagePayload & { data?: Record<string, string> };

export function isFirebaseMessagingConfigured() {
  return Object.values(firebaseConfig).every(Boolean) && Boolean(vapidKey);
}

function app() {
  return getApps()[0] ?? initializeApp(firebaseConfig);
}

export async function enableFirebasePush(registerToken: (token: string) => Promise<void>) {
  if (!isFirebaseMessagingConfigured()) throw new Error("Firebase Web Push 설정이 없습니다.");
  if (!window.isSecureContext || !("serviceWorker" in navigator) || !("Notification" in window)) {
    throw new Error("HTTPS와 서비스워커가 필요합니다.");
  }
  const permission = await window.Notification.requestPermission();
  if (permission !== "granted") return permission;

  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app()), { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error("FCM 토큰을 발급하지 못했습니다.");
  await registerToken(token);
  return permission;
}

export function listenForFirebaseMessages(listener: (payload: PushMessage) => void) {
  if (!isFirebaseMessagingConfigured()) return () => undefined;
  return onMessage(getMessaging(app()), listener);
}
