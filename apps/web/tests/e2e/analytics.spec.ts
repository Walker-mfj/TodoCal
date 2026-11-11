import { test, expect } from "./fixtures";
test("weekly/monthly analytics reconcile with daily details and preserve selection when navigating", async ({
  page,
  auth,
}) => {
  const { today: date, send } = auth;
  await test.step("Progress changes from 66.7% to 60% to 50% to 33.3%; unscheduled completion is independent", async () => {
    const tasks = [];
    for (let i = 0; i < 5; i++) {
      const task = await send("/tasks", {
        title: `Planned ${i}`,
        scheduledDate: date,
        ...(i === 0 ? { startTime: "09:00", endTime: "09:30" } : {}),
      });
      tasks.push(task);
      if (i === 0 || i === 1 || i === 3)
        await send(`/tasks/${task.id}/completion`, {
          complete: true,
          expectedRevision: 1,
        });
      if (i === 2) {
        await page.reload();
        await expect(page.locator(".progress-hero")).toContainText("66.7%");
      }
    }
    await page.reload();
    await expect(page.locator(".progress-hero")).toContainText("60%");
    await send("/tasks", { title: "One more", scheduledDate: date });
    await page.reload();
    await expect(page.locator(".progress-hero")).toContainText("50%");
    await send(`/tasks/${tasks[0].id}/completion`, {
      complete: false,
      expectedRevision: 2,
    });
    await page.reload();
    await expect(page.locator(".progress-hero")).toContainText("33.3%");
    const unscheduled = await send("/tasks", { title: "Unscheduled complete" });
    await send(`/tasks/${unscheduled.id}/completion`, {
      complete: true,
      expectedRevision: 1,
    });
  });
  const metrics = page.locator(".analytics-metrics");
  await test.step("Weekly report and daily details agree", async () => {
    await page.getByRole("button", { name: "Progress", exact: true }).click();
    await expect(metrics).toContainText("33.3%");
    await expect(metrics).toContainText("2/6 planned occurrences");
    await expect(
      metrics.locator(".metric").filter({ hasText: "Completed tasks" }),
    ).toContainText("3");
    await expect(
      page.getByRole("region", { name: "Daily focus chart" }),
    ).toContainText("No focus sessions yet");
    await page
      .locator(".report-days .day-progress")
      .filter({ hasText: "2/6" })
      .click();
    await expect(page.locator(".detail-panel")).toContainText(
      "2 of 6 tasks complete",
    );
    await expect(page.locator(".detail-panel")).toContainText(
      "3 completed tasks",
    );
    await expect(
      page.locator('.report-days [aria-pressed="true"]'),
    ).toHaveCount(1);
  });
  await test.step("Monthly report preserves selection and reconciles totals", async () => {
    await page.getByLabel("Progress period").selectOption("month");
    await expect(page.locator(".report-days.month")).toBeVisible();
    await expect(metrics).toContainText("2/6 planned occurrences");
    await expect(page.locator(".weekday-heading")).toHaveCount(7);
    await page.screenshot({
      path: test.info().outputPath("analytics-month-light.png"),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Previous period" }).click();
    await expect(metrics).toContainText("0/0 planned occurrences");
    await expect(
      page.locator('.report-days [aria-pressed="true"]'),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(metrics).toContainText("2/6 planned occurrences");
    const report = await (
      await page.request.get(`/api/v1/reports/period?period=month&date=${date}`)
    ).json();
    const day = await (
      await page.request.get(`/api/v1/reports/days/${date}`)
    ).json();
    expect(report.metrics.completed).toBe(day.completed);
    expect(report.metrics.planned).toBe(day.planned);
  });
  await test.step("Reports and completion bands remain correct across themes", async () => {
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByLabel("Appearance").selectOption(theme);
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Save changes", exact: true }),
      ).toBeEnabled();
      await expect(page.locator("html")).toHaveAttribute("data-mode", theme);
      await page.getByRole("button", { name: "Progress", exact: true }).click();
      await expect(page.locator(".progress-legend")).toContainText("100%");
      await expect(page.locator(".day-progress.starting")).toHaveCount(1);
    }

    await expect(metrics).toContainText("33.3%");
    await page.screenshot({
      path: test.info().outputPath("analytics-month-dark.png"),
      animations: "disabled",
    });
  });
});
