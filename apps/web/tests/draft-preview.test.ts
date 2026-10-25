import { expect, it } from "vitest";
import { draftEvent } from "../src/features/calendar/draft-preview";
it("renders a editable draft with live title and schedule", () => {
  expect(
    draftEvent({
      draft: {
        title: "Changed title",
        scheduledDate: "2026-10-24",
        startTime: "10:00",
        endTime: "11:30",
      },
    }),
  ).toMatchObject({
    title: "Changed title",
    start: "2026-10-24T10:00:00",
    end: "2026-10-24T11:30:00",
    editable: true,
    extendedProps: { draft: true },
  });
});
it("supports untimed drafts and avoids misleading previews for invalid or unscheduled input", () => {
  expect(
    draftEvent({ draft: { title: "", scheduledDate: "2026-10-24" } }),
  ).toMatchObject({ title: "New task", allDay: true });
  for (const draft of [
    { title: "Unscheduled" },
    { title: "Invalid date", scheduledDate: "2026-02-30" },
    {
      title: "Reversed",
      scheduledDate: "2026-10-24",
      startTime: "11:00",
      endTime: "10:00",
    },
    { title: "Partial time", scheduledDate: "2026-10-24", startTime: "09:00" },
  ])
    expect(draftEvent({ draft })).toBeNull();
});
