import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function register(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`settings-${randomUUID()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Settings-test-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Appearance")).toBeEnabled();
}

test("expired access recovers during a combined settings save without losing edits", async ({
  page,
  context,
}, info) => {
  await register(page);
  const identity = (await (await page.request.get("/api/v1/auth/me")).json())
    .user.id;
  await page.getByLabel("Appearance").selectOption("dark");
  await page.getByLabel("Focus minutes", { exact: true }).fill("35");
  await page.getByLabel("Scheduled task reminders").check();
  let refreshes = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/auth/refresh")) refreshes++;
  });
  await context.clearCookies({ name: "focus_session" });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  expect(me.user.id).toBe(identity);
  expect(me.settings.focusMinutes).toBe(35);
  expect(me.settings.appearance).toBe("dark");
  expect(
    (await (await page.request.get("/api/v1/notifications")).json()).preferences
      .taskStart,
  ).toBe(true);
  expect(refreshes).toBe(1);
  await page.screenshot({
    path: info.outputPath("settings-dark-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("settings-dark-mobile.png"),
    fullPage: true,
  });
  await page.getByLabel("Appearance").selectOption("light");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await page.screenshot({
    path: info.outputPath("settings-light-mobile.png"),
    fullPage: true,
  });
});

test("two tabs share one renewal after the access cookie expires", async ({
  page,
  context,
}) => {
  await register(page);
  const other = await context.newPage();
  await other.goto("/");
  await expect(
    other.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  let refreshes = 0;
  context.on("request", (r) => {
    if (r.url().endsWith("/auth/refresh")) refreshes++;
  });
  await context.clearCookies({ name: "focus_session" });
  await Promise.all([page.reload(), other.reload()]);
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    other.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  expect(refreshes).toBe(1);
});
