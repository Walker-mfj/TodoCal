import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ScheduleScopeDialog } from "../src/features/calendar/schedule-scope-dialog";

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
it("traps focus between close and the last available recurrence action", () => {
  render(
    <ScheduleScopeDialog
      busy={false}
      error=""
      allAvailable={false}
      onCancel={vi.fn()}
      onChoose={vi.fn()}
    />,
  );
  const close = screen.getByRole("button", { name: "Close dialog" });
  close.focus();
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(screen.getByRole("button", { name: "This occurrence" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "Tab" });
  expect(close).toHaveFocus();
});
it("blocks dismissal while saving and restores focus after unmount", () => {
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();
  const onCancel = vi.fn();
  const view = render(
    <ScheduleScopeDialog
      busy={false}
      error=""
      allAvailable={true}
      onCancel={onCancel}
      onChoose={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  view.rerender(
    <ScheduleScopeDialog
      busy={true}
      error=""
      allAvailable={true}
      onCancel={onCancel}
      onChoose={vi.fn()}
    />,
  );
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(onCancel).not.toHaveBeenCalled();
  view.unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});
