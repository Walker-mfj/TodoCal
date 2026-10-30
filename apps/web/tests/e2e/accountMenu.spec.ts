import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("account popover contains focus toggle and sign out, dismisses and works collapsed", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  const email = `account-${randomUUID()}@example.com`;
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Account-menu-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const trigger = page.getByRole("button", {
    name: `Account: ${email}`,
    exact: true,
  });
  const panel = page.getByRole("dialog", { name: "Account options" });
  await expect(
    page.getByRole("switch", { name: "Show floating focus timer" }),
  ).toBeHidden();
  await trigger.click();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(email);
  await expect(panel).toContainText("Connected");
  await panel.getByRole("switch").click();
  await expect(
    page.getByRole("button", { name: "Focus timer", exact: true }),
  ).toBeHidden();
  await panel.getByRole("switch").click();
  await expect(
    page.getByRole("button", { name: "Focus timer", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/account-popover.png" });
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toBeVisible();
  await trigger.click();
  await expect(panel.getByRole("switch")).toBeVisible();
  await page
    .getByRole("heading", { name: "A week with room to focus." })
    .click();
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Collapse sidebar" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await panel.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});
