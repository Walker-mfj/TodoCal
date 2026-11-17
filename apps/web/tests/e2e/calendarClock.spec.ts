import { test, expect } from "@playwright/test";
import { build } from "vite";

test.use({ timezoneId: "America/New_York" });

let script: string;
let css: string;
test.beforeAll(async () => {
  const output = await build({
    configFile: false,
    oxc: { jsx: { runtime: "automatic" } },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      lib: {
        entry: "tests/e2e/fixtures/calendarClock.tsx",
        name: "CalendarClock",
        formats: ["iife"],
      },
    },
  });
  const bundles = Array.isArray(output) ? output : [output];
  const files = bundles.flatMap((bundle) =>
    "output" in bundle ? bundle.output : [],
  );
  script = files
    .filter((file) => file.type === "chunk")
    .map((file) => file.code)
    .join("\n");
  css = files
    .filter((file) => file.type === "asset" && file.fileName.endsWith(".css"))
    .map((file) => (file.type === "asset" ? file.source : ""))
    .join("\n");
});

test("indicator follows account wall time, navigation and wake from sleep", async ({
  page,
}) => {
  // Browser timezone deliberately differs from the account timezone.
  await page.clock.install({ time: new Date("2026-11-16T01:15:00Z") });
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({
    content: css + "\n#root > div > div { height: 1500px; }",
  });
  await page.addScriptTag({ content: script });
  const column = page.locator('.fc-timegrid-col[data-date="2026-11-16"]');
  const line = column.locator(".fc-timegrid-now-indicator-line");
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
  await page.clock.runFor(15 * 60_000);
  await expectTime("10:30:00");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".fc-timegrid-now-indicator-line")).toHaveCount(0);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(line).toBeVisible();
  await page.clock.setSystemTime(new Date("2026-11-16T05:45:00Z"));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expectTime("14:30:00", 0.5);
});
