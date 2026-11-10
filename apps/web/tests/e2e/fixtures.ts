import { test as base, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";

/** Each test/retry/browser gets its own account and browser context. */
export const test = base.extend<{
  account: { email: string; password: string };
  auth: {
    today: string;
    send: (path: string, body: unknown, method?: string) => Promise<any>;
  };
}>({
  account: async ({}, use) => {
    await use({
      email: `e2e-${randomUUID()}@example.com`,
      password: "Strong-e2e-password-123",
    });
  },
  page: async ({ page, account }, use) => {
    await base.step("Create isolated account", async () => {
      await page.goto("/");
      await page
        .getByRole("button", { name: "Create an account", exact: true })
        .click();
      await page.getByLabel("Email", { exact: true }).fill(account.email);
      await page.getByLabel("Password", { exact: true }).fill(account.password);
      await page
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      await expect(page.locator(".fc")).toBeVisible();
    });
    await use(page);
  },
  auth: async ({ page }, use) => {
    const response = await page.request.get("/api/v1/auth/me");
    expect(response.ok()).toBeTruthy();
    const session = await response.json();
    await use({
      today: DateTime.now().setZone(session.settings.timezone).toISODate()!,
      send: async (path, body, method = "POST") => {
        const result = await page.request.fetch(`/api/v1${path}`, {
          method,
          data: body,
          headers: {
            Origin: new URL(page.url()).origin,
            "X-CSRF-Token": session.csrfToken,
            "Idempotency-Key": randomUUID(),
          },
        });
        expect(result.ok(), await result.text()).toBeTruthy();
        return result.json();
      },
    });
  },
});
export { expect };
