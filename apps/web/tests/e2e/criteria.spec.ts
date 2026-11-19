import { test, expect } from "./fixtures";
import { DateTime } from "luxon";

test("criteria 4 and 7: overlapping calendar events selectable and Month creation remains untimed", async ({
  page,
  auth,
}) => {
  const { today, send } = auth;
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
  // The month range is a new query; until its data arrives, Calendar
  // disables creation. Wait for a persisted event in the new view.
  await expect(
    page.locator(".fc-daygrid-event").filter({ hasText: "Overlap" }).first(),
  ).toBeVisible();
  const emptyDate = DateTime.fromISO(today).plus({ days: 1 }).toISODate()!;
  const emptyCell = page.locator(`.fc-daygrid-day[data-date="${emptyDate}"]`);
  await expect(emptyCell.locator(".fc-event")).toHaveCount(0);
  // Click the empty event area, not a fixed offset that can hit the daily
  // progress button when WebKit lays out a shorter month row.
  await emptyCell.locator(".fc-daygrid-day-events").click();
  await expect(page.getByLabel("Task title")).toBeVisible();
  await expect(page.getByLabel("Scheduled date")).toHaveValue(emptyDate);
  await expect(page.getByLabel("Start time", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("End time", { exact: true })).toHaveValue("");
  await page.getByLabel("Task title").fill("Month untimed");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByLabel("Task title")).toBeHidden();
  await expect(page.locator(".fc-event-draft")).toHaveCount(0);
  await expect(
    page.locator(".fc-event").filter({ hasText: "Month untimed" }),
  ).toHaveCount(1);
  await expect(
    page.locator(".fc-event").filter({ hasText: "Month untimed" }),
  ).toBeVisible();
});

test("criterion 34: cross-device appearance preserves report period/day, unsaved editor and running timer together", async ({
  page,
  auth,
}) => {
  const { today, send } = auth;
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
  auth,
}) => {
  const { today, send } = auth;
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
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.locator(".progress-hero.complete")).toContainText("100%");
  await expect(page.locator(".progress-hero .ring-check")).toBeVisible();
});

test("criteria 37–42: inclusive daily/every-N/weekly recurrence from the creation form", async ({
  page,
  auth,
}) => {
  const { today } = auth;
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
