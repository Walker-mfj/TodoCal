import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
for (const failure of ["denied", "quota"]) {
  test(`storage ${failure}: task retry, settings, timer and logout remain usable`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => {
      if (mode === "denied")
        Object.defineProperty(window, "sessionStorage", {
          get() {
            throw new DOMException("Blocked", "SecurityError");
          },
        });
      else
        Storage.prototype.setItem = function () {
          throw new DOMException("Full", "QuotaExceededError");
        };
    }, failure);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page
      .getByRole("button", { name: "Create an account", exact: true })
      .click();
    await page
      .getByLabel("Email", { exact: true })
      .fill(`storage-${randomUUID()}@example.com`);
    await page
      .getByLabel("Password", { exact: true })
      .fill("Storage-password-123");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(page.locator(".fc")).toBeVisible();
    await page
      .getByRole("button", { name: "New task", exact: true })
      .first()
      .click();
    await page.getByLabel("Task title").fill("Safe in memory");
    await expect(
      page.getByRole("status").filter({ hasText: "Browser storage" }),
    ).toBeVisible();
    const attempts: { key: string | undefined; body: string | null }[] = [];
    await page.route("**/api/v1/tasks", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      attempts.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      if (attempts.length === 1) {
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry save", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reconnect", exact: true }).click();
    await page.getByRole("button", { name: "Retry save", exact: true }).click();
    await expect(page.getByLabel("Task title")).toBeHidden();
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(
      page.locator(".task-open").filter({ hasText: "Safe in memory" }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Appearance").selectOption("dark");
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save settings", exact: true }),
    ).toBeEnabled();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
    await page.getByRole("button", { name: /^Focus timer/ }).click();
    await page
      .getByRole("button", { name: "Start session", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "End session", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeHidden();
    await page.getByRole("button", { name: "Close focus timer" }).click();
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page
      .getByRole("dialog", { name: "Account options" })
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
