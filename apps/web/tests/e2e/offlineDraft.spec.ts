import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("offline draft survives reconnect and page reload and saves exactly once", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`offline-draft-${randomUUID()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Offline-draft-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  await context.setOffline(true);
  await page.getByLabel("Task title").fill("Recover after network loss");
  await expect(
    page.getByRole("button", { name: "Create task", exact: true }),
  ).toBeDisabled();
  // The draft is session-scoped: wait for persistence before reloading the tab.
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(sessionStorage)
          .filter((key) => key.startsWith("focus:draft:"))
          .some(
            (key) =>
              JSON.parse(sessionStorage.getItem(key)!).draft.title ===
              "Recover after network loss",
          ),
      ),
    )
    .toBe(true);
  await context.setOffline(false);
  await page.reload();
  await page
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Task title")).toHaveValue(
    "Recover after network loss",
  );
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByLabel("Task title")).toBeHidden();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(
    page
      .locator(".task-open")
      .filter({ hasText: "Recover after network loss" }),
  ).toHaveCount(1);
  await page.reload();
  await page
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Task title")).toHaveValue("");
});
