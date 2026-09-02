import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  CalendarIcon,
  BellIcon,
  CameraIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  Cross2Icon,
  DashboardIcon,
  DownloadIcon,
  EnvelopeClosedIcon,
  ExitIcon,
  EyeClosedIcon,
  EyeOpenIcon,
  IdCardIcon,
  ImageIcon,
  LockClosedIcon,
  MoonIcon,
  PersonIcon,
  PlusIcon,
  SunIcon,
} from "@radix-ui/react-icons";
import {
  BottomSheet,
  FlowStack,
  MobileRuntime,
  MobileScroll,
  useFlow,
  useScreenPortal,
  type FlowScreen,
} from "./mobile";
import {
  clearToken,
  changePassword,
  completeAssignment,
  confirmEmailVerification,
  confirmPasswordReset,
  createAssignment,
  deleteAccount,
  deleteAssignment,
  extractAssignment,
  hasToken,
  listAssignments,
  listNotifications,
  login,
  markAllNotificationsRead,
  markNotificationRead,
  me,
  requestEmailVerification,
  requestPasswordReset,
  RecordsApiError,
  signup,
  getNotificationPreferences,
  unreadNotificationCount,
  updateNotificationPreferences,
  registerPushSubscription,
  updateAssignment,
  updateProfile,
  AUTH_EXPIRED_EVENT,
  CONNECTION_STATUS_EVENT,
  type Assignment,
  type AppNotification,
  type Candidate,
  type NotificationPreferences,
  type User,
} from "./recordsApi";
import { enableWebPush, isWebPushConfigured, requestWebPushPermission } from "./webPush";

type Theme = "dark" | "light";
type AuthMode = "login" | "signup";
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type Task = {
  id: string;
  title: string;
  subject: string;
  date: string;
  time: string;
  notificationsEnabled: boolean;
  done: boolean;
  color: string;
};

type CalendarImagePreset = {
  id: "phone" | "tablet-landscape" | "tablet-portrait";
  label: string;
  width: number;
  height: number;
};

const initialTasks: Task[] = [];

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const colors: Record<string, string> = {
  국어: "#f0c75e",
  영어: "#7c8cff",
  수학: "#ff7a45",
  과학: "#55c9a5",
  한국사: "#d98bff",
};

const calendarImagePresets: CalendarImagePreset[] = [
  { id: "phone", label: "스마트폰 비율 (세로)", width: 1080, height: 1920 },
  { id: "tablet-landscape", label: "태블릿 비율 (가로)", width: 2560, height: 1600 },
  { id: "tablet-portrait", label: "태블릿 비율 (세로)", width: 1600, height: 2560 },
];

const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void } | null>(null);
const THEME_KEY = "records-theme";
const PENDING_EMAIL_KEY = "records-pending-verification-email";

function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeContext is missing");
  return value;
}

function themeFromUrl(): Theme {
  const requested = new URLSearchParams(window.location.search).get("theme");
  if (requested === "light" || requested === "dark") {
    localStorage.setItem(THEME_KEY, requested);
    return requested;
  }
  return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

function nextTheme(current: Theme): Theme {
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  return next;
}

function openEmailVerificationPage(email: string) {
  sessionStorage.setItem(PENDING_EMAIL_KEY, email);
  window.location.assign("/check-email");
}

async function openEmailVerificationPageWithFreshCode(email: string) {
  await requestEmailVerification(email).catch(() => undefined);
  openEmailVerificationPage(email);
}

async function signupOrResume(name: string, email: string, studentId: string, password: string) {
  try {
    await signup(name, email, studentId, password);
    return false;
  } catch (error) {
    if (!(error instanceof RecordsApiError) || error.code !== "EMAIL_ALREADY_EXISTS") throw error;
    try {
      await login(email, password);
      return true;
    } catch (loginError) {
      if (loginError instanceof RecordsApiError && loginError.code === "EMAIL_NOT_VERIFIED") throw loginError;
      throw error;
    }
  }
}

function openLoginPage() {
  const email = sessionStorage.getItem(PENDING_EMAIL_KEY);
  const query = new URLSearchParams({ screen: "login" });
  if (email) query.set("email", email);
  window.location.assign(`/?${query}`);
}

function loginEmailFromUrl() {
  return new URLSearchParams(window.location.search).get("email") || "";
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function taskFromAssignment(assignment: Assignment): Task {
  const dueAt = new Date(assignment.dueAt);
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(dueAt);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(dueAt);
  return { id: assignment.id, title: assignment.title, subject: assignment.subject, date, time, notificationsEnabled: assignment.notificationsEnabled ?? true, done: assignment.completed, color: colors[assignment.subject] || "#7c8cff" };
}

function canvasText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  let value = text;
  while (value.length > 1 && ctx.measureText(value).width > maxWidth) value = `${value.slice(0, -2)}…`;
  ctx.fillText(value, x, y);
}

function drawCalendarCard(
  ctx: CanvasRenderingContext2D,
  calendar: ReturnType<typeof useCalendar>,
  tasks: Task[],
  x: number,
  y: number,
  width: number,
  height: number,
  palette: { ink: string; muted: string; card: string; line: string; accent: string; today: string; selectedInk: string },
) {
  const landscape = width > height;

  ctx.fillStyle = palette.card;
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 28);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = palette.muted;
  ctx.font = '700 18px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, system-ui, sans-serif';
  ctx.fillText("월간", x + 34, y + 48);
  ctx.fillStyle = palette.ink;
  ctx.font = '900 36px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, system-ui, sans-serif';
  ctx.fillText(`${calendar.year}. ${String(calendar.month + 1).padStart(2, "0")}`, x + 34, y + 92);

  const gridX = x + 28;
  const gridY = y + 142;
  const gridWidth = width - 56;
  const columnWidth = gridWidth / 7;
  const rows = Math.ceil(calendar.cells.length / 7);
  const gridHeight = landscape ? 300 : 430;
  const rowHeight = (gridHeight - 42) / rows;
  ctx.fillStyle = palette.muted;
  ctx.font = '700 16px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, system-ui, sans-serif';
  weekdays.forEach((weekday, index) => {
    ctx.textAlign = "center";
    ctx.fillText(weekday, gridX + columnWidth * index + columnWidth / 2, gridY - 22);
  });

  calendar.cells.forEach((day, index) => {
    if (!day) return;
    const row = Math.floor(index / 7);
    const column = index % 7;
    const centerX = gridX + columnWidth * column + columnWidth / 2;
    const cellTop = gridY + rowHeight * row;
    const dateY = cellTop + 28;
    const date = isoDate(calendar.year, calendar.month, day);
    const dateTasks = tasks.filter((task) => task.date === date);
    const selected = date === calendar.selectedDate;
    const isToday = date === todayInSeoul();
    if (selected || isToday) {
      ctx.fillStyle = isToday ? palette.today : palette.accent;
      ctx.beginPath();
      ctx.arc(centerX, dateY - 7, 27, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = selected || isToday ? palette.selectedInk : palette.ink;
    ctx.font = `${selected ? "900" : "500"} 19px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, system-ui, sans-serif`;
    ctx.fillText(String(day), centerX, dateY);
    dateTasks.slice(0, 3).forEach((task, taskIndex) => {
      ctx.fillStyle = task.done ? palette.muted : task.color;
      ctx.beginPath();
      ctx.arc(centerX - (Math.min(dateTasks.length, 3) - 1) * 7 + taskIndex * 14, cellTop + 53, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    if (dateTasks.length > 3) {
      ctx.fillStyle = palette.muted;
      ctx.font = '500 10px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, system-ui, sans-serif';
      ctx.fillText(`+${dateTasks.length - 3}`, centerX, cellTop + 76);
    }
  });

  const groups = Array.from(
    tasks
      .filter((task) => task.date.startsWith(`${calendar.year}-${String(calendar.month + 1).padStart(2, "0")}`))
      .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
      .reduce((result, task) => result.set(task.date, [...(result.get(task.date) || []), task]), new Map<string, Task[]>()),
  );
  ctx.textAlign = "left";
  const agendaTop = gridY + gridHeight + 38;
  ctx.fillStyle = palette.line;
  ctx.fillRect(x + 28, agendaTop - 22, width - 56, 2);
  ctx.fillStyle = palette.muted;
    ctx.font = '700 15px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, system-ui, sans-serif';
  ctx.fillText("예정된 과제", x + 28, agendaTop + 14);

  const groupHeight = landscape ? 72 : 92;
  const visibleGroups = groups.slice(0, Math.max(1, Math.floor((y + height - agendaTop - 36) / groupHeight)));
  visibleGroups.forEach(([date, dateTasks], groupIndex) => {
    const groupY = agendaTop + 44 + groupIndex * groupHeight;
    const day = Number(date.slice(8));
    const weekday = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "short" }).format(new Date(`${date}T00:00:00+09:00`));
    ctx.fillStyle = palette.ink;
    ctx.font = '900 22px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, system-ui, sans-serif';
    ctx.fillText(String(day), x + 30, groupY + 18);
    ctx.fillStyle = palette.muted;
    ctx.font = '500 11px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, system-ui, sans-serif';
    ctx.fillText(`${calendar.month + 1}월 ${day}일 ${weekday}`, x + 30, groupY + 38);

    dateTasks.slice(0, landscape ? 1 : 2).forEach((task, taskIndex) => {
      const taskY = groupY + 15 + taskIndex * 34;
      const taskX = x + (landscape ? 175 : 170);
      ctx.fillStyle = task.done ? palette.muted : task.color;
      ctx.beginPath();
      ctx.arc(taskX, taskY - 5, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = task.done ? palette.muted : palette.ink;
      ctx.font = '700 13px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, system-ui, sans-serif';
      canvasText(ctx, task.subject, taskX + 14, taskY, landscape ? 110 : 120);
      ctx.fillStyle = palette.muted;
      ctx.font = '500 12px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, system-ui, sans-serif';
      canvasText(ctx, task.title, taskX + (landscape ? 132 : 142), taskY, width - (taskX - x) - 230);
      ctx.textAlign = "right";
      ctx.fillText(task.time, x + width - 30, taskY);
      ctx.textAlign = "left";
    });
    if (dateTasks.length > (landscape ? 1 : 2)) {
      ctx.fillStyle = palette.muted;
      ctx.font = '500 10px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, system-ui, sans-serif';
      ctx.fillText(`+${dateTasks.length - (landscape ? 1 : 2)}개 더 있음`, x + (landscape ? 175 : 170), groupY + groupHeight - 8);
    }
    ctx.fillStyle = palette.line;
    ctx.fillRect(x + 170, groupY + groupHeight - 1, width - 200, 1);
  });
  if (!groups.length) {
    ctx.fillStyle = palette.muted;
    ctx.font = '500 13px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, system-ui, sans-serif';
    ctx.fillText("이번 달에 등록된 과제가 없습니다.", x + 28, agendaTop + 54);
  } else if (visibleGroups.length < groups.length) {
    ctx.fillStyle = palette.muted;
    ctx.font = '500 11px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, system-ui, sans-serif';
    ctx.fillText(`+${groups.length - visibleGroups.length}일의 일정이 더 있습니다.`, x + 28, y + height - 18);
  }
  ctx.textAlign = "left";
}

async function downloadCalendarImage(
  calendar: ReturnType<typeof useCalendar>,
  tasks: Task[],
  theme: Theme,
  preset: CalendarImagePreset,
) {
  const canvas = document.createElement("canvas");
  canvas.width = preset.width;
  canvas.height = preset.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 생성할 수 없습니다.");

  const palette = theme === "dark"
    ? { background: "#0f1113", ink: "#f6f4ef", muted: "#898d90", card: "#17191b", line: "#2a2d30", accent: "#ff7a45", today: "#e05252", selectedInk: "#17191b" }
    : { background: "#f4f1eb", ink: "#1b1d1f", muted: "#74787a", card: "#fffefa", line: "#ddd8cf", accent: "#f56f3d", today: "#e05252", selectedInk: "#fffefa" };
  const landscape = preset.width > preset.height;
  const designWidth = landscape ? 1600 : 1000;
  const scale = preset.width / designWidth;
  const designHeight = preset.height / scale;
  ctx.scale(scale, scale);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, designWidth, designHeight);

  ctx.fillStyle = palette.muted;
  ctx.font = '700 16px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, system-ui, sans-serif';
  ctx.fillText("과제 플래너", 56, 58);
  ctx.fillStyle = palette.ink;
  ctx.font = '900 42px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, system-ui, sans-serif';
  ctx.fillText("Kyelendar.", 56, 108);

  const cardX = landscape ? 56 : 48;
  const cardY = 148;
  const cardWidth = landscape ? designWidth - 112 : 904;
  const cardHeight = landscape ? Math.min(730, designHeight - 250) : Math.min(1450, designHeight - 250);
  drawCalendarCard(ctx, calendar, tasks, cardX, cardY, cardWidth, cardHeight, palette);

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("이미지를 저장할 수 없습니다.")), "image/png"));
  const filename = `kyelendar-calendar-${calendar.year}-${String(calendar.month + 1).padStart(2, "0")}-${preset.id}.png`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CalendarSaveOptions({ onSelect, busy }: { onSelect: (preset: CalendarImagePreset) => void; busy: boolean }) {
  return (
    <div className="calendar-save-options">
      <p>월간 그리드와 날짜별 과목·시간을 배경화면으로 저장하세요.</p>
      <div className="calendar-save-grid add-method-grid">
        {calendarImagePresets.map((preset) => (
          <button key={preset.id} className="calendar-save-option" onClick={() => onSelect(preset)} disabled={busy} aria-label={`${preset.label}로 저장`}>
            <strong>{preset.label}</strong>
            <small>{preset.width} × {preset.height}</small>
          </button>
        ))}
      </div>
      {busy ? <small className="calendar-save-status">이미지 생성 중...</small> : null}
    </div>
  );
}

function taskProgress(tasks: Task[]) {
  const completed = tasks.filter((task) => task.done).length;
  return {
    completed,
    active: tasks.length - completed,
    percent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0,
  };
}

function deadlineSummary(tasks: Task[]) {
  const task = tasks
    .filter((candidate) => !candidate.done)
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))[0];
  if (!task) return null;
  const due = new Date(`${task.date}T${task.time}:00+09:00`);
  const today = Date.parse(`${todayInSeoul()}T00:00:00+09:00`);
  const dueDate = Date.parse(`${task.date}T00:00:00+09:00`);
  const days = Math.round((dueDate - today) / 86_400_000);
  return {
    task,
    dday: days === 0 ? "D-DAY" : days > 0 ? `D-${days}` : `D+${Math.abs(days)}`,
    label: new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(due),
  };
}

function todayInSeoul() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}

function todayLabel() {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "long", month: "long", day: "numeric" }).format(new Date());
}

function dueAt(date: string, time: string) {
  return `${date}T${time}:00+09:00`;
}

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const updateFromRequest = (event: Event) => setOnline(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener(CONNECTION_STATUS_EVENT, updateFromRequest);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener(CONNECTION_STATUS_EVENT, updateFromRequest);
    };
  }, []);
  return online;
}

function OfflineBadge({ online }: { online: boolean }) {
  return online ? null : <span className="offline-badge" role="status">오프라인 · 변경사항 자동 저장</span>;
}

function apiErrorMessage(error: unknown) {
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) return "요청 시간이 초과되었습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.";
  return error instanceof RecordsApiError || error instanceof Error ? error.message : "요청에 실패했습니다.";
}

function monthRange(year: number, month: number) {
  return [isoDate(year, month, 1), isoDate(year, month, new Date(year, month + 1, 0).getDate())] as const;
}

function useCalendar(tasks: Task[]) {
  const [cursor, setCursor] = useState(() => {
    const [year, month] = todayInSeoul().split("-").map(Number);
    return new Date(year, month - 1, 1);
  });
  const [selectedDate, setSelectedDate] = useState(todayInSeoul);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = useMemo(
    () => [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)],
    [firstWeekday, daysInMonth],
  );
  const selectDate = (date: string) => {
    const [nextYear, nextMonth] = date.split("-").map(Number);
    setCursor(new Date(nextYear, nextMonth - 1, 1));
    setSelectedDate(date);
  };
  const changeMonth = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    selectDate(isoDate(next.getFullYear(), next.getMonth(), 1));
  };

  return { year, month, cells, selectedDate, selectDate, changeMonth, tasks };
}

function ThemeButton() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button className="icon-button" onClick={toggleTheme} aria-label={`${theme === "dark" ? "화이트" : "다크"} 모드로 전환`}>
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches
      || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    if (isStandalone || localStorage.getItem("records-pwa-install-dismissed") === "true") return;

    const captureInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const installed = () => setInstallEvent(null);
    window.addEventListener("beforeinstallprompt", captureInstall);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstall);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  if (!installEvent) return null;

  const install = async () => {
    await installEvent.prompt();
    const result = await installEvent.userChoice;
    setInstallEvent(null);
    if (result.outcome === "dismissed") localStorage.setItem("records-pwa-install-dismissed", "true");
  };

  return (
    <aside className="pwa-install-prompt" aria-label="웹앱 설치 안내">
      <div><strong>Kyelendar를 앱처럼 사용하세요</strong><span>홈 화면에 설치하면 더 빠르게 열 수 있어요.</span></div>
      <button onClick={() => void install()}>앱으로 설치</button>
      <button className="pwa-install-dismiss" onClick={() => { localStorage.setItem("records-pwa-install-dismissed", "true"); setInstallEvent(null); }} aria-label="설치 안내 닫기">×</button>
    </aside>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [preference, setPreference] = useState<NotificationPreferences["beforeDeadlineMinutes"]>(60);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [pushError, setPushError] = useState("");
  const loaded = useRef(false);
  const seen = useRef(new Set<string>());
  const reduceMotion = useReducedMotion();

  const refresh = useCallback(async () => {
    try {
      const [nextItems, nextUnread, nextPreferences] = await Promise.all([
        listNotifications(false, 20),
        unreadNotificationCount(),
        getNotificationPreferences(),
      ]);
      nextItems.forEach((item) => seen.current.add(item.id));
      loaded.current = true;
      setItems(nextItems);
      setUnread(nextUnread);
      setPreference(nextPreferences.beforeDeadlineMinutes);
    } catch {
      // The dashboard remains usable when notifications are temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    if ("Notification" in window) setPermission(window.Notification.permission);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const enableBrowserNotifications = async () => {
    if (!("Notification" in window) || !window.isSecureContext) return;
    try {
      setPushError("");
      setPermission(await enableWebPush(registerPushSubscription));
    } catch (error) {
      setPushError(error instanceof Error ? error.message : "브라우저 알림을 설정하지 못했습니다.");
    }
  };

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches
    || "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

  const read = async (item: AppNotification) => {
    if (!item.readAt) {
      const updated = await markNotificationRead(item.id);
      setItems((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate));
      setUnread((current) => Math.max(0, current - 1));
    }
  };

  const changePreference = async (value: string) => {
    const minutes = Number(value) as NotificationPreferences["beforeDeadlineMinutes"];
    setPreference(minutes);
    await updateNotificationPreferences(minutes);
    await refresh();
  };

  return (
    <div className="notification-menu">
      <button
        className="icon-button notification-button"
        onClick={() => {
          const nextOpen = !open;
          setOpen(nextOpen);
          if (nextOpen && permission === "default" && window.isSecureContext && (!isIos || isStandalone)) {
            void enableBrowserNotifications();
          }
        }}
        aria-label="알림"
        aria-expanded={open}
      >
        <BellIcon />
        {unread ? <span className="notification-count">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
        <motion.section
          key="notification-panel"
          className="notification-panel"
          aria-label="알림 목록"
          initial={{ opacity: 0, y: reduceMotion ? 0 : -8, scale: reduceMotion ? 1 : 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: reduceMotion ? 0 : -6, scale: reduceMotion ? 1 : 0.98 }}
          transition={{ duration: reduceMotion ? 0.01 : 0.2, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <header><div><p className="section-label">알림</p><h2>알림</h2></div><button onClick={() => void markAllNotificationsRead().then(refresh)}>모두 읽음</button></header>
          <div className="notification-preferences">
            <strong>마감 전 알림</strong>
            <select aria-label="마감 전 알림" value={preference} onChange={(event) => void changePreference(event.target.value)}>
              <option value="60">1시간 전</option>
              <option value="30">30분 전</option>
              <option value="10">10분 전</option>
            </select>
            <small>D-7·D-4·D-1 오전 7시와 D-Day 오전 7시 30분 알림은 항상 켜져 있어요.</small>
          </div>
          {permission === "default" && window.isSecureContext && (!isIos || isStandalone) ? <button className="browser-notification-button" onClick={() => void enableBrowserNotifications()}>브라우저 알림 허용</button> : null}
          {permission === "default" && window.isSecureContext && isIos && !isStandalone ? <p className="notification-hint">iPhone/iPad는 공유 메뉴에서 홈 화면에 추가한 뒤 앱 아이콘으로 열어야 알림을 허용할 수 있어요.</p> : null}
          {permission === "denied" ? <p className="notification-hint">브라우저 설정에서 Kyelendar 알림 권한을 허용해 주세요.</p> : null}
          {!window.isSecureContext ? <p className="notification-hint">기기 알림은 HTTPS 접속에서 사용할 수 있어요.</p> : null}
          {permission === "unsupported" && window.isSecureContext ? <p className="notification-hint">이 브라우저는 Web Push 알림을 지원하지 않아요.</p> : null}
          {pushError ? <p className="notification-hint">{pushError}</p> : null}
          <div className="notification-list">
            {items.length ? items.map((item) => (
              <button className={`notification-item ${item.readAt ? "read" : "unread"}`} key={item.id} onClick={() => void read(item)}>
                <span className="notification-dot" />
                <span><strong>{item.title}</strong><small>{item.message}</small></span>
              </button>
            )) : <p className="notification-empty">새 알림이 없어요.</p>}
          </div>
        </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Brand() {
  return <div className="brand">Kyelendar<span>.</span></div>;
}

function TabletModal({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const duration = reduceMotion ? 0.01 : 0.2;
  return (
    <motion.div className="tablet-modal-overlay" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration }}>
      <motion.section
        className={`tablet-modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
        transition={{ duration: reduceMotion ? 0.01 : 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {children}
      </motion.section>
    </motion.div>
  );
}

function MyPageContent({ profile, onProfileUpdated, onPasswordChanged, onDeleteAccount }: {
  profile: User;
  onProfileUpdated: (user: User) => void;
  onPasswordChanged: () => void;
  onDeleteAccount: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [studentNumber, setStudentNumber] = useState(profile.studentNumber);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !/^[0-9]{5}$/.test(studentNumber)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const user = await updateProfile(name.trim(), studentNumber);
      onProfileUpdated(user);
      setMessage("개인 정보가 저장되었습니다.");
    } catch (saveError) { setError(apiErrorMessage(saveError)); }
    finally { setBusy(false); }
  };

  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(""); setMessage("");
    if (newPassword.length < 10) { setError("새 비밀번호는 10자 이상이어야 합니다."); return; }
    if (newPassword !== confirmPassword) { setError("새 비밀번호가 서로 일치하지 않습니다."); return; }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      onPasswordChanged();
    } catch (saveError) {
      setError(saveError instanceof RecordsApiError && saveError.code === "INVALID_PASSWORD" ? "현재 비밀번호가 올바르지 않습니다." : apiErrorMessage(saveError));
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="mypage-summary"><span>{profile.name.slice(0, 1)}</span><div><strong>{profile.name}</strong><small>{profile.email}</small></div></div>
      {message ? <p className="mypage-success" role="status">{message}</p> : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <section className="mypage-section">
        <div><h3>기본 정보</h3><p>이름과 학번을 수정할 수 있어요.</p></div>
        <form onSubmit={saveProfile}>
          <label className="form-field"><span>이름</span><input value={name} maxLength={50} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
          <label className="form-field"><span>학번</span><input value={studentNumber} inputMode="numeric" maxLength={5} onChange={(event) => setStudentNumber(event.target.value.replace(/\D/g, ""))} /></label>
          <label className="form-field"><span>이메일</span><input value={profile.email} readOnly /></label>
          <button className="save-button" disabled={busy || !name.trim() || !/^[0-9]{5}$/.test(studentNumber)}>정보 저장</button>
        </form>
      </section>
      <section className="mypage-section">
        <div><h3>비밀번호 변경</h3><p>변경 후에는 새 비밀번호로 다시 로그인해야 해요.</p></div>
        <form onSubmit={savePassword}>
          <label className="form-field"><span>현재 비밀번호</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
          <label className="form-field"><span>새 비밀번호</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></label>
          <label className="form-field"><span>새 비밀번호 확인</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label>
          <button className="save-button" disabled={busy || !currentPassword || !newPassword || !confirmPassword}>비밀번호 변경</button>
        </form>
      </section>
      <section className="mypage-danger"><div><h3>회원탈퇴</h3><p>계정과 모든 과제 및 알림이 영구적으로 삭제됩니다.</p></div><button type="button" onClick={onDeleteAccount}>회원탈퇴</button></section>
    </>
  );
}

function MyPageModal({ profile, onClose, onProfileUpdated, onPasswordChanged, onDeleteAccount }: {
  profile: User;
  onClose: () => void;
  onProfileUpdated: (user: User) => void;
  onPasswordChanged: () => void;
  onDeleteAccount: () => void;
}) {
  return (
    <TabletModal label="마이페이지" className="mypage-modal">
      <header><div><p className="section-label">계정 설정</p><h2>마이페이지</h2></div><button onClick={onClose} aria-label="닫기"><Cross2Icon /></button></header>
      <MyPageContent profile={profile} onProfileUpdated={onProfileUpdated} onPasswordChanged={onPasswordChanged} onDeleteAccount={onDeleteAccount} />
    </TabletModal>
  );
}

function MyPageSheet({ profile, onClose, onProfileUpdated, onPasswordChanged, onDeleteAccount }: {
  profile: User;
  onClose: () => void;
  onProfileUpdated: (user: User) => void;
  onPasswordChanged: () => void;
  onDeleteAccount: () => void;
}) {
  const [open, setOpen] = useState(true);
  const closeTimer = useRef<number | null>(null);
  useBottomSheetOverscroll(open);

  const close = () => {
    if (!open || closeTimer.current !== null) return;
    setOpen(false);
    closeTimer.current = window.setTimeout(onClose, 420);
  };

  useEffect(() => {
    let sheet: HTMLElement | null = null;
    const frame = window.requestAnimationFrame(() => {
      sheet = document.querySelector<HTMLElement>('[data-testid="bottom-sheet"]');
      sheet?.classList.add("mypage-large-sheet");
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLInputElement) activeElement.blur();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      sheet?.classList.remove("mypage-large-sheet");
    };
  }, []);

  return (
    <BottomSheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) close(); }} title="마이페이지" description="개인 정보와 계정을 관리하세요." snap={1}>
      <div className="mypage-sheet-content">
        <MyPageContent profile={profile} onProfileUpdated={onProfileUpdated} onPasswordChanged={onPasswordChanged} onDeleteAccount={onDeleteAccount} />
      </div>
    </BottomSheet>
  );
}

function DeleteAccountModal({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void }) {
  const [seconds, setSeconds] = useState(5);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (seconds === 0) return;
    const timer = window.setTimeout(() => setSeconds((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (seconds > 0 || !password) return;
    setBusy(true);
    setError("");
    try {
      await deleteAccount(password);
      onDeleted();
    } catch (deleteError) {
      setError(deleteError instanceof RecordsApiError && deleteError.code === "INVALID_PASSWORD"
        ? "비밀번호가 올바르지 않습니다."
        : apiErrorMessage(deleteError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TabletModal label="회원탈퇴 확인">
      <header><div><p className="section-label">계정 삭제</p><h2>정말 지우시겠습니까?</h2></div><button onClick={onClose} aria-label="닫기"><Cross2Icon /></button></header>
      <p className="delete-account-warning">과제, 알림, 로그인 정보가 모두 삭제되며 복구할 수 없습니다.</p>
      <form className="delete-account-form" onSubmit={submit}>
        <label className="form-field"><span>현재 비밀번호</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="비밀번호를 다시 입력하세요" /></label>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <button className="delete-account-confirm" type="submit" disabled={busy || seconds > 0 || !password}>{busy ? "삭제 중..." : seconds > 0 ? `${seconds}초 후 회원탈퇴` : "회원탈퇴"}</button>
      </form>
    </TabletModal>
  );
}

function AuthField({ icon, label, ...props }: InputHTMLAttributes<HTMLInputElement> & { icon: ReactNode; label: string }) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <div>{icon}<input {...props} aria-label={label} /></div>
    </label>
  );
}

function VerificationPendingPage() {
  const [theme, setTheme] = useState<Theme>(themeFromUrl);
  const email = sessionStorage.getItem(PENDING_EMAIL_KEY) || "";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState("이메일로 보낸 5자리 코드를 입력해 주세요. 코드는 10분 동안 유효합니다.");

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email || !/^[0-9]{5}$/.test(code)) {
      setStatus("error");
      setMessage("이메일로 받은 숫자 5자리를 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      await confirmEmailVerification(email, code);
      sessionStorage.removeItem(PENDING_EMAIL_KEY);
      setStatus("success");
      setMessage("이메일 인증이 완료되었습니다. 이제 Kyelendar를 사용할 수 있어요.");
    } catch (error) {
      setStatus("error");
      setMessage(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!email) return;
    setBusy(true);
    try {
      await requestEmailVerification(email);
      setCode("");
      setStatus("idle");
      setMessage("새 인증 코드를 보냈습니다. 가장 최근에 받은 코드를 입력해 주세요.");
    } catch (error) {
      setStatus("error");
      setMessage(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme(nextTheme) }}>
      <div className={`tablet-app theme-${theme}`}>
        <main className="tablet-auth">
          <section className="tablet-auth-brand"><Brand /><div><p className="section-label">과제 플래너</p><h1>학교의 모든 마감을<br />한 화면에.</h1><p>달력과 D-Day를 함께 보며 오늘 할 일을 가볍게 정리하세요.</p></div><small>Kyelendar · 학생 플래너</small></section>
          <section className="tablet-auth-form">
            <ThemeButton />
            <motion.div className="tablet-form-wrap" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <p className="section-label">이메일 인증</p>
              <h2>{status === "success" ? "인증이 완료됐어요." : "인증 코드를 입력해 주세요."}</h2>
              <p>{status === "success" ? "확인이 끝났습니다. 바로 서비스를 시작할 수 있어요." : <><strong>{email || "가입한 이메일"}</strong>로 인증 코드를 보냈어요.</>}</p>
              {status === "success" ? (
                <>
                  <div className="auth-link-result success" role="status"><span className="auth-result-icon"><CheckIcon /></span><p>{message}</p></div>
                  <button className="auth-submit auth-link-primary" type="button" onClick={() => window.location.assign("/?screen=dashboard")}>서비스 시작하기</button>
                </>
              ) : (
                <form className="verification-code-form" onSubmit={verifyCode} noValidate>
                  <label htmlFor="verification-code">5자리 인증 코드</label>
                  <input id="verification-code" className="verification-code-input" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{5}" maxLength={5} placeholder="00000" aria-invalid={status === "error"} />
                  <p className={status === "error" ? "auth-error" : "verification-help"} aria-live="polite">{message}</p>
                  <button className="auth-submit" type="submit" disabled={busy || code.length !== 5}>{busy ? "확인 중..." : "인증 코드 확인"}</button>
                  <button className="verification-resend" type="button" onClick={() => void resend()} disabled={busy || !email}>인증 코드 다시 보내기</button>
                </form>
              )}
              {status !== "success" ? <p className="auth-switch"><button type="button" onClick={openLoginPage}>로그인으로 돌아가기</button></p> : null}
            </motion.div>
          </section>
        </main>
      </div>
    </ThemeContext.Provider>
  );
}

type AuthLinkKind = "forgot" | "reset";

function AuthLinkPage({ kind }: { kind: AuthLinkKind }) {
  const [theme, setTheme] = useState<Theme>(themeFromUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const token = new URLSearchParams(window.location.search).get("token") || "";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    if (kind === "forgot") {
      if (!email.includes("@")) { setStatus("error"); setMessage("이메일을 올바르게 입력해 주세요."); return; }
      setBusy(true);
      try {
        await requestPasswordReset(email.trim());
        setStatus("success");
        setMessage("계정이 존재하면 비밀번호 재설정 메일을 보내드립니다.");
      } catch (error) {
        setStatus("error");
        setMessage(apiErrorMessage(error));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!token) { setStatus("error"); setMessage("재설정 링크가 올바르지 않습니다."); return; }
    if (password.length < 10 || password !== passwordConfirm) {
      setStatus("error");
      setMessage("10자 이상의 동일한 비밀번호를 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      await confirmPasswordReset(token, password);
      setStatus("success");
      setMessage("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.");
    } catch (error) {
      setStatus("error");
      setMessage(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const title = kind === "forgot" ? "비밀번호를 잊으셨나요?" : "새 비밀번호 설정";
  const description = kind === "forgot" ? "가입한 이메일로 재설정 링크를 보내드려요." : "앞으로 사용할 비밀번호를 입력해 주세요.";
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme(nextTheme) }}>
      <div className={`auth-link-page theme-${theme}`}>
        <motion.main className="auth-link-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <header><Brand /><ThemeButton /></header>
          <p className="section-label">계정 보안</p>
          <h1>{title}</h1>
          <p className="auth-link-description">{description}</p>
          {status === "success" ? (
            <div className="auth-link-result success" role="status"><span className="auth-result-icon"><CheckIcon /></span><p>{message}</p></div>
          ) : (
            <form className="auth-form" onSubmit={submit} noValidate>
              {kind === "forgot" ? <AuthField icon={<EnvelopeClosedIcon />} label="이메일" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="student@school.kr" /> : (
                <>
                  <AuthField icon={<LockClosedIcon />} label="새 비밀번호" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="10자 이상 입력해 주세요" />
                  <AuthField icon={<LockClosedIcon />} label="새 비밀번호 확인" type="password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} placeholder="한 번 더 입력해 주세요" />
                </>
              )}
              {message ? <p className="auth-error" role="alert">{message}</p> : null}
              <button className="auth-submit" type="submit" disabled={busy}>{busy ? "처리 중..." : kind === "forgot" ? "재설정 메일 받기" : "비밀번호 변경"}</button>
            </form>
          )}
          <p className="auth-switch"><button type="button" onClick={openLoginPage}>로그인으로 돌아가기</button></p>
        </motion.main>
      </div>
    </ThemeContext.Provider>
  );
}

function requestLoginNotificationPermission() {
  if (!isWebPushConfigured()) return null;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches
    || "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  if (isIos && !isStandalone) return null;
  try {
    return requestWebPushPermission();
  } catch {
    return null;
  }
}

function MobileAuth({ mode, onSuccess, onSwitch }: { mode: AuthMode; onSuccess: () => void; onSwitch: () => void }) {
  useAuthExpiredRedirect();
  const { theme } = useTheme();
  const [studentId, setStudentId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(() => mode === "login" ? loginEmailFromUrl() : "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const required = mode === "signup" ? studentId.trim() && name.trim() && email.trim() && password : email.trim() && password;
    if (!required || !email.includes("@")) {
      setError("필수 정보를 올바르게 입력해 주세요.");
      return;
    }
    setError("");
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const permissionRequest = mode === "login" ? requestLoginNotificationPermission()?.catch(() => null) ?? null : null;
    setSubmitting(true);
    try {
      if (mode === "signup") {
        const signedIn = await signupOrResume(name.trim(), email.trim(), studentId.trim(), password);
        if (signedIn) {
          onSuccess();
          return;
        }
        openEmailVerificationPage(email.trim());
        return;
      } else {
        await login(email.trim(), password);
      }
      onSuccess();
      if (permissionRequest) void permissionRequest.then((permission) => permission === "granted" ? enableWebPush(registerPushSubscription, permission) : undefined).catch(() => undefined);
    } catch (submitError) {
      if (submitError instanceof RecordsApiError && submitError.code === "EMAIL_NOT_VERIFIED") {
        await openEmailVerificationPageWithFreshCode(email.trim());
        return;
      }
      setError(apiErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MobileScroll className={`app-screen theme-${theme}`}>
      <main className="auth-screen" aria-label={mode === "login" ? "로그인" : "회원가입"}>
        <header className="auth-topbar"><Brand /><ThemeButton /></header>
        <section className="auth-intro">
          <p className="section-label">학교 생활을 위한 플래너</p>
          <h1>{mode === "login" ? <>과제를 놓치지 않는<br />가벼운 시작.</> : <>학교 생활을 한곳에<br />차곡차곡.</>}</h1>
          <p>{mode === "login" ? "오늘의 마감부터 한눈에 확인해 보세요." : "기본 정보만 입력하면 바로 시작할 수 있어요."}</p>
        </section>
        <form className="auth-form" onSubmit={submit} noValidate>
          {mode === "signup" ? (
            <>
              <AuthField icon={<IdCardIcon />} label="학번" value={studentId} onChange={(event) => setStudentId(event.target.value)} placeholder="예: 20514" inputMode="numeric" />
              <AuthField icon={<PersonIcon />} label="이름" value={name} onChange={(event) => setName(event.target.value)} placeholder="이름을 입력해 주세요" />
            </>
          ) : null}
          <AuthField icon={<EnvelopeClosedIcon />} label="이메일" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="student@school.kr" />
          <label className="auth-field">
            <span>비밀번호</span>
            <div>
              <LockClosedIcon />
              <input aria-label="비밀번호" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="10자 이상 입력해 주세요" />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((current) => !current)} aria-label="비밀번호 표시 전환">
                {showPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
              </button>
            </div>
          </label>
          {mode === "login" ? <button className="auth-text-button" type="button" onClick={() => window.location.assign("/forgot-password")}>비밀번호를 잊으셨나요?</button> : null}
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? "처리 중..." : mode === "login" ? "로그인" : "회원가입 완료"}</button>
        </form>
        <p className="auth-switch">
          {mode === "login" ? "아직 계정이 없나요?" : "이미 계정이 있나요?"}
          <button onClick={(event) => { event.currentTarget.blur(); onSwitch(); }}>{mode === "login" ? "회원가입" : "로그인"}</button>
        </p>
      </main>
    </MobileScroll>
  );
}

function CalendarPanel({ calendar, tasks, expanded = false }: { calendar: ReturnType<typeof useCalendar>; tasks: Task[]; expanded?: boolean }) {
  const { year, month, cells, selectedDate, selectDate, changeMonth } = calendar;
  const today = todayInSeoul();
  return (
    <section className={`calendar-card ${expanded ? "expanded" : ""}`}>
      <div className="calendar-header">
        <div><p className="section-label">월간</p><h2>{year}. {String(month + 1).padStart(2, "0")}</h2></div>
        <div className="month-controls">
          <button onClick={() => changeMonth(-1)} aria-label="이전 달"><ChevronLeftIcon /></button>
          <button onClick={() => changeMonth(1)} aria-label="다음 달"><ChevronRightIcon /></button>
        </div>
      </div>
      <div className="weekdays" aria-hidden="true">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">
        {cells.map((day, index) => {
          if (!day) return <span className="day empty" key={`empty-${index}`} />;
          const date = isoDate(year, month, day);
          const dateTasks = tasks.filter((task) => task.date === date);
          const hasTask = dateTasks.some((task) => !task.done);
          const selected = date === selectedDate;
          const isToday = date === today;
          return (
            <button
              className={`day ${hasTask ? "has-task" : ""} ${isToday ? "today" : ""} ${selected ? "selected" : ""}`}
              key={date}
              onClick={() => selectDate(date)}
              aria-label={`${month + 1}월 ${day}일${hasTask ? ", 과제 있음" : ""}`}
              aria-pressed={selected}
            >
              <span>{day}</span>
              {expanded ? (
                <span className="calendar-task-preview">
                  {dateTasks.slice(0, 2).map((task) => <small className={task.done ? "done" : ""} key={task.id}>{task.title}</small>)}
                  {dateTasks.length > 2 ? <small>+{dateTasks.length - 2}</small> : null}
                </span>
              ) : hasTask ? <i /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function TaskList({ tasks, selectedDate, onToggle, onEdit }: { tasks: Task[]; selectedDate: string; onToggle: (id: string) => void; onEdit?: (task: Task) => void }) {
  const selectedTasks = tasks.filter((task) => task.date === selectedDate).sort((a, b) => Number(a.done) - Number(b.done));
  return (
    <section className="task-section">
      <div className="task-heading">
        <div><p className="section-label">선택한 날짜</p><h2>{Number(selectedDate.slice(5, 7))}월 {Number(selectedDate.slice(8))}일의 과제</h2></div>
        <span>{selectedTasks.length}</span>
      </div>
      <div className="task-list">
        {selectedTasks.length ? selectedTasks.map((task) => (
          <article className={`task-card ${task.done ? "done" : ""}`} key={task.id} style={{ "--task-color": task.color } as CSSProperties}>
            <button className="task-check" onClick={() => onToggle(task.id)} aria-label={`${task.title} ${task.done ? "완료 취소" : "완료"}`} aria-pressed={task.done}>
              {task.done ? <CheckIcon /> : null}
            </button>
            <div className="task-copy"><span className="subject">{task.subject}</span><h3>{task.title}</h3><p><ClockIcon /> 오늘 {task.time}</p></div>
            <button className="more-button" onClick={() => onEdit?.(task)} aria-label={`${task.title} 수정`}>···</button>
          </article>
        )) : <div className="empty-state"><CalendarIcon /><p>이 날짜에는 과제가 없어요.</p></div>}
      </div>
    </section>
  );
}

function PhotoPicker({ file, onRequestSelect, onRequestCamera }: { file: File | null; onRequestSelect: () => void; onRequestCamera: () => void }) {
  const [sourceOpen, setSourceOpen] = useState(false);
  return (
    <div className={`photo-field ${sourceOpen ? "source-open" : ""}`}>
      <button type="button" className="photo-picker-trigger" onClick={() => setSourceOpen((open) => !open)} aria-expanded={sourceOpen}>
        <ImageIcon /><span>{file?.name || "칠판 또는 유인물 사진 선택"}</span>
      </button>
      {sourceOpen ? <div className="photo-source-options" role="group" aria-label="사진 가져오기 방법">
        <button type="button" onClick={onRequestCamera}><CameraIcon />카메라 촬영</button>
        <button type="button" onClick={onRequestSelect}><ImageIcon />갤러리 선택</button>
      </div> : null}
    </div>
  );
}

function AnalysisReview({ candidates, selected, warnings, onSelect }: { candidates: Candidate[]; selected: number; warnings: string[]; onSelect: (candidate: Candidate, index: number) => void }) {
  if (!candidates.length && !warnings.length) return null;
  return (
    <div className="analysis-review" role="status">
      {candidates.length > 1 ? (
        <div className="candidate-list" aria-label="AI 분석 후보">
          {candidates.map((candidate, index) => (
            <button type="button" className={index === selected ? "active" : ""} key={`${candidate.title}-${index}`} onClick={() => onSelect(candidate, index)}>
              {index + 1}. {candidate.title || "제목 확인 필요"}
            </button>
          ))}
        </div>
      ) : null}
      {candidates[selected]?.needsReview.length ? <p>주황색 입력값을 직접 확인해 주세요.</p> : null}
      {warnings.map((warning) => <p key={warning}>{warning}</p>)}
    </div>
  );
}

function candidateDueAt(candidate: Candidate) {
  if (!candidate.dueAt) return null;
  const date = new Date(candidate.dueAt);
  if (Number.isNaN(date.getTime())) return null;
  return {
    date: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date),
    time: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(date),
  };
}

function useAuthExpiredRedirect() {
  const flow = useFlow();
  useEffect(() => {
    const redirect = () => flow.replace(loginScreen);
    window.addEventListener(AUTH_EXPIRED_EVENT, redirect);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, redirect);
  }, [flow]);
}

function useBottomSheetOverscroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const sheet = document.querySelector<HTMLElement>('[data-testid="bottom-sheet"]');
    const content = sheet?.querySelector<HTMLElement>('.sheet-content');
    if (!sheet || !content) return;
    let startY = 0;
    let pulling = false;
    const reset = () => {
      sheet.style.transition = "translate 280ms cubic-bezier(.22, 1, .36, 1)";
      sheet.style.translate = "0 0";
      pulling = false;
    };
    const onTouchStart = (event: TouchEvent) => {
      startY = event.touches[0]?.clientY ?? 0;
      sheet.style.transition = "none";
      pulling = false;
    };
    const onTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      if (currentY === undefined) return;
      const delta = currentY - startY;
      const atTop = content.scrollTop <= 0;
      const atBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 1;
      const shouldPull = (atTop && delta > 0) || (atBottom && delta < 0);
      if (!pulling && !shouldPull) return;
      if (!shouldPull) return reset();
      pulling = true;
      event.preventDefault();
      const distance = Math.sign(delta) * 28 * (1 - Math.exp(-Math.abs(delta) / 100));
      sheet.style.translate = `0 ${distance}px`;
    };
    sheet.style.willChange = "translate";
    content.style.overscrollBehaviorY = "contain";
    content.addEventListener("touchstart", onTouchStart, { passive: true });
    content.addEventListener("touchmove", onTouchMove, { passive: false });
    content.addEventListener("touchend", reset, { passive: true });
    content.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      content.removeEventListener("touchstart", onTouchStart);
      content.removeEventListener("touchmove", onTouchMove);
      content.removeEventListener("touchend", reset);
      content.removeEventListener("touchcancel", reset);
      sheet.style.translate = "";
      sheet.style.transition = "";
      sheet.style.willChange = "";
      content.style.overscrollBehaviorY = "";
    };
  }, [active]);
}

function MobileDashboard({ onLogout }: { onLogout: () => void }) {
  const { theme } = useTheme();
  const online = useOnlineStatus();
  useAuthExpiredRedirect();
  const { screenRef } = useScreenPortal();
  const [portalReady, setPortalReady] = useState(false);
  const [tasks, setTasks] = useState(initialTasks);
  const [profile, setProfile] = useState<User | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [calendarSaveOpen, setCalendarSaveOpen] = useState(false);
  const [myPageOpen, setMyPageOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [calendarSaveBusy, setCalendarSaveBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [dueDate, setDueDate] = useState(todayInSeoul);
  const [dueTime, setDueTime] = useState("18:00");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState(0);
  const [analysisWarnings, setAnalysisWarnings] = useState<string[]>([]);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const openPhotoInput = (capture: boolean) => {
    const input = photoInputRef.current;
    if (!input) return;
    if (capture) input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    input.click();
  };
  const calendar = useCalendar(tasks);
  const activeCount = tasks.filter((task) => !task.done).length;
  const progress = taskProgress(tasks);
  const deadline = deadlineSummary(tasks);
  useBottomSheetOverscroll(sheetOpen || Boolean(editingTask) || calendarSaveOpen || deleteAccountOpen);

  const saveCalendarImage = async (preset: CalendarImagePreset) => {
    setCalendarSaveBusy(true);
    try {
      await downloadCalendarImage(calendar, tasks, theme, preset);
      setCalendarSaveOpen(false);
    } catch (saveError) {
      setError(apiErrorMessage(saveError));
    } finally {
      setCalendarSaveBusy(false);
    }
  };

  useEffect(() => setPortalReady(true), []);

  useEffect(() => {
    if (!sheetOpen && !editingTask) return;
    const frame = window.requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLInputElement) activeElement.blur();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingTask, sheetOpen]);

  useEffect(() => {
    if (!hasToken()) return;
    const [from, to] = monthRange(calendar.year, calendar.month);
    let mounted = true;
    me().then((user) => { if (mounted) setProfile(user); }).catch((loadError) => { if (mounted) setError(apiErrorMessage(loadError)); });
    listAssignments(from, to)
      .then((assignments) => { if (mounted) setTasks(assignments.map(taskFromAssignment)); })
      .catch((loadError) => { if (mounted) setError(apiErrorMessage(loadError)); });
    return () => { mounted = false; };
  }, [calendar.year, calendar.month, online]);

  const applyCandidate = (candidate: Candidate, index: number) => {
    const extractedDueAt = candidateDueAt(candidate);
    setSelectedCandidate(index);
    setTitle(candidate.title || "");
    setSubject(candidate.subject || "");
    setDueDate(extractedDueAt?.date || "");
    if (extractedDueAt) setDueTime(extractedDueAt.time);
  };

  const analyzePhoto = async (selectedFile: File) => {
    setBusy(true);
    setError("");
    try {
      const extraction = await extractAssignment(selectedFile);
      const candidate = extraction.candidates[0];
      if (!candidate) throw new Error("사진에서 과제를 찾지 못했습니다.");
      setCandidates(extraction.candidates);
      setAnalysisWarnings(extraction.warnings);
      applyCandidate(candidate, 0);
    } catch (analysisError) {
      setError(apiErrorMessage(analysisError));
    } finally {
      setBusy(false);
    }
  };

  const addTask = async () => {
    if (!title.trim() || !subject.trim() || !dueDate) return;
    setBusy(true);
    setError("");
    try {
      const created = await createAssignment(title.trim(), subject, dueAt(dueDate, dueTime), notificationsEnabled);
      const createdTask = taskFromAssignment(created);
      setTasks((current) => [...current, createdTask]);
      calendar.selectDate(createdTask.date);
      setTitle("");
      setFile(null);
      setNotificationsEnabled(true);
      setCandidates([]);
      setAnalysisWarnings([]);
      setSheetOpen(false);
    } catch (saveError) {
      setError(apiErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  const toggleTask = async (id: string) => {
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) return;
    try {
      const updated = await completeAssignment(id, !task.done);
      setTasks((current) => current.map((candidate) => candidate.id === id ? taskFromAssignment(updated) : candidate));
    } catch (toggleError) {
      setError(apiErrorMessage(toggleError));
    }
  };

  const saveEdit = async () => {
    if (!editingTask?.title.trim() || !editingTask.subject.trim()) return;
    setBusy(true);
    setError("");
    try {
      const updated = await updateAssignment(editingTask.id, editingTask.title.trim(), editingTask.subject.trim(), dueAt(editingTask.date, editingTask.time), editingTask.notificationsEnabled);
      const updatedTask = taskFromAssignment(updated);
      setTasks((current) => current.map((task) => task.id === updated.id ? updatedTask : task));
      calendar.selectDate(updatedTask.date);
      setEditingTask(null);
    } catch (saveError) {
      setError(apiErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  const removeTask = async () => {
    if (!editingTask || !window.confirm(`'${editingTask.title}' 과제를 삭제할까요?`)) return;
    setBusy(true); setError("");
    try {
      await deleteAssignment(editingTask.id);
      setTasks((current) => current.filter((task) => task.id !== editingTask.id));
      setEditingTask(null);
    } catch (deleteError) { setError(apiErrorMessage(deleteError)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <MobileScroll className={`app-screen theme-${theme}`}>
        <main className="records" aria-label="과제 디데이 대시보드">
          <header className="topbar">
            <div><p className="eyebrow">과제 플래너</p><Brand /></div>
            <div className="topbar-actions"><NotificationBell /><ThemeButton /><button className="icon-button" onClick={() => setCalendarSaveOpen(true)} aria-label="배경화면으로 저장"><DownloadIcon /></button><button className="icon-button" onClick={() => setMyPageOpen(true)} aria-label="마이페이지"><PersonIcon /></button><button className="icon-button" onClick={onLogout} aria-label="로그아웃"><ExitIcon /></button></div>
          </header>
          <OfflineBadge online={online} />
          <section className="deadline-card" aria-label="가장 가까운 마감">
            <div className="deadline-copy"><p className="section-label"><span /> 다음 마감</p><strong>{deadline?.dday || "-"}</strong><p className="deadline-title">{deadline?.task.title || "마감 예정인 과제가 없어요"}</p><p className="deadline-meta">{deadline?.label || "새 과제를 추가해 보세요."}</p></div>
            <div className="progress-ring" style={{ "--progress": `${progress.percent}%` } as CSSProperties} aria-label={`전체 ${tasks.length}개 중 ${progress.completed}개 완료, 진행 중 ${progress.active}개`}><span>{progress.active}</span><small>진행 중</small></div>
          </section>
          <CalendarPanel calendar={calendar} tasks={tasks} />
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <TaskList tasks={tasks} selectedDate={calendar.selectedDate} onToggle={toggleTask} onEdit={(task) => setEditingTask({ ...task })} />
          <div className="bottom-spacer" />
        </main>
      </MobileScroll>
      <AnimatePresence>
        {myPageOpen && profile ? <MyPageSheet key="my-page" profile={profile} onClose={() => setMyPageOpen(false)} onProfileUpdated={setProfile} onPasswordChanged={onLogout} onDeleteAccount={() => { setMyPageOpen(false); setDeleteAccountOpen(true); }} /> : null}
        {deleteAccountOpen ? <DeleteAccountModal key="delete-account" onClose={() => setDeleteAccountOpen(false)} onDeleted={onLogout} /> : null}
      </AnimatePresence>
      {portalReady && screenRef.current && !editingTask && !calendarSaveOpen && !myPageOpen && !deleteAccountOpen ? createPortal(
        <nav className="action-bar" aria-label="과제 추가">
          <button className="photo-button" onClick={() => { setDueDate(calendar.selectedDate); setSheetOpen(true); }}><PlusIcon /> 과제 추가</button>
        </nav>, screenRef.current,
      ) : null}
      <input ref={photoInputRef} hidden type="file" accept="image/*" onChange={(event) => {
        const selectedFile = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!selectedFile) return;
        setFile(selectedFile);
        setCandidates([]);
        setAnalysisWarnings([]);
        setDueDate(calendar.selectedDate);
        setSheetOpen(true);
      }} />
      <BottomSheet open={sheetOpen} onOpenChange={setSheetOpen} title="새 과제 추가" description="사진 한 장과 필수 정보만 빠르게 기록해요." snap={0.86}>
        <div className="add-form">
          <PhotoPicker file={file} onRequestSelect={() => openPhotoInput(false)} onRequestCamera={() => openPhotoInput(true)} />
          {file ? <button type="button" className="analyze-button" onClick={() => void analyzePhoto(file)} disabled={busy}>{busy ? "분석 중..." : "사진 분석"}</button> : null}
          <AnalysisReview candidates={candidates} selected={selectedCandidate} warnings={analysisWarnings} onSelect={applyCandidate} />
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <label className={`form-field ${candidates[selectedCandidate]?.needsReview.includes("title") ? "review-needed" : ""}`}><span>과제명</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="과제명을 입력하세요" /></label>
          <div className="form-row">
            <label className={`form-field ${candidates[selectedCandidate]?.needsReview.includes("subject") ? "review-needed" : ""}`}><span>과목</span><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="과목 또는 분류를 입력하세요" /></label>
            <label className={`form-field ${candidates[selectedCandidate]?.needsReview.includes("dueAt") ? "review-needed" : ""}`}><span>마감일</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          </div>
          <label className="form-field"><span>마감 시간</span><input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} /></label>
          <label className="alarm-toggle"><input type="checkbox" checked={notificationsEnabled} onChange={(event) => setNotificationsEnabled(event.target.checked)} /><BellIcon />마감 알림 받기</label>
          <button className="save-button" onClick={() => void addTask()} disabled={!title.trim() || !subject.trim() || !dueDate || busy}>{busy ? "처리 중..." : "과제 저장"}</button>
          <button className="sheet-close" onClick={() => setSheetOpen(false)} aria-label="닫기"><Cross2Icon /></button>
        </div>
      </BottomSheet>
      <BottomSheet open={Boolean(editingTask)} onOpenChange={(open) => { if (!open) setEditingTask(null); }} title="과제 수정" description="과제명과 마감 정보를 수정할 수 있어요." snap={0.72}>
        {editingTask ? (
          <div className="add-form">
            <label className="form-field"><span>과제명</span><input value={editingTask.title} onChange={(event) => setEditingTask((task) => task ? { ...task, title: event.target.value } : task)} /></label>
            <label className="form-field"><span>과목</span><input value={editingTask.subject} onChange={(event) => setEditingTask((task) => task ? { ...task, subject: event.target.value } : task)} /></label>
            <div className="form-row">
              <label className="form-field"><span>마감일</span><input type="date" value={editingTask.date} onChange={(event) => setEditingTask((task) => task ? { ...task, date: event.target.value } : task)} /></label>
              <label className="form-field"><span>마감 시간</span><input type="time" value={editingTask.time} onChange={(event) => setEditingTask((task) => task ? { ...task, time: event.target.value } : task)} /></label>
            </div>
            <label className="alarm-toggle"><input type="checkbox" checked={editingTask.notificationsEnabled} onChange={(event) => setEditingTask((task) => task ? { ...task, notificationsEnabled: event.target.checked } : task)} /><BellIcon />마감 알림 받기</label>
            <button className="save-button" onClick={() => void saveEdit()} disabled={!editingTask.title.trim() || !editingTask.subject.trim() || busy}>{busy ? "처리 중..." : "수정 저장"}</button>
            <button className="assignment-delete-button" type="button" onClick={() => void removeTask()} disabled={busy}>과제 삭제</button>
          </div>
        ) : null}
      </BottomSheet>
      <BottomSheet open={calendarSaveOpen} onOpenChange={setCalendarSaveOpen} title="캘린더 이미지 저장" description="기기 배경화면에 맞는 비율을 선택하세요." snap={0.5}>
        <CalendarSaveOptions onSelect={(preset) => void saveCalendarImage(preset)} busy={calendarSaveBusy} />
      </BottomSheet>
    </>
  );
}

const dashboardScreen: FlowScreen = { id: "dashboard", render: (flow) => <MobileDashboard onLogout={() => { clearToken(); flow.replace(loginScreen); }} /> };
const signupScreen: FlowScreen = { id: "signup", render: (flow) => <MobileAuth mode="signup" onSuccess={() => flow.replace(dashboardScreen)} onSwitch={flow.pop} /> };
const loginScreen: FlowScreen = { id: "login", render: (flow) => <MobileAuth mode="login" onSuccess={() => flow.replace(dashboardScreen)} onSwitch={() => flow.push(signupScreen)} /> };

export default function Prototype() {
  const { screenRef } = useScreenPortal();
  const [theme, setTheme] = useState<Theme>(themeFromUrl);
  const screen = new URLSearchParams(window.location.search).get("screen");
  const initial = screen === "signup" ? signupScreen : screen === "dashboard" || hasToken() ? dashboardScreen : loginScreen;

  useEffect(() => {
    if (screenRef.current) screenRef.current.dataset.theme = theme;
  }, [screenRef, theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme(nextTheme) }}>
      <FlowStack initial={initial} />
    </ThemeContext.Provider>
  );
}

function useMobileViewport() {
  const query = "(max-width: 700px), (max-height: 500px) and (max-width: 950px)";
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isMobile;
}

function TabletInput({ icon, label, ...props }: InputHTMLAttributes<HTMLInputElement> & { icon: ReactNode; label: string }) {
  return <label className="tablet-field"><span>{label}</span><div>{icon}<input {...props} aria-label={label} /></div></label>;
}

function TabletAuth({ mode, setMode, onSuccess }: { mode: AuthMode; setMode: (mode: AuthMode) => void; onSuccess: () => void }) {
  const [studentId, setStudentId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(() => mode === "login" ? loginEmailFromUrl() : "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) {
      setError(mode === "signup" ? "학번은 숫자 5자리, 이메일 형식, 비밀번호 10자리를 확인해 주세요." : "이메일과 비밀번호를 확인해 주세요.");
      return;
    }
    setError("");
    setSubmitting(true);
    const permissionRequest = mode === "login" ? requestLoginNotificationPermission()?.catch(() => null) ?? null : null;
    try {
      if (mode === "signup") {
        const signedIn = await signupOrResume(name.trim(), email.trim(), studentId.trim(), password);
        if (signedIn) {
          onSuccess();
          return;
        }
        openEmailVerificationPage(email.trim());
        return;
      } else {
        await login(email.trim(), password);
      }
      onSuccess();
      if (permissionRequest) void permissionRequest.then((permission) => permission === "granted" ? enableWebPush(registerPushSubscription, permission) : undefined).catch(() => undefined);
    } catch (submitError) {
      if (submitError instanceof RecordsApiError && submitError.code === "EMAIL_NOT_VERIFIED") {
        await openEmailVerificationPageWithFreshCode(email.trim());
        return;
      }
      setError(apiErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className="tablet-auth">
      <section className="tablet-auth-brand"><Brand /><div><p className="section-label">과제 플래너</p><h1>학교의 모든 마감을<br />한 화면에.</h1><p>달력과 D-Day를 함께 보며 오늘 할 일을 가볍게 정리하세요.</p></div><small>Kyelendar · 학생 플래너</small></section>
      <section className="tablet-auth-form">
        <ThemeButton />
        <div className="tablet-form-wrap">
          <p className="section-label">{mode === "login" ? "다시 만나서 반가워요" : "계정 만들기"}</p>
          <h2>{mode === "login" ? "다시 만나서 반가워요." : "학생 정보를 알려주세요."}</h2>
          <p>{mode === "login" ? "이메일로 로그인해 오늘의 과제를 확인하세요." : "학번, 이름, 이메일로 Kyelendar를 시작하세요."}</p>
          <form onSubmit={submit} noValidate>
            {mode === "signup" ? <><TabletInput icon={<IdCardIcon />} label="학번" value={studentId} onChange={(event) => setStudentId(event.target.value)} placeholder="20514" inputMode="numeric" pattern="[0-9]{5}" required /><TabletInput icon={<PersonIcon />} label="이름" value={name} onChange={(event) => setName(event.target.value)} placeholder="이름" required /></> : null}
            <TabletInput icon={<EnvelopeClosedIcon />} label="이메일" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="student@school.kr" required />
            <TabletInput icon={<LockClosedIcon />} label="비밀번호" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="10자 이상" minLength={mode === "signup" ? 10 : undefined} required />
            {mode === "login" ? <button className="auth-text-button" type="button" onClick={() => window.location.assign("/forgot-password")}>비밀번호를 잊으셨나요?</button> : null}
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? "처리 중..." : mode === "login" ? "로그인" : "회원가입 완료"}</button>
          </form>
          <p className="auth-switch">{mode === "login" ? "처음이신가요?" : "이미 계정이 있나요?"}<button onClick={() => setMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "회원가입" : "로그인"}</button></p>
        </div>
      </section>
    </main>
  );
}

function TabletDashboard({ onLogout }: { onLogout: () => void }) {
  const { theme } = useTheme();
  const [view, setView] = useState<"dashboard" | "calendar">("dashboard");
  const online = useOnlineStatus();
  const [tasks, setTasks] = useState(initialTasks);
  const [profile, setProfile] = useState<User | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [calendarSaveOpen, setCalendarSaveOpen] = useState(false);
  const [myPageOpen, setMyPageOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [calendarSaveBusy, setCalendarSaveBusy] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [dueDate, setDueDate] = useState(todayInSeoul);
  const [dueTime, setDueTime] = useState("18:00");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState(0);
  const [analysisWarnings, setAnalysisWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const openPhotoInput = (capture: boolean) => {
    const input = photoInputRef.current;
    if (!input) return;
    if (capture) input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    input.click();
  };
  const calendar = useCalendar(tasks);
  const activeCount = tasks.filter((task) => !task.done).length;
  const progress = taskProgress(tasks);
  const deadline = deadlineSummary(tasks);
  useBottomSheetOverscroll(addOpen || Boolean(editingTask) || calendarSaveOpen || myPageOpen || deleteAccountOpen);

  const saveCalendarImage = async (preset: CalendarImagePreset) => {
    setCalendarSaveBusy(true);
    try {
      await downloadCalendarImage(calendar, tasks, theme, preset);
      setCalendarSaveOpen(false);
    } catch (saveError) {
      setError(apiErrorMessage(saveError));
    } finally {
      setCalendarSaveBusy(false);
    }
  };
  useEffect(() => {
    if (!hasToken()) return;
    const [from, to] = monthRange(calendar.year, calendar.month);
    let mounted = true;
    me()
      .then((user) => { if (mounted) setProfile(user); })
      .catch((loadError) => { if (mounted) setError(apiErrorMessage(loadError)); });
    listAssignments(from, to)
      .then((assignments) => { if (mounted) setTasks(assignments.map(taskFromAssignment)); })
      .catch((loadError) => { if (mounted) setError(apiErrorMessage(loadError)); });
    return () => { mounted = false; };
  }, [calendar.year, calendar.month, online]);

  const applyCandidate = (candidate: Candidate, index: number) => {
    const extractedDueAt = candidateDueAt(candidate);
    setSelectedCandidate(index);
    setTitle(candidate.title || "");
    setSubject(candidate.subject || "");
    setDueDate(extractedDueAt?.date || "");
    if (extractedDueAt) setDueTime(extractedDueAt.time);
  };

  const analyzePhoto = async (selectedFile: File) => {
    setBusy(true);
    setError("");
    try {
      const extraction = await extractAssignment(selectedFile);
      const candidate = extraction.candidates[0];
      if (!candidate) throw new Error("사진에서 과제를 찾지 못했습니다.");
      setCandidates(extraction.candidates);
      setAnalysisWarnings(extraction.warnings);
      applyCandidate(candidate, 0);
    } catch (analysisError) {
      setError(apiErrorMessage(analysisError));
    } finally {
      setBusy(false);
    }
  };

  const addTask = async () => {
    if (!title.trim() || !subject.trim() || !dueDate) return;
    setBusy(true);
    setError("");
    try {
      const created = await createAssignment(title.trim(), subject, dueAt(dueDate, dueTime), notificationsEnabled);
      const createdTask = taskFromAssignment(created);
      setTasks((current) => [...current, createdTask]);
      calendar.selectDate(createdTask.date);
      setTitle("");
      setFile(null);
      setNotificationsEnabled(true);
      setCandidates([]);
      setAnalysisWarnings([]);
      setAddOpen(false);
    } catch (saveError) {
      setError(apiErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  const toggleTask = async (id: string) => {
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) return;
    try {
      const updated = await completeAssignment(id, !task.done);
      setTasks((current) => current.map((candidate) => candidate.id === id ? taskFromAssignment(updated) : candidate));
    } catch (toggleError) {
      setError(apiErrorMessage(toggleError));
    }
  };

  const saveEdit = async () => {
    if (!editingTask?.title.trim() || !editingTask.subject.trim()) return;
    setBusy(true);
    setError("");
    try {
      const updated = await updateAssignment(editingTask.id, editingTask.title.trim(), editingTask.subject.trim(), dueAt(editingTask.date, editingTask.time), editingTask.notificationsEnabled);
      const updatedTask = taskFromAssignment(updated);
      setTasks((current) => current.map((task) => task.id === updated.id ? updatedTask : task));
      calendar.selectDate(updatedTask.date);
      setEditingTask(null);
    } catch (saveError) {
      setError(apiErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };
  const removeTask = async () => {
    if (!editingTask || !window.confirm(`'${editingTask.title}' 과제를 삭제할까요?`)) return;
    setBusy(true); setError("");
    try {
      await deleteAssignment(editingTask.id);
      setTasks((current) => current.filter((task) => task.id !== editingTask.id));
      setEditingTask(null);
    } catch (deleteError) { setError(apiErrorMessage(deleteError)); }
    finally { setBusy(false); }
  };
  return (
    <main className="tablet-dashboard">
      <input ref={photoInputRef} hidden type="file" accept="image/*" onChange={(event) => {
        const selectedFile = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!selectedFile) return;
        setFile(selectedFile);
        setCandidates([]);
        setAnalysisWarnings([]);
        setDueDate(calendar.selectedDate);
        setAddOpen(true);
      }} />
      <aside className="tablet-sidebar">
        <Brand />
        <nav>
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")} aria-current={view === "dashboard" ? "page" : undefined}><DashboardIcon />대시보드</button>
          <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")} aria-current={view === "calendar" ? "page" : undefined}><CalendarIcon />월간 달력</button>
        </nav>
        <div className="student-card"><span>{profile?.studentNumber || "-"}</span><strong>{profile?.name || "사용자"}</strong><small>{profile?.email || "-"}</small></div>
        <button className="tablet-account" onClick={() => setMyPageOpen(true)}><PersonIcon />마이페이지</button>
        <button className="tablet-logout" onClick={onLogout}><ExitIcon />로그아웃</button>
      </aside>
      <section className="tablet-content">
        <header className="tablet-topbar"><div><p className="section-label">{view === "calendar" ? "월간 달력" : todayLabel()}</p><h1>{view === "calendar" ? "이번 달 과제를 한눈에 확인하세요." : "오늘도 하나씩 끝내볼까요?"}</h1></div><div><OfflineBadge online={online} /><NotificationBell /><ThemeButton /><button className="icon-button" onClick={() => setCalendarSaveOpen(true)} aria-label="배경화면으로 저장"><DownloadIcon /></button>{!editingTask && !calendarSaveOpen && !myPageOpen && !deleteAccountOpen ? <button className="tablet-photo" onClick={() => { setDueDate(calendar.selectedDate); setAddOpen(true); }}><PlusIcon />과제 추가</button> : null}</div></header>
        {view === "dashboard" ? (
          <div className="tablet-grid">
            <div className="tablet-left">
              <section className="deadline-card tablet-deadline" aria-label="가장 가까운 마감"><div className="deadline-copy"><p className="section-label"><span /> 다음 마감</p><strong>{deadline?.dday || "-"}</strong><p className="deadline-title">{deadline?.task.title || "마감 예정인 과제가 없어요"}</p><p className="deadline-meta">{deadline?.label || "새 과제를 추가해 보세요."}</p></div><div className="progress-ring" style={{ "--progress": `${progress.percent}%` } as CSSProperties} aria-label={`전체 ${tasks.length}개 중 ${progress.completed}개 완료, 진행 중 ${progress.active}개`}><span>{progress.active}</span><small>진행 중</small></div></section>
              <CalendarPanel calendar={calendar} tasks={tasks} />
            </div>
            <div className="tablet-right">{error ? <p className="auth-error" role="alert">{error}</p> : null}<TaskList tasks={tasks} selectedDate={calendar.selectedDate} onToggle={toggleTask} onEdit={(task) => setEditingTask({ ...task })} /></div>
          </div>
        ) : (
          <div className="tablet-calendar-page">
            <CalendarPanel calendar={calendar} tasks={tasks} expanded />
            <div className="tablet-right">{error ? <p className="auth-error" role="alert">{error}</p> : null}<TaskList tasks={tasks} selectedDate={calendar.selectedDate} onToggle={toggleTask} onEdit={(task) => setEditingTask({ ...task })} /></div>
          </div>
        )}
      </section>
      <AnimatePresence>
        {myPageOpen && profile ? <MyPageModal key="my-page" profile={profile} onClose={() => setMyPageOpen(false)} onProfileUpdated={setProfile} onPasswordChanged={onLogout} onDeleteAccount={() => { setMyPageOpen(false); setDeleteAccountOpen(true); }} /> : null}
        {deleteAccountOpen ? <DeleteAccountModal key="delete-account" onClose={() => setDeleteAccountOpen(false)} onDeleted={onLogout} /> : null}
        {addOpen ? (
          <TabletModal key="add-assignment" label="새 과제 추가">
            <header><div><p className="section-label">빠른 추가</p><h2>새 과제 추가</h2></div><button onClick={() => setAddOpen(false)} aria-label="닫기"><Cross2Icon /></button></header>
            <PhotoPicker file={file} onRequestSelect={() => openPhotoInput(false)} onRequestCamera={() => openPhotoInput(true)} />
            {file ? <button type="button" className="analyze-button" onClick={() => void analyzePhoto(file)} disabled={busy}>{busy ? "분석 중..." : "사진 분석"}</button> : null}
            <AnalysisReview candidates={candidates} selected={selectedCandidate} warnings={analysisWarnings} onSelect={applyCandidate} />
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <label className={`form-field ${candidates[selectedCandidate]?.needsReview.includes("title") ? "review-needed" : ""}`}><span>과제명</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="과제명을 입력하세요" /></label>
            <div className="form-row">
              <label className={`form-field ${candidates[selectedCandidate]?.needsReview.includes("subject") ? "review-needed" : ""}`}><span>과목</span><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="과목 또는 분류를 입력하세요" /></label>
              <label className={`form-field ${candidates[selectedCandidate]?.needsReview.includes("dueAt") ? "review-needed" : ""}`}><span>마감일</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
            </div>
            <label className="form-field"><span>마감 시간</span><input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} /></label>
            <label className="alarm-toggle"><input type="checkbox" checked={notificationsEnabled} onChange={(event) => setNotificationsEnabled(event.target.checked)} /><BellIcon />마감 알림 받기</label>
            <button className="save-button" onClick={() => void addTask()} disabled={!title.trim() || !subject.trim() || !dueDate || busy}>{busy ? "처리 중..." : "과제 저장"}</button>
          </TabletModal>
        ) : null}
        {editingTask ? (
          <TabletModal key={`edit-${editingTask.id}`} label="과제 수정">
            <header><div><p className="section-label">과제 수정</p><h2>과제 수정</h2></div><button onClick={() => setEditingTask(null)} aria-label="닫기"><Cross2Icon /></button></header>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <label className="form-field"><span>과제명</span><input value={editingTask.title} onChange={(event) => setEditingTask((task) => task ? { ...task, title: event.target.value } : task)} /></label>
            <label className="form-field"><span>과목</span><input value={editingTask.subject} onChange={(event) => setEditingTask((task) => task ? { ...task, subject: event.target.value } : task)} /></label>
            <div className="form-row">
              <label className="form-field"><span>마감일</span><input type="date" value={editingTask.date} onChange={(event) => setEditingTask((task) => task ? { ...task, date: event.target.value } : task)} /></label>
              <label className="form-field"><span>마감 시간</span><input type="time" value={editingTask.time} onChange={(event) => setEditingTask((task) => task ? { ...task, time: event.target.value } : task)} /></label>
            </div>
            <label className="alarm-toggle"><input type="checkbox" checked={editingTask.notificationsEnabled} onChange={(event) => setEditingTask((task) => task ? { ...task, notificationsEnabled: event.target.checked } : task)} /><BellIcon />마감 알림 받기</label>
            <button className="save-button" onClick={() => void saveEdit()} disabled={!editingTask.title.trim() || !editingTask.subject.trim() || busy}>{busy ? "처리 중..." : "수정 저장"}</button>
            <button className="assignment-delete-button" type="button" onClick={() => void removeTask()} disabled={busy}>과제 삭제</button>
          </TabletModal>
        ) : null}
        {calendarSaveOpen ? (
          <TabletModal key="calendar-save" label="캘린더 이미지 저장">
            <header><div><p className="section-label">캘린더 저장</p><h2>캘린더 이미지 저장</h2></div><button onClick={() => setCalendarSaveOpen(false)} aria-label="닫기"><Cross2Icon /></button></header>
            <CalendarSaveOptions onSelect={(preset) => void saveCalendarImage(preset)} busy={calendarSaveBusy} />
          </TabletModal>
        ) : null}
      </AnimatePresence>
    </main>
  );
}

function TabletWebPrototype() {
  const params = new URLSearchParams(window.location.search);
  const [theme, setTheme] = useState<Theme>(themeFromUrl);
  const [screen, setScreen] = useState<AuthMode | "dashboard">(() => {
    if (params.get("screen") === "signup") return "signup";
    if (params.get("screen") === "dashboard" || hasToken()) return "dashboard";
    return "login";
  });

  useEffect(() => {
    const redirect = () => setScreen("login");
    window.addEventListener(AUTH_EXPIRED_EVENT, redirect);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, redirect);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme(nextTheme) }}>
      <div className={`tablet-app theme-${theme}`}>
        {screen === "dashboard" ? <TabletDashboard onLogout={() => { clearToken(); setScreen("login"); }} /> : <TabletAuth mode={screen} setMode={setScreen} onSuccess={() => setScreen("dashboard")} />}
      </div>
    </ThemeContext.Provider>
  );
}

export function WebPrototype() {
  const isMobile = useMobileViewport();
  if (window.location.pathname === "/check-email") return <VerificationPendingPage />;
  if (window.location.pathname === "/forgot-password") return <AuthLinkPage kind="forgot" />;
  if (window.location.pathname === "/reset-password") return <AuthLinkPage kind="reset" />;
  const app = isMobile
    ? <MobileRuntime><Prototype /></MobileRuntime>
    : <TabletWebPrototype />;
  if (isMobile) {
    return <><PwaInstallPrompt />{app}</>;
  }
  return <><PwaInstallPrompt />{app}</>;
}
