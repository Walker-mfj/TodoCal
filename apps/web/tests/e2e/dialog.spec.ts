import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
async function setup(page: Page) {
  const nativeDialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    nativeDialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`dialogs-${randomUUID()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Dialog-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator(".fc")).toBeVisible();
  return nativeDialogs;
}
async function slot(page: Page, time: string) {
  const row = page.locator(`.fc-timegrid-slot[data-time="${time}:00"]`).last();
  await row.scrollIntoViewIfNeeded();
  const col = (await page
    .locator(".fc-timegrid-col.fc-day-today")
    .boundingBox())!;
  const cell = (await row.boundingBox())!;
  await page.mouse.click(col.x + col.width / 2, cell.y + 4);
}
test("calendar slot changes retain content; only edited drafts need a close decision", async ({
  page,
}) => {
  const native = await setup(page);
  await slot(page, "09:00");
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect(page.getByLabel("Task title")).toBeHidden();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await slot(page, "09:00");
  await page.getByLabel("Task title").fill("Keep my draft");
  await page.getByLabel("Description").fill("Keep notes, too");
  await page
    .getByRole("combobox", { name: "Priority", exact: true })
    .selectOption("high");
  await page
    .getByRole("combobox", { name: "Repeat", exact: true })
    .selectOption("weekly");
  await slot(page, "11:00");
  await expect(page.getByLabel("Start time", { exact: true })).toHaveValue(
    "11:00",
  );
  await expect(page.getByLabel("End time", { exact: true })).toHaveValue(
    "11:30",
  );
  await expect(page.getByLabel("Task title")).toHaveValue("Keep my draft");
  await expect(page.getByLabel("Description")).toHaveValue("Keep notes, too");
  await expect(
    page.getByRole("combobox", { name: "Priority", exact: true }),
  ).toHaveValue("high");
  await expect(
    page.getByRole("combobox", { name: "Repeat", exact: true }),
  ).toHaveValue("weekly");
  await expect(page.getByRole("alertdialog")).toBeHidden();
  const close = page.getByRole("button", { name: "Close editor", exact: true });
  await page.getByLabel("Task title").focus();
  await page.keyboard.press("Escape");
  const dialog = page.getByRole("alertdialog", {
    name: "Discard unsaved changes?",
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Keep editing" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Close dialog", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Discard changes" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close dialog", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Keep editing" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Task title")).toBeFocused();
  await close.click();
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByLabel("Task title")).toBeHidden();
  await page
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Task title")).toHaveValue("");
  expect(native).toEqual([]);
});
test("shared delete confirmation supports cancel, light/dark and accessible labels", async ({
  page,
}) => {
  const native = await setup(page);
  for (const theme of ["light", "dark"]) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Appearance").selectOption(theme);
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save settings", exact: true }),
    ).toBeEnabled();
    await expect(page.locator("html")).toHaveAttribute("data-mode", theme);
    await page.getByRole("button", { name: "Groups", exact: true }).click();
    await page.getByLabel("Group name").fill(`Group ${theme}`);
    await page.getByRole("button", { name: "Create group" }).click();
    const group = page
      .locator(".group-row")
      .filter({ hasText: `Group ${theme}` });
    await group.getByRole("button", { name: "Delete", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete group?" });
    await expect(dialog).toBeVisible();
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({ path: `test-results/shared-dialog-${theme}.png` });
    await dialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(group).toBeVisible();
    await group.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(dialog).toBeVisible();
    // Clicking the backdrop cancels; it must never confirm or click through.
    await page.mouse.click(10, 10);
    await expect(dialog).toBeHidden();
    await expect(group).toBeVisible();
    await group.getByRole("button", { name: "Delete", exact: true }).click();
    await dialog.getByRole("heading").click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(group).toBeVisible();
    await group.getByRole("button", { name: "Delete", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Delete group", exact: true })
      .click();
    await expect(group).toBeHidden();
  }
  expect(native).toEqual([]);
});
