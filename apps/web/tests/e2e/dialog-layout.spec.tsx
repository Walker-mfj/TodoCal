import { test, expect } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { ScheduleScopeDialog } from "../../src/features/calendar/schedule-scope-dialog";

for (const mode of ["light", "dark"]) {
  for (const width of [390, 1024]) {
    test(`recurrence dialog layout ${mode} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const markup = renderToStaticMarkup(
        <ScheduleScopeDialog
          busy={false}
          error=""
          allAvailable={true}
          onCancel={() => {}}
          onChoose={async () => {}}
        />,
      );
      await page.setContent(
        `<html data-mode="${mode}"><head><style>${readFileSync("src/app/globals.css", "utf8")}</style></head><body>${markup}</body></html>`,
      );
      await page
        .locator("dialog")
        .evaluate((dialog: HTMLDialogElement) => dialog.showModal());
      const dialog = page.getByRole("dialog", {
        name: "Reschedule repeating task",
      });
      const heading = await dialog.getByRole("heading").boundingBox();
      const icon = await dialog.locator(".app-dialog-icon").boundingBox();
      expect(
        Math.abs(heading!.y + heading!.height / 2 - icon!.y - icon!.height / 2),
      ).toBeLessThan(1);
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      const buttons = await dialog.locator(".app-dialog-actions button").all();
      const boxes = await Promise.all(
        buttons.map((button) => button.boundingBox()),
      );
      if (width > 480) {
        expect(new Set(boxes.map((box) => box!.y)).size).toBe(1);
        expect(new Set(boxes.map((box) => box!.height)).size).toBe(1);
      } else {
        expect(boxes[1]!.y).toBeGreaterThanOrEqual(
          boxes[0]!.y + boxes[0]!.height,
        );
      }
      await page.screenshot({
        path: `test-results/dialog-layout-${mode}-${width}.png`,
      });
    });
  }
}

