import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { CalendarEventContent } from "../eventContent/eventContent";
const task = {
  id: "task",
  title: "Read",
  priority: "high",
  status: "incomplete",
  estimatedPomodoros: 2,
  focusMinutes: 25,
  actualFocusSeconds: 2220,
  seriesId: "series",
} as any;
function card(
  overrides: Record<string, unknown> = {},
  controller: Record<string, unknown> = {},
) {
  const focus = {
    active: null,
    receivedAt: performance.now(),
    blocked: false,
    start: vi.fn(),
    change: vi.fn(),
    command: {},
    ...controller,
  };
  const open = vi.fn(),
    click = vi.fn(),
    pointer = vi.fn();
  const result = render(
    <div onClick={click} onPointerDown={pointer}>
      <CalendarEventContent
        title="Read"
        timeText="10:00"
        priority="high"
        compact
        complete={false}
        draft={false}
        repeating
        task={{ ...task, ...overrides }}
        focus={focus as any}
        defaultFocusMinutes={30}
        onOpenFocus={open}
      />
    </div>,
  );
  return { ...result, focus, open, click, pointer };
}
it("shows actual partial focus adjacent to title and permits excess clocks", () => {
  const { rerender } = card();
  expect(screen.getByLabelText("37 / 50 min focus")).toBeInTheDocument();
  expect(document.querySelectorAll(".focus-stopwatch")).toHaveLength(2);
  expect(document.querySelector('[data-fill="0.48"]')).toBeInTheDocument();
  rerender(
    <CalendarEventContent
      title="Read"
      timeText=""
      compact
      complete={false}
      draft={false}
      repeating={false}
      task={{ ...task, actualFocusSeconds: 4500 }}
    />,
  );
  expect(document.querySelectorAll(".focus-stopwatch")).toHaveLength(3);
});
it("starts focus by keyboard without opening details or initiating a drag", async () => {
  const { focus, open, click, pointer } = card({
    estimatedPomodoros: null,
    focusMinutes: null,
  });
  const button = screen.getByRole("button", {
    name: "Start focus for Read · 30 min",
  });
  fireEvent.pointerDown(button);
  button.focus();
  await userEvent.keyboard("{Enter}");
  expect(focus.start).toHaveBeenCalledWith("focus", "task", 30);
  expect(open).toHaveBeenCalledOnce();
  expect(click).not.toHaveBeenCalled();
  expect(pointer).not.toHaveBeenCalled();
});
it.each(["running", "paused"])(
  "offers the existing %s timer instead of starting a second session",
  async (status) => {
    const { focus, open } = card(
      {},
      {
        active: {
          taskId: "other",
          taskTitle: "Other task",
          kind: "focus",
          status,
        },
      },
    );
    await userEvent.click(screen.getByRole("button", { name: /Start focus/ }));
    expect(focus.start).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Other task");
    await userEvent.click(
      screen.getByRole("button", { name: "Open current timer" }),
    );
    expect(open).toHaveBeenCalled();
  },
);
it.each([
  ["running", "Pause", "pause"],
  ["paused", "Resume", "resume"],
])("keeps %s controls on completed tasks", async (status, label, action) => {
  const { focus, open } = card(
    { status: "complete" },
    {
      active: {
        taskId: "task",
        kind: "focus",
        status,
        targetSeconds: 90,
        elapsedSeconds: 0,
      },
    },
  );
  expect(screen.getByText("01:30")).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: `${label} focus for Read` }),
  );
  expect(focus.change).toHaveBeenCalledWith(action);
  expect(open).toHaveBeenCalledTimes(action === "resume" ? 1 : 0);
});
it("hides new focus on done tasks and disables requests while busy", () => {
  card({ status: "complete" });
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
