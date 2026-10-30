import { test, expect } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { layoutComponent, layoutStyles } from "./layoutStyles";

for (const compact of [false, true]) {
  for (const width of [90, 220]) {
    test(`calendar priority stays inside ${width}px ${compact ? "short" : "large"} cards`, async ({
      page,
    }) => {
      const { CalendarEventContent } = await layoutComponent<
        typeof import("../../src/features/calendar/components/eventContent/eventContent")
      >("/src/features/calendar/components/eventContent/eventContent.tsx");
      const markup = renderToStaticMarkup(
        <div className="calendar-wrap">
          <div className="fc">
            {(["high", "medium", "low"] as const).map((priority) => (
              <div
                key={priority}
                className="fc-timegrid-event"
                style={{
                  width,
                  height: compact ? 22 : 180,
                  margin: 12,
                  background: "var(--color-work)",
                }}
              >
                <div className="fc-event-main" style={{ height: "100%" }}>
                  <CalendarEventContent
                    title="Review launch checklist"
                    timeText="09:00–11:00"
                    priority={priority}
                    compact={compact}
                    complete={false}
                    draft={false}
                    repeating={true}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>,
      );
      await page.setContent(
        `<html><head><style>${layoutStyles("src/features/calendar/components/calendar/calendar.module.css", "src/features/calendar/components/eventContent/eventContent.module.css", "src/features/tasks/components/priorityBadge/priorityBadge.module.css")}</style></head><body>${markup}</body></html>`,
      );
      for (const event of await page.locator(".fc-timegrid-event").all()) {
        const bounds = (await event.boundingBox())!;
        const badge = (await event.locator(".priority-badge").boundingBox())!;
        expect(badge.x + badge.width).toBeLessThanOrEqual(
          bounds.x + bounds.width + 1,
        );
        expect(badge.y + badge.height).toBeLessThanOrEqual(
          bounds.y + bounds.height + 1,
        );
        const title = (await event.locator(".event-title").boundingBox())!;
        expect(badge.x + badge.width).toBeLessThanOrEqual(title.x + 1);
        const repeat = (await event.locator(".event-repeat").boundingBox())!;
        expect(repeat.x + repeat.width).toBeLessThanOrEqual(
          bounds.x + bounds.width + 1,
        );
        expect(repeat.y + repeat.height).toBeLessThanOrEqual(
          bounds.y + bounds.height + 1,
        );
      }
      await page.screenshot({
        path: `test-results/calendar-priority-${width}-${compact}.png`,
      });
    });
  }
}
