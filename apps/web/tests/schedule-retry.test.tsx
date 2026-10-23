import { it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSchedule } from "../src/features/calendar/use-schedule";
import type { Task } from "../src/lib/model";
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../src/app/providers", () => ({
  useSession: () => ({
    session: { user: { id: "A" } },
    connected: true,
    execute: mocks.execute,
  }),
}));
afterEach(() => vi.useRealTimers());
it("does not subtract response latency twice from Undo", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
  });
  vi.setSystemTime(new Date("2030-10-19T12:00:00Z"));
  mocks.execute.mockImplementation(async (_path, options) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    options.onResponse(
      new Response("{}", { headers: { Date: new Date().toUTCString() } }),
    );
    return {
      task: {},
      undo: { id: "undo", expiresAt: "2030-10-19T12:00:10Z" },
      serverNow: "2030-10-19T12:00:00Z",
    };
  });
  const { result } = renderHook(() => useSchedule());
  act(() =>
    result.current.schedule(
      { id: "task", revision: 1, title: "Read" } as Task,
      { scheduledDate: "2030-10-19", startTime: "09:00", endTime: "09:30" },
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(result.current.toast).not.toBeNull();
  expect(result.current.toast!.deadline - performance.now()).toBe(5000);
});

it("dispatches and retries scheduling when storage writes and deletion fail", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new DOMException("Denied", "SecurityError");
  });
  mocks.execute
    .mockReset()
    .mockRejectedValueOnce(new TypeError("Lost response"))
    .mockResolvedValue({});
  const first = renderHook(() => useSchedule());
  await act(async () =>
    first.result.current.schedule(
      { id: "retry-task", revision: 1, title: "Read" } as Task,
      { scheduledDate: "2030-10-19", startTime: null, endTime: null },
    ),
  );
  expect(first.result.current.busy).toBe(false);
  const call = mocks.execute.mock.calls[0];
  first.unmount();
  const second = renderHook(() => useSchedule());
  await act(async () => second.result.current.retry());
  expect(mocks.execute.mock.calls[1][0]).toBe(call[0]);
  expect(mocks.execute.mock.calls[1][1].key).toBe(call[1].key);
  expect(mocks.execute.mock.calls[1][1].body).toEqual(call[1].body);
  expect(second.result.current.busy).toBe(false);
  expect(second.result.current.blocked).toBe(false);
});
