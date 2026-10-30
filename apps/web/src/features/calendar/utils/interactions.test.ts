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
  ).toEqual({
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
  ).toEqual({
    scheduledDate: "2030-10-20",
    startTime: "09:07",
    endTime: "10:07",
  });
});
it("resizes edges on a quarter-hour grid and rejects midnight crossing", () => {
  expect(
    scheduleFromDrop(
      task,
      "2030-10-20T09:00:00Z",
      "2030-10-20T10:16:00Z",
      false,
      "resize",
    ),
  ).toMatchObject({ startTime: "09:00", endTime: "10:15" });
  expect(() =>
    scheduleFromDrop(task, "2030-10-20T23:30:00Z", undefined, false, "move"),
  ).toThrow("midnight");
  expect(() =>
    scheduleFromDrop(
      task,
      "2030-10-20T23:30:00Z",
      "2030-10-21T00:15:00Z",
      false,
      "resize",
    ),
  ).toThrow("midnight");
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
