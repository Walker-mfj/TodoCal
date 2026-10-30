import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ToastProvider } from "../../../../shared/components/toast/toast";
import { RecoveryToast } from "./recoveryToast";

it("restores the deleted revision and dismisses only after success", async () => {
  const execute = vi.fn().mockResolvedValue({});
  const onRestored = vi.fn();
  render(
    <ToastProvider>
      <RecoveryToast
        item={{ kind: "task", id: "task-1", revision: 8 }}
        execute={execute}
        connected
        onRestored={onRestored}
        onDismiss={() => {}}
      />
    </ToastProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(execute).toHaveBeenCalledWith(
      "/tasks/task-1/restore",
      expect.objectContaining({
        method: "POST",
        body: { expectedRevision: 8 },
      }),
    ),
  );
  expect(onRestored).toHaveBeenCalledOnce();
});

it("keeps retry available with the same idempotency key after an uncertain response", async () => {
  const execute = vi
    .fn()
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValue({});
  render(
    <ToastProvider>
      <RecoveryToast
        item={{ kind: "series", id: "series-1", revision: 3 }}
        execute={execute}
        connected
        onRestored={() => {}}
        onDismiss={() => {}}
      />
    </ToastProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Retry restore" }),
  );
  expect(execute.mock.calls[1]).toEqual(execute.mock.calls[0]);
});
