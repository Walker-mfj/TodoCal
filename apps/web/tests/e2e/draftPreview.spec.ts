import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function slot(page: Page, time: string) {
  const row = page.locator(`.fc-timegrid-slot[data-time="${time}:00"]`).last();
  await row.scrollIntoViewIfNeeded();
  const column = (await page
    .locator(".fc-timegrid-col.fc-day-today")
    .boundingBox())!;
  const box = (await row.boundingBox())!;
  await page.mouse.click(column.x + column.width / 2, box.y + 4);
}
test("calendar previews create/edit drafts without saving; slot selection retargets the same task", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`preview-${randomUUID()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Preview-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator(".fc")).toBeVisible();
  await slot(page, "09:00");
  const longTitle = "Draft " + "x".repeat(294);
  await page.getByLabel("Task title").pressSequentially(longTitle);
  await expect(page.getByLabel("Task title")).toHaveValue(longTitle);
  await expect(page.locator(".fc-event-draft")).toContainText(longTitle);
  await page.getByLabel("Task title").fill("");
  await page.getByLabel("Task title").pressSequentially("Draft appointment");
  await expect(page.getByLabel("Task title")).toHaveValue("Draft appointment");
  const preview = page.locator(".fc-event-draft");
  await expect(preview).toContainText("Draft appointment");
  await expect(preview).toContainText("Draft");
  expect(
    (await (await page.request.get("/api/v1/tasks")).json()).items,
  ).toHaveLength(0);
  await page.getByLabel("Start time", { exact: true }).fill("10:00");
  await page.getByLabel("End time", { exact: true }).fill("11:00");
  await expect(preview).toContainText("10:00");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(
    page.locator(".fc-event").filter({ hasText: "Draft appointment" }),
  ).toHaveCount(1);
  const saved = (await (await page.request.get("/api/v1/tasks")).json())
    .items[0];
  await page
    .locator(".fc-event")
    .filter({ hasText: "Draft appointment" })
    .click();
  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  await page.getByLabel("Task title").fill("Changed appointment");
  await expect(preview).toContainText("Changed appointment");
  await expect(
    page
      .locator(".fc-event:not(.fc-event-draft)")
      .filter({ hasText: "Draft appointment" }),
  ).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/v1/tasks/${saved.id}`)).json()).title,
  ).toBe("Draft appointment");
  await page.screenshot({ path: "test-results/calendar-live-draft.png" });
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(preview).toHaveCount(0);
  const original = page
    .locator(".fc-event")
    .filter({ hasText: "Draft appointment" });
  await expect(original).toHaveCount(1);
  await original.click();
  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  // Confirming Close editor explicitly discards the previous unsaved draft.
  await expect(page.getByLabel("Task title")).toHaveValue("Draft appointment");
  await page.getByLabel("Task title").fill("Changed appointment");
  await expect(preview).toContainText("Changed appointment");
  await slot(page, "12:00");
  await expect(
    page.getByRole("heading", { name: "Edit task", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Task title")).toHaveValue(
    "Changed appointment",
  );
  await expect(page.getByLabel("Start time", { exact: true })).toHaveValue(
    "12:00",
  );
  await expect(preview).toHaveAccessibleName(
    /Unsaved draft: Changed appointment, .*T12:00/,
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(preview).toHaveCount(0);
  const tasks = (await (await page.request.get("/api/v1/tasks")).json()).items;
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({
    id: saved.id,
    title: "Changed appointment",
    startTime: "12:00",
    endTime: "12:30",
  });
});
