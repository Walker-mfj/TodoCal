import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { initialCalendarScrollTime } from "./initialScrollTime";

describe("initialCalendarScrollTime", () => {
  it("shows three hours before now, rounded down to the hour, in the account timezone", () => {
    const instant = DateTime.fromISO("2026-11-21T12:34:56Z");
    expect(initialCalendarScrollTime("Asia/Tokyo", instant)).toBe("18:00:00");
    expect(initialCalendarScrollTime("America/Los_Angeles", instant)).toBe(
      "01:00:00",
    );
  });

  it.each([
    ["16:22:10", "13:00:00"],
    ["17:45:12", "14:00:00"],
    ["02:59:59", "00:00:00"],
    ["03:59:59", "00:00:00"],
  ])("rounds %s to %s", (time, expected) => {
    const instant = DateTime.fromISO(`2026-11-21T${time}`, {
      zone: "Asia/Tokyo",
    });
    expect(initialCalendarScrollTime("Asia/Tokyo", instant)).toBe(expected);
  });

  it("keeps late-night context within the same day", () => {
    const instant = DateTime.fromISO("2026-11-21T14:45:00Z");
    expect(initialCalendarScrollTime("Asia/Tokyo", instant)).toBe("20:00:00");
  });

  it("clamps to midnight instead of wrapping into the previous day", () => {
    const instant = DateTime.fromISO("2026-11-21T15:30:00Z");
    expect(initialCalendarScrollTime("Asia/Tokyo", instant)).toBe("00:00:00");
  });

  it("uses wall-clock time during daylight-saving changes", () => {
    const summer = DateTime.fromISO("2026-07-21T12:34:56Z");
    expect(initialCalendarScrollTime("America/Los_Angeles", summer)).toBe(
      "02:00:00",
    );
    const springForward = DateTime.fromISO("2026-03-08T10:30:00Z");
    expect(
      initialCalendarScrollTime("America/Los_Angeles", springForward),
    ).toBe("00:00:00");
  });
});
