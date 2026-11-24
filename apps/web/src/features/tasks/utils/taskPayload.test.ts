import { describe, it, expect } from "vitest";
import { taskPayload } from "./taskPayload";
import { recurrenceSummary } from "./recurrenceSummary";
import { progressLevel } from "../../../shared/utils/progress";
describe("task scheduling", () => {
  it("preserves a per-task focus duration independently of its schedule", () => {
    expect(
      taskPayload(
        {
          title: "Read",
          focusMinutes: "40",
          estimatedPomodoros: "2",
          scheduledDate: "2020-01-01",
          startTime: "09:00",
          endTime: "09:30",
        },
        "Asia/Tokyo",
      ),
    ).toMatchObject({
      focusMinutes: 40,
      estimatedPomodoros: 2,
      scheduledDate: "2020-01-01",
      endTime: "09:30",
    });
    expect(taskPayload({ title: "Read" }, "Asia/Tokyo")).toMatchObject({
      focusMinutes: null,
    });
    for (const value of ["0", "181", "1.5", "abc"])
      expect(() =>
        taskPayload({ title: "Read", focusMinutes: value }, "Asia/Tokyo"),
      ).toThrow("1 and 180");
  });
  it("accepts a title without a Pomodoro or schedule", () => {
    expect(taskPayload({ title: "Read a book" }, "Asia/Tokyo")).toMatchObject({
      title: "Read a book",
      scheduledDate: null,
      estimatedPomodoros: null,
    });
  });
  it("uses inclusive end dates and validates recurrence", () => {
    expect(recurrenceSummary("interval", 2, "2026-10-24")).toBe(
      "Every 2 days · through Oct 24, 2026 (inclusive)",
    );
    expect(() =>
      taskPayload(
        {
          title: "Read",
          scheduledDate: "2026-10-25",
          cadence: "daily",
          endDate: "2026-10-24",
        },
        "Asia/Tokyo",
      ),
    ).toThrow("End date");
  });
  it("converts deadlines in the account timezone and rejects missing local times", () => {
    expect(
      taskPayload({ title: "Read", deadline: "2026-10-21T09:00" }, "Asia/Tokyo")
        .deadline,
    ).toBe("2026-10-21T00:00:00.000Z");
    expect(() =>
      taskPayload(
        { title: "Read", deadline: "2026-03-08T02:30" },
        "America/New_York",
      ),
    ).toThrow("does not exist");
  });
  it("classifies progress without treating no-plan as failure", () => {
    expect([null, 0, 20, 50, 80, 100].map(progressLevel)).toEqual([
      "empty",
      "zero",
      "starting",
      "building",
      "strong",
      "complete",
    ]);
  });
});

it("submits an explicit next-day end in the account timezone", () => {
  expect(
    taskPayload(
      {
        title: "Overnight",
        scheduledDate: "2026-11-22",
        scheduledEndDate: "2026-11-23",
        startTime: "23:30",
        endTime: "01:00",
      },
      "Asia/Tokyo",
    ),
  ).toMatchObject({ scheduledEndDate: "2026-11-23", endTime: "01:00" });
});

it("rejects a scheduled endpoint in a daylight-saving gap", () => {
  expect(() =>
    taskPayload(
      {
        title: "Gap",
        scheduledDate: "2026-03-08",
        startTime: "01:45",
        endTime: "02:15",
      },
      "America/New_York",
    ),
  ).toThrow("does not exist");
});

it("preserves the unchanged second-fold endpoint while editing the first", () => {
  expect(() =>
    taskPayload(
      {
        title: "Fold",
        scheduledDate: "2026-11-01",
        startTime: "01:50",
        endTime: "01:10",
      },
      "America/New_York",
      {
        editing: true,
        previousTask: {
          scheduledStartAt: "2026-11-01T05:00:00Z",
          scheduledEndAt: "2026-11-01T06:10:00Z",
        } as import("../../../shared/api/domainTypes").Task,
      },
    ),
  ).not.toThrow();
});
