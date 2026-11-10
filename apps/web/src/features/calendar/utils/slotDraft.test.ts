import { expect, it } from "vitest";
import { slotDraft } from "./slotDraft";
it("preserves selected intervals and defaults clicks to 30 minutes", () => {
  expect(slotDraft("2026-10-21T09:00:00Z")).toMatchObject({
    scheduledDate: "2026-10-21",
    startTime: "09:00",
    endTime: "09:30",
  });
  expect(
    slotDraft("2026-10-21T09:00:00Z", "2026-10-21T10:30:00Z").endTime,
  ).toBe("10:30");
});
