import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ScheduleScopeDialog } from "./scheduleScopeDialog";

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
  const cancel = screen.getByRole("button", { name: "Cancel" });
  fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
  expect(screen.getByRole("button", { name: "Close dialog" })).toHaveFocus();
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

import { useState } from "react";
it("shows the indicator only on the selected scope until its request finishes", async () => {
  let resolve!: () => void;
  const response = new Promise<void>((r) => (resolve = r));
  function Harness() {
    const [busy, setBusy] = useState(false);
    return (
      <ScheduleScopeDialog
        busy={busy}
        error=""
        allAvailable
        onCancel={vi.fn()}
        onChoose={async () => {
          setBusy(true);
          await response;
          setBusy(false);
        }}
      />
    );
  }
  render(<Harness />);
  const following = screen.getByRole("button", { name: "This and following" });
  const occurrence = screen.getByRole("button", { name: "This occurrence" });
  const reservation = [
    ...occurrence.querySelectorAll("[data-button-reserve]"),
  ].map((el) => el.textContent?.trim());
  expect(reservation).toEqual(
    expect.arrayContaining(["Saving…", "This occurrence"]),
  );
  expect(
    [...following.querySelectorAll("[data-button-reserve]")].map((el) =>
      el.textContent?.trim(),
    ),
  ).toEqual(expect.arrayContaining(["Saving…", "This and following"]));
  fireEvent.click(occurrence);
  expect(occurrence).toHaveAttribute("aria-busy", "true");
  expect(
    [...occurrence.querySelectorAll("[data-button-reserve]")].map((el) =>
      el.textContent?.trim(),
    ),
  ).toEqual(reservation);
  expect(
    screen.getByRole("button", { name: "Saving…" }).querySelector("svg"),
  ).not.toBeNull();
  expect(following.querySelector("svg")).toBeNull();
  expect(following).toBeDisabled();
  await act(async () => resolve());
  expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull();
  expect(screen.getByRole("button", { name: "This occurrence" })).toBeEnabled();
  expect(occurrence).toHaveAttribute("aria-busy", "false");
  expect(
    [...occurrence.querySelectorAll("[data-button-reserve]")].map((el) =>
      el.textContent?.trim(),
    ),
  ).toEqual(reservation);
});
