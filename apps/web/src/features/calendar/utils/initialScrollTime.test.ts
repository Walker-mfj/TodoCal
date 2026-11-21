import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { initialCalendarScrollTime } from "./initialScrollTime";

describe("initialCalendarScrollTime", () => {
  it("shows four hours before now in the account timezone", () => {
    const instant = DateTime.fromISO("2026-11-21T12:34:56Z");
    expect(initialCalendarScrollTime("Asia/Tokyo", instant)).toBe("17:34:56");
    expect(initialCalendarScrollTime("America/Los_Angeles", instant)).toBe(
      "00:34:56",
    );
  });

  it("keeps late-night context within the same day", () => {
    const instant = DateTime.fromISO("2026-11-21T14:45:00Z");
    expect(initialCalendarScrollTime("Asia/Tokyo", instant)).toBe("19:45:00");
  });

  it("clamps to midnight instead of wrapping into the previous day", () => {
    const instant = DateTime.fromISO("2026-11-21T15:30:00Z");
    expect(initialCalendarScrollTime("Asia/Tokyo", instant)).toBe("00:00:00");
  });

  it("uses wall-clock time during daylight-saving changes", () => {
    const summer = DateTime.fromISO("2026-07-21T12:34:56Z");
    expect(initialCalendarScrollTime("America/Los_Angeles", summer)).toBe(
      "01:34:56",
    );
    const springForward = DateTime.fromISO("2026-03-08T10:30:00Z");
    expect(
      initialCalendarScrollTime("America/Los_Angeles", springForward),
    ).toBe("00:00:00");
  });
});
