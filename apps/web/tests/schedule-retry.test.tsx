import { it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSchedule } from "../src/features/calendar/use-schedule";
import type { Task } from "../src/lib/model";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), read: vi.fn() }));
vi.mock("../src/app/providers", () => ({
  useSession: () => ({
    session: { user: { id: "A" } },
    connected: true,
    execute: mocks.execute,
    read: mocks.read,
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

it("asks before scheduling a repeating task and cancels without saving", async () => {
  mocks.execute.mockReset();
  const { result } = renderHook(() => useSchedule());
  act(() =>
    result.current.schedule(
      { id: "repeat", seriesId: "series", revision: 1, title: "Read" } as Task,
      { scheduledDate: "2030-10-20", startTime: "10:00", endTime: "10:30" },
    ),
  );
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(result.current.choice?.task.id).toBe("repeat");
  act(() => result.current.cancelChoice());
  expect(result.current.choice).toBeNull();
  expect(mocks.execute).not.toHaveBeenCalled();
});
it("keeps the existing single-occurrence schedule and Undo path", async () => {
  mocks.execute.mockReset().mockResolvedValue({});
  const { result } = renderHook(() => useSchedule());
  act(() =>
    result.current.schedule(
      { id: "repeat", seriesId: "series", revision: 2, title: "Read" } as Task,
      { scheduledDate: "2030-10-20", startTime: "10:00", endTime: "10:30" },
    ),
  );
  await act(async () => result.current.chooseScope("one"));
  expect(mocks.execute.mock.calls[0][0]).toBe("/tasks/repeat/schedule");
  expect(mocks.execute.mock.calls[0][1].body.expectedRevision).toBe(2);
});

it("sends only schedule fields for all occurrences and retains scope on retry", async () => {
  mocks.read.mockResolvedValue({ revision: 4 });
  mocks.execute
    .mockReset()
    .mockRejectedValueOnce(new TypeError("Lost response"))
    .mockResolvedValue({});
  const { result } = renderHook(() => useSchedule());
  const schedule = {
    scheduledDate: "2030-10-20",
    startTime: "10:00",
    endTime: "10:30",
  };
  act(() =>
    result.current.schedule(
      {
        id: "repeat",
        seriesId: "series",
        revision: 2,
        title: "Read",
        scheduledDate: "2030-10-19",
      } as Task,
      schedule,
    ),
  );
  await act(async () => result.current.chooseScope("all"));
  expect(mocks.execute.mock.calls[0][0]).toBe("/tasks/repeat");
  expect(mocks.execute.mock.calls[0][1].body).toEqual({
    ...schedule,
    scope: "all",
    expectedRevision: 2,
    expectedSeriesRevision: 4,
  });
  const first = mocks.execute.mock.calls[0][1];
  await act(async () => result.current.retry());
  expect(mocks.execute.mock.calls[1][1].key).toBe(first.key);
  expect(mocks.execute.mock.calls[1][1].body).toEqual(first.body);
});
