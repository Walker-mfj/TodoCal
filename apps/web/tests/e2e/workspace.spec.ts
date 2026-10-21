import { test, expect, type Page } from "@playwright/test";
const password = "A-strong-test-password-123";
async function signIn(page: Page, email: string, register = false) {
  await page.goto("/");
  if (register)
    await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", {
      name: register ? "Create account" : "Sign in",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "A week with room to focus." }),
  ).toBeVisible();
}
test("real API: tasks, recurrence, groups, progress, theme and second-browser persistence", async ({
  page,
  browser,
}) => {
  const email = `workspace-${Date.now()}@example.com`;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, email, true);
  await page
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  await page.getByLabel("Task title").fill("Read without a timer");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Read without a timer/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Read without a timer/ }).click();
  await expect(page.getByText("Not needed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  const date = await page.evaluate(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  await page.getByLabel("Scheduled date").fill(date);
  await page.getByLabel("Start time", { exact: true }).fill("09:00");
  await page.getByLabel("End time", { exact: true }).fill("09:30");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByLabel("Task title")).toBeHidden();
  await page
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  await page.getByLabel("Task title").fill("Daily practice");
  await page.getByLabel("Scheduled date").fill(date);
  await page
    .getByRole("combobox", { name: "Repeat", exact: true })
    .selectOption("daily");
  await page.getByLabel("Repeat until (inclusive)").fill(date);
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByLabel("Task title")).toBeHidden();
  await page.getByRole("button", { name: "Groups", exact: true }).click();
  await page.getByLabel("Group name").fill("Personal");
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page.locator(".group-row")).toContainText("Personal");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Appearance").selectOption("dark");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.locator(".fc-event")).toHaveCount(2);
  await page.screenshot({
    path: "test-results/clear-week-dark.png",
    fullPage: true,
  });
  const second = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "America/Los_Angeles",
  });
  const other = await second.newPage();
  await signIn(other, email);
  await expect(other.locator("html")).toHaveAttribute("data-mode", "dark");
  await expect(other.locator(".fc-event")).toHaveCount(2);
  await expect(
    other.locator(".fc-event").filter({ hasText: "Read without a timer" }),
  ).toContainText("09:00");
  await other.getByRole("button", { name: "Tasks", exact: true }).click();
  await other
    .getByRole("button", { name: "Complete Read without a timer", exact: true })
    .click();
  await expect(other.locator(".progress-hero")).toContainText("1 of 2");
  await page.reload();
  await expect(page.locator(".progress-hero")).toContainText("1 of 2");
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  await page.getByLabel("Progress period").selectOption("month");
  await expect(page.locator(".report-days .day-progress")).toHaveCount(
    new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate(),
  );
  await page
    .locator(".report-days .day-progress")
    .filter({ hasText: new Date(date + "T12:00:00").getDate().toString() })
    .first()
    .click();
  await expect(page.locator(".day-detail")).toBeVisible();
  await page.screenshot({
    path: "test-results/clear-week-month.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close day details" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Appearance").selectOption("light");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.screenshot({
    path: "test-results/clear-week-light.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect
    .poll(async () => {
      const edge = await page
        .locator(".fc-col-header-cell")
        .last()
        .boundingBox();
      const card = await page.locator(".calendar-card").boundingBox();
      return edge!.x + edge!.width <= card!.x + card!.width;
    })
    .toBe(true);
  await page.screenshot({
    path: "test-results/clear-week-1024.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1024);
  expect(errors).toEqual([]);
  await second.close();
});
test("expired session keeps the original account draft and never shows it to another account", async ({
  page,
  context,
}) => {
  const a = `draft-a-${Date.now()}@example.com`,
    b = `draft-b-${Date.now()}@example.com`;
  await signIn(page, a, true);
  await page
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  await page.getByLabel("Task title").fill("Private unfinished draft");
  await context.clearCookies();
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await signIn(page, b, true);
  await page
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Task title")).toHaveValue("");
  await page.getByRole("button", { name: "Close editor" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, a);
  await expect(page.getByLabel("Task title")).toHaveValue(
    "Private unfinished draft",
  );
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.getByLabel("Task title")).toBeHidden();
  await expect(
    page.getByRole("button", { name: /^Private unfinished draft/ }),
  ).toBeVisible();
});
test("calendar click/selection, filtered progress, conflicts, offline writes and stopping recurrence", async ({
  page,
  context,
  browser,
}) => {
  const email = `calendar-${Date.now()}@example.com`;
  await signIn(page, email, true);
  const todayColumn = page.locator(".fc-timegrid-col.fc-day-today");
  const box = await todayColumn.boundingBox();
  const slot = await page
    .locator('.fc-timegrid-slot[data-time="09:00:00"]')
    .last()
    .boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, slot!.y + 5);
  await expect(page.getByLabel("Start time", { exact: true })).toHaveValue(
    "09:00",
  );
  await expect(page.getByLabel("End time", { exact: true })).toHaveValue(
    "09:30",
  );
  await page.getByRole("button", { name: "Close editor" }).click();
  const endSlot = await page
    .locator('.fc-timegrid-slot[data-time="10:00:00"]')
    .last()
    .boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, slot!.y + 5);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, endSlot!.y + 10, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel("Start time", { exact: true })).toHaveValue(
    "09:00",
  );
  await expect(page.getByLabel("End time", { exact: true })).toHaveValue(
    "10:30",
  );
  await page.getByLabel("Task title").fill("Shared revision task");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByLabel("Task title")).toBeHidden();
  const second = await browser.newContext();
  const other = await second.newPage();
  await signIn(other, email);
  await other.getByRole("button", { name: "Tasks", exact: true }).click();
  await other
    .locator(".task-open")
    .filter({ hasText: "Shared revision task" })
    .click();
  await other.getByRole("button", { name: "Edit task", exact: true }).click();
  await other.getByLabel("Task title").fill("Changed in second browser");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page
    .locator(".task-open")
    .filter({ hasText: "Shared revision task" })
    .click();
  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  await page.getByLabel("Task title").fill("My conflicting draft");
  await other
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(other.getByLabel("Task title")).toBeHidden();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".detail-panel [role=alert]")).toContainText(
    "changed elsewhere",
  );
  await expect(page.getByLabel("Task title")).toHaveValue(
    "My conflicting draft",
  );
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Discard draft and reload" }).click();
  await expect(page.locator(".task-open")).toContainText(
    "Changed in second browser",
  );
  await page.getByLabel("Search tasks").fill("nothing matches");
  await expect(page.locator(".progress-hero")).toContainText("0 of 1");
  await page.getByLabel("Search tasks").fill("");
  await page
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  await page.getByLabel("Task title").fill("Offline draft");
  await context.setOffline(true);
  await expect(
    page.getByRole("button", { name: "Create task", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Task title")).toHaveValue("Offline draft");
  await context.setOffline(false);
  await expect(
    page.getByRole("button", { name: "Create task", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Repeat", exact: true })
    .selectOption("weekly");
  const date = await page.evaluate(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
      new Date(),
    ),
  );
  await page.getByLabel("Scheduled date").fill(date);
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByLabel("Task title")).toBeHidden();
  await page.locator(".task-open").filter({ hasText: "Offline draft" }).click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Stop repeating after today", exact: true })
    .click();
  await expect(
    page.getByText("Recurrence stopped.", { exact: true }),
  ).toBeVisible();
  await second.close();
});
