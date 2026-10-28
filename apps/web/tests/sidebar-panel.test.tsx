import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { SidebarPanel } from "../src/components/sidebar-panel";
import { AppDialogProvider, useConfirm } from "../src/components/app-dialog";

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
function Details({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(true);
  const confirm = useConfirm();
  return open ? (
    <SidebarPanel
      label="Task details"
      eyebrow="TASK DETAILS"
      onClose={() => setOpen(false)}
    >
      <button
        onClick={async () => {
          if (
            await confirm("Delete this task?", {
              title: "Delete task?",
              destructive: true,
              confirmLabel: "Delete task",
            })
          )
            onDelete();
        }}
      >
        Delete task
      </button>
    </SidebarPanel>
  ) : (
    <p>Sidebar closed</p>
  );
}
it("Escape cancels deletion first, keeps the sidebar open, then closes it on the next press", async () => {
  const onDelete = vi.fn();
  render(
    <AppDialogProvider>
      <Details onDelete={onDelete} />
    </AppDialogProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete task" }));
  const dialog = await screen.findByRole("alertdialog", {
    name: "Delete task?",
  });
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("complementary", { name: "Task details" }),
  ).toBeVisible();
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape", repeat: true });
  expect(screen.queryByText("Sidebar closed")).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByText("Sidebar closed")).toBeVisible();
});
it("blocks Escape while a sidebar action is busy and removes the handler on unmount", () => {
  const onClose = vi.fn();
  const view = render(
    <SidebarPanel
      label="Task details"
      eyebrow="TASK DETAILS"
      disabled
      onClose={onClose}
    >
      Details
    </SidebarPanel>,
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  view.unmount();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
});
