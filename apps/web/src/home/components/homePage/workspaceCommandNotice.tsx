"use client";
import { useState } from "react";
import { LoadingIndicator } from "../../../shared/components/loadingIndicator/loadingIndicator";
import { ToastNotice } from "../../../shared/components/toast/toast";
import type { useCommand } from "../../../shared/hooks/useCommand";
import { usePendingAction } from "../../../shared/hooks/usePendingAction";
import { bindStyles } from "../../../shared/utils/classNames";
const cx = bindStyles();

export function WorkspaceCommandNotice({
  message,
  command,
  connected,
  onRetry,
  onDismiss,
}: {
  message: string;
  command: ReturnType<typeof useCommand>;
  connected: boolean;
  onRetry: () => Promise<void>;
  onDismiss: () => void;
}) {
  const actions = usePendingAction();
  const [attempt, setAttempt] = useState(0);
  const retrying = actions.isPending("retry");
  if (!retrying && !message && !command.error) return null;
  return (
    <ToastNotice
      tone={
        retrying
          ? "info"
          : !command.error && message.startsWith("Confirm the pending save")
            ? "warning"
            : "error"
      }
      duration={retrying || command.uncertain ? 0 : undefined}
      resetKey={
        retrying ? `command-retry-pending:${attempt}` : message || command.error
      }
      onDismiss={onDismiss}
    >
      {retrying ? "Confirming the previous request…" : message || command.error}
      {(retrying || command.uncertain) && (
        <button
          disabled={!connected || command.busy || retrying}
          onClick={() => {
            setAttempt((previous) => previous + 1);
            void actions.run("retry", onRetry);
          }}
          className={cx("", true)}
          data-pending-control="true"
          aria-busy={retrying}
        >
          <span data-button-content="true">
            {retrying && <LoadingIndicator />}
            Retry request
          </span>
          <span aria-hidden="true" data-button-reserve="true">
            Retry request
          </span>
        </button>
      )}
    </ToastNotice>
  );
}
