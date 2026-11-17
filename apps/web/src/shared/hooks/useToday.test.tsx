import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useToday } from "./useToday";
afterEach(() => vi.useRealTimers());
it("rolls over at account midnight without interaction and cleans up", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-16T14:59:59Z"));
  const { result, unmount } = renderHook(() => useToday("Asia/Tokyo"));
  expect(result.current).toBe("2026-11-16");
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe("2026-11-17");
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it("resynchronizes after sleep and timezone changes", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-16T14:59:00Z"));
  const { result, rerender } = renderHook(({ zone }) => useToday(zone), {
    initialProps: { zone: "Asia/Tokyo" },
  });
  vi.setSystemTime(new Date("2026-11-17T01:30:00Z"));
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(result.current).toBe("2026-11-17");
  rerender({ zone: "America/New_York" });
  expect(result.current).toBe("2026-11-16");
});
it("follows daylight saving transitions", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-08T06:59:59Z"));
  const { result } = renderHook(() => useToday("America/New_York"));
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe("2026-03-08");
});

it("does not rerender consumers on minute ticks within the same day", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-16T01:00:00Z"));
  const renders = vi.fn();
  renderHook(() => {
    renders();
    return useToday("Asia/Tokyo");
  });
  const initial = renders.mock.calls.length;
  act(() => vi.advanceTimersByTime(10 * 60_000));
  expect(renders).toHaveBeenCalledTimes(initial);
});
