import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("focus scene custom duration persists, pauses, exits and resumes", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`scene-${randomUUID()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Focus-scene-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Task title").fill("A focused session");
  await page.getByLabel("Plan focus", { exact: true }).check();
  await page.getByLabel("Planned Pomodoros").fill("2");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await page.getByRole("button", { name: /^A focused session/ }).click();
  await page
    .getByRole("button", { name: "Focus on this task", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Focus timer", exact: true });
  await expect(dialog.getByRole("heading")).toHaveText("A focused session");
  await expect(dialog.getByLabel("Task", { exact: true })).toContainText(
    "A focused session",
  );
  await dialog.getByLabel("Task", { exact: true }).selectOption("");
  await expect(dialog.getByRole("heading")).toHaveText("One thing at a time.");
  await dialog
    .getByLabel("Task", { exact: true })
    .selectOption({ label: "A focused session · 2 Pomodoros" });

  await dialog.getByLabel("Duration").fill("0");
  await expect(
    dialog.getByRole("button", { name: "Start session" }),
  ).toBeDisabled();
  await dialog.getByLabel("Duration").fill("42");
  await dialog.getByRole("button", { name: "Start session" }).click();
  await expect(
    dialog.getByRole("button", { name: "Pause", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Resume", exact: true }),
  ).toBeEnabled();
  const current = await (await page.request.get("/api/v1/focus")).json();
  expect(current.active.targetSeconds).toBe(2520);
  expect(current.active.taskTitle).toBe("A focused session");
  await page.screenshot({ path: "test-results/focus-scene.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "Focus timer", exact: true }).click();
  await expect(dialog.getByLabel("Duration")).toHaveValue("42");
  await expect(
    dialog.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Pause", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "End session", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Start session" }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Short break", exact: true })
    .click();
  await dialog.getByLabel("Duration").fill("8");
  await dialog.getByRole("button", { name: "Start session" }).click();
  await expect(
    dialog.getByRole("button", { name: "Pause", exact: true }),
  ).toBeEnabled();
  const rest = await (await page.request.get("/api/v1/focus")).json();
  expect(rest.active.targetSeconds).toBe(480);
  expect(rest.active.taskId).toBeNull();
  await dialog
    .getByRole("button", { name: "End session", exact: true })
    .click();
});
