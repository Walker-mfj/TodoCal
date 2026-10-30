import { beforeEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TaskDetail } from "./taskDetail";
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
const fixtures = vi.hoisted(() => ({
  series: {
    revision: 7,
    cadence: "daily",
    intervalDays: 1,
    endDate: null,
    stoppedAfter: null,
    task: { scheduledDate: "2026-10-01" },
  },
  focus: {
    actualFocusSeconds: 2220,
    sessions: [
      {
        id: "session",
        status: "ended",
        focusSeconds: 2220,
        targetSeconds: 2400,
        startedAt: "2026-10-20T01:00:00Z",
        endedAt: "2026-10-20T01:40:00Z",
      },
    ],
  },
}));
vi.mock("../../../auth/hooks/useOwnedQuery", () => ({
  useOwnedQuery: (name: string) => ({
    data:
      name === "series"
        ? fixtures.series
        : name === "task-focus"
          ? fixtures.focus
          : undefined,
    isPending: false,
  }),
}));
const task = {
  id: "one",
  title: "Read",
  description: "",
  groupId: null,
  priority: "medium" as const,
  scheduledDate: "2026-10-20",
  startTime: "09:00",
  endTime: "10:00",
  deadline: null,
  estimatedPomodoros: 2,
  focusMinutes: 25,
  actualFocusSeconds: 2220,
  completedAt: "2026-10-20T02:00:00Z",
  status: "complete" as const,
  revision: 4,
  createdAt: "",
  updatedAt: "",
  seriesId: null,
  originalOccurrenceDate: null,
};
const base = {
  task,
  historical: true,
  zone: "Asia/Tokyo",
  groups: [],
  disabled: false,
  onClose: vi.fn(),
  onEdit: vi.fn(),
  onCurrent: vi.fn(),
  onComplete: vi.fn(),
  onDeleted: vi.fn(),
};
it("updates the completion instant in account timezone without rescheduling", async () => {
  const execute = vi.fn().mockResolvedValue({});
  render(<TaskDetail {...base} execute={execute} />);
  fireEvent.change(screen.getByLabelText("Change completed at"), {
    target: { value: "2026-10-19T14:30" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save completion time" }));
  await waitFor(() => expect(execute).toHaveBeenCalled());
  expect(execute.mock.calls[0][0]).toBe("/tasks/one/completion");
  expect(execute.mock.calls[0][1].body).toEqual({
    complete: true,
    completedAt: "2026-10-19T05:30:00.000Z",
    expectedRevision: 4,
  });
});
it("deletes a single task directly and passes the task for Undo", async () => {
  const execute = vi.fn().mockResolvedValue({}),
    onDeleted = vi.fn();
  render(<TaskDetail {...base} execute={execute} onDeleted={onDeleted} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete task" }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(task));
  expect(execute.mock.calls[0][1]).toMatchObject({
    method: "DELETE",
    body: { expectedRevision: 4 },
  });
});
it("offers occurrence deletion and stopping separately without a destructive default", async () => {
  const execute = vi.fn().mockResolvedValue({}),
    onStopped = vi.fn();
  render(
    <TaskDetail
      {...base}
      task={{ ...task, seriesId: "series" }}
      execute={execute}
      onStopped={onStopped}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete task" }));
  expect(execute).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Delete this occurrence" }),
  ).toBeEnabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Stop repeating" }));
  await waitFor(() => expect(onStopped).toHaveBeenCalledWith("series", 8));
  expect(execute.mock.calls[0][0]).toBe("/series/series/stop");
});
it("distinguishes actual time and ended-early sessions from planned time", () => {
  render(<TaskDetail {...base} execute={vi.fn()} />);
  expect(screen.getByText("2 × 25 min = 50 min")).toBeVisible();
  expect(screen.getByText("37 min")).toBeVisible();
  expect(screen.getByText("Ended early")).toBeVisible();
  expect(screen.getByText(/37 active min \/ 40 min target/)).toBeVisible();
});
