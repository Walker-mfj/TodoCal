import { test, expect } from "./fixtures";
test("focus scene custom duration persists, pauses, exits and resumes", async ({
  page,
}) => {
  await test.step("Create a task with planned Pomodoros", async () => {
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByLabel("Task title").fill("A focused session");
    const today = await page.evaluate(() =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
        new Date(),
      ),
    );
    await page.getByLabel("Scheduled date").fill(today);
    await page.getByLabel("Plan focus", { exact: true }).check();
    await page.getByLabel("Planned Pomodoros").fill("2");
    await page
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await page.getByRole("button", { name: /^A focused session/ }).click();
    await page
      .getByRole("button", { name: "Focus on this task", exact: true })
      .click();
  });
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

  await test.step("Validate duration, start and pause a custom session", async () => {
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
  });
  await test.step("Exit, reload, resume and end the same session", async () => {
    await page.screenshot({ path: test.info().outputPath("focus-scene.png") });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.reload();
    await page.getByRole("button", { name: /^Focus timer/ }).click();
    await expect(dialog).toBeVisible();
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
  });
  await test.step("Start and end a custom break without task attribution", async () => {
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
});
