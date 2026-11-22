import { expect, it } from "vitest";
import { calendarEvents } from "./calendarEvents";
import type { Day, Task } from "../../../shared/api/domainTypes";

const task = {
  id: "task",
  title: "Overnight",
  scheduledDate: "2026-11-22",
  startTime: "23:30",
  endTime: "01:00",
  scheduledStartAt: "2026-11-22T14:30:00Z",
  scheduledEndAt: "2026-11-22T16:00:00Z",
} as Task;
const day = {
  date: "2026-11-22",
  timezone: "Asia/Tokyo",
  finalized: true,
  entries: [{ task, groupName: null, groupColor: null }],
} as Day;

it("prefers finalized snapshot clocks and history metadata over the live task", () => {
  const options = {
    tasks: [task],
    days: [day],
    groups: [],
    filter: () => true,
    disabled: false,
  };
  const tokyo = calendarEvents({ ...options, zone: "Asia/Tokyo" });
  expect(tokyo).toHaveLength(1);
  expect(tokyo[0]).toMatchObject({
    start: "2026-11-22T23:30:00",
    end: "2026-11-23T01:00:00",
  });
  expect(
    calendarEvents({ ...options, zone: "Asia/Ho_Chi_Minh" })[0],
  ).toMatchObject({
    start: "2026-11-22T23:30:00",
    end: "2026-11-23T01:00:00",
    extendedProps: { historical: true, zone: "Asia/Tokyo" },
  });
});

it("renders an overlapping task even if its start day is outside the range", () => {
  expect(
    calendarEvents({
      tasks: [task],
      days: [],
      groups: [],
      filter: () => true,
      disabled: false,
      zone: "Asia/Tokyo",
    }),
  ).toHaveLength(1);
});

it("keeps finalized snapshot dates and timezone when no current identity overlaps the range", () => {
  expect(
    calendarEvents({
      days: [day],
      groups: [],
      filter: () => true,
      disabled: false,
      zone: "Asia/Ho_Chi_Minh",
    })[0],
  ).toMatchObject({
    start: "2026-11-22T23:30:00",
    end: "2026-11-23T01:00:00",
    extendedProps: { historical: true, zone: "Asia/Tokyo" },
  });
});

it("shows both passes through a repeated hour without inventing a duration", () => {
  const events = calendarEvents({
    tasks: [
      {
        ...task,
        scheduledStartAt: "2026-11-01T05:50:00Z",
        scheduledEndAt: "2026-11-01T06:10:00Z",
      },
    ],
    days: [],
    groups: [],
    filter: () => true,
    disabled: false,
    zone: "America/New_York",
  });
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({
    start: "2026-11-01T01:50:00",
    end: "2026-11-01T02:00:00",
    editable: false,
  });
  expect(events[1]).toMatchObject({
    start: "2026-11-01T01:00:00",
    end: "2026-11-01T01:10:00",
    editable: false,
  });
  expect(events[0].title).toContain("UTC-04:00");
  expect(events[1].title).toContain("UTC-05:00");
  expect(events[0].extendedProps?.task.id).toBe(
    events[1].extendedProps?.task.id,
  );
});

it("also splits a forward-looking wall interval across the repeated hour", () => {
  const events = calendarEvents({
    tasks: [
      {
        ...task,
        scheduledStartAt: "2026-11-01T05:10:00Z",
        scheduledEndAt: "2026-11-01T06:20:00Z",
      },
    ],
    days: [],
    groups: [],
    filter: () => true,
    disabled: false,
    zone: "America/New_York",
  });
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({
    start: "2026-11-01T01:10:00",
    end: "2026-11-01T02:00:00",
  });
  expect(events[1]).toMatchObject({
    start: "2026-11-01T01:00:00",
    end: "2026-11-01T01:20:00",
  });
});
