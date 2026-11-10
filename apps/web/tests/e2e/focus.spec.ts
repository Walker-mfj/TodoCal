import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
const password = "Strong-focus-password-123";
async function signIn(page: Page, email: string, register = false) {
  await page.goto("/");
  if (register)
    await page
      .getByRole("button", { name: "Create an account", exact: true })
      .click();
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
test("optional timer persists across reloads and devices; task completion is independent", async ({
  page,
  browser,
}) => {
  const email = `focus-${randomUUID()}@example.com`;
  await signIn(page, email, true);
  await page
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  await page.getByLabel("Task title").fill("Focus independently");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await page.getByRole("button", { name: /^Focus independently/ }).click();
  await page
    .getByRole("button", { name: "Focus on this task", exact: true })
    .click();
  const panel = page.getByRole("dialog", { name: "Focus timer", exact: true });
  await panel
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Pause", exact: true }),
  ).toBeEnabled();
  await expect(panel).toContainText("Focus independently");
  await expect(panel.getByRole("timer")).toHaveText(/2[45]:\d\d/);
  await panel.getByRole("button", { name: "Close focus timer" }).click();
  await page
    .getByRole("button", { name: "Mark complete", exact: true })
    .click();
  await page.getByRole("button", { name: /^Focus timer/ }).click();
  await expect(
    panel.getByRole("button", { name: "Pause", exact: true }),
  ).toBeEnabled();
  await panel.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(panel).toContainText("Paused");
  const frozen = await panel.getByRole("timer").textContent();
  await page.reload();
  await expect(panel).toContainText("Paused");
  await expect(panel.getByRole("timer")).toHaveText(frozen!);
  const context = await browser.newContext();
  const other = await context.newPage();
  await signIn(other, email);
  await other.getByRole("button", { name: /^Focus timer/ }).click();
  const otherPanel = other.getByRole("dialog", {
    name: "Focus timer",
    exact: true,
  });
  await expect(otherPanel).toContainText("Paused");
  await otherPanel.getByRole("button", { name: "Resume", exact: true }).click();
  await page.reload();
  await expect(
    panel.getByRole("button", { name: "Pause", exact: true }),
  ).toBeEnabled();
  await panel.getByRole("button", { name: "End session", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Start session", exact: true }),
  ).toBeEnabled();
  await expect(panel).toContainText("0 Pomodoro");
  await panel.getByRole("button", { name: "Short break", exact: true }).click();
  await panel
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(panel.getByRole("heading")).toHaveText("Short break");
  await expect(panel.getByRole("timer")).toHaveText(/0[45]:\d\d/);
  await page.screenshot({
    animations: "disabled",
    path: "test-results/focus-light.png",
  });
  await panel.getByRole("button", { name: "End session", exact: true }).click();
  await expect(panel).toContainText("Break time does not count as focus.");
  await panel.getByRole("button", { name: "Close focus timer" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Appearance").selectOption("dark");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await page.screenshot({
    animations: "disabled",
    path: "test-results/focus-dark.png",
  });
  await context.close();
});
test("notification denial does not block a free focus session", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "requestPermission", {
      value: async () => "denied",
    });
    Object.defineProperty(Notification, "permission", { get: () => "default" });
  });
  await signIn(page, `notification-${randomUUID()}@example.com`, true);
  await page.getByRole("button", { name: /^Focus timer/ }).click();
  await page
    .getByRole("button", { name: "Enable completion notifications" })
    .click();
  await expect(
    page.getByText(
      "Notifications are blocked. The timer still works normally.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Focus timer", exact: true })
      .getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Focus timer", exact: true })
      .getByRole("button", { name: "Pause", exact: true }),
  ).toBeHidden();
});

test("an uncertain timer start retries the identical command without a second session", async ({
  page,
}) => {
  await signIn(page, `retry-focus-${randomUUID()}@example.com`, true);
  await page.getByRole("button", { name: /^Focus timer/ }).click();
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route("**/api/v1/focus", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    if (requests.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Focus timer", exact: true })
      .getByRole("button", { name: "Retry timer action" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await page.getByRole("button", { name: /^Focus timer/ }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Focus timer", exact: true })
      .getByRole("button", { name: "Retry timer action" }),
  ).toBeEnabled();
  await page
    .getByRole("dialog", { name: "Focus timer", exact: true })
    .getByRole("button", { name: "Retry timer action" })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Focus timer", exact: true })
      .getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "Focus timer", exact: true })
      .getByRole("button", { name: "Retry timer action" }),
  ).toBeHidden();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await page.getByRole("button", { name: "End session", exact: true }).click();
});

test("Focus pause, resume and end synchronize across tabs without reloading", async ({
  page,
  context,
}) => {
  await signIn(page, `focus-tabs-${randomUUID()}@example.com`, true);
  const other = await context.newPage();
  await other.goto("/");
  for (const tab of [page, other]) {
    await tab.getByRole("button", { name: /^Focus timer/ }).click();
  }
  const panel = page.getByRole("dialog", { name: "Focus timer", exact: true });
  const otherPanel = other.getByRole("dialog", {
    name: "Focus timer",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(
    otherPanel.getByRole("button", { name: "Pause", exact: true }),
  ).toBeEnabled();
  const active = await (await page.request.get("/api/v1/focus")).json();
  expect(active.active).not.toBeNull();
  await otherPanel.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(panel).toContainText("Paused");
  await expect(otherPanel).toContainText("Paused");
  await expect(panel.getByRole("timer")).toHaveText(
    (await otherPanel.getByRole("timer").textContent())!,
  );
  await panel.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    otherPanel.getByRole("button", { name: "Pause", exact: true }),
  ).toBeEnabled();
  const resumed = await (await other.request.get("/api/v1/focus")).json();
  expect(resumed.active.id).toBe(active.active.id);
  await otherPanel
    .getByRole("button", { name: "End session", exact: true })
    .click();
  for (const dialog of [panel, otherPanel]) {
    await expect(
      dialog.getByRole("button", { name: "Start session", exact: true }),
    ).toBeEnabled();
  }
  const ended = await (await page.request.get("/api/v1/focus")).json();
  expect(ended.active).toBeNull();
  expect(ended.last.id).toBe(active.active.id);
  await other.close();
});
