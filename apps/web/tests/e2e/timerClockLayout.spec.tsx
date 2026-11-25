import { test, expect } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { layoutComponent, layoutStyles } from "./layoutStyles";

test("focus settlement spinner stays inline and the progress ring stays absolute", async ({
  page,
}) => {
  const { TimerClock } = await layoutComponent<
    typeof import("../../src/features/focus/components/timerPanel/timerClock")
  >("/src/features/focus/components/timerPanel/timerClock.tsx");
  const markup = renderToStaticMarkup(
    <TimerClock
      seconds={0}
      ratio={1}
      active={{ status: "running" } as NonNullable<
        Parameters<typeof TimerClock>[0]["active"]
      >}
      connected
      settlementPending
    />,
  );
  await page.setContent(
    `<html><head><style>${layoutStyles("src/features/focus/components/timerPanel/timerClock.module.css", "src/shared/components/loadingIndicator/loadingIndicator.module.css")}</style></head><body>${markup}</body></html>`,
  );
  const ring = page.locator(".focus-clock > svg");
  const spinner = page.locator(".focus-clock small svg");
  await expect(ring).toHaveCSS("position", "absolute");
  await expect(spinner).toHaveCSS("position", "static");
  await expect(spinner).toHaveCSS("width", "16px");
  await expect(spinner).toHaveCSS("height", "16px");
  await expect(page.locator(".focus-clock small")).toHaveText(
    "Confirming completion…",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(spinner).toHaveCSS("animation-name", "none");
});
