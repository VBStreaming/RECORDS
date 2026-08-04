export type SubjectCode =
  | "KOREAN"
  | "ENGLISH"
  | "MATH"
  | "SOCIAL_STUDIES"
  | "SCIENCE"
  | "HISTORY"
  | "ETC";

export type User = {
  id: string;
  name: string;
  email: string;
  studentNumber: string;
};

export type Assignment = {
  id: string;
  title: string;
  subject: SubjectCode;
  dueAt: string;
  completed: boolean;
  completedAt: string | null;
  dayOffset: number;
  deadlineLabel: string;
  createdAt: string;
  updatedAt: string;
};

export type Dashboard = {
  activeCount: number;
  nearestAssignment: Assignment | null;
};

export type AssignmentCandidate = {
  title: string | null;
  subject: SubjectCode | null;
  dueAt: string | null;
  needsReview: Array<"title" | "subject" | "dueAt">;
};

export type Extraction = {
  candidates: AssignmentCandidate[];
  requiresConfirmation: true;
  warnings: string[];
};

type ApiEnvelope<T> = {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const TOKEN_KEY = "records-access-token";

export class RecordsApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (auth && token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (response.status === 204) return undefined as T;

  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.success || body.data === null) {
    throw new RecordsApiError(
      body.error?.code || "REQUEST_FAILED",
      body.error?.message || "요청을 처리하지 못했습니다.",
      response.status,
    );
  }
  return body.data;
}

export const api = {
  async signup(payload: {
    name: string;
    email: string;
    studentNumber: string;
    password: string;
  }) {
    return request<User>("/auth/signup", { method: "POST", body: JSON.stringify(payload) }, false);
  },

  async login(email: string, password: string) {
    const data = await request<{ accessToken: string }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
      false,
    );
    setToken(data.accessToken);
  },

  me: () => request<User>("/users/me"),
  dashboard: () => request<Dashboard>("/dashboard"),
  assignments: (from: string, to: string) =>
    request<Assignment[]>(`/assignments?from=${from}&to=${to}`),
  createAssignment: (payload: { title: string; subject: SubjectCode; dueAt: string }) =>
    request<Assignment>("/assignments", { method: "POST", body: JSON.stringify(payload) }),
  setCompletion: (id: string, completed: boolean) =>
    request<Assignment>(`/assignments/${id}/completion`, {
      method: "PUT",
      body: JSON.stringify({ completed }),
    }),
  extract: (file: File) => {
    const form = new FormData();
    form.append("image", file);
    return request<Extraction>("/assignment-extractions", { method: "POST", body: form });
  },
};
