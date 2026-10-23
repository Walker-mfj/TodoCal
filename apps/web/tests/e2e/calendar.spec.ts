import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function setup(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1600 });
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`drag-${randomUUID()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Strong-calendar-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator(".fc-timegrid-col.fc-day-today")).toBeVisible();
  const session = await (await page.request.get("/api/v1/auth/me")).json();
  const date = await page.evaluate(() =>
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
        "X-CSRF-Token": session.csrfToken,
        "Idempotency-Key": randomUUID(),
      },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  return { date, send };
}
async function dragMinutes(page: Page, title: string, minutes: number) {
  const event = page.locator(".fc-timegrid-event").filter({ hasText: title });
  await event.hover(); // Wait for layout and initial calendar scrolling to settle.
  const box = await event.boundingBox();
  const slot = await page
    .locator('.fc-timegrid-slot[data-time="09:00:00"]')
    .last()
    .boundingBox();
  const nextSlot = await page
    .locator('.fc-timegrid-slot[data-time="09:30:00"]')
    .last()
    .boundingBox();
  // Use row pitch (including collapsed borders), not the cell's content height.
  // FullCalendar centers the subject within its 30-minute hit row. Start
  // in the second snap and land inside (not on the edge of) the target snap.
  const x = box!.x + box!.width / 2;
  const pitch = nextSlot!.y - slot!.y;
  const y = box!.y + pitch * 0.75;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + (minutes * pitch) / 30 + pitch / 8, {
    steps: 15,
  });
  await page.mouse.up();
}
test("calendar drag snaps, Undo restores, resize saves, and Month moves preserve time", async ({
  page,
}) => {
  const { date, send } = await setup(page);
  const task = await send("/tasks", {
    title: "Move this task",
    scheduledDate: date,
    startTime: "09:00",
    endTime: "10:00",
    deadline: `${date}T12:00:00Z`,
  });
  await page.reload();
  await expect(page.locator(".fc-timegrid-event")).toBeVisible();
  await dragMinutes(page, "Move this task", 75);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  let current = await (
    await page.request.get(`/api/v1/tasks/${task.id}`)
  ).json();
  expect(current.startTime).toBe("10:15");
  expect(current.endTime).toBe("11:15");
  expect(current.deadline).toBe(`${date}T12:00:00Z`);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/tasks/${task.id}`)).json())
          .startTime,
    )
    .toBe("09:00");
  const event = page
    .locator(".fc-timegrid-event")
    .filter({ hasText: "Move this task" });
  await expect(page.locator(".undo-toast")).toBeHidden();
  await expect(event).toHaveClass(/fc-event-resizable/);
  await event.hover();
  const edge = event.locator(".fc-event-resizer-end");
  const edgeBox = await edge.boundingBox();
  const slot = await page
    .locator('.fc-timegrid-slot[data-time="09:00:00"]')
    .last()
    .boundingBox();
  await page.mouse.move(
    edgeBox!.x + edgeBox!.width / 2,
    edgeBox!.y + edgeBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    edgeBox!.x + edgeBox!.width / 2,
    edgeBox!.y + edgeBox!.height / 2 + slot!.height,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/tasks/${task.id}`)).json())
          .endTime,
    )
    .toBe("10:30");
  await page.getByRole("button", { name: "Month", exact: true }).click();
  const from = page
    .locator(".fc-daygrid-event")
    .filter({ hasText: "Move this task" });
  const next = new Date(date + "T12:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);
  const target = page.locator(`.fc-daygrid-day[data-date="${nextDate}"]`);
  await from.dragTo(target);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/tasks/${task.id}`)).json())
          .scheduledDate,
    )
    .toBe(nextDate);
  current = await (await page.request.get(`/api/v1/tasks/${task.id}`)).json();
  expect(current.startTime).toBe("09:00");
  expect(current.endTime).toBe("10:30");
});
test("calendar external drop assigns 30 minutes, clear-time drop and uncertain retry preserve identity", async ({
  page,
}) => {
  const { date, send } = await setup(page);
  const task = await send("/tasks", { title: "From unscheduled" });
  await page.reload();
  const row = page
    .locator(".unscheduled-section .task-row")
    .filter({ hasText: "From unscheduled" });
  await expect(row.locator(".drag-handle")).toBeVisible();
  const col = await page.locator(".fc-timegrid-col.fc-day-today").boundingBox();
  const slot = await page
    .locator('.fc-timegrid-slot[data-time="09:00:00"]')
    .last()
    .boundingBox();
  const grip = await row.locator(".drag-handle").boundingBox();
  await page.mouse.move(grip!.x + 5, grip!.y + 5);
  await page.mouse.down();
  await page.mouse.move(col!.x + col!.width / 2, slot!.y + 5, { steps: 25 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/tasks/${task.id}`)).json())
          .scheduledDate,
    )
    .toBe(date);
  let current = await (
    await page.request.get(`/api/v1/tasks/${task.id}`)
  ).json();
  expect(current.startTime).toBe("09:00");
  expect(current.endTime).toBe("09:30");
  const requests: { body: string | null; key: string | undefined }[] = [];
  await page.route("**/api/v1/tasks/*/schedule", async (route) => {
    requests.push({
      body: route.request().postData(),
      key: route.request().headers()["idempotency-key"],
    });
    if (requests.length === 1)
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Simulated save failure" } }),
      });
    else await route.continue();
  });
  await dragMinutes(page, "From unscheduled", 30);
  await expect(
    page.getByRole("button", { name: "Retry calendar change" }),
  ).toBeVisible();
  current = await (await page.request.get(`/api/v1/tasks/${task.id}`)).json();
  expect(current.startTime).toBe("09:00");
  await expect(page.locator(".fc-timegrid-event")).toHaveAttribute(
    "aria-label",
    new RegExp("T09:00"),
  );
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry calendar change" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Retry calendar change" }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/tasks/${task.id}`)).json())
          .startTime,
    )
    .toBe("09:30");
  expect(requests[1]).toEqual(requests[0]);
  await page.unroute("**/api/v1/tasks/*/schedule");
  const event = page.locator(".fc-timegrid-event");
  const allDay = page.locator(".fc-daygrid-day.fc-day-today");
  await event.dragTo(allDay);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/tasks/${task.id}`)).json())
          .startTime,
    )
    .toBeNull();
  current = await (await page.request.get(`/api/v1/tasks/${task.id}`)).json();
  expect(current.scheduledDate).toBe(date);
  expect(current.endTime).toBeNull();
});

test("new scheduled tasks appear immediately without navigation or polling", async ({
  page,
}) => {
  const { date } = await setup(page);
  for (const repeat of [false, true]) {
    await page
      .getByRole("button", { name: "New task", exact: true })
      .first()
      .click();
    const title = repeat ? "Immediate repeating task" : "Immediate single task";
    await page.getByLabel("Task title").fill(title);
    await page.getByLabel("Scheduled date").fill(date);
    if (repeat)
      await page
        .getByRole("combobox", { name: "Repeat", exact: true })
        .selectOption("daily");
    await page
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await expect(page.getByLabel("Task title")).toBeHidden();
    await expect(
      page.locator(".fc-event").filter({ hasText: title }).first(),
    ).toBeVisible({ timeout: 3000 });
  }
});

test("creating a task outside the visible week reveals its date and clears hiding filters", async ({
  page,
}) => {
  const { date } = await setup(page);
  const next = new Date(date + "T12:00:00Z");
  next.setUTCDate(next.getUTCDate() + 14);
  await page.getByPlaceholder("Search tasks…").fill("Something else");
  await page
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  await page.getByLabel("Task title").fill("Visible after save");
  await page.getByLabel("Scheduled date").fill(next.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByLabel("Task title")).toBeHidden();
  await expect(
    page.locator(".fc-event").filter({ hasText: "Visible after save" }),
  ).toBeVisible({ timeout: 3000 });
});

test("task validation uses an inline message instead of browser tooltips", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Task title is required." }),
  ).toBeVisible();
  await expect(page.getByLabel("Task title")).toBeFocused();
  await page.screenshot({ path: "test-results/custom-validation.png" });
});
