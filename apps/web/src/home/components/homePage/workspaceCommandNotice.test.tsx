import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/api/apiClient";
import { ToastProvider } from "../../../shared/components/toast/toast";
import { useCommand } from "../../../shared/hooks/useCommand";
import { WorkspaceCommandNotice } from "./workspaceCommandNotice";

it.each([true, false])(
  "keeps workspace retry feedback until settlement (success: %s)",
  async (success) => {
    let settle!: () => void;
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, "Original failure"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            settle = () =>
              success
                ? resolve({})
                : reject(new ApiError(500, "Retry failed"));
          }),
      );
    const onSuccess = vi.fn();
    function Harness() {
      const command = useCommand(execute);
      return (
        <ToastProvider>
          <button
            onClick={() =>
              void command.run("/tasks/a/completion", "POST", {
                complete: true,
              })
            }
          >
            Complete task
          </button>
          <WorkspaceCommandNotice
            message=""
            command={command}
            connected
            onRetry={() => command.run("", "", null, onSuccess)}
            onDismiss={command.dismissError}
          />
        </ToastProvider>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Complete task" }));
    await screen.findByText("Original failure");
    const retry = screen.getByRole("button", { name: "Retry request" });
    expect(retry).toHaveAttribute("aria-busy", "false");
    fireEvent.click(retry);
    const pending = await screen.findByRole("status");
    expect(pending).toHaveTextContent("Confirming the previous request…");
    const pendingButton = screen.getByRole("button", { name: "Retry request" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");
    expect(pendingButton.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("Original failure")).toBeNull();
    expect(execute.mock.calls[1]).toEqual(execute.mock.calls[0]);
    await act(async () => settle());
    expect(screen.queryByRole("status")).toBeNull();
    if (success) {
      expect(onSuccess).toHaveBeenCalledOnce();
      expect(screen.queryByRole("button", { name: "Retry request" })).toBeNull();
    } else {
      expect(screen.getByRole("alert")).toHaveTextContent("Retry failed");
      const retryAgain = screen.getByRole("button", { name: "Retry request" });
      expect(retryAgain).toBeEnabled();
      expect(retryAgain).toHaveAttribute("aria-busy", "false");
      expect(retryAgain.querySelector("svg")).toBeNull();
      expect(onSuccess).not.toHaveBeenCalled();
    }
  },
);
