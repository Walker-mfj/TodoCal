import { test, expect } from "./fixtures";
import { DateTime } from "luxon";

test.use({ timezoneId: "America/New_York" });

test("indicator follows account wall time, navigation and wake from sleep", async ({
  page,
  auth,
}) => {
  const settings = await (await page.request.get("/api/v1/settings")).json();
  await auth.send(
    "/settings",
    { timezone: "Asia/Tokyo", expectedRevision: settings.revision },
    "PATCH",
  );
  // Use a past local date so the simulated browser time cannot expire the
  // real session. Reload the actual Next.js app with the account timezone.
  const initial = DateTime.now()
    .setZone("Asia/Tokyo")
    .minus({ days: 1 })
    .set({ hour: 10, minute: 15, second: 0, millisecond: 0 });
  const date = initial.toISODate();
  await page.clock.install({ time: initial.toJSDate() });
  await page.reload();
  const column = page.locator(`.fc-timegrid-col[data-date="${date}"]`);
  const line = column.locator(".fc-timegrid-now-indicator-line");
  await expect(column).toHaveClass(/fc-day-today/);
  await line.scrollIntoViewIfNeeded();
  await expect(line).toBeVisible();

  async function expectTime(time: string, fraction = 0) {
    await expect
      .poll(async () => {
        const slot = await page
          .locator(`.fc-timegrid-slot-lane[data-time="${time}"]`)
          .boundingBox();
        const mark = await line.boundingBox();
        if (!slot || !mark) return Infinity;
        return Math.abs(mark.y - (slot.y + slot.height * fraction));
      })
      .toBeLessThan(3);
  }

  await expectTime("10:00:00", 0.5);
  await page.clock.runFor(60_000);
  await expectTime("10:00:00", 16 / 30);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".fc-timegrid-now-indicator-line")).toHaveCount(0);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(line).toBeVisible();
  await page.clock.setSystemTime(
    initial.set({ hour: 14, minute: 45 }).toJSDate(),
  );
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expectTime("14:30:00", 0.5);
});
