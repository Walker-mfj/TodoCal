import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { AppDialogProvider } from "../src/components/app-dialog";
import { TaskEditor } from "../src/features/tasks/editor";

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
function Harness({ execute = vi.fn().mockResolvedValue({}) }) {
  const [open, setOpen] = useState(true);
  return (
    <AppDialogProvider>
      {open ? (
        <TaskEditor
          owner="escape-test"
          zone="Asia/Tokyo"
          groups={[]}
          disabled={false}
          execute={execute}
          onSaved={() => {}}
          onClose={() => setOpen(false)}
        />
      ) : (
        <p>Editor closed</p>
      )}
    </AppDialogProvider>
  );
}
it("closes a clean editor with Escape", async () => {
  render(<Harness />);
  fireEvent.keyDown(screen.getByLabelText("Task title"), { key: "Escape" });
  expect(await screen.findByText("Editor closed")).toBeVisible();
});
it("preserves a dirty draft on cancellation and only discards after confirmation", async () => {
  render(<Harness />);
  const title = screen.getByLabelText("Task title");
  fireEvent.change(title, { target: { value: "Keep this draft" } });
  fireEvent.keyDown(title, { key: "Escape" });
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByText("Editor closed")).not.toBeInTheDocument();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(title).toHaveValue("Keep this draft");
  expect(sessionStorage.getItem("focus:draft:escape-test:new")).toContain(
    "Keep this draft",
  );
  fireEvent.keyDown(title, { key: "Escape" });
  fireEvent.click(
    await screen.findByRole("button", { name: "Discard changes" }),
  );
  expect(await screen.findByText("Editor closed")).toBeVisible();
  expect(sessionStorage.getItem("focus:draft:escape-test:new")).toBeNull();
});
it("does not close while saving or consume a select's Escape", async () => {
  const execute = vi.fn(() => new Promise(() => {}));
  render(<Harness execute={execute} />);
  fireEvent.keyDown(screen.getByLabelText("Priority"), { key: "Escape" });
  expect(screen.getByLabelText("Task title")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Task title"), {
    target: { value: "Saving" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Close editor" })).toBeDisabled(),
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Task title")).toBeVisible();
});
