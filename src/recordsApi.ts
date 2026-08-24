const API_BASE = (import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:8001`).replace(/\/$/, "");
const TOKEN_KEY = "records-access-token";
const USER_CACHE_KEY = "records-offline-user";
const ASSIGNMENTS_CACHE_KEY = "records-offline-assignments";
const PENDING_KEY = "records-offline-pending";
const NOTIFICATIONS_CACHE_KEY = "records-offline-notifications";
const NOTIFICATION_PREFERENCE_CACHE_KEY = "records-notification-preference";
export const AUTH_EXPIRED_EVENT = "records:auth-expired";
export const OFFLINE_SYNC_EVENT = "records:offline-sync";
export const CONNECTION_STATUS_EVENT = "records:connection-status";
export const NOTIFICATIONS_EVENT = "records:notifications";

export type User = { id: string; name: string; email: string; studentNumber: string };
export type Assignment = {
  id: string;
  title: string;
  subject: string;
  dueAt: string;
  completed: boolean;
  completedAt: string | null;
  dayOffset: number;
  deadlineLabel: string;
};
export type AppNotification = {
  id: string;
  assignmentId: string;
  type: "D_MINUS_4" | "D_MINUS_1" | "D_DAY" | "BEFORE_DEADLINE";
  offsetMinutes: number;
  title: string;
  message: string;
  dueAt: string;
  scheduledAt: string;
  deliveredAt: string;
  readAt: string | null;
};
export type NotificationPreferences = { beforeDeadlineMinutes: 10 | 30 | 60 };
export type Candidate = { title: string; subject: string | null; dueAt: string | null; needsReview: string[] };
export type Extraction = { candidates: Candidate[]; requiresConfirmation: boolean; warnings: string[] };
type ApiError = { status?: number; code?: string; message?: string; details?: Record<string, string> };
type AssignmentPayload = { title: string; subject: string; dueAt: string };
type PendingOperation =
  | { key: string; type: "create"; assignmentId: string; payload: AssignmentPayload }
  | { key: string; type: "update"; assignmentId: string; payload: AssignmentPayload }
  | { key: string; type: "completion"; assignmentId: string; payload: { completed: boolean } };

export class RecordsApiError extends Error {
  code?: string;
  details?: Record<string, string>;

  constructor(message: string, error?: ApiError) {
    super(message);
    this.name = "RecordsApiError";
    this.code = error?.code;
    this.details = error?.details;
  }
}

function token() {
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) return saved;
  const legacy = sessionStorage.getItem(TOKEN_KEY);
  if (legacy) {
    localStorage.setItem(TOKEN_KEY, legacy);
    sessionStorage.removeItem(TOKEN_KEY);
  }
  return legacy;
}

export function hasToken() {
  return Boolean(token());
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_CACHE_KEY);
  localStorage.removeItem(ASSIGNMENTS_CACHE_KEY);
  localStorage.removeItem(PENDING_KEY);
  localStorage.removeItem(NOTIFICATIONS_CACHE_KEY);
  localStorage.removeItem(NOTIFICATION_PREFERENCE_CACHE_KEY);
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private mode; online behavior still works.
  }
}

function localId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function cachedNotifications() {
  return readStored<AppNotification[]>(NOTIFICATIONS_CACHE_KEY, []);
}

function saveNotifications(notifications: AppNotification[]) {
  writeStored(NOTIFICATIONS_CACHE_KEY, notifications);
  window.dispatchEvent(new Event(NOTIFICATIONS_EVENT));
}

function cachedAssignments() {
  return readStored<Assignment[]>(ASSIGNMENTS_CACHE_KEY, []);
}

function saveAssignments(assignments: Assignment[]) {
  writeStored(ASSIGNMENTS_CACHE_KEY, assignments);
  window.dispatchEvent(new Event(OFFLINE_SYNC_EVENT));
}

function upsertAssignment(assignment: Assignment) {
  const cached = cachedAssignments();
  const index = cached.findIndex((candidate) => candidate.id === assignment.id);
  if (index === -1) cached.push(assignment);
  else cached[index] = assignment;
  saveAssignments(cached);
}

function assignmentDate(assignment: Assignment) {
  return assignment.dueAt.slice(0, 10);
}

function assignmentsInRange(from: string, to: string) {
  return cachedAssignments().filter((assignment) => assignmentDate(assignment) >= from && assignmentDate(assignment) <= to);
}

function replaceCachedRange(assignments: Assignment[], from: string, to: string) {
  const pendingIds = new Set(readStored<PendingOperation[]>(PENDING_KEY, []).map((operation) => operation.assignmentId));
  const cached = cachedAssignments();
  const outside = cached.filter((assignment) => assignmentDate(assignment) < from || assignmentDate(assignment) > to);
  const optimistic = cached.filter((assignment) => assignmentDate(assignment) >= from && assignmentDate(assignment) <= to && pendingIds.has(assignment.id));
  saveAssignments([...outside, ...assignments.filter((assignment) => !pendingIds.has(assignment.id)), ...optimistic]);
  return assignmentsInRange(from, to);
}

function isNetworkError(error: unknown) {
  return !navigator.onLine || error instanceof TypeError || error instanceof DOMException && ["AbortError", "NetworkError", "TimeoutError"].includes(error.name);
}

function onlineNow() {
  const online = navigator.onLine;
  if (!online) window.dispatchEvent(new CustomEvent(CONNECTION_STATUS_EVENT, { detail: false }));
  return online;
}

function queueOperation(operation: PendingOperation) {
  const pending = readStored<PendingOperation[]>(PENDING_KEY, []);
  const create = pending.find((candidate) => candidate.type === "create" && candidate.assignmentId === operation.assignmentId);
  if (create && operation.type === "update") {
    create.payload = operation.payload;
  } else {
    const existing = pending.findIndex((candidate) => candidate.type === operation.type && candidate.assignmentId === operation.assignmentId);
    if (existing === -1 || operation.type === "create") pending.push(operation);
    else pending[existing] = operation;
  }
  writeStored(PENDING_KEY, pending);
  window.dispatchEvent(new Event(OFFLINE_SYNC_EVENT));
}

function optimisticAssignment(id: string, payload: AssignmentPayload, completed = false): Assignment {
  return { id, ...payload, completed, completedAt: completed ? new Date().toISOString() : null, dayOffset: 0, deadlineLabel: "" };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const accessToken = token();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: init.signal || AbortSignal.timeout(30000) });
    window.dispatchEvent(new CustomEvent(CONNECTION_STATUS_EVENT, { detail: true }));
  } catch (error) {
    window.dispatchEvent(new CustomEvent(CONNECTION_STATUS_EVENT, { detail: false }));
    throw error;
  }
  const body = await response.json().catch(() => null) as { data?: T; error?: ApiError } | null;
  if (response.status === 401 && accessToken) {
    clearToken();
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
  if (!response.ok || !body?.data && body?.error) {
    throw new RecordsApiError(body?.error?.message || `요청에 실패했습니다. (${response.status})`, body?.error);
  }
  return body?.data as T;
}

export async function login(email: string, password: string) {
  const result = await request<{ accessToken: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem(TOKEN_KEY, result.accessToken);
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function signup(name: string, email: string, studentNumber: string, password: string) {
  await request<User>("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name, email, studentNumber, password }),
  });
  await login(email, password);
}

export function me() {
  if (!onlineNow()) {
    const cached = readStored<User | null>(USER_CACHE_KEY, null);
    return cached ? Promise.resolve(cached) : Promise.reject(new RecordsApiError("오프라인에서 저장된 사용자 정보를 찾지 못했습니다."));
  }
  return request<User>("/users/me").then((user) => {
    writeStored(USER_CACHE_KEY, user);
    return user;
  }).catch((error) => {
    const cached = readStored<User | null>(USER_CACHE_KEY, null);
    if (cached && isNetworkError(error)) return cached;
    throw error;
  });
}

export async function listAssignments(from: string, to: string) {
  if (onlineNow()) {
    await syncPendingAssignments();
    try {
      const assignments = await request<Assignment[]>(`/assignments?from=${from}&to=${to}`);
      return replaceCachedRange(assignments, from, to);
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  return assignmentsInRange(from, to);
}

export async function completeAssignment(id: string, completed: boolean) {
  if (onlineNow() && !id.startsWith("offline-")) {
    try {
      const assignment = await request<Assignment>(`/assignments/${id}/completion`, {
        method: "PUT",
        body: JSON.stringify({ completed }),
      });
      upsertAssignment(assignment);
      return assignment;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  const current = cachedAssignments().find((assignment) => assignment.id === id);
  if (!current) throw new RecordsApiError("저장된 과제를 찾지 못했습니다.");
  const assignment = { ...current, completed, completedAt: completed ? new Date().toISOString() : null };
  upsertAssignment(assignment);
  queueOperation({ key: localId(), type: "completion", assignmentId: id, payload: { completed } });
  return assignment;
}

export async function createAssignment(title: string, subject: string, dueAt: string) {
  const payload = { title, subject, dueAt };
  if (onlineNow()) {
    try {
      const assignment = await request<Assignment>("/assignments", { method: "POST", body: JSON.stringify(payload) });
      upsertAssignment(assignment);
      return assignment;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  const assignment = optimisticAssignment(`offline-${localId()}`, payload);
  upsertAssignment(assignment);
  queueOperation({ key: localId(), type: "create", assignmentId: assignment.id, payload });
  return assignment;
}

export async function updateAssignment(id: string, title: string, subject: string, dueAt: string) {
  const payload = { title, subject, dueAt };
  if (onlineNow() && !id.startsWith("offline-")) {
    try {
      const assignment = await request<Assignment>(`/assignments/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      upsertAssignment(assignment);
      return assignment;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  const current = cachedAssignments().find((assignment) => assignment.id === id);
  const assignment = optimisticAssignment(id, payload, current?.completed);
  assignment.completedAt = current?.completedAt || null;
  upsertAssignment(assignment);
  queueOperation({ key: localId(), type: "update", assignmentId: id, payload });
  return assignment;
}

export async function listNotifications(unreadOnly = false, limit = 20) {
  if (onlineNow()) {
    try {
      const notifications = await request<AppNotification[]>(`/notifications?unreadOnly=${unreadOnly}&limit=${limit}`);
      if (!unreadOnly) saveNotifications(notifications);
      return notifications;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  const notifications = cachedNotifications();
  return (unreadOnly ? notifications.filter((notification) => !notification.readAt) : notifications).slice(0, limit);
}

export async function unreadNotificationCount() {
  if (onlineNow()) {
    try {
      const result = await request<{ count: number }>("/notifications/unread-count");
      return result.count;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  return cachedNotifications().filter((notification) => !notification.readAt).length;
}

export async function markNotificationRead(id: string) {
  if (onlineNow()) {
    try {
      const notification = await request<AppNotification>(`/notifications/${id}/read`, { method: "PUT" });
      saveNotifications(cachedNotifications().map((candidate) => candidate.id === id ? notification : candidate));
      return notification;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  const notification = cachedNotifications().find((candidate) => candidate.id === id);
  if (!notification) throw new RecordsApiError("저장된 알림을 찾지 못했습니다.");
  const updated = { ...notification, readAt: new Date().toISOString() };
  saveNotifications(cachedNotifications().map((candidate) => candidate.id === id ? updated : candidate));
  return updated;
}

export async function markAllNotificationsRead() {
  if (onlineNow()) {
    try {
      await request<void>("/notifications/read-all", { method: "PUT" });
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  const now = new Date().toISOString();
  saveNotifications(cachedNotifications().map((notification) => ({ ...notification, readAt: notification.readAt || now })));
}

export async function getNotificationPreferences() {
  if (onlineNow()) {
    try {
      const preferences = await request<NotificationPreferences>("/notifications/preferences");
      writeStored(NOTIFICATION_PREFERENCE_CACHE_KEY, preferences);
      return preferences;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  return readStored<NotificationPreferences>(NOTIFICATION_PREFERENCE_CACHE_KEY, { beforeDeadlineMinutes: 60 });
}

export async function updateNotificationPreferences(beforeDeadlineMinutes: NotificationPreferences["beforeDeadlineMinutes"]) {
  if (onlineNow()) {
    try {
      const preferences = await request<NotificationPreferences>("/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify({ beforeDeadlineMinutes }),
      });
      writeStored(NOTIFICATION_PREFERENCE_CACHE_KEY, preferences);
      return preferences;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  const preferences = { beforeDeadlineMinutes };
  writeStored(NOTIFICATION_PREFERENCE_CACHE_KEY, preferences);
  return preferences;
}

export function extractAssignment(image: File) {
  if (!onlineNow()) return Promise.reject(new RecordsApiError("오프라인에서는 사진 분석을 사용할 수 없습니다. 직접 과제를 입력해 주세요."));
  const body = new FormData();
  body.append("image", image);
  return request<Extraction>("/assignment-extractions", { method: "POST", body });
}

let syncInFlight: Promise<void> | null = null;

export function syncPendingAssignments() {
  if (!onlineNow() || !hasToken()) return Promise.resolve();
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const pending = readStored<PendingOperation[]>(PENDING_KEY, []);
    while (pending.length) {
      const operation = pending[0];
      try {
        let assignment: Assignment;
        if (operation.type === "create") {
          const offlineId = operation.assignmentId;
          assignment = await request<Assignment>("/assignments", { method: "POST", body: JSON.stringify(operation.payload) });
          const cached = cachedAssignments().filter((candidate) => candidate.id !== offlineId);
          saveAssignments([...cached, assignment]);
          for (const queued of pending) {
            if (queued.assignmentId === offlineId) queued.assignmentId = assignment.id;
          }
        } else if (operation.type === "update") {
          assignment = await request<Assignment>(`/assignments/${operation.assignmentId}`, { method: "PATCH", body: JSON.stringify(operation.payload) });
          upsertAssignment(assignment);
        } else {
          assignment = await request<Assignment>(`/assignments/${operation.assignmentId}/completion`, { method: "PUT", body: JSON.stringify(operation.payload) });
          upsertAssignment(assignment);
        }
        pending.shift();
        writeStored(PENDING_KEY, pending);
      } catch (error) {
        if (!isNetworkError(error)) window.dispatchEvent(new CustomEvent(OFFLINE_SYNC_EVENT, { detail: apiMessage(error) }));
        return;
      }
    }
    window.dispatchEvent(new Event(OFFLINE_SYNC_EVENT));
  })().finally(() => { syncInFlight = null; });
  return syncInFlight;
}

function apiMessage(error: unknown) {
  return error instanceof Error ? error.message : "오프라인 변경사항 동기화에 실패했습니다.";
}
