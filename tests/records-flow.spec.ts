import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

async function chooseAssignmentPhoto(page: Page) {
  await page.getByRole("button", { name: "과제 추가", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "칠판 또는 유인물 사진 선택" }).click();
  await page.getByRole("button", { name: "갤러리 선택" }).click();
  await (await chooser).setFiles({
    name: "assignment.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
}

test("email verification and password reset flows are connected", async ({ page }) => {
  const calls: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/auth/signup") {
      calls.push(path);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "user-1", name: "테스트", email: "student@example.com", studentNumber: "20514", emailVerified: false } }) });
      return;
    }
    if (path === "/auth/login") {
      calls.push(path);
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "EMAIL_NOT_VERIFIED", message: "이메일 인증이 필요합니다." } }) });
      return;
    }
    if (path === "/auth/email-verification/confirm") {
      calls.push(path);
      expect(request.postDataJSON()).toEqual({ email: "student@example.com", code: "12345" });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { accessToken: "verified-access", refreshToken: "verified-refresh" } }) });
      return;
    }
    if (["/auth/email-verification/request", "/auth/password-reset/request", "/auth/password-reset/confirm"].includes(path)) {
      calls.push(path);
      if (path === "/auth/password-reset/confirm") {
        expect(request.postDataJSON()).toEqual({ token: "reset-token", newPassword: "new-records-password" });
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
      return;
    }
    await route.continue();
  });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?screen=signup&theme=light");
  await page.getByRole("textbox", { name: "학번" }).fill("20514");
  await page.getByRole("textbox", { name: "이름" }).fill("테스트");
  await page.getByRole("textbox", { name: "이메일" }).fill("student@example.com");
  await page.getByRole("textbox", { name: "비밀번호" }).fill("records-password");
  await page.getByRole("button", { name: "회원가입 완료" }).click();
  await expect(page).toHaveURL(/\/check-email$/);
  await expect(page.getByRole("heading", { name: "인증 코드를 입력해 주세요." })).toBeVisible();
  await page.getByRole("button", { name: "인증 코드 다시 보내기" }).click();
  await expect(page.getByText("새 인증 코드를 보냈습니다. 가장 최근에 받은 코드를 입력해 주세요.")).toBeVisible();
  await page.getByRole("button", { name: "로그인으로 돌아가기" }).click();

  await page.getByRole("textbox", { name: "이메일" }).fill("student@example.com");
  await page.getByRole("textbox", { name: "비밀번호" }).fill("records-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/check-email$/);
  await page.getByRole("textbox", { name: "5자리 인증 코드" }).fill("12345");
  await page.getByRole("button", { name: "인증 코드 확인" }).click();
  await expect(page.getByRole("heading", { name: "인증이 완료됐어요." })).toBeVisible();
  await expect(page.getByText("이메일 인증이 완료되었습니다. 이제 Kyelendar를 사용할 수 있어요.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("records-access-token"))).toBe("verified-access");
  await page.getByRole("button", { name: "서비스 시작하기" }).click();
  await expect(page).toHaveURL(/\?screen=dashboard$/);

  await page.goto("/forgot-password");
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByRole("textbox", { name: "이메일" }).fill("student@example.com");
  await page.getByRole("button", { name: "재설정 메일 받기" }).click();
  await expect(page.getByText("계정이 존재하면 비밀번호 재설정 메일을 보내드립니다.")).toBeVisible();

  await page.goto("/reset-password?token=reset-token");
  await page.getByRole("textbox", { name: "새 비밀번호", exact: true }).fill("new-records-password");
  await page.getByRole("textbox", { name: "새 비밀번호 확인" }).fill("new-records-password");
  await page.getByRole("button", { name: "비밀번호 변경" }).click();
  await expect(page.getByText("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.")).toBeVisible();

  expect(calls).toEqual(expect.arrayContaining([
    "/auth/signup",
    "/auth/login",
    "/auth/email-verification/request",
    "/auth/email-verification/confirm",
    "/auth/password-reset/request",
    "/auth/password-reset/confirm",
  ]));
  expect(calls.filter((path) => path === "/auth/email-verification/confirm")).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("existing unverified signup resumes on the verification page", async ({ page }) => {
  await page.route("**/auth/signup", (route) => route.fulfill({
    status: 409,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: { code: "EMAIL_ALREADY_EXISTS", message: "이미 사용 중인 이메일입니다." } }),
  }));
  await page.route("**/auth/login", (route) => route.fulfill({
    status: 403,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: { code: "EMAIL_NOT_VERIFIED", message: "이메일 인증이 필요합니다." } }),
  }));
  await page.route("**/auth/email-verification/request", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true }),
  }));

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?screen=signup&theme=light");
  await page.getByRole("textbox", { name: "학번" }).fill("20000");
  await page.getByRole("textbox", { name: "이름" }).fill("gg");
  await page.getByRole("textbox", { name: "이메일" }).fill("sss20090529@gmail.com");
  await page.getByRole("textbox", { name: "비밀번호" }).fill("records-password");
  await page.getByRole("button", { name: "회원가입 완료" }).click();

  await expect(page).toHaveURL(/\/check-email$/);
  await expect(page.getByRole("heading", { name: "인증 코드를 입력해 주세요." })).toBeVisible();
  await expect(page.locator(".tablet-auth-brand")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".tablet-auth-brand")).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("verification-code");
});

test("duplicate signup keeps the duplicate email error when credentials do not match", async ({ page }) => {
  await page.route("**/auth/signup", (route) => route.fulfill({
    status: 409,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: { code: "EMAIL_ALREADY_EXISTS", message: "이미 사용 중인 이메일입니다." } }),
  }));
  await page.route("**/auth/login", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: { code: "INVALID_CREDENTIALS", message: "이메일 또는 비밀번호가 올바르지 않습니다." } }),
  }));

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?screen=signup&theme=light");
  await page.getByRole("textbox", { name: "학번" }).fill("12313");
  await page.getByRole("textbox", { name: "이름" }).fill("11");
  await page.getByRole("textbox", { name: "이메일" }).fill("hsm20090529@dgsw.hs.kr");
  await page.getByRole("textbox", { name: "비밀번호" }).fill("wrong-password");
  await page.getByRole("button", { name: "회원가입 완료" }).click();

  await expect(page.getByText("이미 사용 중인 이메일입니다.")).toBeVisible();
  await expect(page).toHaveURL(/screen=signup/);
});

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
  await chooseAssignmentPhoto(page);
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
  await chooseAssignmentPhoto(page);
  await page.getByRole("textbox", { name: "과제명" }).fill("다음 달 과제");
  await page.getByRole("textbox", { name: "과목" }).fill("자율");
  await page.getByRole("textbox", { name: "마감일" }).fill(nextMonthDate);
  await page.getByRole("checkbox", { name: "마감 알림 받기" }).uncheck();
  await page.getByRole("button", { name: "과제 저장" }).click();
  expect((createdAssignment as Record<string, unknown>).notificationsEnabled).toBe(false);

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
  expect(imageDownload.suggestedFilename()).toContain("kyelendar-calendar-");
    const imagePath = await imageDownload.path();
    expect(imagePath).not.toBeNull();
    const png = readFileSync(imagePath!);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);
    if (index === imagePresets.length - 1) break;
  }
  await page.evaluate(() => Object.defineProperty(navigator, "share", {
    configurable: true,
    value: async () => { (window as Window & { __shareCalled?: boolean }).__shareCalled = true; },
  }));
  const directDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "배경화면으로 저장" }).click();
  await page.getByRole("button", { name: "스마트폰 비율 (세로)로 저장" }).click();
  expect((await directDownload).suggestedFilename()).toContain("kyelendar-calendar-");
  expect(await page.evaluate(() => (window as Window & { __shareCalled?: boolean }).__shareCalled ?? false)).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?screen=dashboard&theme=light");
  await expect(page.locator(".flow-stack")).toBeVisible();
  await expect(page.locator(".mobile-cursor")).toHaveCount(0);
});

test("photo analysis requires an explicit action and supports candidate review", async ({ page }) => {
  let extractionRequests = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/assignment-extractions") {
      extractionRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: {
          candidates: [
            { title: "첫 후보", subject: "수학", dueAt: null, needsReview: ["dueAt"] },
            { title: "두 번째 후보", subject: "직접 입력 과목", dueAt: "2030-09-10T09:00:00+09:00", needsReview: [] },
          ],
          requiresConfirmation: true,
          warnings: ["날짜가 불명확한 후보가 있습니다."],
        } }),
      });
      return;
    }
    if (url.pathname === "/users/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "user-1", name: "테스트", email: "test@example.com", studentNumber: "20514" } }) });
      return;
    }
    if (url.pathname === "/assignments" && request.method() === "GET") {
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
  await page.addInitScript(() => localStorage.setItem("records-access-token", "test-access"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?screen=dashboard&theme=light");
  await expect(page.getByRole("button", { name: "과제 추가", exact: true })).toHaveCount(1);
  await expect(page.locator(".day.today")).toHaveCount(1);
  await expect(page.locator(".day.today.selected")).toHaveCSS("background-color", "rgb(224, 82, 82)");
  await chooseAssignmentPhoto(page);
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.locator('input[type="file"]:not([capture])')).toHaveCount(1);
  expect(extractionRequests).toBe(0);
  await page.getByRole("button", { name: "사진 분석" }).click();
  await expect.poll(() => extractionRequests).toBe(1);
  await expect(page.getByRole("button", { name: "1. 첫 후보" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "마감일" })).toHaveValue("");
  await expect(page.getByRole("button", { name: "과제 저장" })).toBeDisabled();
  await page.getByRole("button", { name: "2. 두 번째 후보" }).click();
  await expect(page.getByRole("textbox", { name: "과제명" })).toHaveValue("두 번째 후보");
  await expect(page.getByRole("textbox", { name: "과목" })).toHaveValue("직접 입력 과목");
  await expect(page.getByRole("textbox", { name: "마감일" })).toHaveValue("2030-09-10");

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator(".flow-stack")).toBeVisible();
  await expect(page.locator(".tablet-dashboard")).toHaveCount(0);

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?screen=dashboard&theme=light");
  await expect(page.locator(".tablet-dashboard")).toBeVisible();
  await expect(page.getByRole("button", { name: "과제 추가", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "과제 추가", exact: true }).click();
  await expect(page.getByRole("heading", { name: "새 과제 추가" })).toBeVisible();
  await expect(page.getByRole("button", { name: "과제 추가", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "칠판 또는 유인물 사진 선택" })).toBeVisible();
  await expect(page.locator('input[type="file"][accept="image/*"]')).toHaveCount(1);
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

test("cross-tab refresh fallback uses one rotation request without Web Locks", async ({ browser }) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  let userRequests = 0;
  let refreshRequests = 0;
  let releaseUserRequests!: () => void;
  const bothUserRequests = new Promise<void>((resolve) => { releaseUserRequests = resolve; });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/users/me") {
      if (request.headers().authorization === "Bearer rotated-access") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "user-1", name: "테스트", email: "test@example.com", studentNumber: "20514" } }) });
      } else {
        userRequests += 1;
        if (userRequests === 2) releaseUserRequests();
        await bothUserRequests;
        await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "TOKEN_EXPIRED", message: "토큰이 만료되었습니다." } }) });
      }
      return;
    }
    if (url.pathname === "/auth/refresh") {
      refreshRequests += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { accessToken: "rotated-access", refreshToken: "rotated-refresh" } }) });
      return;
    }
    await route.continue();
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    localStorage.setItem("records-access-token", "expired-access");
    localStorage.setItem("records-refresh-token", "shared-refresh");
  });
  await first.goto("/?screen=signup");
  await second.goto("/?screen=signup");

  await Promise.all([
    first.evaluate(() => import("/src/recordsApi.ts").then(({ me }) => me())),
    second.evaluate(() => import("/src/recordsApi.ts").then(({ me }) => me())),
  ]);

  expect(refreshRequests).toBe(1);
  await expect.poll(() => first.evaluate(() => localStorage.getItem("records-access-token"))).toBe("rotated-access");
  await expect.poll(() => second.evaluate(() => localStorage.getItem("records-refresh-token"))).toBe("rotated-refresh");
  await context.close();
});

test("temporary refresh outage preserves the session and offline queue", async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/users/me") {
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "TOKEN_EXPIRED", message: "토큰이 만료되었습니다." } }) });
      return;
    }
    if (url.pathname === "/auth/refresh") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "잠시 후 다시 시도해 주세요." } }) });
      return;
    }
    await route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem("records-access-token", "expired-access");
    localStorage.setItem("records-refresh-token", "saved-refresh");
    localStorage.setItem("records-offline-pending", JSON.stringify([{ key: "pending-1", type: "create", assignmentId: "offline-1", payload: { title: "보존 과제", subject: "자율", dueAt: "2026-08-30T18:00:00+09:00" } }]));
  });
  await page.goto("/?screen=signup");

  const result = await page.evaluate(async () => {
    let expired = false;
    window.addEventListener("records:auth-expired", () => { expired = true; }, { once: true });
    let errorName = "";
    try {
      await import("/src/recordsApi.ts").then(({ me }) => me());
    } catch (error) {
      errorName = error instanceof Error ? error.name : "unknown";
    }
    return {
      errorName,
      expired,
      accessToken: localStorage.getItem("records-access-token"),
      refreshToken: localStorage.getItem("records-refresh-token"),
      pending: JSON.parse(localStorage.getItem("records-offline-pending") || "[]").length,
    };
  });

  expect(result).toEqual({
    errorName: "NetworkError",
    expired: false,
    accessToken: "expired-access",
    refreshToken: "saved-refresh",
    pending: 1,
  });
});

test("offline sync keeps operations queued while a request is in flight", async ({ page }) => {
  let assignmentRequests = 0;
  let releaseFirstRequest!: () => void;
  let markFirstRequest!: () => void;
  const firstRequest = new Promise<void>((resolve) => { markFirstRequest = resolve; });
  const release = new Promise<void>((resolve) => { releaseFirstRequest = resolve; });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/assignments" && request.method() === "POST") {
      assignmentRequests += 1;
      if (assignmentRequests === 1) {
        markFirstRequest();
        await release;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { id: `server-${assignmentRequests}`, title: `과제 ${assignmentRequests}`, subject: "자율", dueAt: "2026-08-30T09:00:00Z", completed: false, completedAt: null, dayOffset: 1, deadlineLabel: "D-1" } }),
      });
      return;
    }
    await route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem("records-access-token", "test-access");
    localStorage.setItem("records-refresh-token", "test-refresh");
    localStorage.setItem("records-offline-pending", JSON.stringify([{ key: "first", type: "create", assignmentId: "offline-first", payload: { title: "과제 1", subject: "자율", dueAt: "2026-08-30T18:00:00+09:00" } }]));
  });
  await page.goto("/?screen=signup");

  const syncing = page.evaluate(() => import("/src/recordsApi.ts").then(({ syncPendingAssignments }) => syncPendingAssignments()));
  await firstRequest;
  await page.evaluate(() => {
    const pending = JSON.parse(localStorage.getItem("records-offline-pending") || "[]");
    pending.push({ key: "second", type: "create", assignmentId: "offline-second", payload: { title: "과제 2", subject: "자율", dueAt: "2026-08-31T18:00:00+09:00" } });
    localStorage.setItem("records-offline-pending", JSON.stringify(pending));
  });
  releaseFirstRequest();
  await syncing;

  expect(assignmentRequests).toBe(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("records-offline-pending") || "[]").length)).toBe(0);
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

test("account deletion waits, verifies the password, and clears the session", async ({ page }) => {
  let deleted = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/users/me" && request.method() === "DELETE") {
      const password = (request.postDataJSON() as { password: string }).password;
      if (password !== "records-password") {
        await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "INVALID_PASSWORD", message: "비밀번호가 올바르지 않습니다." } }) });
        return;
      }
      deleted = true;
      await route.fulfill({ status: 204 });
      return;
    }
    if (path === "/users/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "user-1", name: "테스트", email: "test@example.com", studentNumber: "20514" } }) });
      return;
    }
    if (path === "/assignments") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) });
      return;
    }
    if (path.startsWith("/notifications")) {
      const data = path.endsWith("unread-count") ? { count: 0 } : path.endsWith("preferences") ? { beforeDeadlineMinutes: 60 } : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data }) });
      return;
    }
    await route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem("records-access-token", "test-access");
    localStorage.setItem("records-refresh-token", "test-refresh");
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?screen=dashboard&theme=light");
  await page.getByRole("button", { name: "마이페이지", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "마이페이지" })).toBeVisible();
  await page.getByRole("button", { name: "회원탈퇴", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "회원탈퇴 확인" });
  await expect(dialog.getByRole("heading", { name: "정말 지우시겠습니까?" })).toBeVisible();
  await dialog.getByRole("textbox", { name: "현재 비밀번호" }).fill("wrong-password");
  await expect(dialog.getByRole("button", { name: /초 후 회원탈퇴/ })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "회원탈퇴", exact: true })).toBeEnabled({ timeout: 7_000 });
  await dialog.getByRole("button", { name: "회원탈퇴", exact: true }).click();
  await expect(dialog.getByText("비밀번호가 올바르지 않습니다.")).toBeVisible();

  await dialog.getByRole("textbox", { name: "현재 비밀번호" }).fill("records-password");
  await dialog.getByRole("button", { name: "회원탈퇴", exact: true }).click();
  await expect(page.getByRole("heading", { name: "다시 만나서 반가워요." })).toBeVisible();
  expect(deleted).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("records-access-token"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("records-refresh-token"))).toBeNull();
});

test("my page updates profile and the edit sheet deletes an assignment", async ({ page }) => {
  let profile = { id: "user-1", name: "테스트", email: "test@example.com", studentNumber: "20514" };
  let deleted = false;
  const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/users/me" && request.method() === "PATCH") {
      profile = { ...profile, ...(request.postDataJSON() as { name: string; studentNumber: string }) };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: profile }) });
      return;
    }
    if (path === "/users/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: profile }) });
      return;
    }
    if (path === "/assignments/task-1" && request.method() === "DELETE") {
      deleted = true;
      await route.fulfill({ status: 204 });
      return;
    }
    if (path === "/assignments") {
      const data = deleted ? [] : [{ id: "task-1", title: "삭제할 과제", subject: "수학", dueAt, notificationsEnabled: true, completed: false, completedAt: null, dayOffset: 0, deadlineLabel: "D-Day" }];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data }) });
      return;
    }
    if (path.startsWith("/notifications")) {
      const data = path.endsWith("unread-count") ? { count: 0 } : path.endsWith("preferences") ? { beforeDeadlineMinutes: 60 } : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data }) });
      return;
    }
    await route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem("records-access-token", "test-access");
    localStorage.setItem("records-refresh-token", "test-refresh");
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?screen=dashboard&theme=light");

  await page.getByRole("button", { name: "마이페이지", exact: true }).click();
  const myPage = page.getByRole("dialog", { name: "마이페이지" });
  await expect(myPage.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
  await myPage.getByRole("button", { name: "로그아웃", exact: true }).click();
  const logoutDialog = page.getByRole("dialog", { name: "로그아웃 확인" });
  await expect(logoutDialog).toBeVisible();
  await logoutDialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(myPage).toBeVisible();
  await myPage.getByRole("textbox", { name: "이름" }).fill("수정학생");
  await myPage.getByRole("textbox", { name: "학번" }).fill("20515");
  await myPage.getByRole("button", { name: "정보 저장" }).click();
  await expect(myPage.getByText("개인 정보가 저장되었습니다.")).toBeVisible();
  await myPage.getByRole("button", { name: "닫기" }).click();
  await expect(page.locator(".student-card")).toContainText("수정학생");

  await page.getByRole("button", { name: "삭제할 과제 수정" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("dialog", { name: "과제 수정" }).getByRole("button", { name: "과제 삭제" }).click();
  await expect(page.getByRole("heading", { name: "삭제할 과제" })).toHaveCount(0);
  expect(deleted).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?screen=dashboard&theme=light");
  await page.getByRole("button", { name: "마이페이지", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "마이페이지" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement instanceof HTMLInputElement)).toBe(false);
  const sheetHeight = await page.locator('[data-testid="bottom-sheet"]').evaluate((sheet) => sheet.getBoundingClientRect().height);
  expect(sheetHeight).toBeGreaterThan(844 * 0.9);
  await page.locator('[data-testid="sheet-overlay"]').click({ position: { x: 10, y: 10 } });
  await expect(page.locator('[data-testid="bottom-sheet"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="bottom-sheet"]')).toHaveCount(0, { timeout: 1_000 });
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

test("delivered notifications do not create duplicate in-page notifications", async ({ page }) => {
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
  await expect.poll(() => page.evaluate(() => (window as Window & { __browserNotifications?: unknown[] }).__browserNotifications?.length || 0)).toBe(0);
  await expect(page.getByRole("button", { name: "알림" })).toContainText("1");
});

test("Web Push replaces a subscription created with a different VAPID key", async ({ page }) => {
  let registeredEndpoint = "";
  await page.addInitScript(() => {
    const state = { unsubscribed: 0, subscribed: 0 };
    (window as Window & { __pushState?: typeof state }).__pushState = state;
    const existing = {
      options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
      unsubscribe: async () => { state.unsubscribed += 1; return true; },
      toJSON: () => ({ endpoint: "https://push.example/old", keys: { p256dh: "old", auth: "old" } }),
    };
    const replacement = {
      options: { applicationServerKey: new Uint8Array(65).buffer },
      unsubscribe: async () => true,
      toJSON: () => ({ endpoint: "https://push.example/new", keys: { p256dh: "new-p256dh", auth: "new-auth" } }),
    };
    Object.defineProperty(navigator.serviceWorker, "ready", {
      configurable: true,
      value: Promise.resolve({ pushManager: {
        getSubscription: async () => existing,
        subscribe: async () => { state.subscribed += 1; return replacement; },
      } }),
    });
    class TestNotification {
      static permission: NotificationPermission = "default";
      static requestPermission = async () => "granted" as NotificationPermission;
    }
    Object.defineProperty(window, "Notification", { configurable: true, value: TestNotification });
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/notifications/push-subscriptions") {
      registeredEndpoint = (request.postDataJSON() as { endpoint: string }).endpoint;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: null }) });
      return;
    }
    if (url.pathname === "/users/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "user-1", name: "테스트", email: "test@example.com", studentNumber: "20514" } }) });
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
  await page.addInitScript(() => localStorage.setItem("records-access-token", "test-access"));
  await page.goto("/?screen=dashboard&theme=light");
  await page.getByRole("button", { name: "알림" }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __pushState?: { unsubscribed: number } }).__pushState?.unsubscribed)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as Window & { __pushState?: { subscribed: number } }).__pushState?.subscribed)).toBe(1);
  expect(registeredEndpoint).toBe("https://push.example/new");
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

  await page.getByRole("button", { name: "과제 추가", exact: true }).click();
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
