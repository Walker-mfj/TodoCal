import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TaskEditor } from "./taskEditor";
const base = {
  zone: "Asia/Tokyo",
  owner: "user-one",
  groups: [],
  disabled: false,
  onClose: vi.fn(),
  onSaved: vi.fn(),
};
it("saves a title-only task without requiring Pomodoro", async () => {
  const save = vi.fn().mockResolvedValue({});
  render(<TaskEditor {...base} execute={save} />);
  fireEvent.change(screen.getByLabelText("Task title"), {
    target: { value: "Read" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][1].body).toMatchObject({
    title: "Read",
    estimatedPomodoros: null,
    scheduledDate: null,
  });
});
it("shows recurrence summary and preserves input after failed save", async () => {
  const save = vi.fn().mockRejectedValue(new Error("Try again"));
  render(<TaskEditor {...base} execute={save} />);
  fireEvent.change(screen.getByLabelText("Task title"), {
    target: { value: "Write" },
  });
  fireEvent.change(screen.getByLabelText("Scheduled date"), {
    target: { value: "2026-10-21" },
  });
  fireEvent.change(screen.getByLabelText("Repeat"), {
    target: { value: "interval" },
  });
  fireEvent.change(screen.getByLabelText("Repeat until (inclusive)"), {
    target: { value: "2026-10-23" },
  });
  expect(
    screen.getByText("Every 2 days · through Oct 23, 2026 (inclusive)"),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  await screen.findByText("Try again");
  expect(screen.getByLabelText("Task title")).toHaveValue("Write");
});
it("restores drafts only for their owner", () => {
  const save = vi.fn();
  const { unmount } = render(<TaskEditor {...base} execute={save} />);
  fireEvent.change(screen.getByLabelText("Task title"), {
    target: { value: "Private draft" },
  });
  unmount();
  const other = render(
    <TaskEditor {...base} owner="user-two" execute={save} />,
  );
  expect(screen.getByLabelText("Task title")).toHaveValue("");
  other.unmount();
  render(<TaskEditor {...base} execute={save} />);
  expect(screen.getByLabelText("Task title")).toHaveValue("Private draft");
});
it("keeps the original revision when restoring an edited draft", async () => {
  const task = {
    id: "task-1",
    title: "Original",
    description: "",
    groupId: null,
    priority: "medium" as const,
    scheduledDate: null,
    startTime: null,
    endTime: null,
    deadline: null,
    estimatedPomodoros: null,
    status: "incomplete" as const,
    revision: 1,
    createdAt: "",
    updatedAt: "",
    seriesId: null,
    originalOccurrenceDate: null,
  };
  const save = vi.fn().mockResolvedValue({});
  const first = render(<TaskEditor {...base} task={task} execute={save} />);
  fireEvent.change(screen.getByLabelText("Task title"), {
    target: { value: "My draft" },
  });
  first.unmount();
  render(
    <TaskEditor
      {...base}
      task={{ ...task, title: "Edited elsewhere", revision: 2 }}
      execute={save}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][1].body.expectedRevision).toBe(1);
});
it("does not remove another editor draft when an unmounted save completes", async () => {
  let finish!: (value: unknown) => void;
  const save = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const saved = vi.fn();
  const editor = render(
    <TaskEditor {...base} execute={save as never} onSaved={saved} />,
  );
  fireEvent.change(screen.getByLabelText("Task title"), {
    target: { value: "Slow task A" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  editor.unmount();
  sessionStorage.setItem(
    "focus:draft:user-one:new",
    JSON.stringify({ draft: { title: "New task B" } }),
  );
  finish({});
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(saved).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("focus:draft:user-one:new")).toContain(
    "New task B",
  );
});

it("changes the calendar slot without replacing draft content", async () => {
  const editor = render(
    <TaskEditor
      {...base}
      execute={vi.fn()}
      seed={{
        scheduledDate: "2026-10-24",
        startTime: "09:00",
        endTime: "09:30",
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Task title"), {
    target: { value: "Keep this title" },
  });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Keep these notes" },
  });
  editor.rerender(
    <TaskEditor
      {...base}
      execute={vi.fn()}
      seed={{
        scheduledDate: "2026-10-25",
        startTime: "11:00",
        endTime: "12:00",
      }}
    />,
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Start time")).toHaveValue("11:00"),
  );
  expect(screen.getByLabelText("Task title")).toHaveValue("Keep this title");
  expect(screen.getByLabelText("Description")).toHaveValue("Keep these notes");
  expect(screen.getByLabelText("Scheduled date")).toHaveValue("2026-10-25");
  expect(screen.getByLabelText("End time")).toHaveValue("12:00");
});
it("tracks description-only edits and becomes clean when reverted", async () => {
  const state = vi.fn();
  render(<TaskEditor {...base} execute={vi.fn()} onStateChange={state} />);
  await waitFor(() =>
    expect(state).toHaveBeenLastCalledWith({ dirty: false, blocked: false }),
  );
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Notes without a title" },
  });
  await waitFor(() =>
    expect(state).toHaveBeenLastCalledWith({ dirty: true, blocked: false }),
  );
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "" },
  });
  await waitFor(() =>
    expect(state).toHaveBeenLastCalledWith({ dirty: false, blocked: false }),
  );
});
it("keeps uncertain save contents and schedule fixed when another slot is selected", async () => {
  const execute = vi.fn().mockRejectedValue(new TypeError("Lost response"));
  const editor = render(
    <TaskEditor
      {...base}
      execute={execute}
      seed={{
        scheduledDate: "2026-10-24",
        startTime: "09:00",
        endTime: "09:30",
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Task title"), {
    target: { value: "Pending task" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  await screen.findByRole("button", { name: "Retry save" });
  editor.rerender(
    <TaskEditor
      {...base}
      execute={execute}
      seed={{
        scheduledDate: "2026-10-25",
        startTime: "11:00",
        endTime: "12:00",
      }}
    />,
  );
  expect(screen.getByLabelText("Start time")).toHaveValue("09:00");
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  expect(execute.mock.calls[1]).toEqual(execute.mock.calls[0]);
});

it("places schedule validation beside the invalid end time", async () => {
  render(
    <TaskEditor
      {...base}
      execute={vi.fn()}
      seed={{
        title: "Read",
        scheduledDate: "2030-10-26",
        startTime: "10:00",
        endTime: "09:00",
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  const alert = await screen.findByRole("alert");
  expect(screen.getByLabelText("End time").nextElementSibling).toBe(alert);
});

it("clears its confirmed pending draft after navigating away during save", async () => {
  let finish!: (value: unknown) => void;
  const execute = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const editor = render(<TaskEditor {...base} execute={execute as never} />);
  fireEvent.change(screen.getByLabelText("Task title"), {
    target: { value: "Save while leaving" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() => expect(execute).toHaveBeenCalled());
  editor.unmount();
  finish({});
  await waitFor(() =>
    expect(sessionStorage.getItem("focus:draft:user-one:new")).toBeNull(),
  );
});

it("plans focus with a custom session length without changing the scheduled interval", async () => {
  const save = vi.fn().mockResolvedValue({});
  render(
    <TaskEditor
      {...base}
      execute={save}
      seed={{
        title: "Read",
        scheduledDate: "2026-10-20",
        startTime: "09:00",
        endTime: "10:00",
      }}
    />,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Plan focus" }));
  fireEvent.change(screen.getByLabelText("Planned Pomodoros"), {
    target: { value: "3" },
  });
  fireEvent.change(screen.getByLabelText("Session length (minutes)"), {
    target: { value: "40" },
  });
  expect(screen.getByText("Planned Focus Time: 120 min")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][1].body).toMatchObject({
    estimatedPomodoros: 3,
    focusMinutes: 40,
    scheduledDate: "2026-10-20",
    startTime: "09:00",
    endTime: "10:00",
  });
});

it.each([
  ["daily", 1, 2],
  ["interval", 5, 5],
] as const)(
  "keeps a valid interval when editing a %s series",
  async (cadence, intervalDays, expected) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              cadence,
              intervalDays,
              endDate: null,
              revision: 1,
            }),
            { headers: { "X-Account-ID": base.owner } },
          ),
        ),
    );
    try {
      render(
        <TaskEditor
          {...base}
          execute={vi.fn()}
          task={{
            id: "recurring-task",
            title: "Repeat",
            description: "",
            groupId: null,
            priority: "medium",
            scheduledDate: "2030-10-20",
            startTime: null,
            endTime: null,
            deadline: null,
            estimatedPomodoros: null,
            status: "incomplete",
            revision: 1,
            createdAt: "",
            updatedAt: "",
            seriesId: "series-one",
            originalOccurrenceDate: "2030-10-20",
          }}
        />,
      );
      await waitFor(() =>
        expect(screen.getByLabelText("Repeat")).toHaveValue(cadence),
      );
      if (cadence === "daily")
        fireEvent.change(screen.getByLabelText("Repeat"), {
          target: { value: "interval" },
        });
      else
        fireEvent.change(screen.getByLabelText("Repeat until (inclusive)"), {
          target: { value: "2030-10-30" },
        });
      expect(screen.getByLabelText("Every (days)")).toHaveValue(expected);
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
