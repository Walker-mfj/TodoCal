import { it, expect } from "vitest";
import { scheduleFromDrop } from "./interactions";
const task = {
  scheduledDate: "2030-10-19",
  startTime: "09:07",
  endTime: "10:07",
};
it("snaps a timed move to 15 minutes while preserving duration", () => {
  expect(
    scheduleFromDrop(task, "2030-10-20T10:08:00Z", undefined, false, "move"),
  ).toMatchObject({
    scheduledDate: "2030-10-20",
    startTime: "10:15",
    endTime: "11:15",
  });
});
it("supports external 30 minute drops and clearing time", () => {
  expect(
    scheduleFromDrop(
      { startTime: null, endTime: null },
      "2030-10-20T09:00:00Z",
      undefined,
      false,
      "move",
    ),
  ).toMatchObject({ startTime: "09:00", endTime: "09:30" });
  expect(scheduleFromDrop(task, "2030-10-20", undefined, true, "move")).toEqual(
    { scheduledDate: "2030-10-20", startTime: null, endTime: null },
  );
});
it("preserves minute-precision times for a Month date move", () => {
  expect(
    scheduleFromDrop(task, "2030-10-20", undefined, false, "month"),
  ).toMatchObject({
    scheduledDate: "2030-10-20",
    startTime: "09:07",
    endTime: "10:07",
  });
});
it("resizes and moves across midnight on a quarter-hour grid", () => {
  expect(
    scheduleFromDrop(
      task,
      "2030-10-20T09:00:00Z",
      "2030-10-20T10:16:00Z",
      false,
      "resize",
    ),
  ).toMatchObject({ startTime: "09:00", endTime: "10:15" });
  expect(
    scheduleFromDrop(task, "2030-10-20T23:30:00Z", undefined, false, "move"),
  ).toMatchObject({ scheduledEndDate: "2030-10-21", endTime: "00:30" });
  expect(
    scheduleFromDrop(
      task,
      "2030-10-20T23:30:00Z",
      "2030-10-21T00:15:00Z",
      false,
      "resize",
    ),
  ).toMatchObject({ scheduledEndDate: "2030-10-21", endTime: "00:15" });
});
it("resizes only the moved edge, preserving minute precision on the fixed edge", () => {
  expect(
    scheduleFromDrop(
      task,
      "2030-10-19T09:07:00Z",
      "2030-10-19T10:16:00Z",
      false,
      "resize",
    ),
  ).toMatchObject({ startTime: "09:07", endTime: "10:15" });
  expect(
    scheduleFromDrop(
      task,
      "2030-10-19T08:44:00Z",
      "2030-10-19T10:07:00Z",
      false,
      "resize",
    ),
  ).toMatchObject({ startTime: "08:45", endTime: "10:07" });
});

it("keeps the end-day offset on a Month move", () => {
  expect(
    scheduleFromDrop(
      {
        scheduledDate: "2030-10-19",
        scheduledEndDate: "2030-10-21",
        startTime: "23:00",
        endTime: "00:15",
      },
      "2030-10-22",
      undefined,
      true,
      "month",
    ),
  ).toMatchObject({
    scheduledDate: "2030-10-22",
    scheduledEndDate: "2030-10-24",
    startTime: "23:00",
    endTime: "00:15",
  });
});

it("uses elapsed duration when moving across a daylight-saving transition", () => {
  expect(
    scheduleFromDrop(
      {
        scheduledDate: "2030-03-09",
        startTime: "01:30",
        endTime: "02:30",
        scheduledStartAt: "2030-03-09T06:30:00Z",
        scheduledEndAt: "2030-03-09T07:30:00Z",
      },
      "2030-03-10T01:30:00Z",
      undefined,
      false,
      "move",
      "America/New_York",
    ),
  ).toMatchObject({
    scheduledDate: "2030-03-10",
    startTime: "01:30",
    endTime: "03:30",
  });
});

it("sends exact instants when a two-hour move ends on the later 01:30", () => {
  const schedule = scheduleFromDrop(
    {
      scheduledDate: "2026-10-31",
      startTime: "00:30",
      endTime: "02:30",
      scheduledStartAt: "2026-10-31T04:30:00Z",
      scheduledEndAt: "2026-10-31T06:30:00Z",
    },
    "2026-11-01T00:30:00Z",
    undefined,
    false,
    "move",
    "America/New_York",
  );
  expect(schedule).toMatchObject({
    startTime: "00:30",
    endTime: "01:30",
    scheduledStartAt: "2026-11-01T04:30:00.000Z",
    scheduledEndAt: "2026-11-01T06:30:00.000Z",
  });
  expect(
    Date.parse(schedule.scheduledEndAt!) -
      Date.parse(schedule.scheduledStartAt!),
  ).toBe(120 * 60000);
});

it("keeps the later repeated-hour endpoint when resizing only the start", () => {
  const schedule = scheduleFromDrop(
    {
      scheduledDate: "2026-11-01",
      startTime: "00:30",
      endTime: "01:30",
      scheduledStartAt: "2026-11-01T04:30:00Z",
      scheduledEndAt: "2026-11-01T06:30:00Z",
    },
    "2026-11-01T00:45:00Z",
    "2026-11-01T01:30:00Z",
    false,
    "resize",
    "America/New_York",
  );
  expect(schedule.scheduledEndAt).toBe("2026-11-01T06:30:00.000Z");
});
