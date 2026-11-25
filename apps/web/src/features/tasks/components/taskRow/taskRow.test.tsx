import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TaskRow } from "./taskRow";
it("preserves its completion name and compact control while exposing pending state", async () => {
  let finish!: () => void;
  const promise = new Promise<void>((r) => {
    finish = r;
  });
  render(
    <TaskRow
      task={
        {
          id: "task",
          title: "My task",
          status: "todo",
          priority: "medium",
        } as any
      }
      onOpen={vi.fn()}
      onComplete={() => promise}
    />,
  );
  const button = screen.getByRole("button", { name: "Complete My task" });
  expect(button).toHaveAttribute("aria-busy", "false");
  const initialClass = button.className;
  fireEvent.click(button);
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button).toHaveAccessibleName("Complete My task");
  expect(button).not.toHaveAttribute("data-pending-control");
  expect(button.querySelector("svg")).toHaveStyle({
    width: "14px",
    height: "14px",
  });
  await act(async () => {
    finish();
    await promise;
  });
  expect(button).toHaveAttribute("aria-busy", "false");
  expect(button.className).toBe(initialClass);
});
