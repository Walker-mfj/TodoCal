import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

async function audit(page: Page, name: string) {
  // Audit the settled theme, not a mixed foreground/background halfway through
  // the controls' color transition. No accessibility rules are disabled.
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
    name,
  ).toEqual([]);
}

test("WCAG A/AA audit of authentication, every workspace, editor errors and timer in both themes", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await audit(page, "Sign in");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await audit(page, "Registration");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`a11y-${randomUUID()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Accessibility-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator(".fc")).toBeVisible();
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
    for (const view of [
      "Settings",
      "Groups",
      "Tasks",
      "Progress",
      "Calendar",
    ]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      await audit(page, `${theme} ${view}`);
      if (view === "Calendar") {
        await page.locator(".fc-next-button").click();
        await expect(
          page.locator(".fc-timegrid-col[tabindex='0']"),
        ).toHaveCount(7);
        await audit(page, `${theme} next calendar week`);
        await page.locator(".fc-today-button").click();
      }
    }
    await page
      .getByRole("button", { name: "New task", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await expect(page.getByLabel("Task title")).toBeFocused();
    await audit(page, `${theme} invalid task`);
    await page.getByLabel("Task title").fill("Accessible task");
    await page
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await expect(page.getByLabel("Task title")).toBeHidden();
    await page.getByRole("button", { name: /^Focus timer/ }).click();
    await audit(page, `${theme} timer panel`);
    await page
      .getByRole("button", { name: "Start session", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await audit(page, `${theme} active timer`);
    await page
      .getByRole("button", { name: "End session", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeHidden();
    await page.getByRole("button", { name: "Close focus timer" }).click();
  }
});

test("desktop zoom reflow and text spacing keep forms and navigation usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`reflow-${randomUUID()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Reflow-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator(".fc")).toBeVisible();
  await page.addStyleTag({
    content:
      "*{letter-spacing:.12em!important;word-spacing:.16em!important;line-height:1.5!important}p{margin-bottom:2em!important}",
  });
  for (const width of [720, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of [
      "Tasks",
      "Groups",
      "Settings",
      "Progress",
      "Calendar",
    ]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        `${view} at ${width}`,
      ).toBeLessThanOrEqual(width);
    }
    await page
      .getByRole("button", { name: "New task", exact: true })
      .first()
      .click();
    await page.getByLabel("Task title").fill("Zoomed task input");
    await page
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await expect(page.getByLabel("Task title")).toBeHidden();
  }
});
