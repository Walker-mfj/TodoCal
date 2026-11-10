import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TimerPanel } from "./timerPanel";
const mocks = vi.hoisted(() => ({ read: vi.fn(), query: null as any }));
vi.mock("../../../auth", () => ({
  useSession: () => ({ session: { user: { id: "owner" } }, read: mocks.read }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (query: any) => {
    mocks.query = query;
    return { data: [], isPending: false };
  },
}));
it("selects a task without a Pomodoro goal and uses its custom duration", async () => {
  const start = vi.fn();
  render(
    <TimerPanel
      task={
        {
          id: "task",
          title: "No goal",
          estimatedPomodoros: null,
          focusMinutes: 40,
        } as any
      }
      settings={
        { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 } as any
      }
      focus={
        {
          state: {},
          start,
          remaining: 0,
          blocked: false,
          command: {},
          query: {},
        } as any
      }
      onClose={() => {}}
      onFree={() => {}}
    />,
  );
  expect(screen.getByRole("spinbutton")).toHaveValue(40);
  await userEvent.click(screen.getByRole("button", { name: "Start session" }));
  expect(start).toHaveBeenCalledWith("focus", "task", 40);
});

it("includes today's completed tasks and excludes other days", async () => {
  render(
    <TimerPanel
      task={null}
      settings={
        {
          timezone: "UTC",
          focusMinutes: 25,
          shortBreakMinutes: 5,
          longBreakMinutes: 15,
        } as any
      }
      focus={
        {
          state: {},
          remaining: 0,
          blocked: false,
          command: {},
          query: {},
        } as any
      }
      onClose={() => {}}
      onFree={() => {}}
    />,
  );
  const date = mocks.query.queryKey[2];
  mocks.read.mockResolvedValue({
    items: [
      { id: "today", status: "incomplete", scheduledDate: date },
      { id: "past", status: "incomplete", scheduledDate: "2000-01-01" },
      { id: "done", status: "complete", scheduledDate: date },
    ],
    nextCursor: null,
  });
  const result = await mocks.query.queryFn({
    signal: new AbortController().signal,
  });
  expect(result.map((task: any) => task.id)).toEqual(["today", "done"]);
  expect(mocks.read.mock.calls.at(-1)?.[0]).toContain("view=today");
  expect(mocks.read.mock.calls.at(-1)?.[0]).not.toContain("status=");
});

it("names session modes and explains denied notifications without blocking focus", () => {
  render(
    <TimerPanel
      task={null}
      settings={
        {
          timezone: "UTC",
          focusMinutes: 25,
          shortBreakMinutes: 5,
          longBreakMinutes: 15,
        } as any
      }
      focus={
        {
          state: {},
          blocked: false,
          permission: "denied",
          command: {},
          query: {},
        } as any
      }
      onClose={() => {}}
      onFree={() => {}}
    />,
  );
  expect(screen.getByRole("group", { name: "Session mode" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Notifications are blocked",
  );
  expect(screen.getByRole("button", { name: "Start session" })).toBeEnabled();
});
