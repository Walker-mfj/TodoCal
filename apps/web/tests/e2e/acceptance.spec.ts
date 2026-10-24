import { test, expect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Move with real Tab keys: focus() would conceal an unreachable control.
async function tabTo(page: Page, target: Locator) {
  const visited = new Set<string>();
  // Reverse at the document boundary: Firefox/WebKit may move forward focus
  // into browser chrome instead of wrapping to the first form control.
  // macOS WebKit uses Option-Tab to include buttons and links.
  const keys =
    page.context().browser()?.browserType().name() === "webkit"
      ? ["Alt+Tab", "Alt+Shift+Tab"]
      : ["Tab", "Shift+Tab"];
  for (const key of keys) {
    for (let i = 0; i < 100; i++) {
      if (await target.evaluate((node) => node === document.activeElement))
        return;
      visited.add(
        await page.evaluate(
          () =>
            `${document.activeElement?.tagName}:${document.activeElement?.getAttribute("type")}`,
        ),
      );
      await page.keyboard.press(key);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
    }
  }
  throw new Error(
    `Control is not reachable using the keyboard; visited ${[...visited].join(" -> ")}`,
  );
}
async function activate(page: Page, target: Locator) {
  await tabTo(page, target);
  await page.keyboard.press("Enter");
}

test("acceptance: keyboard-only task workflow, custom errors, long names and empty states in both themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/acceptance-auth-1024.png" });
  await activate(
    page,
    page.getByRole("button", { name: "Create an account", exact: true }),
  );
  await tabTo(page, page.getByLabel("Email", { exact: true }));
  await page.keyboard.type(`acceptance-${randomUUID()}@example.com`);
  await tabTo(page, page.getByLabel("Password", { exact: true }));
  await page.keyboard.type("Keyboard-acceptance-password-123");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "A week with room to focus." }),
  ).toBeVisible();
  await activate(
    page,
    page.getByRole("button", { name: "Tasks", exact: true }),
  );
  await expect(page.getByText("No tasks match this view.")).toBeVisible();
  await activate(
    page,
    page.getByRole("button", { name: "New task", exact: true }).first(),
  );
  await activate(
    page,
    page.getByRole("button", { name: "Create task", exact: true }),
  );
  await expect(page.locator(".form-validation[role=alert]")).toContainText(
    "Task title is required",
  );
  await expect(page.getByLabel("Task title")).toBeFocused();
  await expect(page.getByLabel("Task title")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.screenshot({
    path: "test-results/acceptance-validation-1024.png",
  });
  const title = "Long task " + "x".repeat(290);
  await page.keyboard.type(title);
  await expect(page.getByLabel("Task title")).toHaveValue(title);
  await activate(
    page,
    page.getByRole("button", { name: "Create task", exact: true }),
  );
  await expect(page.getByLabel("Task title")).toBeHidden();
  await expect(page.locator(".task-open")).toHaveText(new RegExp("Long task"));
  await activate(
    page,
    page.getByRole("button", { name: `Complete ${title}`, exact: true }),
  );
  await expect(
    page.getByRole("button", { name: `Reopen ${title}`, exact: true }),
  ).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await activate(
      page,
      page.getByRole("button", { name: "Settings", exact: true }),
    );
    // Theme/layout coverage is separate from the keyboard-only create/complete journey.
    await page.getByLabel("Appearance").selectOption(theme);
    await activate(
      page,
      page.getByRole("button", { name: "Save settings", exact: true }),
    );
    await expect(page.locator("html")).toHaveAttribute("data-mode", theme);
    await expect(
      page.getByRole("button", { name: "Save settings", exact: true }),
    ).toBeEnabled();
    await activate(
      page,
      page.getByRole("button", { name: "Tasks", exact: true }),
    );
    for (const width of [1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: `test-results/acceptance-long-${theme}-${width}.png`,
      });
    }
    await activate(
      page,
      page.getByRole("button", { name: "Progress", exact: true }),
    );
    await expect(page.locator(".analytics-metrics")).toContainText(
      "0/0 planned occurrences",
    );
    await page.screenshot({
      path: `test-results/acceptance-empty-${theme}.png`,
    });
    await activate(
      page,
      page.getByRole("button", { name: "New task", exact: true }).first(),
    );
    await activate(
      page,
      page.getByRole("button", { name: "Create task", exact: true }),
    );
    await expect(page.locator(".form-validation[role=alert]")).toBeVisible();
    await page.screenshot({
      path: `test-results/acceptance-form-${theme}-1440.png`,
    });
    await activate(page, page.getByRole("button", { name: "Close editor" }));
  }
});
