import { expect, test } from "@playwright/test";

const image = (name: string) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
});

test("selects every image, reviews every extracted assignment, and saves selected drafts as a batch", async ({ page }) => {
  let extractionRequests = 0;
  let batchPayload: { assignments: Array<{ title: string }>; extractionBatchId: string } | null = null;

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/users/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "user-1", name: "테스트", email: "test@example.com", studentNumber: "20514" } }) });
      return;
    }
    if (url.pathname === "/assignments" && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) });
      return;
    }
    if (url.pathname === "/assignment-extractions") {
      extractionRequests += 1;
      const imageIndex = Number(request.headers()["x-image-index"] || 0);
      const imageId = request.headers()["x-client-image-id"];
      const assignments = imageIndex === 0
        ? [
            { assignmentId: "draft-1", sourceOrder: 0, title: "첫 번째 과제", subject: "수학", startDate: null, dueDate: "2030-09-05", dueTime: "18:00", sourceText: "수학 9/5", confidence: null, needsReview: false, warnings: [], possibleDuplicateOf: null },
            { assignmentId: "draft-2", sourceOrder: 1, title: "두 번째 과제", subject: "영어", startDate: null, dueDate: "2030-09-06", dueTime: null, sourceText: "영어 9/6", confidence: null, needsReview: false, warnings: [], possibleDuplicateOf: null },
          ]
        : [{ assignmentId: "draft-3", sourceOrder: 0, title: "세 번째 과제", subject: "과학", startDate: null, dueDate: "2030-09-07", dueTime: "09:00", sourceText: "과학 9/7", confidence: null, needsReview: false, warnings: [], possibleDuplicateOf: null }];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: {
          extractionBatchId: request.headers()["x-extraction-batch-id"], referenceDate: "2026-09-02", timezone: "Asia/Seoul",
          images: [{ imageId, imageIndex, status: "COMPLETED", assignments, errorMessage: null }],
          summary: { totalImages: 1, completedImages: 1, failedImages: 0, totalAssignments: assignments.length },
        } }),
      });
      return;
    }
    if (url.pathname === "/assignments/batch") {
      batchPayload = request.postDataJSON() as typeof batchPayload;
      const assignments = batchPayload.assignments.map((item, index) => ({ id: `saved-${index}`, ...item, dueAt: `${item.title === "수정된 과제" ? "2030-09-05T09:00:00Z" : "2030-09-07T00:00:00Z"}`, notificationsEnabled: true, completed: false, completedAt: null, dayOffset: 0, deadlineLabel: "D-1", startDate: null }));
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ success: true, data: assignments }) });
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
  await page.goto("/?screen=dashboard&theme=dark");
  await page.getByRole("button", { name: "과제 추가", exact: true }).click();

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /칠판 또는 유인물 사진 선택/ }).click();
  await (await chooser).setFiles([image("one.png"), image("two.png")]);

  await expect.poll(() => extractionRequests).toBe(2);
  await expect(page.locator('input[type="file"][accept="image/*"][multiple]')).toHaveCount(1);
  await expect(page.locator('input[type="file"][capture]')).toHaveCount(0);
  await expect(page.locator(".selected-photo")).toHaveCount(2);
  await expect(page.locator(".assignment-draft-card")).toHaveCount(3);
  await expect(page.getByText("사진 2장 중 2장 분석 완료")).toBeVisible();

  const cards = page.locator(".assignment-draft-card");
  await cards.nth(0).getByRole("button", { name: "+ 시작일 추가" }).click();
  await expect(cards.nth(0).getByRole("textbox", { name: "시작일 1" })).toHaveValue("");
  await cards.nth(0).getByRole("textbox", { name: "시작일 1" }).fill("2030-09-01");
  await page.getByRole("textbox", { name: "과제명 1" }).fill("수정된 과제");
  await cards.nth(2).locator('input[type="checkbox"]').first().uncheck();
  await cards.nth(1).getByRole("button", { name: "두 번째 과제 과제 삭제" }).click();
  await expect(page.locator(".assignment-draft-card")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "선택한 1개 과제 저장" })).toBeVisible();
  await page.getByRole("button", { name: "선택한 1개 과제 저장" }).click();

  await expect.poll(() => batchPayload?.assignments.length || 0).toBe(1);
  expect(batchPayload?.assignments[0].title).toBe("수정된 과제");
});

test("keeps edited drafts when a newly added image fails and only retries that image", async ({ page }) => {
  let secondImageAttempts = 0;

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/users/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "user-1", name: "테스트", email: "test@example.com", studentNumber: "20514" } }) });
      return;
    }
    if (url.pathname === "/assignments" && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) });
      return;
    }
    if (url.pathname === "/assignment-extractions") {
      const imageIndex = Number(request.headers()["x-image-index"] || 0);
      if (imageIndex === 1 && secondImageAttempts++ === 0) {
        await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "EXTRACTION_FAILED", message: "분석 실패" } }) });
        return;
      }
      const imageId = request.headers()["x-client-image-id"];
      const assignment = imageIndex === 0
        ? { assignmentId: "draft-1", sourceOrder: 0, title: "기존 과제", subject: "수학", startDate: null, dueDate: "2030-09-05", dueTime: "18:00", sourceText: "수학 9/5", confidence: null, needsReview: false, warnings: [], possibleDuplicateOf: null }
        : { assignmentId: "draft-2", sourceOrder: 0, title: "추가 과제", subject: "과학", startDate: null, dueDate: "2030-09-06", dueTime: null, sourceText: "과학 9/6", confidence: null, needsReview: false, warnings: [], possibleDuplicateOf: null };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: {
        extractionBatchId: request.headers()["x-extraction-batch-id"], referenceDate: "2026-09-02", timezone: "Asia/Seoul",
        images: [{ imageId, imageIndex, status: "COMPLETED", assignments: [assignment], errorMessage: null }],
        summary: { totalImages: 1, completedImages: 1, failedImages: 0, totalAssignments: 1 },
      } }) });
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
  await page.goto("/?screen=dashboard&theme=dark");
  await page.getByRole("button", { name: "과제 추가", exact: true }).click();

  let chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /칠판 또는 유인물 사진 선택/ }).click();
  await (await chooser).setFiles([image("one.png")]);
  await expect(page.getByRole("textbox", { name: "과제명 1" })).toHaveValue("기존 과제");
  await page.getByRole("textbox", { name: "과제명 1" }).fill("사용자가 수정한 과제");

  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "사진 추가" }).click();
  await (await chooser).setFiles([image("two.png")]);
  await expect.poll(() => secondImageAttempts).toBe(1);
  await expect(page.getByText("사진 2장 중 1장 분석 완료")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "과제명 1" })).toHaveValue("사용자가 수정한 과제");
  await expect(page.getByText("사진 1장은 분석하지 못했어요.")).toBeVisible();

  await page.getByRole("button", { name: "실패한 사진 다시 분석" }).click();
  await expect.poll(() => secondImageAttempts).toBe(2);
  await expect(page.getByText("사진 2장 중 2장 분석 완료")).toBeVisible();
  await expect(page.locator(".assignment-draft-card")).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: "과제명 1" })).toHaveValue("사용자가 수정한 과제");
});
