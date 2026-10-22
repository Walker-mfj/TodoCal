import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("weekly/monthly analytics reconcile with daily details and preserve selection when navigating", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`analytics-${randomUUID()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Strong-analytics-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A week with room to focus." }),
  ).toBeVisible();
  const session = await (await page.request.get("/api/v1/auth/me")).json();
  const date = await page.evaluate(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  const send = async (path: string, body: unknown) => {
    const r = await page.request.post(`/api/v1${path}`, {
      data: body,
      headers: {
        Origin: new URL(page.url()).origin,
        "X-CSRF-Token": session.csrfToken,
        "Idempotency-Key": randomUUID(),
      },
    });
    expect(r.ok()).toBeTruthy();
    return r.json();
  };
  for (let i = 0; i < 4; i++) {
    const t = await send("/tasks", {
      title: `Analytics task ${i}`,
      scheduledDate: i < 3 ? date : null,
    });
    if (i !== 2)
      await send(`/tasks/${t.id}/completion`, {
        complete: true,
        expectedRevision: 1,
      });
  }
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  const metrics = page.locator(".analytics-metrics");
  await expect(metrics).toContainText("66.7%");
  await expect(metrics).toContainText("2/3 planned occurrences");
  await expect(
    metrics.locator(".metric").filter({ hasText: "Completed tasks" }),
  ).toContainText("3");
  await expect(
    page.getByRole("region", { name: "Daily focus chart" }),
  ).toContainText("No focus sessions yet");
  await page
    .locator(".report-days .day-progress")
    .filter({ hasText: "2/3" })
    .click();
  await expect(page.locator(".detail-panel")).toContainText(
    "2 of 3 tasks complete",
  );
  await expect(page.locator(".detail-panel")).toContainText(
    "3 completed tasks",
  );
  await expect(page.locator('.report-days [aria-pressed="true"]')).toHaveCount(
    1,
  );
  await page.getByLabel("Progress period").selectOption("month");
  await expect(page.locator(".report-days.month")).toBeVisible();
  await expect(metrics).toContainText("2/3 planned occurrences");
  await expect(page.locator(".weekday-heading")).toHaveCount(7);
  await page.screenshot({
    path: "test-results/analytics-month-light.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Previous period" }).click();
  await expect(metrics).toContainText("0/0 planned occurrences");
  await expect(page.locator('.report-days [aria-pressed="true"]')).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(metrics).toContainText("2/3 planned occurrences");
  const report = await (
    await page.request.get(`/api/v1/reports/period?period=month&date=${date}`)
  ).json();
  const day = await (
    await page.request.get(`/api/v1/reports/days/${date}`)
  ).json();
  expect(report.metrics.completed).toBe(day.completed);
  expect(report.metrics.planned).toBe(day.planned);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Appearance").selectOption("dark");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  await expect(metrics).toContainText("66.7%");
  await page.screenshot({
    path: "test-results/analytics-month-dark.png",
    animations: "disabled",
  });
});
