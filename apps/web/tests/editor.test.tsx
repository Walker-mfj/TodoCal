import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TaskEditor } from "../src/features/tasks/editor";
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
