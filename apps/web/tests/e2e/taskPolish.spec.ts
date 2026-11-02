import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("focus position, field errors, compact drafts, colors and navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`polish-${randomUUID()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Polish-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const focus = page.getByRole("button", { name: /^Focus timer/ });
  await expect(focus).toBeVisible();
  const box = (await focus.boundingBox())!;
  await page.mouse.move(box.x + 32, box.y + 32);
  await page.mouse.down();
  await page.mouse.move(500, 400, { steps: 12 });
  await page.mouse.up();
  const moved = (await focus.boundingBox())!;
  await page.reload();
  await expect(focus).toBeVisible();
  await expect.poll(async () => (await focus.boundingBox())?.x).toBe(moved.x);
  await expect.poll(async () => (await focus.boundingBox())?.y).toBe(moved.y);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  const title = page.getByLabel("Task title", { exact: true });
  const error = page.locator(".field-error");
  await expect(error).toContainText("required");
  expect((await error.boundingBox())!.y).toBeGreaterThan(
    (await title.boundingBox())!.y,
  );
  await title.fill("Short draft");
  await page
    .getByLabel("Scheduled date")
    .fill(
      (await page
        .locator(".fc-timegrid-col.fc-day-today")
        .getAttribute("data-date"))!,
    );
  await page.getByLabel("Start time", { exact: true }).fill("10:00");
  await page.getByLabel("End time", { exact: true }).fill("10:05");
  const preview = page.locator(".fc-event-draft");
  await preview.scrollIntoViewIfNeeded();
  await expect(preview.locator(".event-title")).toBeVisible();
  const bounds = (await preview.boundingBox())!;
  const textBounds = (await preview.locator(".event-title").boundingBox())!;
  expect(textBounds.y).toBeGreaterThanOrEqual(bounds.y);
  expect(textBounds.y + textBounds.height).toBeLessThanOrEqual(
    bounds.y + bounds.height + 1,
  );
  await page.screenshot({ path: "test-results/short-draft-polish.png" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "New task" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Groups", exact: true }).click();
  await page.getByLabel("Group name").fill("Blue group");
  await page.getByRole("button", { name: "Purple", exact: true }).click();
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page.locator(".group-row")).toContainText("Blue group");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Purple", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Custom color", exact: true }).click();
  await expect(page.getByLabel("Custom color", { exact: true })).toBeVisible();
});

test("repeating edits ask for scope and update generated occurrences", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`scope-${randomUUID()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("Scope-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Task title").fill("Recurring original");
  await page
    .getByLabel("Scheduled date")
    .fill(
      (await page
        .locator(".fc-timegrid-col.fc-day-today")
        .getAttribute("data-date"))!,
    );
  await page
    .getByRole("combobox", { name: "Repeat", exact: true })
    .selectOption("daily");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "New task" }),
  ).toHaveCount(0);
  await page
    .locator(".fc-event:not(.fc-event-draft)")
    .filter({ hasText: "Recurring original" })
    .first()
    .click();
  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  await page.getByLabel("Task title").fill("Recurring updated");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit repeating task" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "This and following", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".fc-event").filter({ hasText: "Recurring updated" }).first(),
  ).toBeVisible();
  await expect(
    page.locator(".fc-event").filter({ hasText: "Recurring original" }),
  ).toHaveCount(0);
});
