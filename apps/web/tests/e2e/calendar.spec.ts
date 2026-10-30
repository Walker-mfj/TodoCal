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
  await expect(page.locator(".toast-actions")).toHaveCSS("display", "flex");
  await expect(page.locator(".toast-actions")).toHaveCSS("gap", "12px");
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
  await page.locator(".unscheduled-section summary").click();
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

test("creating a task outside the visible week preserves the calendar date and scroll", async ({
  page,
}) => {
  const { date } = await setup(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const heading = await page.locator(".fc-toolbar-title").textContent();
  const scroll = () =>
    page
      .locator(".fc-scroller")
      .evaluateAll((nodes) => Math.max(...nodes.map((n) => n.scrollTop)));
  const before = await scroll();
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
  await expect(page.locator(".fc-toolbar-title")).toHaveText(heading!);
  expect(Math.abs((await scroll()) - before)).toBeLessThan(2);
  await expect(
    page.locator(".fc-event").filter({ hasText: "Visible after save" }),
  ).toHaveCount(0);
  expect(
    (await (await page.request.get("/api/v1/tasks")).json()).items,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ title: "Visible after save" }),
    ]),
  );
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

test("selecting a new time range renders a taskless preview without crashing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setup(page);
  const column = page.locator(".fc-timegrid-col.fc-day-today");
  const start = page.locator('.fc-timegrid-slot[data-time="09:00:00"]').last();
  await start.scrollIntoViewIfNeeded();
  const col = (await column.boundingBox())!;
  const from = (await start.boundingBox())!;
  const to = (await page
    .locator('.fc-timegrid-slot[data-time="10:00:00"]')
    .last()
    .boundingBox())!;
  await page.mouse.move(col.x + col.width / 2, from.y + 4);
  await page.mouse.down();
  await page.mouse.move(col.x + col.width / 2, to.y + 4, { steps: 12 });
  await expect(page.locator(".fc-event-mirror")).toBeVisible();
  expect(errors).toEqual([]);
  await page.mouse.up();
  await expect(page.getByLabel("Task title")).toBeVisible();
  expect(errors).toEqual([]);
});

test("calendar fits desktop and keeps its scroll when creating a draft; sidebar can collapse", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.locator(".idle-panel")).toHaveCount(0);
  const fits = async () => {
    const size = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      viewport: innerHeight,
    }));
    expect(size.height).toBeLessThanOrEqual(size.viewport);
    const workspace = await page.locator(".workspace").evaluate((node) => ({
      scroll: node.scrollHeight,
      client: node.clientHeight,
    }));
    expect(workspace.scroll).toBeLessThanOrEqual(workspace.client + 1);
  };
  await fits();
  const beforeWidth = (await page.locator(".calendar-card").boundingBox())!
    .width;
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(
    (await page.locator(".calendar-card").boundingBox())!.width,
  ).toBeGreaterThan(beforeWidth);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  const row = page.locator('.fc-timegrid-slot[data-time="10:00:00"]').last();
  await row.scrollIntoViewIfNeeded();
  const readScroll = () =>
    page
      .locator(".fc-scroller")
      .evaluateAll((nodes) => Math.max(...nodes.map((node) => node.scrollTop)));
  const before = await readScroll();
  const column = (await page
    .locator(".fc-timegrid-col.fc-day-today")
    .boundingBox())!;
  const box = (await row.boundingBox())!;
  await page.mouse.click(column.x + column.width / 2, box.y + 4);
  await expect(page.getByLabel("Task title")).toBeVisible();
  await expect(page.locator(".fc-event-draft")).toBeVisible();
  expect(Math.abs((await readScroll()) - before)).toBeLessThan(2);
  await fits();
  const submit = await page
    .getByRole("button", { name: "Create task", exact: true })
    .boundingBox();
  expect(submit!.y + submit!.height).toBeLessThanOrEqual(768);
  await page.screenshot({ path: "test-results/calendar-compact-editor.png" });
  await page.getByLabel("Task title").fill("Stay in place");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByLabel("Task title")).toBeHidden();
  expect(Math.abs((await readScroll()) - before)).toBeLessThan(2);
  await fits();
  await page.screenshot({ path: "test-results/calendar-compact.png" });
  const event = page.locator(".fc-event").filter({ hasText: "Stay in place" });
  await event.click();
  await page
    .getByRole("button", { name: "Mark complete", exact: true })
    .click();
  await expect(event).toHaveClass(/event-complete/);
  await expect(event.locator(".event-done")).toBeVisible();
  await page.screenshot({ path: "test-results/calendar-completed.png" });
});

test("draft drag and resize update the editor without creating a task", async ({
  page,
}) => {
  const { date } = await setup(page);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Task title").fill("Movable draft");
  await page.getByLabel("Scheduled date").fill(date);
  await page.getByLabel("Start time", { exact: true }).fill("09:00");
  await page.getByLabel("End time", { exact: true }).fill("10:00");
  const event = page.locator(".fc-event-draft");
  await expect(event).toHaveClass(/fc-event-draggable/);
  await dragMinutes(page, "Movable draft", 60);
  await expect(page.getByLabel("Start time", { exact: true })).toHaveValue(
    "10:00",
  );
  await expect(page.getByLabel("End time", { exact: true })).toHaveValue(
    "11:00",
  );
  await event.hover();
  const edge = (await event.locator(".fc-event-resizer-end").boundingBox())!;
  const slot = (await page
    .locator('.fc-timegrid-slot[data-time="10:00:00"]')
    .last()
    .boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    edge.x + edge.width / 2,
    edge.y + edge.height / 2 + slot.height,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect(page.getByLabel("End time", { exact: true })).toHaveValue(
    "11:30",
  );
  expect(
    (await (await page.request.get("/api/v1/tasks")).json()).items,
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(event).toHaveCount(0);
  const tasks = (await (await page.request.get("/api/v1/tasks")).json()).items;
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({ startTime: "10:00", endTime: "11:30" });
});

test("repeating drag asks for scope; cancel, one and all preserve occurrence details", async ({
  page,
}) => {
  const { date, send } = await setup(page);
  const tomorrow = new Date(date + "T12:00:00Z");
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const end = tomorrow.toISOString().slice(0, 10);
  await send("/series", {
    task: {
      title: "Drag repeating",
      scheduledDate: date,
      startTime: "09:00",
      endTime: "10:00",
    },
    cadence: "daily",
    intervalDays: 1,
    endDate: end,
  });
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const to = tomorrow.toISOString().slice(0, 10);
  const items = (
    await (
      await page.request.get(`/api/v1/calendar?from=${date}&to=${to}`)
    ).json()
  ).tasks;
  const first = items.find(
    (t: { scheduledDate: string }) => t.scheduledDate === date,
  );
  const second = items.find(
    (t: { scheduledDate: string }) => t.scheduledDate === end,
  );
  await send(
    `/tasks/${second.id}`,
    {
      title: "Own title",
      description: "Own notes",
      expectedRevision: second.revision,
    },
    "PATCH",
  );
  await page.reload();
  const dialog = page.getByRole("dialog", {
    name: "Reschedule repeating task",
  });
  const read = async (id: string) =>
    await (await page.request.get(`/api/v1/tasks/${id}`)).json();
  await dragMinutes(page, "Drag repeating", 60);
  await expect(dialog).toBeVisible();
  expect((await read(first.id)).startTime).toBe("09:00");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await read(first.id)).startTime).toBe("09:00");
  await dragMinutes(page, "Drag repeating", 60);
  await dialog
    .getByRole("button", { name: "This occurrence", exact: true })
    .click();
  await expect.poll(async () => (await read(first.id)).startTime).toBe("10:00");
  expect((await read(second.id)).startTime).toBe("09:00");
  await expect(
    page.locator(".fc-timegrid-event").filter({ hasText: "Drag repeating" }),
  ).toContainText("10:00");
  await dragMinutes(page, "Drag repeating", 60);
  await dialog
    .getByRole("button", { name: "All occurrences", exact: true })
    .click();
  await expect.poll(async () => (await read(first.id)).startTime).toBe("11:00");
  expect(await read(second.id)).toMatchObject({
    title: "Own title",
    description: "Own notes",
    startTime: "11:00",
    endTime: "12:00",
  });
});

test("completed calendar titles retain their strike-through after CSS scoping", async ({
  page,
}) => {
  const { date, send } = await setup(page);
  const task = await send("/tasks", {
    title: "Completed style regression",
    scheduledDate: date,
    startTime: "09:00",
    endTime: "10:00",
  });
  await send(`/tasks/${task.id}/completion`, {
    complete: true,
    expectedRevision: task.revision,
  });
  await page.reload();
  const title = page
    .locator(".fc .event-complete .event-title")
    .filter({ hasText: "Completed style regression" });
  await expect(title).toBeVisible();
  await expect(title).toHaveCSS("text-decoration-line", "line-through");
});
