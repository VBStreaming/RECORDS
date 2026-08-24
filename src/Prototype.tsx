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
  completeAssignment,
  createAssignment,
  extractAssignment,
  hasToken,
  listAssignments,
  listNotifications,
  login,
  markAllNotificationsRead,
  markNotificationRead,
  me,
  RecordsApiError,
  signup,
  getNotificationPreferences,
  unreadNotificationCount,
  updateNotificationPreferences,
  updateAssignment,
  AUTH_EXPIRED_EVENT,
  CONNECTION_STATUS_EVENT,
  type Assignment,
  type AppNotification,
  type NotificationPreferences,
  type User,
} from "./recordsApi";

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

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function taskFromAssignment(assignment: Assignment): Task {
  const dueAt = new Date(assignment.dueAt);
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(dueAt);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(dueAt);
  return { id: assignment.id, title: assignment.title, subject: assignment.subject, date, time, done: assignment.completed, color: colors[assignment.subject] || "#7c8cff" };
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
  palette: { ink: string; muted: string; card: string; line: string; accent: string; selectedInk: string },
) {
  ctx.fillStyle = palette.card;
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 28);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = palette.muted;
  ctx.font = "700 18px Roboto, system-ui, sans-serif";
  ctx.fillText("MONTHLY", x + 34, y + 48);
  ctx.fillStyle = palette.ink;
  ctx.font = "900 36px Roboto, system-ui, sans-serif";
  ctx.fillText(`${calendar.year}. ${String(calendar.month + 1).padStart(2, "0")}`, x + 34, y + 92);

  const gridX = x + 28;
  const gridY = y + 142;
  const gridWidth = width - 56;
  const columnWidth = gridWidth / 7;
  const rows = Math.ceil(calendar.cells.length / 7);
  const rowHeight = (height - 170) / rows;
  ctx.fillStyle = palette.muted;
  ctx.font = "700 16px Roboto, system-ui, sans-serif";
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
    if (selected) {
      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.arc(centerX, dateY - 7, 27, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = selected ? palette.selectedInk : palette.ink;
    ctx.font = `${selected ? "900" : "500"} 19px Roboto, system-ui, sans-serif`;
    ctx.fillText(String(day), centerX, dateY);
    dateTasks.slice(0, 2).forEach((task, taskIndex) => {
      const taskY = cellTop + 50 + taskIndex * 24;
      ctx.fillStyle = task.done ? palette.muted : task.color;
      ctx.font = "700 10px Roboto, system-ui, sans-serif";
      canvasText(ctx, task.subject, centerX, taskY, columnWidth - 8);
      ctx.fillStyle = palette.muted;
      ctx.font = "500 9px Roboto, system-ui, sans-serif";
      canvasText(ctx, task.time, centerX, taskY + 12, columnWidth - 8);
    });
    if (dateTasks.length > 2) {
      ctx.fillStyle = palette.muted;
      ctx.font = "500 8px Roboto, system-ui, sans-serif";
      canvasText(ctx, `+${dateTasks.length - 2}`, centerX, cellTop + rowHeight - 7, columnWidth - 8);
    }
  });
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
    ? { background: "#0f1113", ink: "#f6f4ef", muted: "#898d90", card: "#17191b", line: "#2a2d30", accent: "#ff7a45", selectedInk: "#17191b" }
    : { background: "#f4f1eb", ink: "#1b1d1f", muted: "#74787a", card: "#fffefa", line: "#ddd8cf", accent: "#f56f3d", selectedInk: "#fffefa" };
  const landscape = preset.width > preset.height;
  const designWidth = landscape ? 1600 : 1000;
  const scale = preset.width / designWidth;
  const designHeight = preset.height / scale;
  ctx.scale(scale, scale);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, designWidth, designHeight);

  ctx.fillStyle = palette.muted;
  ctx.font = "700 16px Roboto, system-ui, sans-serif";
  ctx.fillText("ASSIGNMENT PLANNER", 56, 58);
  ctx.fillStyle = palette.ink;
  ctx.font = "900 42px Roboto, system-ui, sans-serif";
  ctx.fillText("RECORDS.", 56, 108);

  const cardX = landscape ? 56 : 48;
  const cardY = 148;
  const cardWidth = landscape ? designWidth - 112 : 904;
  const cardHeight = landscape ? 730 : Math.min(960, designHeight - 250);
  drawCalendarCard(ctx, calendar, tasks, cardX, cardY, cardWidth, cardHeight, palette);

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("이미지를 저장할 수 없습니다.")), "image/png"));
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `records-calendar-${calendar.year}-${String(calendar.month + 1).padStart(2, "0")}-${preset.id}.png`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function CalendarSaveOptions({ onSelect, busy }: { onSelect: (preset: CalendarImagePreset) => void; busy: boolean }) {
  return (
    <div className="calendar-save-options">
      <p>저장할 배경화면 비율을 선택하세요.</p>
      <div className="calendar-save-grid">
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
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase().replace(", ", " · ");
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
      <div><strong>RECORDS를 앱처럼 사용하세요</strong><span>홈 화면에 설치하면 더 빠르게 열 수 있어요.</span></div>
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
      if (loaded.current && window.isSecureContext && "Notification" in window && window.Notification.permission === "granted") {
        nextItems.filter((item) => !item.readAt && !seen.current.has(item.id)).forEach((item) => {
          new window.Notification(item.title, { body: item.message });
        });
      }
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
    const timer = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
    };
  }, [refresh]);

  const enableBrowserNotifications = async () => {
    if (!("Notification" in window) || !window.isSecureContext) return;
    setPermission(await window.Notification.requestPermission());
  };

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
      <button className="icon-button notification-button" onClick={() => setOpen((current) => !current)} aria-label="알림" aria-expanded={open}>
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
          <header><div><p className="section-label">NOTIFICATIONS</p><h2>알림</h2></div><button onClick={() => void markAllNotificationsRead().then(refresh)}>모두 읽음</button></header>
          <div className="notification-preferences">
            <strong>마감 전 알림</strong>
            <select aria-label="마감 전 알림" value={preference} onChange={(event) => void changePreference(event.target.value)}>
              <option value="60">1시간 전</option>
              <option value="30">30분 전</option>
              <option value="10">10분 전</option>
            </select>
            <small>D-1 오전 7시와 D-Day 오전 7시 30분 알림은 항상 켜져 있어요.</small>
          </div>
          {permission === "default" ? <button className="browser-notification-button" onClick={() => void enableBrowserNotifications()}>브라우저 알림 허용</button> : null}
          {permission === "unsupported" && !window.isSecureContext ? <p className="notification-hint">기기 알림은 HTTPS 접속에서 사용할 수 있어요.</p> : null}
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
  return <div className="brand">RECORDS<span>.</span></div>;
}

function TabletModal({ label, children }: { label: string; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const duration = reduceMotion ? 0.01 : 0.2;
  return (
    <motion.div className="tablet-modal-overlay" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration }}>
      <motion.section
        className="tablet-modal"
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

function AuthField({ icon, label, ...props }: InputHTMLAttributes<HTMLInputElement> & { icon: ReactNode; label: string }) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <div>{icon}<input {...props} aria-label={label} /></div>
    </label>
  );
}

function MobileAuth({ mode, onSuccess, onSwitch }: { mode: AuthMode; onSuccess: () => void; onSwitch: () => void }) {
  useAuthExpiredRedirect();
  const { theme } = useTheme();
  const [studentId, setStudentId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
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
    setSubmitting(true);
    try {
      if (mode === "signup") await signup(name.trim(), email.trim(), studentId.trim(), password);
      else await login(email.trim(), password);
      onSuccess();
    } catch (submitError) {
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
          <p className="section-label">FOR YOUR SCHOOL DAYS</p>
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
              <input aria-label="비밀번호" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8자 이상 입력해 주세요" />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((current) => !current)} aria-label="비밀번호 표시 전환">
                {showPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
              </button>
            </div>
          </label>
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
  return (
    <section className={`calendar-card ${expanded ? "expanded" : ""}`}>
      <div className="calendar-header">
        <div><p className="section-label">MONTHLY</p><h2>{year}. {String(month + 1).padStart(2, "0")}</h2></div>
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
          return (
            <button
              className={`day ${hasTask ? "has-task" : ""} ${selected ? "selected" : ""}`}
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
        <div><p className="section-label">SELECTED DAY</p><h2>{Number(selectedDate.slice(5, 7))}월 {Number(selectedDate.slice(8))}일의 과제</h2></div>
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

function PhotoPicker({ file, capture, onSelect }: { file: File | null; capture?: "environment"; onSelect: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="photo-field">
      <button type="button" className="photo-picker-trigger" onClick={() => inputRef.current?.click()}>
        <ImageIcon />
        <span>{file?.name || "칠판 또는 유인물 사진 선택"}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        {...(capture ? { capture } : {})}
        onChange={(event) => {
          const selectedFile = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (selectedFile) onSelect(selectedFile);
        }}
      />
    </div>
  );
}

function useAuthExpiredRedirect() {
  const flow = useFlow();
  useEffect(() => {
    const redirect = () => flow.replace(loginScreen);
    window.addEventListener(AUTH_EXPIRED_EVENT, redirect);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, redirect);
  }, [flow]);
}

function MobileDashboard({ onLogout }: { onLogout: () => void }) {
  const { theme } = useTheme();
  const online = useOnlineStatus();
  useAuthExpiredRedirect();
  const { screenRef } = useScreenPortal();
  const [portalReady, setPortalReady] = useState(false);
  const [tasks, setTasks] = useState(initialTasks);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [calendarSaveOpen, setCalendarSaveOpen] = useState(false);
  const [calendarSaveBusy, setCalendarSaveBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [dueTime, setDueTime] = useState("18:00");
  const [file, setFile] = useState<File | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const calendar = useCalendar(tasks);
  const activeCount = tasks.filter((task) => !task.done).length;
  const progress = taskProgress(tasks);
  const deadline = deadlineSummary(tasks);

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
    me().catch((loadError) => { if (mounted) setError(apiErrorMessage(loadError)); });
    listAssignments(from, to)
      .then((assignments) => { if (mounted) setTasks(assignments.map(taskFromAssignment)); })
      .catch((loadError) => { if (mounted) setError(apiErrorMessage(loadError)); });
    return () => { mounted = false; };
  }, [calendar.year, calendar.month, online]);

  const analyzePhoto = async (selectedFile: File) => {
    setFile(selectedFile);
    setBusy(true);
    setError("");
    try {
      const extraction = await extractAssignment(selectedFile);
      const candidate = extraction.candidates[0];
      if (!candidate) throw new Error("사진에서 과제를 찾지 못했습니다.");
      setTitle(candidate.title || "");
      if (candidate.subject) setSubject(candidate.subject);
      if (candidate.dueAt) {
        const date = new Date(candidate.dueAt);
        setDueTime(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(date));
        calendar.selectDate(new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date));
      }
    } catch (analysisError) {
      setError(apiErrorMessage(analysisError));
    } finally {
      setBusy(false);
    }
  };

  const addTask = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = await createAssignment(title.trim(), subject, dueAt(calendar.selectedDate, dueTime));
      const createdTask = taskFromAssignment(created);
      setTasks((current) => [...current, createdTask]);
      calendar.selectDate(createdTask.date);
      setTitle("");
      setFile(null);
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
      const updated = await updateAssignment(editingTask.id, editingTask.title.trim(), editingTask.subject.trim(), dueAt(editingTask.date, editingTask.time));
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

  return (
    <>
      <MobileScroll className={`app-screen theme-${theme}`}>
        <main className="records" aria-label="과제 디데이 대시보드">
          <header className="topbar">
            <div><p className="eyebrow">ASSIGNMENT PLANNER</p><Brand /></div>
            <div className="topbar-actions"><NotificationBell /><ThemeButton /><button className="icon-button" onClick={() => setCalendarSaveOpen(true)} aria-label="배경화면으로 저장"><DownloadIcon /></button><button className="icon-button" onClick={onLogout} aria-label="로그아웃"><ExitIcon /></button></div>
          </header>
          <OfflineBadge online={online} />
          <section className="deadline-card" aria-label="가장 가까운 마감">
            <div className="deadline-copy"><p className="section-label"><span /> NEXT DEADLINE</p><strong>{deadline?.dday || "-"}</strong><p className="deadline-title">{deadline?.task.title || "마감 예정인 과제가 없어요"}</p><p className="deadline-meta">{deadline?.label || "새 과제를 추가해 보세요."}</p></div>
            <div className="progress-ring" style={{ "--progress": `${progress.percent}%` } as CSSProperties} aria-label={`전체 ${tasks.length}개 중 ${progress.completed}개 완료, 진행 중 ${progress.active}개`}><span>{progress.active}</span><small>진행 중</small></div>
          </section>
          <CalendarPanel calendar={calendar} tasks={tasks} />
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <TaskList tasks={tasks} selectedDate={calendar.selectedDate} onToggle={toggleTask} onEdit={(task) => setEditingTask({ ...task })} />
          <div className="bottom-spacer" />
        </main>
      </MobileScroll>
      {portalReady && screenRef.current ? createPortal(
        <nav className="action-bar" aria-label="과제 추가">
          <button className="photo-button" onClick={() => setSheetOpen(true)}><CameraIcon /> 사진으로 추가</button>
          <button className="plus-button" onClick={() => setSheetOpen(true)} aria-label="직접 과제 추가"><PlusIcon /></button>
        </nav>, screenRef.current,
      ) : null}
      <BottomSheet open={sheetOpen} onOpenChange={setSheetOpen} title="새 과제 추가" description="사진 한 장과 필수 정보만 빠르게 기록해요." snap={0.86}>
        <div className="add-form">
          <PhotoPicker file={file} capture="environment" onSelect={(selectedFile) => void analyzePhoto(selectedFile)} />
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <label className="form-field"><span>과제명</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="과제명을 입력하세요" /></label>
          <div className="form-row">
            <label className="form-field"><span>과목</span><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="과목 또는 분류를 입력하세요" /></label>
            <label className="form-field"><span>마감일</span><input type="date" value={calendar.selectedDate} onChange={(event) => calendar.selectDate(event.target.value)} /></label>
          </div>
          <label className="form-field"><span>마감 시간</span><input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} /></label>
          <button className="save-button" onClick={() => void addTask()} disabled={!title.trim() || !subject.trim() || busy}>{busy ? "처리 중..." : "과제 저장"}</button>
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
            <button className="save-button" onClick={() => void saveEdit()} disabled={!editingTask.title.trim() || !editingTask.subject.trim() || busy}>{busy ? "처리 중..." : "수정 저장"}</button>
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
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 700px)").matches);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
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
  const [email, setEmail] = useState("");
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
    try {
      if (mode === "signup") await signup(name.trim(), email.trim(), studentId.trim(), password);
      else await login(email.trim(), password);
      onSuccess();
    } catch (submitError) {
      setError(apiErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className="tablet-auth">
      <section className="tablet-auth-brand"><Brand /><div><p className="section-label">ASSIGNMENT PLANNER</p><h1>학교의 모든 마감을<br />한 화면에.</h1><p>달력과 D-Day를 함께 보며 오늘 할 일을 가볍게 정리하세요.</p></div><small>RECORDS · STUDENT PLANNER</small></section>
      <section className="tablet-auth-form">
        <ThemeButton />
        <div className="tablet-form-wrap">
          <p className="section-label">{mode === "login" ? "WELCOME BACK" : "CREATE ACCOUNT"}</p>
          <h2>{mode === "login" ? "다시 만나서 반가워요." : "학생 정보를 알려주세요."}</h2>
          <p>{mode === "login" ? "이메일로 로그인해 오늘의 과제를 확인하세요." : "학번, 이름, 이메일로 RECORDS를 시작하세요."}</p>
          <form onSubmit={submit} noValidate>
            {mode === "signup" ? <><TabletInput icon={<IdCardIcon />} label="학번" value={studentId} onChange={(event) => setStudentId(event.target.value)} placeholder="20514" inputMode="numeric" pattern="[0-9]{5}" required /><TabletInput icon={<PersonIcon />} label="이름" value={name} onChange={(event) => setName(event.target.value)} placeholder="이름" required /></> : null}
            <TabletInput icon={<EnvelopeClosedIcon />} label="이메일" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="student@school.kr" required />
            <TabletInput icon={<LockClosedIcon />} label="비밀번호" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8자 이상" minLength={mode === "signup" ? 10 : undefined} required />
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
  const [calendarSaveBusy, setCalendarSaveBusy] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [dueTime, setDueTime] = useState("18:00");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const calendar = useCalendar(tasks);
  const activeCount = tasks.filter((task) => !task.done).length;
  const progress = taskProgress(tasks);
  const deadline = deadlineSummary(tasks);

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

  const analyzePhoto = async (selectedFile: File) => {
    setFile(selectedFile);
    setBusy(true);
    setError("");
    try {
      const extraction = await extractAssignment(selectedFile);
      const candidate = extraction.candidates[0];
      if (!candidate) throw new Error("사진에서 과제를 찾지 못했습니다.");
      setTitle(candidate.title || "");
      if (candidate.subject) setSubject(candidate.subject);
      if (candidate.dueAt) {
        const date = new Date(candidate.dueAt);
        setDueTime(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(date));
        calendar.selectDate(new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date));
      }
    } catch (analysisError) {
      setError(apiErrorMessage(analysisError));
    } finally {
      setBusy(false);
    }
  };

  const addTask = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = await createAssignment(title.trim(), subject, dueAt(calendar.selectedDate, dueTime));
      const createdTask = taskFromAssignment(created);
      setTasks((current) => [...current, createdTask]);
      calendar.selectDate(createdTask.date);
      setTitle("");
      setFile(null);
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
      const updated = await updateAssignment(editingTask.id, editingTask.title.trim(), editingTask.subject.trim(), dueAt(editingTask.date, editingTask.time));
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
  return (
    <main className="tablet-dashboard">
      <aside className="tablet-sidebar">
        <Brand />
        <nav>
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")} aria-current={view === "dashboard" ? "page" : undefined}><DashboardIcon />대시보드</button>
          <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")} aria-current={view === "calendar" ? "page" : undefined}><CalendarIcon />월간 달력</button>
          <button><CameraIcon />사진 보관함</button>
        </nav>
        <div className="student-card"><span>{profile?.studentNumber || "-"}</span><strong>{profile?.name || "사용자"}</strong><small>{profile?.email || "-"}</small></div>
        <button className="tablet-logout" onClick={onLogout}><ExitIcon />로그아웃</button>
      </aside>
      <section className="tablet-content">
        <header className="tablet-topbar"><div><p className="section-label">{view === "calendar" ? "MONTHLY CALENDAR" : todayLabel()}</p><h1>{view === "calendar" ? "이번 달 과제를 한눈에 확인하세요." : "오늘도 하나씩 끝내볼까요?"}</h1></div><div><OfflineBadge online={online} /><NotificationBell /><ThemeButton /><button className="icon-button" onClick={() => setCalendarSaveOpen(true)} aria-label="배경화면으로 저장"><DownloadIcon /></button><button className="tablet-photo" onClick={() => setAddOpen(true)}><CameraIcon />사진으로 추가</button></div></header>
        {view === "dashboard" ? (
          <div className="tablet-grid">
            <div className="tablet-left">
              <section className="deadline-card tablet-deadline" aria-label="가장 가까운 마감"><div className="deadline-copy"><p className="section-label"><span /> NEXT DEADLINE</p><strong>{deadline?.dday || "-"}</strong><p className="deadline-title">{deadline?.task.title || "마감 예정인 과제가 없어요"}</p><p className="deadline-meta">{deadline?.label || "새 과제를 추가해 보세요."}</p></div><div className="progress-ring" style={{ "--progress": `${progress.percent}%` } as CSSProperties} aria-label={`전체 ${tasks.length}개 중 ${progress.completed}개 완료, 진행 중 ${progress.active}개`}><span>{progress.active}</span><small>진행 중</small></div></section>
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
        {addOpen ? (
          <TabletModal key="add-assignment" label="새 과제 추가">
            <header><div><p className="section-label">QUICK ADD</p><h2>새 과제 추가</h2></div><button onClick={() => setAddOpen(false)} aria-label="닫기"><Cross2Icon /></button></header>
            <PhotoPicker file={file} onSelect={(selectedFile) => void analyzePhoto(selectedFile)} />
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <label className="form-field"><span>과제명</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="과제명을 입력하세요" /></label>
            <div className="form-row">
              <label className="form-field"><span>과목</span><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="과목 또는 분류를 입력하세요" /></label>
              <label className="form-field"><span>마감일</span><input type="date" value={calendar.selectedDate} onChange={(event) => calendar.selectDate(event.target.value)} /></label>
            </div>
            <label className="form-field"><span>마감 시간</span><input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} /></label>
            <button className="save-button" onClick={() => void addTask()} disabled={!title.trim() || !subject.trim() || busy}>{busy ? "처리 중..." : "과제 저장"}</button>
          </TabletModal>
        ) : null}
        {editingTask ? (
          <TabletModal key={`edit-${editingTask.id}`} label="과제 수정">
            <header><div><p className="section-label">EDIT TASK</p><h2>과제 수정</h2></div><button onClick={() => setEditingTask(null)} aria-label="닫기"><Cross2Icon /></button></header>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <label className="form-field"><span>과제명</span><input value={editingTask.title} onChange={(event) => setEditingTask((task) => task ? { ...task, title: event.target.value } : task)} /></label>
            <label className="form-field"><span>과목</span><input value={editingTask.subject} onChange={(event) => setEditingTask((task) => task ? { ...task, subject: event.target.value } : task)} /></label>
            <div className="form-row">
              <label className="form-field"><span>마감일</span><input type="date" value={editingTask.date} onChange={(event) => setEditingTask((task) => task ? { ...task, date: event.target.value } : task)} /></label>
              <label className="form-field"><span>마감 시간</span><input type="time" value={editingTask.time} onChange={(event) => setEditingTask((task) => task ? { ...task, time: event.target.value } : task)} /></label>
            </div>
            <button className="save-button" onClick={() => void saveEdit()} disabled={!editingTask.title.trim() || !editingTask.subject.trim() || busy}>{busy ? "처리 중..." : "수정 저장"}</button>
          </TabletModal>
        ) : null}
        {calendarSaveOpen ? (
          <TabletModal key="calendar-save" label="캘린더 이미지 저장">
            <header><div><p className="section-label">SAVE CALENDAR</p><h2>캘린더 이미지 저장</h2></div><button onClick={() => setCalendarSaveOpen(false)} aria-label="닫기"><Cross2Icon /></button></header>
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
  const app = isMobile
    ? <MobileRuntime><Prototype /></MobileRuntime>
    : <TabletWebPrototype />;
  if (isMobile) {
    return <><PwaInstallPrompt />{app}</>;
  }
  return <><PwaInstallPrompt />{app}</>;
}
