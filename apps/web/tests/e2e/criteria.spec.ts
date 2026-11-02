import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function setup(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`criteria-${randomUUID()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Criteria-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator(".fc")).toBeVisible();
  const auth = await (await page.request.get("/api/v1/auth/me")).json();
  const today = await page.evaluate(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  const send = async (path: string, body: unknown, method = "POST") => {
    const response = await page.request.fetch(`/api/v1${path}`, {
      method,
      data: body,
      headers: {
        Origin: new URL(page.url()).origin,
        "X-CSRF-Token": auth.csrfToken,
        "Idempotency-Key": randomUUID(),
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  return { today, send };
}

test("criteria 11–14, 18, 35–36: exact progress transitions and independent unscheduled completion", async ({
  page,
}) => {
  const { today, send } = await setup(page);
  const tasks = [];
  for (let i = 0; i < 5; i++)
    tasks.push(
      await send("/tasks", {
        title: `Planned ${i}`,
        scheduledDate: today,
        ...(i === 0 ? { startTime: "09:00", endTime: "09:30" } : {}),
      }),
    );
  for (const task of tasks.slice(0, 3))
    await send(`/tasks/${task.id}/completion`, {
      complete: true,
      expectedRevision: 1,
    });
  await page.reload();
  await expect(page.locator(".progress-hero")).toContainText("60%");
  await send("/tasks", { title: "One more", scheduledDate: today });
  await page.reload();
  await expect(page.locator(".progress-hero")).toContainText("50%");
  await send(`/tasks/${tasks[0].id}/completion`, {
    complete: false,
    expectedRevision: 2,
  });
  await page.reload();
  await expect(page.locator(".progress-hero")).toContainText("33.3%");
  const unscheduled = await send("/tasks", { title: "Unscheduled complete" });
  await send(`/tasks/${unscheduled.id}/completion`, {
    complete: true,
    expectedRevision: 1,
  });
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  await expect(page.locator(".analytics-metrics")).toContainText(
    "2/6 planned occurrences",
  );
  await expect(
    page.locator(".metric").filter({ hasText: "Completed tasks" }),
  ).toContainText("3");
  for (const theme of ["light", "dark"]) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Appearance").selectOption(theme);
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save settings", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Progress", exact: true }).click();
    await expect(page.locator(".progress-legend")).toContainText("100%");
    await expect(page.locator(".day-progress.starting")).toHaveCount(1);
  }
});

test("criteria 4 and 7: overlapping calendar events selectable and Month creation remains untimed", async ({
  page,
}) => {
  const { today, send } = await setup(page);
  for (let i = 0; i < 4; i++)
    await send("/tasks", {
      title: `Overlap ${i}`,
      scheduledDate: today,
      startTime: "09:00",
      endTime: "10:00",
    });
  await page.reload();
  for (let i = 0; i < 4; i++) {
    const event = page
      .locator(".fc-timegrid-event")
      .filter({ hasText: `Overlap ${i}` });
    await expect(event).toBeVisible();
    await event.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: `Overlap ${i}`, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await page
    .locator(`.fc-daygrid-day[data-date="${today}"] .fc-daygrid-day-frame`)
    .click({ position: { x: 12, y: 40 } });
  await expect(page.getByLabel("Task title")).toBeVisible();
  await expect(page.getByLabel("Start time", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("End time", { exact: true })).toHaveValue("");
  await page.getByLabel("Task title").fill("Month untimed");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(
    page.locator(".fc-event").filter({ hasText: "Month untimed" }),
  ).toBeVisible();
});

test("criterion 34: cross-device appearance preserves report period/day, unsaved editor and running timer together", async ({
  page,
}) => {
  const { today, send } = await setup(page);
  await send("/tasks", { title: "Selected day plan", scheduledDate: today });
  await send("/focus", { kind: "focus" });
  await page.reload();
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  await page.getByLabel("Progress period").selectOption("month");
  await page
    .locator(".report-days .day-progress")
    .filter({ hasText: "0/1" })
    .click();
  const selected = await page
    .locator('.report-days [aria-pressed="true"]')
    .getAttribute("title");
  await page
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  await page.getByLabel("Task title").fill("Keep this unsaved draft");
  const settings = await (await page.request.get("/api/v1/settings")).json();
  await send(
    "/settings",
    { appearance: "dark", expectedRevision: settings.revision },
    "PATCH",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await expect(page.getByLabel("Task title")).toHaveValue(
    "Keep this unsaved draft",
  );
  await expect(page.getByLabel("Progress period")).toHaveValue("month");
  await expect(
    page.locator('.report-days [aria-pressed="true"]'),
  ).toHaveAttribute("title", selected!);
  await expect(
    page.getByRole("button", { name: /^Focus timer/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Focus timer/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Focus timer" }).getByRole("timer"),
  ).toHaveText(/2[45]:\d\d/);
  await page.getByRole("button", { name: "End session", exact: true }).click();
});

test("criteria 35–36: every completion band and exact 100% checkmark across themes", async ({
  page,
}) => {
  const { today, send } = await setup(page);
  const tasks = [];
  for (let i = 0; i < 10; i++)
    tasks.push(
      await send("/tasks", { title: `Band ${i}`, scheduledDate: today }),
    );
  let done = 0;
  for (const [count, band] of [
    [0, "zero"],
    [1, "starting"],
    [5, "building"],
    [8, "strong"],
    [10, "complete"],
  ] as const) {
    while (done < count) {
      await send(`/tasks/${tasks[done].id}/completion`, {
        complete: true,
        expectedRevision: 1,
      });
      done++;
    }
    await page.reload();
    await expect(page.locator(`.progress-hero.${band}`)).toContainText(
      `${count * 10}%`,
    );
  }
  await expect(page.locator(".progress-hero .ring-check")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Appearance").selectOption("dark");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save settings", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.locator(".progress-hero.complete")).toContainText("100%");
  await expect(page.locator(".progress-hero .ring-check")).toBeVisible();
});

test("criteria 37–42: inclusive daily/every-N/weekly recurrence from the creation form", async ({
  page,
}) => {
  const { today } = await setup(page);
  const add = (days: number) =>
    new Date(new Date(`${today}T12:00:00Z`).getTime() + days * 86400000)
      .toISOString()
      .slice(0, 10);
  for (const [cadence, count] of [
    ["daily", 7],
    ["interval", 4],
    ["weekly", 1],
  ] as const) {
    await page
      .getByRole("button", { name: "New task", exact: true })
      .first()
      .click();
    await page.getByLabel("Task title").fill(`Cadence ${cadence}`);
    await page.getByLabel("Scheduled date").fill(today);
    await page
      .getByRole("combobox", { name: "Repeat", exact: true })
      .selectOption(cadence);
    if (cadence === "interval") await page.getByLabel("Every (days)").fill("2");
    await page.getByLabel("Repeat until (inclusive)").fill(add(6));
    await page
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await expect(page.getByLabel("Task title")).toBeHidden();
    const calendar = await (
      await page.request.get(`/api/v1/calendar?from=${today}&to=${add(7)}`)
    ).json();
    expect(
      calendar.tasks.filter(
        (t: { title: string }) => t.title === `Cadence ${cadence}`,
      ),
    ).toHaveLength(count);
  }
  await page.reload();
  const calendar = await (
    await page.request.get(`/api/v1/calendar?from=${today}&to=${add(7)}`)
  ).json();
  expect(calendar.tasks).toHaveLength(12);
  expect(new Set(calendar.tasks.map((t: { id: string }) => t.id)).size).toBe(
    12,
  );
});
