import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarIcon,
  CameraIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  Cross2Icon,
  DashboardIcon,
  ExitIcon,
  ImageIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
} from "@radix-ui/react-icons";

import {
  api,
  getToken,
  RecordsApiError,
  setToken,
  type Assignment,
  type AssignmentCandidate,
  type Dashboard,
  type SubjectCode,
  type User,
} from "./api";

type Theme = "light" | "dark";
type AuthMode = "login" | "signup";

const subjects: Record<SubjectCode, { label: string; color: string }> = {
  KOREAN: { label: "국어", color: "#e4b94c" },
  ENGLISH: { label: "영어", color: "#7385e8" },
  MATH: { label: "수학", color: "#ed7548" },
  SOCIAL_STUDIES: { label: "사회", color: "#bc78d5" },
  SCIENCE: { label: "과학", color: "#45aa8d" },
  HISTORY: { label: "역사", color: "#a574d0" },
  ETC: { label: "기타", color: "#8d918f" },
};

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function koreaDateTime(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

function displayDate(iso: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function monthRange(cursor: Date) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  return {
    from: dateKey(year, month, 1),
    to: dateKey(year, month, new Date(year, month + 1, 0).getDate()),
  };
}

function Brand() {
  return (
    <div className="brand" aria-label="RECORDS">
      RECORDS<span>.</span>
    </div>
  );
}

function ThemeButton({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button className="icon-button" onClick={onToggle} aria-label="테마 전환">
      {theme === "light" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function AuthScreen({ theme, onTheme }: { theme: Theme; onTheme: () => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [studentNumber, setStudentNumber] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "signup") {
        await api.signup({ name, email, studentNumber, password });
      }
      await api.login(email, password);
      window.dispatchEvent(new Event("records-authenticated"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Brand />
        <div className="auth-message">
          <p className="eyebrow">ASSIGNMENT PLANNER</p>
          <h1>학교의 모든 마감을<br />한 화면에.</h1>
          <p>달력과 D-Day를 함께 보며 오늘 할 일을 가볍게 정리하세요.</p>
        </div>
        <small>RECORDS · STUDENT PLANNER</small>
      </section>
      <section className="auth-form-panel">
        <ThemeButton theme={theme} onToggle={onTheme} />
        <div className="auth-form-wrap">
          <p className="eyebrow">{mode === "login" ? "WELCOME BACK" : "CREATE ACCOUNT"}</p>
          <h2>{mode === "login" ? "다시 만나서 반가워요." : "학생 정보를 알려주세요."}</h2>
          <p>{mode === "login" ? "이메일로 로그인해 오늘의 과제를 확인하세요." : "기본 정보만 입력하면 바로 시작할 수 있어요."}</p>
          <form onSubmit={submit}>
            {mode === "signup" && (
              <div className="field-row">
                <label><span>학번</span><input value={studentNumber} onChange={(event) => setStudentNumber(event.target.value)} placeholder="20514" inputMode="numeric" required pattern="[0-9]{5}" /></label>
                <label><span>이름</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="이름" required /></label>
              </div>
            )}
            <label><span>이메일</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="student@school.kr" required /></label>
            <label><span>비밀번호</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="10자 이상" minLength={10} required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" disabled={submitting}>{submitting ? "처리 중..." : mode === "login" ? "로그인" : "회원가입 완료"}</button>
          </form>
          <p className="auth-switch">
            {mode === "login" ? "처음이신가요?" : "이미 계정이 있나요?"}
            <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>
              {mode === "login" ? "회원가입" : "로그인"}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}

function CalendarPanel({ cursor, selectedDate, assignments, onSelect, onMonth }: {
  cursor: Date;
  selectedDate: string;
  assignments: Assignment[];
  onSelect: (date: string) => void;
  onMonth: (delta: number) => void;
}) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
  const assignmentDates = new Set(assignments.map((item) => koreaDateTime(item.dueAt).date));

  return (
    <section className="panel calendar-panel">
      <header className="panel-heading">
        <div><p className="eyebrow">MONTHLY</p><h2>{year}. {String(month + 1).padStart(2, "0")}</h2></div>
        <div className="month-buttons">
          <button onClick={() => onMonth(-1)} aria-label="이전 달"><ChevronLeftIcon /></button>
          <button onClick={() => onMonth(1)} aria-label="다음 달"><ChevronRightIcon /></button>
        </div>
      </header>
      <div className="weekdays">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">
        {cells.map((day, index) => day === null ? <span key={`empty-${index}`} /> : (() => {
          const value = dateKey(year, month, day);
          const hasTask = assignmentDates.has(value);
          return (
            <button key={value} className={`${selectedDate === value ? "selected" : ""} ${hasTask ? "has-task" : ""}`} onClick={() => onSelect(value)}>
              {day}{hasTask && <i />}
            </button>
          );
        })())}
      </div>
    </section>
  );
}

function TaskList({ date, assignments, onToggle }: {
  date: string;
  assignments: Assignment[];
  onToggle: (assignment: Assignment) => void;
}) {
  const selected = assignments.filter((item) => koreaDateTime(item.dueAt).date === date);
  const label = `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일의 과제`;
  return (
    <section className="panel task-panel">
      <header className="panel-heading">
        <div><p className="eyebrow">SELECTED DAY</p><h2>{label}</h2></div>
        <span className="count-badge">{selected.length}</span>
      </header>
      <div className="task-list">
        {selected.length === 0 ? (
          <div className="empty-state"><CalendarIcon /><p>등록된 과제가 없어요.</p></div>
        ) : selected.map((assignment) => {
          const subject = subjects[assignment.subject];
          return (
            <article key={assignment.id} className={`task-card ${assignment.completed ? "done" : ""}`} style={{ "--task-color": subject.color } as React.CSSProperties}>
              <button className="task-check" onClick={() => onToggle(assignment)} aria-label={`${assignment.title} ${assignment.completed ? "완료 취소" : "완료"}`}>
                {assignment.completed && <CheckIcon />}
              </button>
              <div><span>{subject.label}</span><h3>{assignment.title}</h3><p><ClockIcon />{displayDate(assignment.dueAt)}</p></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AddAssignmentDialog({ defaultDate, photoFirst, onClose, onCreated }: {
  defaultDate: string;
  photoFirst: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<SubjectCode>("MATH");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("23:59");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<AssignmentCandidate[]>([]);
  const [message, setMessage] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const chooseFile = (selected: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(selected);
    setPreview(selected ? URL.createObjectURL(selected) : null);
    setCandidates([]);
    setMessage("");
  };

  const applyCandidate = (candidate: AssignmentCandidate) => {
    if (candidate.title) setTitle(candidate.title);
    if (candidate.subject) setSubject(candidate.subject);
    if (candidate.dueAt) {
      const extracted = koreaDateTime(candidate.dueAt);
      setDate(extracted.date);
      setTime(extracted.time);
    }
    setMessage(candidate.needsReview.length ? "표시된 내용을 확인한 뒤 저장해 주세요." : "사진에서 과제 정보를 채웠습니다.");
  };

  const analyze = async () => {
    if (!file) return;
    setAnalyzing(true);
    setMessage("");
    try {
      const result = await api.extract(file);
      setCandidates(result.candidates);
      if (result.candidates[0]) applyCandidate(result.candidates[0]);
      else setMessage("사진에서 과제를 찾지 못했습니다. 직접 입력해 주세요.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "사진을 분석하지 못했습니다.");
    } finally {
      setAnalyzing(false);
    }
  };

  const save = async () => {
    if (!title.trim() || !date || !time) return;
    setSaving(true);
    setMessage("");
    try {
      await api.createAssignment({ title: title.trim(), subject, dueAt: `${date}T${time}:00+09:00` });
      onCreated();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "과제를 저장하지 못했습니다.");
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <header><div><p className="eyebrow">QUICK ADD</p><h2 id="add-title">새 과제 추가</h2></div><button className="dialog-close" onClick={onClose} aria-label="닫기"><Cross2Icon /></button></header>
        <label className={`photo-drop ${preview ? "has-preview" : ""}`}>
          {preview ? <img src={preview} alt="선택한 과제 사진 미리보기" /> : <><ImageIcon /><strong>{photoFirst ? "칠판 또는 유인물 사진 선택" : "사진을 첨부해 자동으로 입력"}</strong><span>JPEG · PNG · WebP, 최대 5MB</span></>}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseFile(event.target.files?.[0] || null)} />
        </label>
        {file && <button className="analyze-button" onClick={analyze} disabled={analyzing}>{analyzing ? "사진 분석 중..." : <><CameraIcon />사진에서 과제 찾기</>}</button>}
        {candidates.length > 1 && <div className="candidate-list">{candidates.map((candidate, index) => <button key={`${candidate.title}-${index}`} onClick={() => applyCandidate(candidate)}>{candidate.title || `후보 ${index + 1}`}</button>)}</div>}
        <label className="form-field"><span>과제명</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 수학 프린트 3장" maxLength={100} /></label>
        <div className="field-row">
          <label className="form-field"><span>과목</span><select value={subject} onChange={(event) => setSubject(event.target.value as SubjectCode)}>{Object.entries(subjects).map(([code, info]) => <option key={code} value={code}>{info.label}</option>)}</select></label>
          <label className="form-field"><span>마감일</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="form-field compact"><span>시간</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
        </div>
        {message && <p className="dialog-message" role="status">{message}</p>}
        <button className="primary-button" onClick={save} disabled={saving || !title.trim()}>{saving ? "저장 중..." : "과제 저장"}</button>
      </section>
    </div>
  );
}

function DashboardScreen({ user, theme, onTheme, onLogout }: {
  user: User;
  theme: Theme;
  onTheme: () => void;
  onLogout: () => void;
}) {
  const now = new Date();
  const [cursor, setCursor] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(dateKey(now.getFullYear(), now.getMonth(), now.getDate()));
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>({ activeCount: 0, nearestAssignment: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"manual" | "photo" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const range = monthRange(cursor);
    try {
      const [nextDashboard, nextAssignments] = await Promise.all([api.dashboard(), api.assignments(range.from, range.to)]);
      setDashboard(nextDashboard);
      setAssignments(nextAssignments);
    } catch (caught) {
      if (caught instanceof RecordsApiError && caught.status === 401) onLogout();
      else setError(caught instanceof Error ? caught.message : "과제를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [cursor, onLogout]);

  useEffect(() => { void load(); }, [load]);

  const changeMonth = (delta: number) => {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
    setCursor(next);
    setSelectedDate(dateKey(next.getFullYear(), next.getMonth(), 1));
  };

  const toggle = async (assignment: Assignment) => {
    try {
      await api.setCompletion(assignment.id, !assignment.completed);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "완료 상태를 바꾸지 못했습니다.");
    }
  };

  const nearest = dashboard.nearestAssignment;
  return (
    <main className="workspace">
      <aside className="sidebar">
        <Brand />
        <nav><button className="active"><DashboardIcon />대시보드</button><button><CalendarIcon />월간 달력</button><button onClick={() => setDialog("photo")}><CameraIcon />사진으로 추가</button></nav>
        <div className="sidebar-bottom"><div className="student-card"><span>{user.studentNumber}</span><strong>{user.name}</strong><small>{user.email}</small></div><button className="logout-button" onClick={onLogout}><ExitIcon />로그아웃</button></div>
      </aside>
      <section className="content">
        <header className="content-header">
          <div><p className="eyebrow">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "2-digit" }).format(now).toUpperCase()}</p><h1>오늘도 하나씩 끝내볼까요?</h1></div>
          <div><ThemeButton theme={theme} onToggle={onTheme} /><button className="photo-button" onClick={() => setDialog("photo")}><CameraIcon />사진으로 추가</button><button className="add-button" onClick={() => setDialog("manual")}><PlusIcon />직접 추가</button></div>
        </header>
        {error && <div className="page-error" role="alert">{error}<button onClick={() => void load()}>다시 시도</button></div>}
        <div className={`dashboard-grid ${loading ? "is-loading" : ""}`}>
          <div className="left-column">
            <section className="panel deadline-panel">
              <div><p className="eyebrow accent-dot">NEXT DEADLINE</p><strong className="dday">{nearest?.deadlineLabel || "—"}</strong><h2>{nearest?.title || "등록된 과제가 없어요"}</h2><p>{nearest ? displayDate(nearest.dueAt) : "새 과제를 추가해 일정을 시작해 보세요."}</p></div>
              <div className="progress-ring"><strong>{dashboard.activeCount}</strong><span>진행 중</span></div>
            </section>
            <CalendarPanel cursor={cursor} selectedDate={selectedDate} assignments={assignments} onSelect={setSelectedDate} onMonth={changeMonth} />
          </div>
          <TaskList date={selectedDate} assignments={assignments} onToggle={toggle} />
        </div>
      </section>
      <button className="mobile-add" onClick={() => setDialog("photo")}><CameraIcon />사진으로 추가</button>
      {dialog && <AddAssignmentDialog defaultDate={selectedDate} photoFirst={dialog === "photo"} onClose={() => setDialog(null)} onCreated={() => { setDialog(null); void load(); }} />}
    </main>
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem("records-theme") === "dark" ? "dark" : "light");
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(Boolean(getToken()));

  const logout = useCallback(() => { setToken(null); setUser(null); setChecking(false); }, []);
  const loadUser = useCallback(async () => {
    if (!getToken()) { setChecking(false); return; }
    setChecking(true);
    try { setUser(await api.me()); } catch { logout(); } finally { setChecking(false); }
  }, [logout]);

  useEffect(() => {
    void loadUser();
    window.addEventListener("records-authenticated", loadUser);
    return () => window.removeEventListener("records-authenticated", loadUser);
  }, [loadUser]);

  const toggleTheme = () => setTheme((current) => {
    const next = current === "light" ? "dark" : "light";
    localStorage.setItem("records-theme", next);
    return next;
  });

  return (
    <div className={`app theme-${theme}`}>
      {checking ? <div className="boot"><Brand /><span>일정을 불러오는 중...</span></div> : user ? <DashboardScreen user={user} theme={theme} onTheme={toggleTheme} onLogout={logout} /> : <AuthScreen theme={theme} onTheme={toggleTheme} />}
    </div>
  );
}
