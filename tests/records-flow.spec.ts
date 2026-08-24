import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("responsive signup, calendar, task edit and dashboard flows work", async ({ page }) => {
  const email = `records-flow-${Date.now()}@example.com`;
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.goto("/?screen=signup&theme=light");
  await page.getByRole("textbox", { name: "학번" }).fill("20514");
  await page.getByRole("textbox", { name: "이름" }).fill("이승윤");
  await page.getByRole("textbox", { name: "이메일" }).fill(email);
  await page.getByRole("textbox", { name: "비밀번호" }).fill("records1234");
  await page.getByRole("button", { name: "회원가입 완료" }).click();
  await expect(page.getByRole("heading", { name: "2026. 08" })).toBeVisible();

  await page.goto("/?screen=dashboard&theme=light");
  await page.getByRole("button", { name: "월간 달력" }).click();
  await expect(page.locator(".calendar-card.expanded")).toBeVisible();
  await page.getByRole("button", { name: "다음 달" }).click();
  await expect(page.locator(".calendar-card.expanded").getByRole("heading", { name: "2026. 09" })).toBeVisible();
  await page.getByRole("button", { name: "이전 달" }).click();
  const todayParts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).formatToParts(new Date());
  const today = `${todayParts.find((part) => part.type === "month")?.value}월 ${todayParts.find((part) => part.type === "day")?.value}일`;
  await page.getByRole("button", { name: today }).click();
  await page.getByRole("button", { name: "대시보드" }).click();
  await page.getByRole("button", { name: "사진으로 추가" }).click();
  const modalLayout = await page.evaluate(() => {
    const sidebar = document.querySelector(".tablet-sidebar")!.getBoundingClientRect();
    const content = document.querySelector(".tablet-content")!.getBoundingClientRect();
    const modal = document.querySelector(".tablet-modal")!.getBoundingClientRect();
    return { sidebarRight: sidebar.right, modalLeft: modal.left, modalCenter: modal.left + modal.width / 2, contentCenter: content.left + content.width / 2 };
  });
  expect(modalLayout.modalLeft).toBeGreaterThanOrEqual(modalLayout.sidebarRight);
  expect(Math.abs(modalLayout.modalCenter - modalLayout.contentCenter)).toBeLessThan(1);
  const fieldLayout = await page.evaluate(() => {
    const modal = document.querySelector(".tablet-modal")!.getBoundingClientRect();
    const padding = Number.parseFloat(getComputedStyle(document.querySelector(".tablet-modal")!).paddingLeft);
    const fields = [...document.querySelectorAll<HTMLInputElement>(".tablet-modal .form-field input")].map((input) => ({ type: input.type, ...input.getBoundingClientRect().toJSON() }));
    return { contentLeft: modal.left + padding, contentRight: modal.right - padding, fields };
  });
  for (const field of fieldLayout.fields) {
    expect(field.left).toBeGreaterThanOrEqual(fieldLayout.contentLeft - 1);
    expect(field.right).toBeLessThanOrEqual(fieldLayout.contentRight + 1);
  }
  const subjectField = fieldLayout.fields[1];
  const dateField = fieldLayout.fields.find((field) => field.type === "date")!;
  expect(subjectField.right).toBeLessThanOrEqual(dateField.left);
  await page.getByRole("textbox", { name: "과제명" }).fill("수학 오답노트 정리");
  await page.getByRole("textbox", { name: "과목" }).fill("수학");
  await page.getByRole("button", { name: "과제 저장" }).click();
  await expect(page.getByRole("heading", { name: "수학 오답노트 정리" })).toBeVisible();
  await page.getByRole("button", { name: "수학 오답노트 정리 수정" }).click();
  await expect(page.getByRole("dialog", { name: "과제 수정" })).toBeVisible();
  expect(await page.evaluate(() => document.activeElement instanceof HTMLInputElement)).toBe(false);
  await page.getByRole("dialog", { name: "과제 수정" }).getByRole("button", { name: "닫기" }).click();
  expect(await page.getByRole("dialog", { name: "과제 수정" }).count()).toBe(1);
  await expect(page.getByRole("dialog", { name: "과제 수정" })).toHaveCount(0);
  await page.getByRole("button", { name: "수학 오답노트 정리 수정" }).click();
  const editFields = await page.locator('.tablet-modal .form-row input').evaluateAll((inputs) => inputs.map((input) => {
    const rect = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    return { left: rect.left, right: rect.right, height: rect.height, lineHeight: style.lineHeight, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom };
  }));
  expect(editFields[0].right).toBeLessThanOrEqual(editFields[1].left);
  for (const field of editFields) {
    expect(field.height).toBe(42);
    expect(field.lineHeight).toBe("40px");
    expect(field.paddingTop).toBe("0px");
    expect(field.paddingBottom).toBe("0px");
  }
  await page.getByRole("textbox", { name: "과제명" }).fill("수학 오답노트 수정");
  await page.getByRole("button", { name: "수정 저장" }).click();
  await expect(page.getByRole("heading", { name: "수학 오답노트 수정" })).toBeVisible();
  await expect(page.getByText("D-DAY", { exact: true })).toBeVisible();
  await expect(page.locator(".progress-ring")).toHaveAttribute("style", /--progress: 0%/);
  await page.getByRole("button", { name: "수학 오답노트 수정 완료" }).click();
  await expect(page.locator(".progress-ring")).toHaveAttribute("style", /--progress: 100%/);

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator(".tablet-logout")).toBeInViewport();
  expect(await page.evaluate(() => document.body.scrollHeight <= window.innerHeight)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?screen=dashboard&theme=light");
  await expect(page.locator(".tablet-dashboard")).toHaveCount(0);
  await expect(page.locator(".flow-stack")).toBeVisible();
  await expect(page.locator(".mobile-cursor")).toHaveCount(0);
  await expect(page.locator(".keyboard-dock")).toHaveCSS("display", "none");
  await expect(page.getByRole("heading", { name: "수학 오답노트 수정" })).toBeVisible();
  await page.getByRole("button", { name: "수학 오답노트 수정 수정" }).click();
  await expect(page.locator(".bottom-sheet .sheet-title")).toHaveText("과제 수정");
});

test("saving an assignment selects its month in the calendar", async ({ page }) => {
  let createdAssignment: Record<string, unknown> | null = null;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/users/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "user-1", name: "테스트", email: "test@example.com", studentNumber: "20514" } }) });
      return;
    }
    if (url.pathname === "/assignments" && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: createdAssignment ? [createdAssignment] : [] }) });
      return;
    }
    if (url.pathname === "/assignments" && request.method() === "POST") {
      const payload = request.postDataJSON() as { title: string; subject: string; dueAt: string };
      createdAssignment = { id: "assignment-1", ...payload, completed: false, completedAt: null, dayOffset: 1, deadlineLabel: "D-1" };
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ success: true, data: createdAssignment }) });
      return;
    }
    if (url.pathname.startsWith("/notifications")) {
      const data = url.pathname.endsWith("unread-count") ? { count: 0 } : url.pathname.endsWith("preferences") ? { beforeDeadlineMinutes: 60 } : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data }) });
      return;
    }
    await route.continue();
  });
  await page.addInitScript(() => localStorage.setItem("records-access-token", "test-access"));
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?screen=dashboard&theme=light");

  const nextMonthDate = await page.evaluate(() => {
    const date = new Date();
    date.setMonth(date.getMonth() + 1, 15);
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
  });
  const [nextYear, nextMonth] = nextMonthDate.split("-");
  await page.getByRole("button", { name: "사진으로 추가" }).click();
  await page.getByRole("textbox", { name: "과제명" }).fill("다음 달 과제");
  await page.getByRole("textbox", { name: "과목" }).fill("자율");
  await page.getByRole("textbox", { name: "마감일" }).fill(nextMonthDate);
  await page.getByRole("button", { name: "과제 저장" }).click();

  await expect(page.locator(".calendar-card").getByRole("heading", { name: `${nextYear}. ${nextMonth}` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "다음 달 과제" })).toBeVisible();
  const imagePresets = [
    ["스마트폰 비율 (세로)로 저장", 1080, 1920],
    ["태블릿 비율 (가로)로 저장", 2560, 1600],
    ["태블릿 비율 (세로)로 저장", 1600, 2560],
  ] as const;
  for (const [index, [label, width, height]] of imagePresets.entries()) {
    await page.getByRole("button", { name: "배경화면으로 저장" }).click();
    await expect(page.getByRole("dialog", { name: "캘린더 이미지 저장" })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: label }).click();
    const imageDownload = await download;
    expect(imageDownload.suggestedFilename()).toContain("records-calendar-");
    const imagePath = await imageDownload.path();
    expect(imagePath).not.toBeNull();
    const png = readFileSync(imagePath!);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);
    if (index === imagePresets.length - 1) break;
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?screen=dashboard&theme=light");
  await expect(page.locator(".flow-stack")).toBeVisible();
  await expect(page.locator(".mobile-cursor")).toHaveCount(0);
});

test("expired access token redirects to login on tablet and mobile", async ({ page }) => {
  await page.route("**/users/me", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "TOKEN_EXPIRED", message: "토큰이 만료되었습니다." } }),
  }));
  await page.addInitScript(() => localStorage.setItem("records-access-token", "expired-token"));

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?screen=dashboard");
  await expect(page.locator("button:visible").filter({ hasText: "로그인" }).first()).toBeVisible();
  await expect(page.evaluate(() => localStorage.getItem("records-access-token"))).resolves.toBeNull();

  await page.evaluate(() => localStorage.setItem("records-access-token", "expired-token"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?screen=dashboard");
  await expect(page.locator("button:visible").filter({ hasText: "로그인" }).first()).toBeVisible();
  await expect(page.evaluate(() => localStorage.getItem("records-access-token"))).resolves.toBeNull();
});

test("expired access token rotates through refresh token before redirecting", async ({ page }) => {
  let userRequests = 0;
  let refreshRequests = 0;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/users/me") {
      userRequests += 1;
      if (userRequests === 1) {
        await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "TOKEN_EXPIRED", message: "토큰이 만료되었습니다." } }) });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "user-1", name: "테스트", email: "test@example.com", studentNumber: "20514" } }) });
      }
      return;
    }
    if (url.pathname === "/auth/refresh") {
      refreshRequests += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { accessToken: "rotated-access", refreshToken: "rotated-refresh" } }) });
      return;
    }
    if (url.pathname === "/assignments") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) });
      return;
    }
    if (url.pathname.startsWith("/notifications")) {
      const data = url.pathname.endsWith("unread-count") ? { count: 0 } : url.pathname.endsWith("preferences") ? { beforeDeadlineMinutes: 60 } : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data }) });
      return;
    }
    await route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem("records-access-token", "expired-access");
    localStorage.setItem("records-refresh-token", "valid-refresh");
  });

  await page.goto("/?screen=dashboard");
  await expect(page.getByText("마감 예정인 과제가 없어요", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("records-access-token"))).toBe("rotated-access");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("records-refresh-token"))).toBe("rotated-refresh");
  expect(refreshRequests).toBe(1);
  expect(userRequests).toBeGreaterThanOrEqual(2);
});

test("selected theme survives reload on tablet and mobile", async ({ page }) => {
  await page.goto("/?screen=login&theme=light");
  await page.goto("/?screen=login");
  await expect(page.locator(".tablet-app")).toHaveClass(/theme-light/);
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await page.reload();
  await expect(page.locator(".tablet-app")).toHaveClass(/theme-dark/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".app-screen")).toHaveClass(/theme-dark/);
  await expect.poll(() => page.locator(".app-screen").evaluate((element) => getComputedStyle(element).transitionProperty)).toContain("background-color");
  await page.getByRole("button", { name: "화이트 모드로 전환" }).click();
  await page.reload();
  await expect(page.locator(".app-screen")).toHaveClass(/theme-light/);
});

test("notification preferences are available from the dashboard", async ({ page }) => {
  const email = `records-notification-${Date.now()}@example.com`;
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?screen=signup&theme=light");
  await page.getByRole("textbox", { name: "학번" }).fill("20516");
  await page.getByRole("textbox", { name: "이름" }).fill("알림검증");
  await page.getByRole("textbox", { name: "이메일" }).fill(email);
  await page.getByRole("textbox", { name: "비밀번호" }).fill("records1234");
  await page.getByRole("button", { name: "회원가입 완료" }).click();
  await expect(page.getByRole("heading", { name: "2026. 08" })).toBeVisible();

  await page.getByRole("button", { name: "알림" }).click();
  await expect(page.getByRole("region", { name: "알림 목록" })).toBeVisible();
  await expect(page.getByText("D-7·D-4·D-1 오전 7시와 D-Day 오전 7시 30분 알림은 항상 켜져 있어요.")).toBeVisible();
  await page.getByRole("combobox", { name: "마감 전 알림" }).selectOption("30");
  await expect(page.getByRole("combobox", { name: "마감 전 알림" })).toHaveValue("30");
});

test("delivered notifications trigger a browser notification while the app is open", async ({ page }) => {
  let notificationListCalls = 0;
  await page.addInitScript(() => {
    class TestNotification {
      static permission = "granted";
      constructor(title: string, options?: { body?: string }) {
        (window as Window & { __browserNotifications?: unknown[] }).__browserNotifications ??= [];
        (window as Window & { __browserNotifications: unknown[] }).__browserNotifications.push({ title, body: options?.body });
      }
    }
    Object.defineProperty(window, "Notification", { configurable: true, value: TestNotification });
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/users/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "user-1", name: "테스트", email: "test@example.com", studentNumber: "20514" } }) });
      return;
    }
    if (url.pathname === "/assignments") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) });
      return;
    }
    if (url.pathname === "/notifications" && request.method() === "GET") {
      notificationListCalls += 1;
      const data = notificationListCalls > 1 ? [{ id: "notification-1", assignmentId: "assignment-1", type: "D_MINUS_1", offsetMinutes: -1, title: "마감 알림", message: "수학 과제가 내일 마감입니다.", dueAt: "2030-08-10T14:00:00Z", scheduledAt: "2030-08-09T22:00:00Z", deliveredAt: "2030-08-09T22:00:01Z", readAt: null }] : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data }) });
      return;
    }
    if (url.pathname === "/notifications/unread-count") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { count: notificationListCalls > 1 ? 1 : 0 } }) });
      return;
    }
    if (url.pathname === "/notifications/preferences") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { beforeDeadlineMinutes: 60 } }) });
      return;
    }
    await route.continue();
  });
  await page.addInitScript(() => localStorage.setItem("records-access-token", "test-access"));
  await page.goto("/?screen=dashboard&theme=light");
  await expect.poll(() => notificationListCalls).toBeGreaterThan(0);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => page.evaluate(() => (window as Window & { __browserNotifications?: unknown[] }).__browserNotifications?.length || 0)).toBe(1);
  await expect(page.getByRole("button", { name: "알림" })).toContainText("1");
});

test("cached assignments remain usable offline and sync after reconnect", async ({ page, context, browserName }) => {
  const email = `records-offline-${Date.now()}@example.com`;
  await page.addInitScript(() => Object.defineProperty(Crypto.prototype, "randomUUID", { configurable: true, value: undefined }));
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?screen=signup&theme=light");
  await page.getByRole("textbox", { name: "학번" }).fill("20515");
  await page.getByRole("textbox", { name: "이름" }).fill("오프라인검증");
  await page.getByRole("textbox", { name: "이메일" }).fill(email);
  await page.getByRole("textbox", { name: "비밀번호" }).fill("records1234");
  await page.getByRole("button", { name: "회원가입 완료" }).click();
  await expect(page.locator(".student-card")).toContainText("오프라인검증");
  await page.goto("/?screen=dashboard&theme=light");

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
    }
  });
  await page.reload();
  await context.setOffline(true);
  // Playwright WebKit currently crashes internally on service-worker-backed
  // offline reload; Chromium covers the shell reload while both engines cover offline CRUD.
  if (browserName !== "webkit") await page.reload();
  if (browserName !== "webkit") await expect(page.getByText("오프라인 · 변경사항 자동 저장")).toBeVisible();

  await page.getByRole("button", { name: "사진으로 추가" }).click();
  await page.getByRole("textbox", { name: "과제명" }).fill("오프라인 과제");
  await page.getByRole("textbox", { name: "과목" }).fill("자율");
  await page.getByRole("button", { name: "과제 저장" }).click();
  await expect(page.getByRole("heading", { name: "오프라인 과제" })).toBeVisible();
  await expect(page.getByText("오프라인 · 변경사항 자동 저장")).toBeVisible();
  await page.getByRole("button", { name: "오프라인 과제 수정" }).click();
  await page.getByRole("textbox", { name: "과제명" }).fill("오프라인 과제 수정본");
  await page.getByRole("button", { name: "수정 저장" }).click();
  await expect(page.getByRole("heading", { name: "오프라인 과제 수정본" })).toBeVisible();
  await page.getByRole("button", { name: "오프라인 과제 수정본 완료" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("records-offline-pending") || "[]").length)).toBe(2);

  await context.setOffline(false);
  if (browserName === "webkit") await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("오프라인 · 변경사항 자동 저장")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("records-offline-pending") || "[]").length)).toBe(0);
  await expect(page.getByRole("heading", { name: "오프라인 과제 수정본" })).toBeVisible();
});
