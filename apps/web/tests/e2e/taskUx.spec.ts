import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";

async function setup(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`ux-${randomUUID()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Strong-ux-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator(".fc-timegrid-col.fc-day-today")).toBeVisible();
  const session = await (await page.request.get("/api/v1/auth/me")).json();
  const send = async (path: string, body: unknown, method = "POST") => {
    const response = await page.request.fetch(`/api/v1${path}`, {
      method,
      data: body,
      headers: {
        Origin: new URL(page.url()).origin,
        "X-CSRF-Token": session.csrfToken,
        "Idempotency-Key": randomUUID(),
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  return {
    send,
    today: DateTime.now().setZone(session.settings.timezone).toISODate()!,
  };
}

test("future completion preserves schedule and deleted task can be restored", async ({
  page,
}) => {
  const { send, today } = await setup(page);
  const date = DateTime.fromISO(today).plus({ days: 2 }).toISODate()!;
  const task = await send("/tasks", {
    title: "Finish early",
    scheduledDate: date,
  });
  await page.reload();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: /^Finish early/ }).click();
  await page
    .getByRole("button", { name: "Mark complete", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Delete task", exact: true }),
  ).toHaveCount(0);
  const finished = await (
    await page.request.get(`/api/v1/tasks/${task.id}`)
  ).json();
  expect(finished.scheduledDate).toBe(date);
  expect(finished.completedAt).toBeTruthy();
  await page.getByRole("button", { name: /^Finish early/ }).click();
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  const confirmation = page.getByRole("dialog");
  if (await confirmation.isVisible())
    await confirmation
      .getByRole("button", { name: "Delete task", exact: true })
      .click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Finish early/ }),
  ).toBeVisible();
  const restored = await (
    await page.request.get(`/api/v1/tasks/${task.id}`)
  ).json();
  expect(restored.scheduledDate).toBe(date);
  expect(restored.status).toBe("complete");
});

test("historical creation remains editable and revises daily analytics", async ({
  page,
}) => {
  const { send, today } = await setup(page);
  const date = DateTime.fromISO(today).minus({ days: 2 }).toISODate()!;
  const task = await send("/tasks", {
    title: "Historical task",
    scheduledDate: date,
  });
  await page.reload();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: /^Historical task/ }).click();
  await page
    .getByRole("button", { name: "Mark complete", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Delete task", exact: true }),
  ).toHaveCount(0);
  const day = await (
    await page.request.get(`/api/v1/reports/days/${date}`)
  ).json();
  expect(day.planned).toBe(1);
  expect(day.completed).toBe(1);
  await page.getByRole("button", { name: /^Historical task/ }).click();
  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  await page.getByLabel("Task title").fill("Historical task revised");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Historical task revised/ }),
  ).toBeVisible();
  const report = await (
    await page.request.get(`/api/v1/reports/days/${date}`)
  ).json();
  expect(
    report.entries.find((x: any) => x.task.id === task.id).task.title,
  ).toBe("Historical task revised");
});

test("compact calendar quick focus supports keyboard, pause and competing tasks", async ({
  page,
}) => {
  const { send, today } = await setup(page);
  const a = await send("/tasks", {
    title: "Read compact",
    scheduledDate: today,
    startTime: "09:00",
    endTime: "09:15",
    focusMinutes: 40,
    estimatedPomodoros: 2,
    priority: "high",
  });
  await send("/tasks", {
    title: "Another compact",
    scheduledDate: today,
    startTime: "09:30",
    endTime: "09:45",
  });
  await page.reload();
  const card = page.locator(".fc-event").filter({ hasText: "Read compact" });
  await expect(card).toBeVisible();
  const initialHeight = (await card.boundingBox())!.height;
  await card.focus();
  const start = card.getByRole("button", {
    name: "Start focus for Read compact · 40 min",
  });
  await expect(start).toBeVisible();
  await expect(card.locator(".focus-stopwatch")).toHaveCount(2);
  await start.focus();
  await page.keyboard.press("Enter");
  const pause = card.getByRole("button", {
    name: "Pause focus for Read compact",
  });
  await expect(pause).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Focus timer", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close focus timer" }).click();
  expect((await card.boundingBox())!.height).toBe(initialHeight);
  await pause.click();
  await expect(
    card.getByRole("button", { name: "Resume focus for Read compact" }),
  ).toBeVisible();
  const other = page
    .locator(".fc-event")
    .filter({ hasText: "Another compact" });
  await other.hover();
  await other.getByRole("button", { name: /Start focus/ }).click();
  await expect(
    page.getByText(/End the current session for Read compact/),
  ).toBeVisible();
  const state = await (await page.request.get("/api/v1/focus")).json();
  expect(state.active.taskId).toBe(a.id);
  expect(state.active.status).toBe("paused");
  expect(state.active.targetSeconds).toBe(2400);
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await card
    .getByRole("button", { name: "Resume focus for Read compact" })
    .focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("dialog", { name: "Focus timer", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close focus timer" }).click();
  await expect(pause).toBeVisible();
  const saved = await (await page.request.get(`/api/v1/tasks/${a.id}`)).json();
  expect(saved.scheduledDate).toBe(today);
  expect(saved.startTime).toBe("09:00");
  expect(saved.status).toBe("incomplete");
  await card.screenshot({ path: "test-results/compact-quick-focus.png" });
});
