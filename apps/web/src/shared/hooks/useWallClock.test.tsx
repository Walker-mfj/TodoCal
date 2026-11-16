import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWallClock } from "./useWallClock";
afterEach(() => vi.useRealTimers());
it("rolls over at account midnight without interaction and cleans up", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-16T14:59:59Z"));
  const { result, unmount } = renderHook(() => useWallClock("Asia/Tokyo"));
  expect(result.current).toBe("2026-11-16T23:59:59Z");
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe("2026-11-17T00:00:00Z");
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it("resynchronizes after sleep and timezone changes", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-16T14:59:00Z"));
  const { result, rerender } = renderHook(({ zone }) => useWallClock(zone), {
    initialProps: { zone: "Asia/Tokyo" },
  });
  vi.setSystemTime(new Date("2026-11-17T01:30:00Z"));
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(result.current).toBe("2026-11-17T10:30:00Z");
  rerender({ zone: "America/New_York" });
  expect(result.current).toBe("2026-11-16T20:30:00Z");
});
it("follows daylight saving transitions", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-08T06:59:59Z"));
  const { result } = renderHook(() => useWallClock("America/New_York"));
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe("2026-03-08T03:00:00Z");
});
