import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("past-day creation opens the editor without shifting the calendar", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`toast-${randomUUID()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("Toast-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  const before = await page.locator(".calendar-card").boundingBox();
  await page
    .locator(".fc-day-past .fc-daygrid-day-frame")
    .first()
    .click({ position: { x: 15, y: 50 } });
  await expect(page.getByLabel("Task title")).toBeVisible();
  const after = await page.locator(".calendar-card").boundingBox();
  expect(after!.y).toBe(before!.y);
  expect(after!.height).toBe(before!.height);
  await page.getByLabel("Task title").fill("Historical plan");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByLabel("Task title")).toBeHidden();
  await expect(
    page.locator(".fc-event").filter({ hasText: "Historical plan" }),
  ).toBeVisible();
});
