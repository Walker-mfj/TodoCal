import { selectCalendarSlot } from "./calendarHelpers";
import { test, expect } from "./fixtures";
test("editing a draft preserves saved data, discards changes and retargets the same task", async ({
  page,
  auth,
}) => {
  const saved = await auth.send("/tasks", {
    title: "Draft appointment",
    scheduledDate: auth.today,
    startTime: "10:00",
    endTime: "11:00",
  });
  await page.reload();
  const preview = page.locator(".fc-event-draft");
  await test.step("Edit preview without persisting changes", async () => {
    await page
      .locator(".fc-event")
      .filter({ hasText: "Draft appointment" })
      .click();
    await page.getByRole("button", { name: "Edit task", exact: true }).click();
    await page.getByLabel("Task title").fill("Changed appointment");
    await expect(preview).toContainText("Changed appointment");
    await expect(
      page
        .locator(".fc-event:not(.fc-event-draft)")
        .filter({ hasText: "Draft appointment" }),
    ).toHaveCount(0);
    expect(
      (await (await page.request.get(`/api/v1/tasks/${saved.id}`)).json())
        .title,
    ).toBe("Draft appointment");
    await page.screenshot({
      path: test.info().outputPath("calendar-live-draft.png"),
    });
  });
  await test.step("Discard changes and restore the original card", async () => {
    await page
      .getByRole("button", { name: "Close editor", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await expect(preview).toHaveCount(0);
    const original = page
      .locator(".fc-event")
      .filter({ hasText: "Draft appointment" });
    await expect(original).toHaveCount(1);
  });
  await test.step("Retarget and save the same task", async () => {
    await page
      .locator(".fc-event")
      .filter({ hasText: "Draft appointment" })
      .click();
    await page.getByRole("button", { name: "Edit task", exact: true }).click();
    // Confirming Close editor explicitly discards the previous unsaved draft.
    await expect(page.getByLabel("Task title")).toHaveValue(
      "Draft appointment",
    );
    await page.getByLabel("Task title").fill("Changed appointment");
    await expect(preview).toContainText("Changed appointment");
    await selectCalendarSlot(page, "12:00");
    await expect(
      page.getByRole("heading", { name: "Edit task", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Task title")).toHaveValue(
      "Changed appointment",
    );
    await expect(page.getByLabel("Start time", { exact: true })).toHaveValue(
      "12:00",
    );
    await expect(preview).toHaveAccessibleName(
      /Unsaved draft: Changed appointment, .*T12:00/,
    );
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(preview).toHaveCount(0);
    const tasks = (await (await page.request.get("/api/v1/tasks")).json())
      .items;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: saved.id,
      title: "Changed appointment",
      startTime: "12:00",
      endTime: "12:30",
    });
  });
});
