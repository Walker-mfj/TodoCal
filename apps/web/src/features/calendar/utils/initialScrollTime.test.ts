import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { initialCalendarScrollTime } from "./initialScrollTime";

describe("initialCalendarScrollTime", () => {
  it("starts at the current time in the account timezone", () => {
    const instant = DateTime.fromISO("2026-11-21T12:34:56Z");
    expect(initialCalendarScrollTime("Asia/Tokyo", instant)).toBe("21:34:56");
    expect(initialCalendarScrollTime("America/Los_Angeles", instant)).toBe(
      "04:34:56",
    );
  });

  it("handles daylight-saving changes using the actual instant", () => {
    const instant = DateTime.fromISO("2026-07-21T12:34:56Z");
    expect(initialCalendarScrollTime("America/Los_Angeles", instant)).toBe(
      "05:34:56",
    );
  });
});
