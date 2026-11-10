import type { Page } from "@playwright/test";

export async function selectCalendarSlot(page: Page, time: string) {
  const row = page.locator(`.fc-timegrid-slot[data-time="${time}:00"]`).last();
  await row.scrollIntoViewIfNeeded();
  const column = (await page
    .locator(".fc-timegrid-col.fc-day-today")
    .boundingBox())!;
  const box = (await row.boundingBox())!;
  await page.mouse.click(column.x + column.width / 2, box.y + 4);
}
